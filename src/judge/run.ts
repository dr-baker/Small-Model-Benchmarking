import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import {
  JUDGE_VERDICT_SCHEMA_VERSION,
  type BenchmarkAnswerResponse,
  type CollectTrace,
  type DatasetQuestion,
  type JudgeArtifact,
  type JudgeAxisScore,
  type JudgeDeprecatedPatternUse,
  type JudgeProfile,
  type JudgeVerdictLabel,
  type ModelRef,
  type ModelTransportConfig,
  type PromptMessageSnapshot,
  type RunManifest,
  type ToolInvocationTrace,
} from "../shared/contracts.js";
import { serializeJson, readJsonFile, writeJsonFile } from "../shared/io.js";
import { toJsonValue, extractJsonObject } from "../shared/json.js";
import { createToolsForToolSet, loadToolSetDefinition } from "../collect/tool-sets.js";
import { runLlmClient } from "../shared/llm-client.js";
import { buildJudgeVerdictResponseFormat } from "../shared/response-schemas.js";
import { resolveModelApiKey } from "../shared/api-key.js";
import { parseSwiftDocsHybridToolResult } from "../shared/swift-docs-search.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "../..");

interface ParsedJudgeResponse {
  correctness: JudgeAxisScore;
  completeness: JudgeAxisScore;
  deprecatedPatternUse: JudgeDeprecatedPatternUse;
  referenceVerified: boolean;
  reasoning: string;
  observations: {
    hasCode: boolean;
    hasExplanation: boolean;
    mode: "closed_book" | "open_book";
  };
}

export interface JudgeRunOptions {
  runDirectory: string;
  datasetPath: string;
  judgeProfile: JudgeProfile;
  promptTemplatePath: string;
  systemPrompt: string;
  toolSetCatalogPath: string;
  transport: ModelTransportConfig;
  judgeModelOverride: ModelRef;
}

export interface JudgeRunOutput {
  judgePath: string;
  artifact: JudgeArtifact;
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

function isJudgeAxisScore(v: unknown): v is JudgeAxisScore { return v === -1 || v === 0 || v === 1; }
function isDeprecatedPatternUse(v: unknown): v is JudgeDeprecatedPatternUse {
  return v === "primary" || v === "fallback" || v === "warning_only" || v === "not_mentioned";
}
function isJudgeObservations(v: unknown): v is ParsedJudgeResponse["observations"] {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.hasCode === "boolean"
    && typeof o.hasExplanation === "boolean"
    && (o.mode === "closed_book" || o.mode === "open_book");
}

function validateJudgeResponse(value: unknown): value is ParsedJudgeResponse {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return isJudgeAxisScore(c.correctness)
    && isJudgeAxisScore(c.completeness)
    && isDeprecatedPatternUse(c.deprecatedPatternUse)
    && typeof c.referenceVerified === "boolean"
    && typeof c.reasoning === "string"
    && isJudgeObservations(c.observations);
}

function parseJudgeResponse(rawText: string | undefined): ParsedJudgeResponse | { parseError: string; rawText?: string } {
  if (!rawText) return { parseError: "Judge produced no final text." };
  try {
    const parsed = extractJsonObject(rawText);
    return validateJudgeResponse(parsed) ? parsed : { parseError: "Judge JSON did not match the expected authoritative judge schema.", rawText };
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error), rawText };
  }
}

function rollUpVerdict(r: ParsedJudgeResponse): JudgeVerdictLabel {
  if (r.correctness === -1) return "incorrect";
  if (r.correctness === 1 && r.completeness === 1) return "correct";
  return "partially_correct";
}

function buildSearchTraceSummary(trace: CollectTrace): string | undefined {
  const searchCalls = trace.toolInvocations.filter((tool) => tool.toolName === "swift_docs_search_hybrid" && !tool.isError);
  if (searchCalls.length === 0) return undefined;

  const summarizeCall = (tool: ToolInvocationTrace, index: number) => {
    const parsed = parseSwiftDocsHybridToolResult(tool.result);
    const summarizedResult = parsed
      ? {
          pages: parsed.pages.slice(0, 5),
          chunks: parsed.chunks.slice(0, 8),
        }
      : tool.result;
    return [
      `### Search call ${index + 1}`,
      `Request: ${JSON.stringify(tool.args)}`,
      `Result: ${JSON.stringify(summarizedResult)}`,
    ].join("\n");
  };

  return `## Candidate retrieval trace\n${searchCalls.slice(0, 3).map(summarizeCall).join("\n\n")}`;
}

