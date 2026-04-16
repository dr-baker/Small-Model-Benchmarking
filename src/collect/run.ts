import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ANSWER_RESPONSE_SCHEMA_VERSION,
  PIPELINE_CONTRACT_VERSION,
  type BenchmarkAnswerResponse,
  type CollectRetryMetadata,
  type CollectRunInput,
  type CollectTrace,
  type PromptMessageSnapshot,
  type PromptSnapshot,
  type RunManifest,
} from "../shared/contracts.js";
import { serializeJson, writeJsonFile } from "../shared/io.js";
import { extractJsonObject } from "../shared/json.js";
import { renderPrompt, renderPromptMessages } from "./prompt-template.js";
import { createToolsForToolSet } from "./tool-sets.js";
import { runLlmClient } from "../shared/llm-client.js";
import { buildAnswerResponseFormat } from "../shared/response-schemas.js";
import { resolveModelApiKey } from "../shared/api-key.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

export interface CollectRunOutput {
  runDirectory: string;
  manifest: RunManifest;
  trace: CollectTrace;
  normalizedAnswer: BenchmarkAnswerResponse | { parseError: string; rawText?: string };
  hasError: boolean;
}

function validateInput(input: CollectRunInput): void {
  if (input.contractVersion !== PIPELINE_CONTRACT_VERSION) throw new Error(`Unsupported contract version: ${input.contractVersion}`);
  if (input.responseSchemaVersion !== ANSWER_RESPONSE_SCHEMA_VERSION) throw new Error(`Unsupported response schema version: ${input.responseSchemaVersion}`);
  if (input.mode === "closed_book" && input.toolSet.name !== "none") throw new Error("Closed-book runs must use the 'none' tool set.");
}

function validateParsedAnswer(value: unknown): value is BenchmarkAnswerResponse {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (c.schemaVersion !== ANSWER_RESPONSE_SCHEMA_VERSION) return false;
  if (c.mode !== "closed_book" && c.mode !== "open_book") return false;
  if (typeof c.finalAnswer !== "string" || c.finalAnswer.trim().length === 0) return false;
  if (typeof c.confidence !== "number") return false;
  if (!Array.isArray(c.citations)) return false;

  if (c.mode === "closed_book") {
    return c.citations.length === 0;
  }

  return typeof c.evidenceSummary === "string" && c.evidenceSummary.trim().length > 0;
}

function parseAnswer(rawText: string | undefined): BenchmarkAnswerResponse | { parseError: string; rawText?: string } {
  if (!rawText) return { parseError: "Assistant produced no final text." };
  try {
    const parsed = extractJsonObject(rawText);
    return validateParsedAnswer(parsed)
      ? parsed
      : { parseError: "Assistant JSON did not match answer-response.v1 schema or contained an empty answer.", rawText };
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error), rawText };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toUsageTotals(value: unknown): { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : promptTokens + completionTokens;
  const cost = typeof usage.cost === "number" ? usage.cost : undefined;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0 && cost === undefined) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cost !== undefined ? { cost } : {}),
  };
}

function isParseErrorResult(value: BenchmarkAnswerResponse | { parseError: string; rawText?: string }): value is { parseError: string; rawText?: string } {
  return "parseError" in value;
}

