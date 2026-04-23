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
  type RetryPolicyConfig,
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
    && typeof o.hasExplanation === "boolean";
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

function deriveLegacyCodeExample(r: ParsedJudgeResponse): 0 | 1 | 2 {
  return r.observations.hasCode ? (r.completeness === 1 ? 2 : 1) : 0;
}

function deriveLegacyExplanation(r: ParsedJudgeResponse): 0 | 1 | 2 {
  return r.observations.hasExplanation ? (r.completeness === 1 ? 2 : 1) : 0;
}

function buildSearchTraceSummary(trace: CollectTrace): string | undefined {
  const searchCalls = trace.toolInvocations.filter((tool) => isSwiftDocsSearchToolName(tool.toolName) && !tool.isError);
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

async function renderJudgePromptMessages(question: DatasetQuestion, answer: BenchmarkAnswerResponse, trace: CollectTrace, promptTemplatePath: string, _manifest: RunManifest): Promise<PromptMessageSnapshot[]> {
  const template = await readFile(promptTemplatePath, "utf8");
  const retrievalBlock = buildSearchTraceSummary(trace);

  return [
    { role: "user", content: template.trim() },
    {
      role: "user",
      content: `## Benchmark question\n${question.question}\n\n## Reference answer\n${question.referenceAnswer}`,
    },
    {
      role: "user",
      content: `## Candidate answer\n${answer.finalAnswer ?? answer.rawText ?? "[missing candidate answer]"}`,
    },
    ...(retrievalBlock ? [{ role: "user" as const, content: retrievalBlock }] : []),
  ];
}

async function renderJudgePrompt(question: DatasetQuestion, answer: BenchmarkAnswerResponse, trace: CollectTrace, promptTemplatePath: string, manifest: RunManifest): Promise<string> {
  const messages = await renderJudgePromptMessages(question, answer, trace, promptTemplatePath, manifest);
  return messages.map((message) => message.content).join("\n\n").trimEnd() + "\n";
}

const DEFAULT_JUDGE_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: 3,
  initialDelayMs: 2000,
  backoffMultiplier: 2,
  maxDelayMs: 15000,
  jitterMs: 250,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(policy: RetryPolicyConfig, attemptIndex: number): number {
  const exponentialDelay = policy.initialDelayMs * (policy.backoffMultiplier ** attemptIndex);
  const cappedDelay = Math.min(policy.maxDelayMs, Math.round(exponentialDelay));
  if (!policy.jitterMs) return cappedDelay;
  return cappedDelay + Math.floor(Math.random() * (policy.jitterMs + 1));
}

function isRetryableJudgeError(error: unknown): boolean {
  if (!error) return false;
  const text = serializeJson(toJsonValue(error)).toLowerCase();
  return text.includes("server_error")
    || text.includes("rate limit")
    || text.includes("rate_limit")
    || text.includes("timeout")
    || text.includes("timed out")
    || text.includes("temporarily unavailable")
    || text.includes("overloaded")
    || text.includes("connection reset")
    || text.includes("econnreset")
    || text.includes("etimedout")
    || text.includes("429")
    || text.includes("502")
    || text.includes("503")
    || text.includes("504");
}

function shouldRetryJudgeAttempt(llmResult: { error: unknown | undefined; finalText: string | undefined }, parsed: ParsedJudgeResponse | { parseError: string; rawText?: string }): { retryable: boolean; reason?: string } {
  if (llmResult.error !== undefined) {
    return isRetryableJudgeError(llmResult.error)
      ? { retryable: true, reason: `judge model call failed: ${serializeJson(toJsonValue(llmResult.error))}` }
      : { retryable: false };
  }

  if ("parseError" in parsed) {
    if (parsed.parseError === "Judge produced no final text.") {
      return { retryable: true, reason: parsed.parseError };
    }
    if (!llmResult.finalText?.trim()) {
      return { retryable: true, reason: parsed.parseError };
    }
  }

  return { retryable: false };
}

async function runJudgeWithRetries(params: {
  model: ModelRef;
  transport: ModelTransportConfig;
  messages: PromptMessageSnapshot[];
  tools: ReturnType<typeof createToolsForToolSet>;
  apiKey: string | undefined;
  cwd: string;
  retryPolicy: RetryPolicyConfig | undefined;
}): Promise<{ llmResult: Awaited<ReturnType<typeof runLlmClient>>; parsed: ParsedJudgeResponse | { parseError: string; rawText?: string }; attemptCount: number; retryNotes: string[] }> {
  const retryPolicy = params.retryPolicy ?? DEFAULT_JUDGE_RETRY_POLICY;
  const retryNotes: string[] = [];

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    const llmResult = await runLlmClient({
      model: params.model,
      transport: params.transport,
      messages: params.messages,
      tools: params.tools,
      responseFormat: buildJudgeVerdictResponseFormat(),
      apiKey: params.apiKey,
      cwd: params.cwd,
    });
    const parsed = parseJudgeResponse(llmResult.finalText);
    const retryDecision = shouldRetryJudgeAttempt(llmResult, parsed);

    if (!retryDecision.retryable || attempt === retryPolicy.maxAttempts) {
      if (attempt > 1) {
        retryNotes.push(`Judge attempts: ${attempt} total; retries used=${attempt - 1}.`);
      }
      if (retryDecision.retryable && attempt === retryPolicy.maxAttempts && retryDecision.reason) {
        retryNotes.push(`Judge retries exhausted after attempt ${attempt}: ${retryDecision.reason}`);
      }
      return { llmResult, parsed, attemptCount: attempt, retryNotes };
    }

    const delayMs = getRetryDelayMs(retryPolicy, attempt - 1);
    const reason = retryDecision.reason ?? "retryable judge failure";
    retryNotes.push(`Judge attempt ${attempt} failed with a retryable issue; waiting ${delayMs}ms before retry ${attempt + 1}/${retryPolicy.maxAttempts}. Reason: ${reason}`);
    console.warn(`judge retry ${attempt + 1}/${retryPolicy.maxAttempts} scheduled in ${delayMs}ms for ${params.model.provider}/${params.model.modelId}: ${reason}`);
    await sleep(delayMs);
  }

  throw new Error("Judge retry loop terminated unexpectedly.");
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
  const normalizedAnswer = await readJsonFile<BenchmarkAnswerResponse>(join(options.runDirectory, "normalized-answer.json"));
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
  if (!normalizedAnswer.finalAnswer?.trim()) {
    const a = skip("answer_parse_error", ["Judge skipped: candidate answer text was unavailable after normalization."]);
    await writeJsonFile(judgePath, a);
    await writeJsonFile(judgeV2Path, a);
    return { judgePath, artifact: a };
  }

  const userMessages = await renderJudgePromptMessages(question, normalizedAnswer, trace, options.promptTemplatePath, manifest);
  const userPrompt = await renderJudgePrompt(question, normalizedAnswer, trace, options.promptTemplatePath, manifest);
  const promptMessages: PromptMessageSnapshot[] = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  const corpusRoot = resolve(REPO_ROOT, manifest.corpus.rootDir);
  const tools = createToolsForToolSet(judgeToolSet, corpusRoot, manifest.swiftDocs ? { swiftDocs: manifest.swiftDocs } : undefined);
  const apiKey = await resolveModelApiKey(effectiveJudgeModel);

  const { llmResult, parsed, retryNotes } = await runJudgeWithRetries({
    model: effectiveJudgeModel,
    transport: options.transport,
    messages: promptMessages,
    tools,
    apiKey,
    cwd: corpusRoot,
    retryPolicy: options.retryPolicy,
  });
  const scored = !("parseError" in parsed);
  const hasError = llmResult.error !== undefined;
  const artifactStatus: JudgeArtifact["status"] = !hasError && scored ? "scored" : "error";

  const commonArtifactFields = {
    schemaVersion: JUDGE_VERDICT_SCHEMA_VERSION,
    runId,
    questionId,
    status: artifactStatus,
    judgedAt,
    judgeProfileId: judgeProfile.id,
    judgeProfileVersion: judgeProfile.version,
    judgeModel: effectiveJudgeModel,
    judgeTransport: options.transport,
    toolSet: judgeToolSet,
    promptTemplateId: judgeProfile.promptTemplateId,
    promptTemplateVersion: judgeProfile.promptTemplateVersion,
    answerSha256,
    prompt: { systemPrompt, userPrompt, messages: promptMessages, availableTools: tools.map((t) => ({ name: t.name, description: t.description })) },
    toolInvocations: llmResult.toolInvocations,
    ...(llmResult.finalText !== undefined ? { rawResponseText: llmResult.finalText } : {}),
    ...(llmResult.usage !== undefined ? { usage: llmResult.usage } : {}),
    ...(llmResult.costUsd !== undefined ? { costUsd: llmResult.costUsd } : {}),
    ...(!scored || hasError ? { error: llmResult.error ?? toJsonValue(parsed) } : {}),
    elapsedMs: Date.now() - startedAt,
    notes: [
      "Corpus-assisted qualitative judgment over the question, reference answer, candidate answer, and optional retrieval trace.",
      options.transport.kind === "openrouter"
        ? "Structured output enforced via response_format."
        : "Pi SDK transport used prompt-level schema enforcement (no response_format support).",
      ...retryNotes,
      ...(hasError ? ["Judge model call failed."] : []),
      ...(scored ? [`Judge writes judge.json for compatibility and judge.v2.json as the slimmer authoritative artifact: correctness=${parsed.correctness}, completeness=${parsed.completeness}, deprecatedPatternUse=${parsed.deprecatedPatternUse}, referenceVerified=${parsed.referenceVerified}.`] : []),
      ...(scored ? [] : [`Judge output parse failure: ${(parsed as { parseError: string }).parseError}`]),
    ],
  };

  const artifact: JudgeArtifact = {
    ...commonArtifactFields,
    ...(scored ? {
      correctness: parsed.correctness,
      completeness: parsed.completeness,
      deprecatedPatternUse: parsed.deprecatedPatternUse,
      referenceVerified: parsed.referenceVerified,
      observations: parsed.observations,
      recommendsCorrectPattern: parsed.correctness === 1,
      recommendsDeprecatedPattern: parsed.deprecatedPatternUse === "primary" || parsed.deprecatedPatternUse === "fallback",
      codeExample: deriveLegacyCodeExample(parsed),
      explanation: deriveLegacyExplanation(parsed),
      verdict: rollUpVerdict(parsed),
      reasoning: parsed.reasoning,
    } : {}),
  };

  const v2Artifact: JudgeArtifact = {
    ...commonArtifactFields,
    ...(scored ? {
      correctness: parsed.correctness,
      completeness: parsed.completeness,
      deprecatedPatternUse: parsed.deprecatedPatternUse,
      referenceVerified: parsed.referenceVerified,
      observations: parsed.observations,
      reasoning: parsed.reasoning,
    } : {}),
  };

  await writeJsonFile(judgePath, artifact);
  await writeJsonFile(judgeV2Path, v2Artifact);
  return { judgePath, artifact };
}
