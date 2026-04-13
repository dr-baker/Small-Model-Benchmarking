import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { ANSWER_RESPONSE_SCHEMA_VERSION, PIPELINE_CONTRACT_VERSION, type BenchmarkAnswerResponse, type CollectRunInput, type CollectTrace, type PromptSnapshot, type RunManifest, type ToolInvocationTrace } from "../shared/contracts.js";
import { serializeJson, writeJsonFile } from "../shared/io.js";
import { toJsonValue } from "../shared/json.js";
import { createMinimalResourceLoader } from "./minimal-resource-loader.js";
import { renderPrompt } from "./prompt-template.js";
import { createToolsForToolSet } from "./tool-sets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

export interface CollectRunOutput {
  runDirectory: string;
  manifest: RunManifest;
  trace: CollectTrace;
  normalizedAnswer: BenchmarkAnswerResponse | { parseError: string; rawText?: string };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function createBenchmarkExecutionDirectoryName(benchmarkName: string): string {
  const isoDate = new Date().toISOString().slice(0, 10);
  return `${isoDate}-${slugify(benchmarkName)}`;
}

function validateSampling(input: CollectRunInput): void {
  const unsupported = [
    input.sampling.temperature !== undefined ? "temperature" : undefined,
    input.sampling.topP !== undefined ? "topP" : undefined,
    input.sampling.seed !== undefined ? "seed" : undefined,
  ].filter((value): value is string => value !== undefined);

  if (unsupported.length > 0) {
    throw new Error(
      `Sampling fields not yet wired through the pi SDK collect runner: ${unsupported.join(", ")}. Record them only after implementation support is added.`,
    );
  }
}

function validateInput(input: CollectRunInput): void {
  if (input.contractVersion !== PIPELINE_CONTRACT_VERSION) {
    throw new Error(`Unsupported contract version: ${input.contractVersion}`);
  }
  if (input.responseSchemaVersion !== ANSWER_RESPONSE_SCHEMA_VERSION) {
    throw new Error(`Unsupported response schema version: ${input.responseSchemaVersion}`);
  }
  if (input.mode === "closed_book" && input.toolSet.name !== "none") {
    throw new Error("Closed-book runs must use the 'none' tool set.");
  }
  validateSampling(input);
}

function validateParsedAnswer(value: unknown): value is BenchmarkAnswerResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== ANSWER_RESPONSE_SCHEMA_VERSION) {
    return false;
  }
  if (candidate.mode !== "closed_book" && candidate.mode !== "open_book") {
    return false;
  }
  if (typeof candidate.finalAnswer !== "string" || typeof candidate.confidence !== "number") {
    return false;
  }
  if (!Array.isArray(candidate.citations)) {
    return false;
  }
  if (candidate.mode === "closed_book") {
    return candidate.citations.length === 0;
  }
  return typeof candidate.evidenceSummary === "string";
}

function parseAnswer(rawText: string | undefined): BenchmarkAnswerResponse | { parseError: string; rawText?: string } {
  if (!rawText) {
    return { parseError: "Assistant produced no final text." };
  }

  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!validateParsedAnswer(parsed)) {
      return {
        parseError: "Assistant JSON did not match answer-response.v1 schema.",
        rawText,
      };
    }
    return parsed;
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
      rawText,
    };
  }
}

