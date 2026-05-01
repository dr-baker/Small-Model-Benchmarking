import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ANSWER_RESPONSE_SCHEMA_VERSION,
  PIPELINE_CONTRACT_VERSION,
  type AnswerCollectionMode,
  type BenchmarkAnswerResponse,
  type CitationReference,
  type CollectRetryMetadata,
  type CollectRunInput,
  type CollectTrace,
  type PromptMessageSnapshot,
  type PromptSnapshot,
  type RunManifest,
  type StructuredBenchmarkAnswerResponse,
} from "../shared/contracts.js";
import { serializeJson, writeJsonFile } from "../shared/io.js";
import { extractJsonObject } from "../shared/json.js";
import { normalizeCitationFilePath } from "../shared/corpus-paths.js";
import { renderPrompt, renderPromptMessages } from "./prompt-template.js";
import { createToolsForToolSet } from "./tool-sets.js";
import { runLlmClient } from "../shared/llm-client.js";
import { buildAnswerResponseFormat } from "../shared/response-schemas.js";
import { resolveModelApiKey } from "../shared/api-key.js";
import { runSpoonfedRagCollect } from "./spoonfed-rag.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

export interface CollectRunOutput {
  runDirectory: string;
  manifest: RunManifest;
  trace: CollectTrace;
  normalizedAnswer: BenchmarkAnswerResponse;
  hasError: boolean;
}

function validateInput(input: CollectRunInput): void {
  if (input.contractVersion !== PIPELINE_CONTRACT_VERSION) throw new Error(`Unsupported contract version: ${input.contractVersion}`);
  if (input.responseSchemaVersion !== ANSWER_RESPONSE_SCHEMA_VERSION) throw new Error(`Unsupported response schema version: ${input.responseSchemaVersion}`);
  if (input.mode === "closed_book" && input.toolSet.name !== "none") throw new Error("Closed-book runs must use the 'none' tool set.");
}

