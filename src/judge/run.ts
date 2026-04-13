import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
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
  type PromptSnapshot,
  type RunManifest,
  type ToolInvocationTrace,
} from "../shared/contracts.js";
import { serializeJson, readJsonFile, writeJsonFile } from "../shared/io.js";
import { toJsonValue } from "../shared/json.js";
import { createMinimalResourceLoader } from "../collect/minimal-resource-loader.js";
import { createToolsForToolSet, loadToolSetDefinition } from "../collect/tool-sets.js";
import { applyEnvApiKeyOverrides } from "../shared/env-api-keys.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const JUDGE_PROMPT_TEMPLATE_PATHS = {
  "judge-answer-v1": resolve(REPO_ROOT, "prompts", "judge-answer-v1.md"),
} as const;

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
  judgeModelOverride?: ModelRef;
}

export interface JudgeRunOutput {
  judgePath: string;
  artifact: JudgeArtifact;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

function isQualitativeScore(value: unknown): value is JudgeQualitativeScore {
  return value === 0 || value === 1 || value === 2;
}

function validateJudgeResponse(value: unknown): value is ParsedJudgeResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.recommendsCorrectPattern === "boolean" &&
    typeof candidate.recommendsDeprecatedPattern === "boolean" &&
    isQualitativeScore(candidate.completeness) &&
    isQualitativeScore(candidate.codeExample) &&
    isQualitativeScore(candidate.explanation) &&
    typeof candidate.reasoning === "string"
  );
}

