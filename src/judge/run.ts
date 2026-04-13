import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import {
  JUDGE_VERDICT_SCHEMA_VERSION,
  type BenchmarkAnswerResponse,
  type DatasetQuestion,
  type JudgeArtifact,
  type JudgeProfile,
  type JudgeProfileCatalog,
  type JudgeQualitativeScore,
  type JudgeVerdictLabel,
  type ModelRef,
  type RunManifest,
} from "../shared/contracts.js";
import { serializeJson, readJsonFile, writeJsonFile } from "../shared/io.js";
import { toJsonValue, extractJsonObject } from "../shared/json.js";
import { createToolsForToolSet, loadToolSetDefinition } from "../collect/tool-sets.js";
import { runLlmClient } from "../shared/llm-client.js";
import { buildJudgeVerdictResponseFormat } from "../shared/response-schemas.js";
import { resolveModelApiKey } from "../shared/api-key.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "../..");

interface ParsedJudgeResponse {
  recommendsCorrectPattern: boolean;
  recommendsDeprecatedPattern: boolean;
  completeness: JudgeQualitativeScore;
  codeExample: JudgeQualitativeScore;
  explanation: JudgeQualitativeScore;
  reasoning: string;
}

export interface JudgeRunOptions {
  runDirectory: string;
  datasetPath: string;
  judgeProfilePath: string;
  judgeProfileId: string;
  promptTemplatePath: string;
  systemPrompt: string;
  toolSetCatalogPath: string;
  judgeModelOverride?: ModelRef;
}

export interface JudgeRunOutput {
  judgePath: string;
  artifact: JudgeArtifact;
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

function isQualitativeScore(v: unknown): v is JudgeQualitativeScore { return v === 0 || v === 1 || v === 2; }

function validateJudgeResponse(value: unknown): value is ParsedJudgeResponse {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return typeof c.recommendsCorrectPattern === "boolean" && typeof c.recommendsDeprecatedPattern === "boolean"
    && isQualitativeScore(c.completeness) && isQualitativeScore(c.codeExample) && isQualitativeScore(c.explanation)
    && typeof c.reasoning === "string";
}

function parseJudgeResponse(rawText: string | undefined): ParsedJudgeResponse | { parseError: string; rawText?: string } {
  if (!rawText) return { parseError: "Judge produced no final text." };
  try {
    const parsed = extractJsonObject(rawText);
    return validateJudgeResponse(parsed) ? parsed : { parseError: "Judge JSON did not match the expected qualitative verdict schema.", rawText };
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error), rawText };
  }
}

function rollUpVerdict(r: ParsedJudgeResponse): JudgeVerdictLabel {
  if (!r.recommendsCorrectPattern || r.recommendsDeprecatedPattern) return "incorrect";
  if (r.completeness === 2 && r.codeExample === 2 && r.explanation === 2) return "correct";
  return "partially_correct";
}

async function loadJudgeProfile(path: string, id: string): Promise<JudgeProfile> {
  const catalog = await readJsonFile<JudgeProfileCatalog>(path);
  const profile = catalog.profiles.find((c) => c.id === id);
  if (!profile) throw new Error(`Unknown judge profile: ${id}`);
  return profile;
}

async function renderJudgePrompt(question: DatasetQuestion, answer: BenchmarkAnswerResponse, profile: JudgeProfile, promptTemplatePath: string): Promise<string> {
  const template = await readFile(promptTemplatePath, "utf8");
  const evidenceBlock = answer.mode === "open_book"
    ? `\n## Candidate answer evidence metadata\n- answer included ${answer.citations.length} citation(s)\n- answer evidence summary: ${answer.evidenceSummary}\n`
    : "";
  return `${template.trim()}\n\n## Benchmark question\n${question.question}\n\n## Reference answer\n${question.referenceAnswer}\n\n## Candidate answer metadata\n- mode: ${answer.mode}\n- answerConfidence: ${answer.confidence}${evidenceBlock}\n\n## Candidate answer\n${answer.finalAnswer}\n`;
}