function validateStructuredAnswer(value: unknown): value is StructuredBenchmarkAnswerResponse {
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

function normalizeCitationReferences(citations: CitationReference[] | null, corpusRoot: string): CitationReference[] | null {
  if (!citations) return null;
  return citations
    .map((citation) => {
      const filePath = normalizeCitationFilePath(citation.filePath, corpusRoot);
      return filePath ? { ...citation, filePath } : undefined;
    })
    .filter((citation): citation is CitationReference => citation !== undefined);
}

function extractStructuredAnswerFields(value: unknown, expectedMode: CollectRunInput["mode"], corpusRoot: string): Partial<BenchmarkAnswerResponse> {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Record<string, unknown>;
  const finalAnswer = typeof candidate.finalAnswer === "string" && candidate.finalAnswer.trim().length > 0
    ? candidate.finalAnswer.trim()
    : undefined;
  const confidence = typeof candidate.confidence === "number" ? candidate.confidence : undefined;
  const citations = Array.isArray(candidate.citations)
    ? normalizeCitationReferences(candidate.citations.filter((item): item is CitationReference => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).filePath === "string"), corpusRoot)
    : undefined;
  const evidenceSummary = typeof candidate.evidenceSummary === "string" && candidate.evidenceSummary.trim().length > 0
    ? candidate.evidenceSummary.trim()
    : expectedMode === "closed_book"
      ? null
      : undefined;

  return {
    ...(candidate.schemaVersion === ANSWER_RESPONSE_SCHEMA_VERSION ? { schemaVersion: ANSWER_RESPONSE_SCHEMA_VERSION } : {}),
    mode: expectedMode,
    ...(finalAnswer !== undefined ? { finalAnswer } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(citations !== undefined ? { citations } : {}),
    ...(evidenceSummary !== undefined ? { evidenceSummary } : {}),
  };
}

function createFormatInstructions(mode: CollectRunInput["mode"], answerCollectionMode: AnswerCollectionMode): string {
  if (answerCollectionMode === "structured_json") {
    const closedBookSchema = `{
  "schemaVersion": "answer-response.v1",
  "mode": "closed_book",
  "finalAnswer": "string",
  "confidence": 0.0,
  "citations": []
}`;
    const openBookSchema = `{
  "schemaVersion": "answer-response.v1",
  "mode": "open_book",
  "finalAnswer": "string",
  "confidence": 0.0,
  "citations": [
    {
      "filePath": "relative/path/in/corpus (for Swift Docs hybrid search, use normalized_md_path from the tool result)",
      "anchor": "optional passage anchor",
      "quote": "optional direct quote",
      "justification": "why this citation supports the answer"
    }
  ],
  "evidenceSummary": "short summary of the evidence actually read or retrieved"
}`;
    return [
      "## Active answer format",
      "Return exactly one JSON object.",
      "Do not wrap it in markdown fences.",
      mode === "closed_book" ? `### Required schema\n\n\`\`\`json\n${closedBookSchema}\n\`\`\`` : `### Required schema\n\n\`\`\`json\n${openBookSchema}\n\`\`\``,
    ].join("\n\n");
  }

  return [
    "## Active answer format",
    "Return a plain answer in normal prose. JSON is optional and not required.",
    `The benchmark mode is ${mode}; answer for that mode only.`,
    mode === "open_book"
      ? "If you can clearly support the answer from material you actually read in this run, include short source hints, quotes, or file paths inline when natural, but do not force a schema."
      : "Do not invent citations or claim you used tools you did not use.",
    "Focus on a correct, concise, actionable answer first. If confidence or evidence summary are not natural to include, omit them.",
  ].join("\n\n");
}

function buildCollectSystemPrompt(basePrompt: string, answerCollectionMode: AnswerCollectionMode): string {
  return answerCollectionMode === "structured_json"
    ? `${basePrompt}\nReturn one valid JSON object only.`
    : `${basePrompt}\nDo not force JSON. A plain answer is acceptable. Include extra metadata only when natural and supported.`;
}

function normalizeStructuredAnswer(rawText: string | undefined, expectedMode: CollectRunInput["mode"], corpusRoot: string): BenchmarkAnswerResponse {
  if (!rawText) {
    return {
      mode: expectedMode,
      finalAnswer: null,
      confidence: null,
      citations: null,
      evidenceSummary: expectedMode === "open_book" ? null : null,
      parseError: "Assistant produced no final text.",
      answerCollectionMode: "structured_json",
    };
  }

  try {
    const parsed = extractJsonObject(rawText);
    const extracted = extractStructuredAnswerFields(parsed, expectedMode, corpusRoot);
    if (validateStructuredAnswer(parsed)) {
      return {
        mode: expectedMode,
        finalAnswer: extracted.finalAnswer ?? null,
        confidence: extracted.confidence ?? null,
        citations: extracted.citations ?? (expectedMode === "closed_book" ? [] : []),
        evidenceSummary: extracted.evidenceSummary ?? null,
        ...(extracted.schemaVersion ? { schemaVersion: extracted.schemaVersion } : {}),
        rawText,
        answerCollectionMode: "structured_json",
      };
    }

    return {
      mode: expectedMode,
      finalAnswer: null,
      confidence: extracted.confidence ?? null,
      citations: extracted.citations ?? null,
      evidenceSummary: extracted.evidenceSummary ?? null,
      ...(extracted.schemaVersion ? { schemaVersion: extracted.schemaVersion } : {}),
      rawText,
      parseError: "Assistant JSON did not match answer-response.v1 schema or contained an empty answer.",
      answerCollectionMode: "structured_json",
    };
  } catch (error) {
    return {
      mode: expectedMode,
      finalAnswer: null,
      confidence: null,
      citations: null,
      evidenceSummary: null,
      rawText,
      parseError: error instanceof Error ? error.message : String(error),
      answerCollectionMode: "structured_json",
    };
  }
}

function normalizeLazyAnswer(rawText: string | undefined, expectedMode: CollectRunInput["mode"], corpusRoot: string): BenchmarkAnswerResponse {
  if (!rawText) {
    return {
      mode: expectedMode,
      finalAnswer: null,
      confidence: null,
      citations: null,
      evidenceSummary: null,
      parseError: "Assistant produced no final text.",
      answerCollectionMode: "lazy_text",
    };
  }

  const trimmedRawText = rawText.trim();
  const warnings: string[] = [];
  const normalized: BenchmarkAnswerResponse = {
    mode: expectedMode,
    finalAnswer: trimmedRawText.length > 0 ? trimmedRawText : null,
    confidence: null,
    citations: null,
    evidenceSummary: null,
    rawText,
    answerCollectionMode: "lazy_text",
  };

  try {
    const parsed = extractJsonObject(rawText);
    const extracted = extractStructuredAnswerFields(parsed, expectedMode, corpusRoot);
    if (extracted.finalAnswer !== undefined) normalized.finalAnswer = extracted.finalAnswer;
    if (extracted.confidence !== undefined) normalized.confidence = extracted.confidence;
    if (extracted.citations !== undefined) normalized.citations = extracted.citations;
    if (extracted.evidenceSummary !== undefined) normalized.evidenceSummary = extracted.evidenceSummary;
    if (extracted.schemaVersion !== undefined) normalized.schemaVersion = extracted.schemaVersion;
    if (!validateStructuredAnswer(parsed)) {
      warnings.push("Structured fields were only partially recoverable from assistant output.");
    }
  } catch (error) {
    warnings.push(`Structured extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (warnings.length > 0) {
    normalized.extractionWarnings = warnings;
  }
  if (normalized.finalAnswer === null) {
    normalized.parseError = "Assistant produced no final text.";
  }

  return normalized;
}

function parseAnswer(rawText: string | undefined, expectedMode: CollectRunInput["mode"], corpusRoot: string, answerCollectionMode: AnswerCollectionMode): BenchmarkAnswerResponse {
  return answerCollectionMode === "lazy_text"
    ? normalizeLazyAnswer(rawText, expectedMode, corpusRoot)
    : normalizeStructuredAnswer(rawText, expectedMode, corpusRoot);
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

function hasCollectParseFailure(value: BenchmarkAnswerResponse): boolean {
  return typeof value.parseError === "string" || value.finalAnswer === null;
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
  const answerCollectionMode = input.answerCollectionMode ?? "structured_json";
  const formatInstructions = createFormatInstructions(input.mode, answerCollectionMode);
  const userMessages = await renderPromptMessages(input.promptTemplatePath, input.mode, input.question, formatInstructions);
  const userPrompt = await renderPrompt(input.promptTemplatePath, input.mode, input.question, formatInstructions);
  const systemPrompt = buildCollectSystemPrompt(input.systemPrompt, answerCollectionMode);
  const promptMessages: PromptMessageSnapshot[] = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  const tools = createToolsForToolSet(
    input.toolSet,
    corpusRoot,
    input.swiftDocs ? { swiftDocs: input.swiftDocs } : undefined,
  );
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
  let normalizedAnswer: BenchmarkAnswerResponse = {
    mode: input.mode,
    finalAnswer: null,
    confidence: null,
    citations: null,
    evidenceSummary: null,
    parseError: "Collect did not run.",
    answerCollectionMode,
  };

  for (let attempt = 1; attempt <= maxParseRetries + 1; attempt += 1) {
    events.push({
      observedAt: new Date().toISOString(),
      eventType: "collect_attempt_start",
      payload: { attempt, maxParseRetries },
    });

    if (input.toolSet.name === "spoonfed_rag") {
      const spoonfed = await runSpoonfedRagCollect(input, corpusRoot);
      llmResult = spoonfed.finalResult;
      events.push(...spoonfed.events);
      toolInvocations.push(...spoonfed.toolInvocations);
      totalPromptTokens += spoonfed.usage.promptTokens;
      totalCompletionTokens += spoonfed.usage.completionTokens;
      totalTokens += spoonfed.usage.totalTokens;
      if (typeof spoonfed.costUsd === "number") {
        totalCostUsd += spoonfed.costUsd;
        hasTrackedCost = true;
      }
    } else {
      llmResult = await runLlmClient({
        model: input.model,
        transport: input.transport,
        messages: promptMessages,
        tools,
        ...(answerCollectionMode === "structured_json" ? { responseFormat: buildAnswerResponseFormat() } : {}),
        apiKey,
        cwd: corpusRoot,
      });

      events.push(...llmResult.events);
      toolInvocations.push(...llmResult.toolInvocations);
    }

    const usageTotals = input.toolSet.name === "spoonfed_rag" ? undefined : toUsageTotals(llmResult.usage);
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

    normalizedAnswer = parseAnswer(llmResult.finalText, input.mode, corpusRoot, answerCollectionMode);
    const parseFailed = hasCollectParseFailure(normalizedAnswer);

    events.push({
      observedAt: new Date().toISOString(),
      eventType: "collect_attempt_end",
      payload: {
        attempt,
        parseFailed,
        ...(normalizedAnswer.parseError ? { parseError: normalizedAnswer.parseError } : {}),
        ...(llmResult.error !== undefined ? { llmError: llmResult.error } : {}),
      },
    });

    if (llmResult.error !== undefined || !parseFailed) {
      break;
    }

    if (attempt <= maxParseRetries) {
      parseRetriesUsed += 1;
      retryReasons.push(normalizedAnswer.parseError ?? "Answer normalization failed.");
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
    succeededAfterRetry: parseRetriesUsed > 0 && !hasCollectParseFailure(normalizedAnswer) && llmResult.error === undefined,
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
    answerCollectionMode,
    toolSet: input.toolSet,
    promptTemplateId: input.promptTemplateId,
    promptTemplateVersion: input.promptTemplateVersion,
    responseSchemaVersion: input.responseSchemaVersion,
    rubricVersion: input.rubricVersion,
    corpus: input.corpus,
    ...(input.swiftDocs ? { swiftDocs: input.swiftDocs } : {}),
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
    hasError: llmResult.error !== undefined || hasCollectParseFailure(normalizedAnswer),
  };
}