async function renderJudgePromptMessages(question: DatasetQuestion, answer: BenchmarkAnswerResponse, trace: CollectTrace, promptTemplatePath: string): Promise<PromptMessageSnapshot[]> {
  const template = await readFile(promptTemplatePath, "utf8");
  const evidenceBlock = answer.mode === "open_book"
    ? `\n- answer included ${answer.citations.length} citation(s)\n- answer evidence summary: ${answer.evidenceSummary}`
    : "";
  const benchmarkMetadataBlock = `## Benchmark question metadata\n- evidenceBasis: ${question.evidenceBasis}\n- questionShape: ${question.questionShape}\n- platformScope: ${question.platformScope}`;

  const retrievalBlock = buildSearchTraceSummary(trace);

  return [
    { role: "user", content: template.trim() },
    {
      role: "user",
      content: `${benchmarkMetadataBlock}\n\n## Benchmark question\n${question.question}\n\n## Reference answer\n${question.referenceAnswer}`,
    },
    {
      role: "user",
      content: `## Candidate answer metadata\n- mode: ${answer.mode}\n- answerConfidence: ${answer.confidence}${evidenceBlock}`,
    },
    {
      role: "user",
      content: `## Candidate answer\n${answer.finalAnswer}`,
    },
    ...(retrievalBlock ? [{ role: "user" as const, content: retrievalBlock }] : []),
  ];
}

async function renderJudgePrompt(question: DatasetQuestion, answer: BenchmarkAnswerResponse, trace: CollectTrace, promptTemplatePath: string): Promise<string> {
  const messages = await renderJudgePromptMessages(question, answer, trace, promptTemplatePath);
  return messages.map((message) => message.content).join("\n\n").trimEnd() + "\n";
}

function createSkippedArtifact(params: {
  runId: string; questionId: string; judgedAt: string;
  judgeProfile: JudgeProfile; judgeModel: ModelRef; judgeTransport: ModelTransportConfig; answerSha256: string;
  skipReason: string; notes: string[]; elapsedMs: number; toolSet: RunManifest["toolSet"]; systemPrompt: string;
}): JudgeArtifact {
  return {
    schemaVersion: JUDGE_VERDICT_SCHEMA_VERSION, runId: params.runId, questionId: params.questionId,
    status: "skipped", judgedAt: params.judgedAt,
    judgeProfileId: params.judgeProfile.id, judgeProfileVersion: params.judgeProfile.version,
    judgeModel: params.judgeModel, judgeTransport: params.judgeTransport, toolSet: params.toolSet,
    promptTemplateId: params.judgeProfile.promptTemplateId, promptTemplateVersion: params.judgeProfile.promptTemplateVersion,
    answerSha256: params.answerSha256,
    prompt: { systemPrompt: params.systemPrompt, userPrompt: "", availableTools: [] },
    toolInvocations: [], skipReason: params.skipReason, elapsedMs: params.elapsedMs, notes: params.notes,
  };
}