function createSkippedArtifact(params: {
  runId: string; questionId: string; judgedAt: string;
  judgeProfile: JudgeProfile; judgeModel: ModelRef; answerSha256: string;
  skipReason: string; notes: string[]; elapsedMs: number; toolSet: RunManifest["toolSet"]; systemPrompt: string;
}): JudgeArtifact {
  return {
    schemaVersion: JUDGE_VERDICT_SCHEMA_VERSION, runId: params.runId, questionId: params.questionId,
    status: "skipped", judgedAt: params.judgedAt,
    judgeProfileId: params.judgeProfile.id, judgeProfileVersion: params.judgeProfile.version,
    judgeModel: params.judgeModel, toolSet: params.toolSet,
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

  const manifest = await readJsonFile<RunManifest>(join(options.runDirectory, "manifest.json"));
  const normalizedAnswer = await readJsonFile<BenchmarkAnswerResponse | { parseError: string; rawText?: string }>(join(options.runDirectory, "normalized-answer.json"));
  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(options.datasetPath);
  const questionId = manifest.questionId ?? "unknown";
  const runId = manifest.runId ?? "unknown";
  const question = dataset.questions.find((c) => c.id === questionId);
  const judgeProfile = await loadJudgeProfile(options.judgeProfilePath, options.judgeProfileId);
  const effectiveJudgeModel = options.judgeModelOverride ?? judgeProfile.model;
  const systemPrompt = options.systemPrompt;
  const answerSha256 = sha256(serializeJson(normalizedAnswer));
  const judgeToolSet = await loadToolSetDefinition(options.toolSetCatalogPath, judgeProfile.toolSetName);

  const skip = (reason: string, notes: string[]) => createSkippedArtifact({
    runId, questionId, judgedAt, judgeProfile, judgeModel: effectiveJudgeModel,
    answerSha256, skipReason: reason, notes, elapsedMs: Date.now() - startedAt, toolSet: judgeToolSet, systemPrompt,
  });

  if (!question) { const a = skip("question_not_found_in_dataset", ["Judge skipped: question missing from dataset."]); await writeJsonFile(judgePath, a); return { judgePath, artifact: a }; }
  if ("parseError" in normalizedAnswer) { const a = skip("answer_parse_error", ["Judge skipped: answer has parse error."]); await writeJsonFile(judgePath, a); return { judgePath, artifact: a }; }

  const userPrompt = await renderJudgePrompt(question, normalizedAnswer, judgeProfile, options.promptTemplatePath);
  const corpusRoot = resolve(REPO_ROOT, manifest.corpus.rootDir);
  const tools = createToolsForToolSet(judgeToolSet, corpusRoot);
  const apiKey = await resolveModelApiKey(effectiveJudgeModel);

  const llmResult = await runLlmClient({
    model: effectiveJudgeModel, systemPrompt, userPrompt, tools,
    responseFormat: buildJudgeVerdictResponseFormat(), apiKey,
  });

  const parsed = parseJudgeResponse(llmResult.finalText);
  const scored = !("parseError" in parsed);
  const hasError = llmResult.error !== undefined;

  const artifact: JudgeArtifact = {
    schemaVersion: JUDGE_VERDICT_SCHEMA_VERSION, runId, questionId,
    ...(scored ? {
      recommendsCorrectPattern: parsed.recommendsCorrectPattern,
      recommendsDeprecatedPattern: parsed.recommendsDeprecatedPattern,
      completeness: parsed.completeness, codeExample: parsed.codeExample, explanation: parsed.explanation,
      verdict: rollUpVerdict(parsed), reasoning: parsed.reasoning,
    } : {}),
    status: !hasError && scored ? "scored" : "error",
    judgedAt,
    judgeProfileId: judgeProfile.id, judgeProfileVersion: judgeProfile.version,
    judgeModel: effectiveJudgeModel, toolSet: judgeToolSet,
    promptTemplateId: judgeProfile.promptTemplateId, promptTemplateVersion: judgeProfile.promptTemplateVersion,
    answerSha256,
    prompt: { systemPrompt, userPrompt, availableTools: tools.map((t) => ({ name: t.name, description: t.description })) },
    toolInvocations: llmResult.toolInvocations,
    ...(llmResult.finalText !== undefined ? { rawResponseText: llmResult.finalText } : {}),
    ...(llmResult.usage !== undefined ? { usage: llmResult.usage } : {}),
    ...(llmResult.costUsd !== undefined ? { costUsd: llmResult.costUsd } : {}),
    ...(!scored || hasError ? { error: llmResult.error ?? toJsonValue(parsed) } : {}),
    elapsedMs: Date.now() - startedAt,
    notes: [
      "Corpus-assisted qualitative judgment.", "Structured output enforced via response_format.",
      ...(hasError ? ["Judge model call failed."] : []),
      ...(scored ? [] : [`Judge output parse failure: ${(parsed as { parseError: string }).parseError}`]),
    ],
  };

  await writeJsonFile(judgePath, artifact);
  if (hasError) throw new Error(`Judge stage LLM error: ${JSON.stringify(llmResult.error)}`);
  return { judgePath, artifact };
}