function getAssistantText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const content = (message as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .filter((item) => item?.type === "text")
    .map((item) => item.text ?? "")
    .join("");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function runCollect(input: CollectRunInput): Promise<CollectRunOutput> {
  validateInput(input);

  const startedAt = Date.now();
  const createdAt = new Date().toISOString();
  const benchmarkExecutionDirectory = resolve(
    REPO_ROOT,
    "benchmark-results",
    createBenchmarkExecutionDirectoryName(input.benchmarkName),
  );
  const runDirectory = join(benchmarkExecutionDirectory, input.runId);
  const tracePath = join(runDirectory, "trace.json");
  const normalizedAnswerPath = join(runDirectory, "normalized-answer.json");
  const judgePath = join(runDirectory, "judge.json");
  const gradePath = join(runDirectory, "grade.json");
  const aggregatePath = join(benchmarkExecutionDirectory, "aggregate.json");
  const manifestPath = join(runDirectory, "manifest.json");

  const corpusRoot = resolve(REPO_ROOT, input.corpus.rootDir);
  const userPrompt = await renderPrompt(input.promptTemplateId, input.mode, input.question);
  const responseSystemPrompt = "You are a benchmark runner. Follow the response schema exactly.";
  const resourceLoader = createMinimalResourceLoader(responseSystemPrompt);
  const tools = createToolsForToolSet(input.toolSet, corpusRoot);
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.find(input.model.provider, input.model.modelId);

  if (!model) {
    throw new Error(`Model not found in pi registry: ${input.model.provider}/${input.model.modelId}`);
  }

  const { session } = await createAgentSession({
    cwd: corpusRoot,
    tools,
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(corpusRoot),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 },
    }),
  });

  const toolInvocations = new Map<string, ToolInvocationTrace>();
  const events: CollectTrace["events"] = [];
  let runError: unknown;

  session.subscribe((event) => {
    const observedAt = new Date().toISOString();
    events.push({
      observedAt,
      eventType: event.type,
      payload: toJsonValue(event),
    });

    if (event.type === "tool_execution_start") {
      toolInvocations.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toJsonValue(event.args),
        startedAt: observedAt,
        updates: [],
      });
      return;
    }

    if (event.type === "tool_execution_update") {
      const existing = toolInvocations.get(event.toolCallId);
      if (existing) {
        existing.updates.push(toJsonValue(event.partialResult));
      }
      return;
    }

    if (event.type === "tool_execution_end") {
      const existing = toolInvocations.get(event.toolCallId);
      if (existing) {
        existing.finishedAt = observedAt;
        existing.isError = event.isError;
        existing.result = toJsonValue(event.result);
      }
    }
  });

  try {
    try {
      await session.prompt(userPrompt);
    } catch (error) {
      runError = error;
    }

    const assistantMessage = [...session.messages].reverse().find((message) => message.role === "assistant");
    const finalAssistantText = getAssistantText(assistantMessage);
    const normalizedAnswer = parseAnswer(finalAssistantText);
    const promptSnapshot: PromptSnapshot = {
      systemPrompt: session.systemPrompt,
      userPrompt,
      availableTools: session.getAllTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };

    const usageValue = assistantMessage && typeof assistantMessage === "object" && "usage" in assistantMessage
      ? (assistantMessage as { usage: { cost?: { total?: number } } }).usage
      : undefined;
    const costUsd = usageValue?.cost?.total;

    const trace: CollectTrace = {
      runId: input.runId,
      prompt: promptSnapshot,
      events,
      toolInvocations: [...toolInvocations.values()],
      ...(finalAssistantText !== undefined ? { finalAssistantText } : {}),
      ...(assistantMessage ? { finalAssistantMessage: toJsonValue(assistantMessage) } : {}),
      ...(usageValue !== undefined ? { usage: toJsonValue(usageValue) } : {}),
      ...(typeof costUsd === "number" ? { costUsd } : {}),
      ...(runError !== undefined ? { error: toJsonValue(runError) } : {}),
      elapsedMs: Date.now() - startedAt,
    };

    const piPackageJson = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    const piSdkVersion = piPackageJson.dependencies?.["@mariozechner/pi-coding-agent"] ?? "unknown";

    const manifest: RunManifest = {
      contractVersion: PIPELINE_CONTRACT_VERSION,
      runId: input.runId,
      benchmarkName: input.benchmarkName,
      createdAt,
      piSdkVersion,
      model: input.model,
      mode: input.mode,
      toolSet: input.toolSet,
      promptTemplateId: input.promptTemplateId,
      promptTemplateVersion: input.promptTemplateVersion,
      responseSchemaVersion: input.responseSchemaVersion,
      rubricVersion: input.rubricVersion,
      corpus: input.corpus,
      questionId: input.question.id,
      sampling: input.sampling,
      artifactPaths: {
        trace: tracePath,
        normalizedAnswer: normalizedAnswerPath,
        judge: judgePath,
        grade: gradePath,
        aggregate: aggregatePath,
      },
    };

    const traceContent = serializeJson(trace);
    const normalizedAnswerContent = serializeJson(normalizedAnswer);
    const manifestWithHashes = {
      ...manifest,
      traceSha256: sha256(traceContent),
      normalizedAnswerSha256: sha256(normalizedAnswerContent),
    };

    await writeJsonFile(tracePath, trace);
    await writeJsonFile(normalizedAnswerPath, normalizedAnswer);
    await writeJsonFile(manifestPath, manifestWithHashes);

    if (runError !== undefined) {
      throw runError;
    }

    return {
      runDirectory,
      manifest,
      trace,
      normalizedAnswer,
    };
  } finally {
    session.dispose();
  }
}