export async function runCollect(input: CollectRunInput): Promise<CollectRunOutput> {
  validateInput(input);

  const startedAt = Date.now();
  const createdAt = new Date().toISOString();
  const runDirectory = join(input.executionDirectory, input.runId);
  const tracePath = join(runDirectory, "trace.json");
  const normalizedAnswerPath = join(runDirectory, "normalized-answer.json");
  const judgePath = join(runDirectory, "judge.json");
  const gradePath = join(runDirectory, "grade.json");
  const aggregatePath = join(input.executionDirectory, "aggregate.json");
  const manifestPath = join(runDirectory, "manifest.json");

  const corpusRoot = resolve(REPO_ROOT, input.corpus.rootDir);
  const userMessages = await renderPromptMessages(input.promptTemplatePath, input.mode, input.question);
  const userPrompt = await renderPrompt(input.promptTemplatePath, input.mode, input.question);
  const systemPrompt = input.systemPrompt;
  const promptMessages: PromptMessageSnapshot[] = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  const tools = createToolsForToolSet(input.toolSet, corpusRoot);
  const apiKey = await resolveModelApiKey(input.model);

  const maxParseRetries = input.maxParseRetries ?? 0;
  const events: CollectTrace["events"] = [];
  const toolInvocations: CollectTrace["toolInvocations"] = [];
  const retryReasons: string[] = [];
  let parseRetriesUsed = 0;
  let totalCostUsd = 0;
  let hasTrackedCost = false;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let llmResult;
  let normalizedAnswer: BenchmarkAnswerResponse | { parseError: string; rawText?: string } = { parseError: "Collect did not run." };

  for (let attempt = 1; attempt <= maxParseRetries + 1; attempt += 1) {
    events.push({
      observedAt: new Date().toISOString(),
      eventType: "collect_attempt_start",
      payload: { attempt, maxParseRetries },
    });

    llmResult = await runLlmClient({
      model: input.model,
      transport: input.transport,
      messages: promptMessages,
      tools,
      responseFormat: buildAnswerResponseFormat(),
      apiKey,
    });

    events.push(...llmResult.events);
    toolInvocations.push(...llmResult.toolInvocations);

    const usageTotals = toUsageTotals(llmResult.usage);
    if (usageTotals) {
      totalPromptTokens += usageTotals.promptTokens;
      totalCompletionTokens += usageTotals.completionTokens;
      totalTokens += usageTotals.totalTokens;
      if (typeof usageTotals.cost === "number") {
        totalCostUsd += usageTotals.cost;
        hasTrackedCost = true;
      }
    }
    if (typeof llmResult.costUsd === "number" && !(usageTotals && typeof usageTotals.cost === "number")) {
      totalCostUsd += llmResult.costUsd;
      hasTrackedCost = true;
    }

    normalizedAnswer = parseAnswer(llmResult.finalText);
    const parseErrorResult = isParseErrorResult(normalizedAnswer) ? normalizedAnswer : undefined;

    events.push({
      observedAt: new Date().toISOString(),
      eventType: "collect_attempt_end",
      payload: {
        attempt,
        parseFailed: parseErrorResult !== undefined,
        ...(parseErrorResult ? { parseError: parseErrorResult.parseError } : {}),
        ...(llmResult.error !== undefined ? { llmError: llmResult.error } : {}),
      },
    });

    if (llmResult.error !== undefined || !parseErrorResult) {
      break;
    }

    if (attempt <= maxParseRetries) {
      parseRetriesUsed += 1;
      retryReasons.push(parseErrorResult.parseError);
    }
  }

  const promptSnapshot: PromptSnapshot = {
    systemPrompt,
    userPrompt,
    messages: promptMessages,
    availableTools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
  };

  if (!llmResult) {
    throw new Error("Collect did not produce an LLM result.");
  }

  const collectRetry: CollectRetryMetadata = {
    maxParseRetries,
    parseRetriesUsed,
    attempts: parseRetriesUsed + 1,
    succeededAfterRetry: parseRetriesUsed > 0 && !isParseErrorResult(normalizedAnswer) && llmResult.error === undefined,
    retryReasons,
  };

  const trace: CollectTrace = {
    runId: input.runId,
    prompt: promptSnapshot,
    events,
    toolInvocations,
    ...(llmResult.finalText !== undefined ? { finalAssistantText: llmResult.finalText } : {}),
    ...(llmResult.finalAssistantMessage !== undefined ? { finalAssistantMessage: llmResult.finalAssistantMessage } : {}),
    ...((totalPromptTokens > 0 || totalCompletionTokens > 0 || totalTokens > 0 || hasTrackedCost)
      ? {
          usage: {
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            total_tokens: totalTokens || totalPromptTokens + totalCompletionTokens,
            ...(hasTrackedCost ? { cost: totalCostUsd } : {}),
          },
        }
      : {}),
    ...(hasTrackedCost ? { costUsd: totalCostUsd } : {}),
    ...(llmResult.error !== undefined ? { error: llmResult.error } : {}),
    collectRetry,
    elapsedMs: Date.now() - startedAt,
  };

  const piSdkVersion = (JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies?.["@mariozechner/pi-coding-agent"] ?? "unknown";

  const manifest: RunManifest = {
    contractVersion: PIPELINE_CONTRACT_VERSION,
    runId: input.runId,
    benchmarkName: input.benchmarkName,
    createdAt,
    piSdkVersion,
    model: input.model,
    transport: input.transport,
    mode: input.mode,
    toolSet: input.toolSet,
    promptTemplateId: input.promptTemplateId,
    promptTemplateVersion: input.promptTemplateVersion,
    responseSchemaVersion: input.responseSchemaVersion,
    rubricVersion: input.rubricVersion,
    corpus: input.corpus,
    questionId: input.question.id,
    sampling: input.sampling,
    collectRetry,
    artifactPaths: { trace: tracePath, normalizedAnswer: normalizedAnswerPath, judge: judgePath, grade: gradePath, aggregate: aggregatePath },
  };

  const manifestWithHashes = {
    ...manifest,
    traceSha256: sha256(serializeJson(trace)),
    normalizedAnswerSha256: sha256(serializeJson(normalizedAnswer)),
  };

  await writeJsonFile(tracePath, trace);
  await writeJsonFile(normalizedAnswerPath, normalizedAnswer);
  await writeJsonFile(manifestPath, manifestWithHashes);

  return {
    runDirectory,
    manifest,
    trace,
    normalizedAnswer,
    hasError: llmResult.error !== undefined || "parseError" in normalizedAnswer,
  };
}