export async function judgeRun(options: JudgeRunOptions): Promise<JudgeRunOutput> {
  const startedAt = Date.now();
  const judgedAt = new Date().toISOString();
  const judgePath = join(options.runDirectory, "judge.json");
  const judgeV2Path = join(options.runDirectory, "judge.v2.json");

  const manifest = await readJsonFile<RunManifest>(join(options.runDirectory, "manifest.json"));
  const normalizedAnswer = await readJsonFile<BenchmarkAnswerResponse | { parseError: string; rawText?: string }>(join(options.runDirectory, "normalized-answer.json"));
  const trace = await readJsonFile<CollectTrace>(join(options.runDirectory, "trace.json"));
  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(options.datasetPath);
  const questionId = manifest.questionId ?? "unknown";
  const runId = manifest.runId ?? "unknown";
  const question = dataset.questions.find((c) => c.id === questionId);
  const judgeProfile = options.judgeProfile;
  const effectiveJudgeModel = options.judgeModelOverride;
  const systemPrompt = options.systemPrompt;
  const answerSha256 = sha256(serializeJson(normalizedAnswer));
  const judgeToolSet = await loadToolSetDefinition(options.toolSetCatalogPath, judgeProfile.toolSetName);

  const skip = (reason: string, notes: string[]) => createSkippedArtifact({
    runId, questionId, judgedAt, judgeProfile, judgeModel: effectiveJudgeModel, judgeTransport: options.transport,
    answerSha256, skipReason: reason, notes, elapsedMs: Date.now() - startedAt, toolSet: judgeToolSet, systemPrompt,
  });

  if (!question) {
    const a = skip("question_not_found_in_dataset", ["Judge skipped: question missing from dataset."]);
    await writeJsonFile(judgePath, a);
    await writeJsonFile(judgeV2Path, a);
    return { judgePath, artifact: a };
  }
  if ("parseError" in normalizedAnswer) {
    const a = skip("answer_parse_error", ["Judge skipped: answer has parse error."]);
    await writeJsonFile(judgePath, a);
    await writeJsonFile(judgeV2Path, a);
    return { judgePath, artifact: a };
  }

  const userMessages = await renderJudgePromptMessages(question, normalizedAnswer, trace, options.promptTemplatePath);
  const userPrompt = await renderJudgePrompt(question, normalizedAnswer, trace, options.promptTemplatePath);
  const promptMessages: PromptMessageSnapshot[] = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  const corpusRoot = resolve(REPO_ROOT, manifest.corpus.rootDir);
  const tools = createToolsForToolSet(judgeToolSet, corpusRoot, manifest.swiftDocs ? { swiftDocs: manifest.swiftDocs } : undefined);
  const apiKey = await resolveModelApiKey(effectiveJudgeModel);

  const llmResult = await runLlmClient({
    model: effectiveJudgeModel,
    transport: options.transport,
    messages: promptMessages,
    tools,
    responseFormat: buildJudgeVerdictResponseFormat(),
    apiKey,
    cwd: corpusRoot,
  });

  const parsed = parseJudgeResponse(llmResult.finalText);
  const modeMismatch = !("parseError" in parsed) && parsed.observations.mode !== normalizedAnswer.mode
    ? `Judge observations.mode (${parsed.observations.mode}) did not match candidate answer mode (${normalizedAnswer.mode}).`
    : undefined;
  const scored = !("parseError" in parsed) && modeMismatch === undefined;
  const hasError = llmResult.error !== undefined;

  const artifact: JudgeArtifact = {
    schemaVersion: JUDGE_VERDICT_SCHEMA_VERSION, runId, questionId,
    ...(scored ? {
      correctness: parsed.correctness,
      completeness: parsed.completeness,
      deprecatedPatternUse: parsed.deprecatedPatternUse,
      referenceVerified: parsed.referenceVerified,
      observations: parsed.observations,
      recommendsCorrectPattern: parsed.correctness === 1,
      recommendsDeprecatedPattern: parsed.deprecatedPatternUse === "primary" || parsed.deprecatedPatternUse === "fallback",
      codeExample: parsed.observations.hasCode ? (parsed.completeness === 1 ? 2 : 1) : 0,
      explanation: parsed.observations.hasExplanation ? (parsed.completeness === 1 ? 2 : 1) : 0,
      verdict: rollUpVerdict(parsed),
      reasoning: parsed.reasoning,
    } : {}),
    status: !hasError && scored ? "scored" : "error",
    judgedAt,
    judgeProfileId: judgeProfile.id, judgeProfileVersion: judgeProfile.version,
    judgeModel: effectiveJudgeModel, judgeTransport: options.transport, toolSet: judgeToolSet,
    promptTemplateId: judgeProfile.promptTemplateId, promptTemplateVersion: judgeProfile.promptTemplateVersion,
    answerSha256,
    prompt: { systemPrompt, userPrompt, messages: promptMessages, availableTools: tools.map((t) => ({ name: t.name, description: t.description })) },
    toolInvocations: llmResult.toolInvocations,
    ...(llmResult.finalText !== undefined ? { rawResponseText: llmResult.finalText } : {}),
    ...(llmResult.usage !== undefined ? { usage: llmResult.usage } : {}),
    ...(llmResult.costUsd !== undefined ? { costUsd: llmResult.costUsd } : {}),
    ...(!scored || hasError ? { error: llmResult.error ?? toJsonValue(modeMismatch ?? parsed) } : {}),
    elapsedMs: Date.now() - startedAt,
    notes: [
      "Corpus-assisted qualitative judgment with explicit closed-book handling.",
      options.transport.kind === "openrouter"
        ? "Structured output enforced via response_format."
        : "Pi SDK transport used prompt-level schema enforcement (no response_format support).",
      ...(hasError ? ["Judge model call failed."] : []),
      ...(scored ? [`Judge v2 artifact written to judge.v2.json (mirrored in judge.json for compatibility): correctness=${parsed.correctness}, completeness=${parsed.completeness}, deprecatedPatternUse=${parsed.deprecatedPatternUse}, referenceVerified=${parsed.referenceVerified}.`] : []),
      ...(modeMismatch ? [modeMismatch] : []),
      ...(scored || modeMismatch ? [] : [`Judge output parse failure: ${(parsed as { parseError: string }).parseError}`]),
    ],
  };

  await writeJsonFile(judgePath, artifact);
  await writeJsonFile(judgeV2Path, artifact);
  return { judgePath, artifact };
}
