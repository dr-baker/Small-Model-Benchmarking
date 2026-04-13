import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ANSWER_RESPONSE_SCHEMA_VERSION, PIPELINE_CONTRACT_VERSION, type BenchmarkAnswerResponse, type CollectRunInput, type CollectTrace, type PromptSnapshot, type RunManifest } from "../shared/contracts.js";
import { serializeJson, writeJsonFile } from "../shared/io.js";
import { toJsonValue, extractJsonObject } from "../shared/json.js";
import { renderPrompt } from "./prompt-template.js";
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
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

function createBenchmarkExecutionDirectoryName(benchmarkName: string): string {
  return `${new Date().toISOString().slice(0, 10)}-${slugify(benchmarkName)}`;
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
  if (typeof c.finalAnswer !== "string" || typeof c.confidence !== "number") return false;
  if (!Array.isArray(c.citations)) return false;
  return c.mode === "closed_book" ? c.citations.length === 0 : typeof c.evidenceSummary === "string";
}

function parseAnswer(rawText: string | undefined): BenchmarkAnswerResponse | { parseError: string; rawText?: string } {
  if (!rawText) return { parseError: "Assistant produced no final text." };
  try {
    const parsed = extractJsonObject(rawText);
    return validateParsedAnswer(parsed) ? parsed : { parseError: "Assistant JSON did not match answer-response.v1 schema.", rawText };
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error), rawText };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function runCollect(input: CollectRunInput): Promise<CollectRunOutput> {
  validateInput(input);

  const startedAt = Date.now();
  const createdAt = new Date().toISOString();
  const benchmarkExecutionDirectory = resolve(REPO_ROOT, "benchmark-results", createBenchmarkExecutionDirectoryName(input.benchmarkName));
  const runDirectory = join(benchmarkExecutionDirectory, input.runId);
  const tracePath = join(runDirectory, "trace.json");
  const normalizedAnswerPath = join(runDirectory, "normalized-answer.json");
  const judgePath = join(runDirectory, "judge.json");
  const gradePath = join(runDirectory, "grade.json");
  const aggregatePath = join(benchmarkExecutionDirectory, "aggregate.json");
  const manifestPath = join(runDirectory, "manifest.json");

  const corpusRoot = resolve(REPO_ROOT, input.corpus.rootDir);
  const userPrompt = await renderPrompt(input.promptTemplateId, input.mode, input.question);
  const systemPrompt = "You are a benchmark runner. Follow the response schema exactly.";
  const tools = createToolsForToolSet(input.toolSet, corpusRoot);
  const apiKey = await resolveModelApiKey(input.model);

  const llmResult = await runLlmClient({
    model: input.model, systemPrompt, userPrompt, tools,
    responseFormat: buildAnswerResponseFormat(), apiKey,
  });

  const normalizedAnswer = parseAnswer(llmResult.finalText);
  const promptSnapshot: PromptSnapshot = {
    systemPrompt, userPrompt,
    availableTools: tools.map((t) => ({ name: t.name, description: t.description })),
  };

  const trace: CollectTrace = {
    runId: input.runId, prompt: promptSnapshot,
    events: llmResult.events, toolInvocations: llmResult.toolInvocations,
    ...(llmResult.finalText !== undefined ? { finalAssistantText: llmResult.finalText } : {}),
    ...(llmResult.finalAssistantMessage !== undefined ? { finalAssistantMessage: llmResult.finalAssistantMessage } : {}),
    ...(llmResult.usage !== undefined ? { usage: llmResult.usage } : {}),
    ...(llmResult.costUsd !== undefined ? { costUsd: llmResult.costUsd } : {}),
    ...(llmResult.error !== undefined ? { error: llmResult.error } : {}),
    elapsedMs: Date.now() - startedAt,
  };

  const piSdkVersion = (JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies?.["@mariozechner/pi-coding-agent"] ?? "unknown";

  const manifest: RunManifest = {
    contractVersion: PIPELINE_CONTRACT_VERSION, runId: input.runId, benchmarkName: input.benchmarkName, createdAt,
    piSdkVersion, model: input.model, mode: input.mode, toolSet: input.toolSet,
    promptTemplateId: input.promptTemplateId, promptTemplateVersion: input.promptTemplateVersion,
    responseSchemaVersion: input.responseSchemaVersion, rubricVersion: input.rubricVersion,
    corpus: input.corpus, questionId: input.question.id, sampling: input.sampling,
    artifactPaths: { trace: tracePath, normalizedAnswer: normalizedAnswerPath, judge: judgePath, grade: gradePath, aggregate: aggregatePath },
  };

  const manifestWithHashes = { ...manifest, traceSha256: sha256(serializeJson(trace)), normalizedAnswerSha256: sha256(serializeJson(normalizedAnswer)) };
  await writeJsonFile(tracePath, trace);
  await writeJsonFile(normalizedAnswerPath, normalizedAnswer);
  await writeJsonFile(manifestPath, manifestWithHashes);

  if (llmResult.error !== undefined) throw new Error(`Collect stage LLM error: ${JSON.stringify(llmResult.error)}`);

  return { runDirectory, manifest, trace, normalizedAnswer };
}