function parseJudgeResponse(rawText: string | undefined): ParsedJudgeResponse | { parseError: string; rawText?: string } {
  if (!rawText) {
    return { parseError: "Judge produced no final text." };
  }

  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!validateJudgeResponse(parsed)) {
      return {
        parseError: "Judge JSON did not match the expected qualitative verdict schema.",
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

function rollUpVerdict(response: ParsedJudgeResponse): JudgeVerdictLabel {
  if (!response.recommendsCorrectPattern || response.recommendsDeprecatedPattern) {
    return "incorrect";
  }
  if (response.completeness === 2 && response.codeExample === 2 && response.explanation === 2) {
    return "correct";
  }
  return "partially_correct";
}

async function loadJudgeProfile(judgeProfilePath: string, judgeProfileId: string): Promise<JudgeProfile> {
  const catalog = await readJsonFile<JudgeProfileCatalog>(judgeProfilePath);
  const profile = catalog.profiles.find((candidate) => candidate.id === judgeProfileId);
  if (!profile) {
    throw new Error(`Unknown judge profile: ${judgeProfileId}`);
  }
  return profile;
}

async function renderJudgePrompt(question: DatasetQuestion, answer: BenchmarkAnswerResponse, profile: JudgeProfile): Promise<string> {
  const templatePath = JUDGE_PROMPT_TEMPLATE_PATHS[profile.promptTemplateId];
  const template = await readFile(templatePath, "utf8");

  const candidateEvidenceBlock = answer.mode === "open_book"
    ? `\n## Candidate answer evidence metadata\n- answer included ${answer.citations.length} citation(s)\n- answer evidence summary: ${answer.evidenceSummary}\n`
    : "";

  return `${template.trim()}\n\n## Benchmark question\n${question.question}\n\n## Reference answer\n${question.referenceAnswer}\n\n## Candidate answer metadata\n- mode: ${answer.mode}\n- answerConfidence: ${answer.confidence}${candidateEvidenceBlock}\n\n## Candidate answer\n${answer.finalAnswer}\n`;
}

function createPromptSnapshot(systemPrompt: string, userPrompt: string, availableTools: PromptSnapshot["availableTools"]): PromptSnapshot {
  return {
    systemPrompt,
    userPrompt,
    availableTools,
  };
}

function createSkippedArtifact(params: {
  runId: string;
  questionId: string;
  judgedAt: string;
  judgeProfile: JudgeProfile;
  judgeModel: ModelRef;
  answerSha256: string;
  skipReason: string;
  notes: string[];
  elapsedMs: number;
  toolSet: RunManifest["toolSet"];
}): JudgeArtifact {
  return {
    schemaVersion: JUDGE_VERDICT_SCHEMA_VERSION,
    runId: params.runId,
    questionId: params.questionId,
    status: "skipped",
    judgedAt: params.judgedAt,
    judgeProfileId: params.judgeProfile.id,
    judgeProfileVersion: params.judgeProfile.version,
    judgeModel: params.judgeModel,
    toolSet: params.toolSet,
    promptTemplateId: params.judgeProfile.promptTemplateId,
    promptTemplateVersion: params.judgeProfile.promptTemplateVersion,
    answerSha256: params.answerSha256,
    prompt: createPromptSnapshot("You are a benchmark judge.", "", []),
    toolInvocations: [],
    skipReason: params.skipReason,
    elapsedMs: params.elapsedMs,
    notes: params.notes,
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
  const question = dataset.questions.find((candidate) => candidate.id === questionId);
  const judgeProfile = await loadJudgeProfile(options.judgeProfilePath, options.judgeProfileId);
  const effectiveJudgeModel = options.judgeModelOverride ?? judgeProfile.model;
  const responseSystemPrompt = "You are a benchmark judge. Follow the response schema exactly.";
  const answerSha256 = sha256(serializeJson(normalizedAnswer));

  const judgeToolSet = await loadToolSetDefinition(judgeProfile.toolSetName);

  if (!question) {
    const artifact = createSkippedArtifact({
      runId,
      questionId,
      judgedAt,
      judgeProfile,
      judgeModel: effectiveJudgeModel,
      answerSha256,
      skipReason: "question_not_found_in_dataset",
      notes: ["Judge stage skipped because the run question was missing from the dataset."],
      elapsedMs: Date.now() - startedAt,
      toolSet: judgeToolSet,
    });
    await writeJsonFile(judgePath, artifact);
    return { judgePath, artifact };
  }

  if ("parseError" in normalizedAnswer) {
    const artifact = createSkippedArtifact({
      runId,
      questionId,
      judgedAt,
      judgeProfile,
      judgeModel: effectiveJudgeModel,
      answerSha256,
      skipReason: "answer_parse_error",
      notes: ["Judge stage skipped because normalized-answer.json contains a parse error artifact instead of a valid answer payload."],
      elapsedMs: Date.now() - startedAt,
      toolSet: judgeToolSet,
    });
    await writeJsonFile(judgePath, artifact);
    return { judgePath, artifact };
  }

  const userPrompt = await renderJudgePrompt(question, normalizedAnswer, judgeProfile);
  const corpusRoot = resolve(REPO_ROOT, manifest.corpus.rootDir);
  const tools = createToolsForToolSet(judgeToolSet, corpusRoot);
  const promptSnapshot = createPromptSnapshot(
    responseSystemPrompt,
    userPrompt,
    tools.map((tool) => ({ name: tool.name, description: tool.description })),
  );
  const resourceLoader = createMinimalResourceLoader(responseSystemPrompt);
  const authStorage = AuthStorage.create();
  applyEnvApiKeyOverrides(authStorage);
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.find(effectiveJudgeModel.provider, effectiveJudgeModel.modelId);

  if (!model) {
    throw new Error(`Judge model not found in pi registry: ${effectiveJudgeModel.provider}/${effectiveJudgeModel.modelId}`);
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
  let runError: unknown;

  session.subscribe((event) => {
    const observedAt = new Date().toISOString();

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
    const rawResponseText = getAssistantText(assistantMessage);
    const parsed = parseJudgeResponse(rawResponseText);
    const usageValue = assistantMessage && typeof assistantMessage === "object" && "usage" in assistantMessage
      ? (assistantMessage as { usage: { cost?: { total?: number } } }).usage
      : undefined;
    const costUsd = usageValue?.cost?.total;

    const artifact: JudgeArtifact = {
      schemaVersion: JUDGE_VERDICT_SCHEMA_VERSION,
      runId,
      questionId,
      ...(!("parseError" in parsed)
        ? {
            recommendsCorrectPattern: parsed.recommendsCorrectPattern,
            recommendsDeprecatedPattern: parsed.recommendsDeprecatedPattern,
            completeness: parsed.completeness,
            codeExample: parsed.codeExample,
            explanation: parsed.explanation,
            verdict: rollUpVerdict(parsed),
            reasoning: parsed.reasoning,
          }
        : {}),
      status: runError === undefined && !("parseError" in parsed) ? "scored" : "error",
      judgedAt,
      judgeProfileId: judgeProfile.id,
      judgeProfileVersion: judgeProfile.version,
      judgeModel: effectiveJudgeModel,
      toolSet: judgeToolSet,
      promptTemplateId: judgeProfile.promptTemplateId,
      promptTemplateVersion: judgeProfile.promptTemplateVersion,
      answerSha256,
      prompt: promptSnapshot,
      toolInvocations: [...toolInvocations.values()],
      ...(rawResponseText !== undefined ? { rawResponseText } : {}),
      ...(usageValue !== undefined ? { usage: toJsonValue(usageValue) } : {}),
      ...(typeof costUsd === "number" ? { costUsd } : {}),
      ...(runError === undefined && !("parseError" in parsed) ? {} : { error: toJsonValue(runError ?? parsed) }),
      elapsedMs: Date.now() - startedAt,
      notes: [
        "Corpus-assisted qualitative judgment of the candidate answer.",
        "Judge prompt intentionally excludes reference answers, pitfalls, and deterministic rubric keywords.",
        ...(runError === undefined ? [] : ["Judge model call failed."]),
        ...("parseError" in parsed ? [`Judge output parse failure: ${parsed.parseError}`] : []),
      ],
    };

    await writeJsonFile(judgePath, artifact);

    if (runError !== undefined) {
      throw runError;
    }

    return { judgePath, artifact };
  } finally {
    session.dispose();
  }
}
