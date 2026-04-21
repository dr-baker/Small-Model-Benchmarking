import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  AggregateArtifact,
  AggregateCostMetrics,
  AggregateErrorMetrics,
  AggregateJudgeMetrics,
  AggregateModelSummary,
  AggregateEvidenceBasisSummary,
  AggregateRunDetail,
  BenchmarkAnswerResponse,
  BenchmarkMode,
  BenchmarkEvidenceBasis,
  CollectTrace,
  DatasetQuestion,
  DeterministicAgreement,
  GradeArtifact,
  JudgeArtifact,
  RunManifest,
  ToolSetDefinition,
} from "../shared/contracts.js";
import { readJsonFile, writeJsonFile, writeTextFile } from "../shared/io.js";

export interface AggregateRunOptions {
  runDirectories: string[];
  benchmarkName: string;
  rubricVersion: string;
}

interface SummaryAccumulator {
  model: RunManifest["model"];
  mode: BenchmarkMode;
  toolSet: ToolSetDefinition;
  transport: RunManifest["transport"];
  runs: number;
  answerScoreTotal: number;
  groundedRuns: number;
  groundedTrue: number;
  retrievalCount: number;
  retrievalMrrTotal: number;
  collectTrackedRuns: number;
  judgeTrackedRuns: number;
  collectCostUsdTotal: number;
  judgeCostUsdTotal: number;
  judgeRuns: number;
  judgeCorrectCount: number;
  judgePartiallyCorrectCount: number;
  judgeIncorrectCount: number;
  judgeCorrectnessTotal: number;
  judgeCorrectnessNegativeCount: number;
  judgeCorrectnessZeroCount: number;
  judgeCorrectnessPositiveCount: number;
  judgeCompletenessTotal: number;
  judgeCompletenessNegativeCount: number;
  judgeCompletenessZeroCount: number;
  judgeCompletenessPositiveCount: number;
  judgeCodeExampleTotal: number;
  judgeExplanationTotal: number;
  judgeRetrievalQualityTotal: number;
  judgeRetrievalQualityRuns: number;
  judgeReferenceVerifiedCount: number;
  judgeReferenceVerifiedRuns: number;
  judgeRecommendsCorrectCount: number;
  judgeRecommendsDeprecatedCount: number;
  judgeRetrievalSupportsCount: number;
  judgeRetrievalSupportsRuns: number;
  runsWithAnyError: number;
  collectErrorRuns: number;
  judgeErrorRuns: number;
  evidenceBasisBreakdown: Map<BenchmarkEvidenceBasis, EvidenceBasisAccumulator>;
}

interface EvidenceBasisAccumulator {
  evidenceBasis: BenchmarkEvidenceBasis;
  runs: number;
  answerScoreTotal: number;
  groundedRuns: number;
  groundedTrue: number;
  retrievalCount: number;
  retrievalMrrTotal: number;
  judgeRuns: number;
  judgeCorrectCount: number;
  judgePartiallyCorrectCount: number;
  judgeIncorrectCount: number;
  judgeCorrectnessTotal: number;
  judgeCorrectnessNegativeCount: number;
  judgeCorrectnessZeroCount: number;
  judgeCorrectnessPositiveCount: number;
  judgeCompletenessTotal: number;
  judgeCompletenessNegativeCount: number;
  judgeCompletenessZeroCount: number;
  judgeCompletenessPositiveCount: number;
  judgeCodeExampleTotal: number;
  judgeExplanationTotal: number;
  judgeRetrievalQualityTotal: number;
  judgeRetrievalQualityRuns: number;
  judgeReferenceVerifiedCount: number;
  judgeReferenceVerifiedRuns: number;
  judgeRecommendsCorrectCount: number;
  judgeRecommendsDeprecatedCount: number;
  judgeRetrievalSupportsCount: number;
  judgeRetrievalSupportsRuns: number;
}

type NormalizedAnswerArtifact = BenchmarkAnswerResponse | { parseError: string; rawText?: string };

interface DatasetArtifact {
  questions: DatasetQuestion[];
}

interface QuestionLookupEntry {
  title?: string;
  question?: string;
}

interface RunRecord {
  runDirectory: string;
  manifest: RunManifest;
  trace: CollectTrace;
  answer: NormalizedAnswerArtifact;
  grade: GradeArtifact;
  judge?: JudgeArtifact;
  questionDetail: AggregateRunDetail["question"];
}

function summaryKey(manifest: RunManifest): string {
  return [manifest.model.provider, manifest.model.modelId, manifest.transport.kind, manifest.mode, manifest.toolSet.name, manifest.toolSet.version].join("::");
}

function getSharedBenchmarkDirectory(runDirectories: string[]): string {
  const parents = [...new Set(runDirectories.map((runDirectory) => dirname(runDirectory)))];
  if (parents.length !== 1 || parents[0] === undefined) {
    throw new Error("Aggregate runs must belong to the same benchmark execution directory.");
  }
  return parents[0];
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    await access(path, fsConstants.F_OK);
  } catch {
    return undefined;
  }
  return readJsonFile<T>(path);
}

async function readPreferredJudgeArtifact(runDirectory: string): Promise<JudgeArtifact | undefined> {
  return (await readOptionalJsonFile<JudgeArtifact>(join(runDirectory, "judge.v2.json")))
    ?? (await readOptionalJsonFile<JudgeArtifact>(join(runDirectory, "judge.json")));
}

async function loadQuestionLookup(executionDirectory: string): Promise<Map<string, QuestionLookupEntry>> {
  const executionConfigPath = join(executionDirectory, "execution-config.yaml");
  try {
    const parsed = parseYaml(await readFile(executionConfigPath, "utf8")) as { paths?: { dataset?: unknown } };
    const datasetPath = typeof parsed.paths?.dataset === "string" ? parsed.paths.dataset : undefined;
    if (!datasetPath) return new Map();

    const dataset = await readOptionalJsonFile<DatasetArtifact>(datasetPath);
    if (!dataset) return new Map();
    return new Map(dataset.questions.map((question) => [
      question.id,
      { title: question.title, question: question.question },
    ]));
  } catch {
    return new Map();
  }
}

function extractQuestionTitleFromTrace(trace: CollectTrace): string | undefined {
  const contents = [
    ...(trace.prompt.messages?.map((message) => message.content) ?? []),
    trace.prompt.userPrompt,
  ];
  for (const content of contents) {
    const match = content.match(/^- title:\s*(.+)$/m);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function extractQuestionTextFromTrace(trace: CollectTrace): string | undefined {
  const prefix = "## Benchmark question\n";
  const contents = [
    ...(trace.prompt.messages?.map((message) => message.content) ?? []).reverse(),
    trace.prompt.userPrompt,
  ];
  for (const content of contents) {
    const index = content.lastIndexOf(prefix);
    if (index >= 0) {
      return content.slice(index + prefix.length).trim();
    }
  }
  return undefined;
}

function resolveQuestionDetail(record: Pick<RunRecord, "grade" | "trace"> & { manifest: RunManifest }, questionLookup: Map<string, QuestionLookupEntry>): AggregateRunDetail["question"] {
  const questionId = record.grade.questionId;
  const lookup = questionLookup.get(questionId);
  const title = lookup?.title ?? extractQuestionTitleFromTrace(record.trace);
  const question = lookup?.question ?? extractQuestionTextFromTrace(record.trace);
  return {
    questionId,
    evidenceBasis: record.grade.evidenceBasis,
    platformScope: record.grade.platformScope,
    questionShape: record.grade.questionShape,
    ...(title !== undefined ? { title } : {}),
    ...(question !== undefined ? { question } : {}),
  };
}

function isParseErrorAnswer(answer: NormalizedAnswerArtifact): answer is { parseError: string; rawText?: string } {
  return "parseError" in answer;
}

function createEvidenceBasisAccumulator(evidenceBasis: BenchmarkEvidenceBasis): EvidenceBasisAccumulator {
  return {
    evidenceBasis,
    runs: 0,
    answerScoreTotal: 0,
    groundedRuns: 0,
    groundedTrue: 0,
    retrievalCount: 0,
    retrievalMrrTotal: 0,
    judgeRuns: 0,
    judgeCorrectCount: 0,
    judgePartiallyCorrectCount: 0,
    judgeIncorrectCount: 0,
    judgeCorrectnessTotal: 0,
    judgeCorrectnessNegativeCount: 0,
    judgeCorrectnessZeroCount: 0,
    judgeCorrectnessPositiveCount: 0,
    judgeCompletenessTotal: 0,
    judgeCompletenessNegativeCount: 0,
    judgeCompletenessZeroCount: 0,
    judgeCompletenessPositiveCount: 0,
    judgeCodeExampleTotal: 0,
    judgeExplanationTotal: 0,
    judgeRetrievalQualityTotal: 0,
    judgeRetrievalQualityRuns: 0,
    judgeReferenceVerifiedCount: 0,
    judgeReferenceVerifiedRuns: 0,
    judgeRecommendsCorrectCount: 0,
    judgeRecommendsDeprecatedCount: 0,
    judgeRetrievalSupportsCount: 0,
    judgeRetrievalSupportsRuns: 0,
  };
}

function isJudgeV2Artifact(judge: JudgeArtifact): boolean {
  return judge.correctness !== undefined
    || judge.deprecatedPatternUse !== undefined
    || judge.referenceVerified !== undefined
    || judge.observations !== undefined;
}

function judgeCorrectnessValue(judge: { correctness?: -1 | 0 | 1 | undefined; verdict?: "correct" | "partially_correct" | "incorrect" | undefined }): -1 | 0 | 1 | undefined {
  if (judge.correctness !== undefined) return judge.correctness;
  if (judge.verdict === "correct") return 1;
  if (judge.verdict === "incorrect") return -1;
  if (judge.verdict === "partially_correct") return 0;
  return undefined;
}

function judgeCompletenessValue(judge: JudgeArtifact): -1 | 0 | 1 | undefined {
  const rawCompleteness = judge.completeness as number | undefined;
  if (rawCompleteness === undefined) return undefined;
  if (isJudgeV2Artifact(judge) && (rawCompleteness === -1 || rawCompleteness === 0 || rawCompleteness === 1)) {
    return rawCompleteness;
  }
  if (rawCompleteness === 0 || rawCompleteness === 1 || rawCompleteness === 2) {
    return (rawCompleteness - 1) as -1 | 0 | 1;
  }
  return undefined;
}

function judgeDerivedVerdict(judge: JudgeArtifact): "correct" | "partially_correct" | "incorrect" | undefined {
  if (judge.verdict !== undefined) return judge.verdict;
  const correctness = judgeCorrectnessValue(judge);
  const completeness = judgeCompletenessValue(judge);
  if (correctness === undefined || completeness === undefined) return undefined;
  if (correctness === -1) return "incorrect";
  if (correctness === 1 && completeness === 1) return "correct";
  return "partially_correct";
}

function judgeDerivedRecommendsCorrectPattern(judge: JudgeArtifact): boolean | undefined {
  if (judge.recommendsCorrectPattern !== undefined) return judge.recommendsCorrectPattern;
  const correctness = judgeCorrectnessValue(judge);
  return correctness === undefined ? undefined : correctness === 1;
}

function judgeDerivedRecommendsDeprecatedPattern(judge: JudgeArtifact): boolean | undefined {
  if (judge.recommendsDeprecatedPattern !== undefined) return judge.recommendsDeprecatedPattern;
  if (judge.deprecatedPatternUse === undefined) return undefined;
  return judge.deprecatedPatternUse === "primary" || judge.deprecatedPatternUse === "fallback";
}

function judgeDerivedCodeExample(judge: JudgeArtifact): 0 | 1 | 2 | undefined {
  if (judge.codeExample !== undefined) return judge.codeExample;
  const completeness = judgeCompletenessValue(judge);
  if (judge.observations?.hasCode === undefined || completeness === undefined) return undefined;
  return judge.observations.hasCode ? (completeness === 1 ? 2 : 1) : 0;
}

function judgeDerivedExplanation(judge: JudgeArtifact): 0 | 1 | 2 | undefined {
  if (judge.explanation !== undefined) return judge.explanation;
  const completeness = judgeCompletenessValue(judge);
  if (judge.observations?.hasExplanation === undefined || completeness === undefined) return undefined;
  return judge.observations.hasExplanation ? (completeness === 1 ? 2 : 1) : 0;
}

function toJudgeMetrics(accumulator: Pick<EvidenceBasisAccumulator, "judgeRuns" | "judgeCorrectCount" | "judgePartiallyCorrectCount" | "judgeIncorrectCount" | "judgeCorrectnessTotal" | "judgeCorrectnessNegativeCount" | "judgeCorrectnessZeroCount" | "judgeCorrectnessPositiveCount" | "judgeCompletenessTotal" | "judgeCompletenessNegativeCount" | "judgeCompletenessZeroCount" | "judgeCompletenessPositiveCount" | "judgeCodeExampleTotal" | "judgeExplanationTotal" | "judgeRetrievalQualityTotal" | "judgeRetrievalQualityRuns" | "judgeReferenceVerifiedCount" | "judgeReferenceVerifiedRuns" | "judgeRecommendsCorrectCount" | "judgeRecommendsDeprecatedCount" | "judgeRetrievalSupportsCount" | "judgeRetrievalSupportsRuns">): AggregateJudgeMetrics | undefined {
  if (accumulator.judgeRuns === 0) return undefined;
  return {
    judgeRuns: accumulator.judgeRuns,
    judgeCorrectCount: accumulator.judgeCorrectCount,
    judgePartiallyCorrectCount: accumulator.judgePartiallyCorrectCount,
    judgeIncorrectCount: accumulator.judgeIncorrectCount,
    meanCorrectness: accumulator.judgeCorrectnessTotal / accumulator.judgeRuns,
    correctnessNegativeCount: accumulator.judgeCorrectnessNegativeCount,
    correctnessZeroCount: accumulator.judgeCorrectnessZeroCount,
    correctnessPositiveCount: accumulator.judgeCorrectnessPositiveCount,
    meanCompleteness: accumulator.judgeCompletenessTotal / accumulator.judgeRuns,
    completenessNegativeCount: accumulator.judgeCompletenessNegativeCount,
    completenessZeroCount: accumulator.judgeCompletenessZeroCount,
    completenessPositiveCount: accumulator.judgeCompletenessPositiveCount,
    meanCodeExample: accumulator.judgeCodeExampleTotal / accumulator.judgeRuns,
    meanExplanation: accumulator.judgeExplanationTotal / accumulator.judgeRuns,
    ...(accumulator.judgeRetrievalQualityRuns > 0
      ? { meanRetrievalQuality: accumulator.judgeRetrievalQualityTotal / accumulator.judgeRetrievalQualityRuns }
      : {}),
    ...(accumulator.judgeReferenceVerifiedRuns > 0
      ? { referenceVerifiedRate: accumulator.judgeReferenceVerifiedCount / accumulator.judgeReferenceVerifiedRuns }
      : {}),
    recommendsCorrectPatternRate: accumulator.judgeRecommendsCorrectCount / accumulator.judgeRuns,
    recommendsDeprecatedPatternRate: accumulator.judgeRecommendsDeprecatedCount / accumulator.judgeRuns,
    ...(accumulator.judgeRetrievalSupportsRuns > 0
      ? { retrievalSupportsReferenceAnswerRate: accumulator.judgeRetrievalSupportsCount / accumulator.judgeRetrievalSupportsRuns }
      : {}),
  };
}

function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return toCsvValue(JSON.stringify(value));
  }
  if (typeof value === "string") {
    if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function toJsonLines(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n") + "\n";
}

function sortSummaries(summaries: AggregateModelSummary[]): AggregateModelSummary[] {
  return [...summaries].sort((left, right) => {
    const leftKey = `${left.model.provider}/${left.model.modelId}/${left.mode}/${left.transport.kind}`;
    const rightKey = `${right.model.provider}/${right.model.modelId}/${right.mode}/${right.transport.kind}`;
    return leftKey.localeCompare(rightKey);
  });
}

function deriveAgreement(grade: GradeArtifact, judge?: JudgeArtifact): DeterministicAgreement {
  const judgeCorrectness = judge ? judgeCorrectnessValue(judge) : undefined;
  if ((grade.rubricStrength !== "medium" && grade.rubricStrength !== "high") || !judge || judge.status !== "scored" || judgeCorrectness === undefined || judgeCorrectness === 0) {
    return "det_advisory";
  }

  const judgePositive = judgeCorrectness === 1;
  if (grade.answer.correct && judgePositive) return "agree_correct";
  if (!grade.answer.correct && !judgePositive) return "agree_incorrect";
  if (grade.answer.correct && !judgePositive) return "det_only_positive";
  return "judge_only_positive";
}

export async function listAggregateReadyRunDirectories(executionDirectory: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(executionDirectory, { withFileTypes: true });
  const runDirectories: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runDirectory = join(executionDirectory, entry.name);
    const hasGrade = await readOptionalJsonFile<unknown>(join(runDirectory, "grade.json"));
    const hasManifest = await readOptionalJsonFile<unknown>(join(runDirectory, "manifest.json"));
    const hasTrace = await readOptionalJsonFile<unknown>(join(runDirectory, "trace.json"));
    if (hasGrade && hasManifest && hasTrace) {
      runDirectories.push(runDirectory);
    }
  }

  return runDirectories.sort((left, right) => left.localeCompare(right));
}

function createAggregateRunDetails(records: RunRecord[]): AggregateRunDetail[] {
  return records
    .sort((left, right) => left.manifest.runId.localeCompare(right.manifest.runId))
    .map(({ runDirectory, manifest, answer, grade, judge, questionDetail, trace }) => {
      const collectUsd = trace.costUsd;
      const judgeUsd = judge?.costUsd;
      const totalUsd = typeof collectUsd === "number" || typeof judgeUsd === "number"
        ? (collectUsd ?? 0) + (judgeUsd ?? 0)
        : undefined;
      const judgeCorrectness = judge ? judgeCorrectnessValue(judge) : undefined;
      const judgeCompleteness = judge ? judgeCompletenessValue(judge) : undefined;
      const judgeVerdict = judge ? judgeDerivedVerdict(judge) : undefined;
      const judgeCodeExample = judge ? judgeDerivedCodeExample(judge) : undefined;
      const judgeExplanation = judge ? judgeDerivedExplanation(judge) : undefined;
      const judgeRecommendsCorrectPattern = judge ? judgeDerivedRecommendsCorrectPattern(judge) : undefined;
      const judgeRecommendsDeprecatedPattern = judge ? judgeDerivedRecommendsDeprecatedPattern(judge) : undefined;

      return {
        runDirectory,
        runId: manifest.runId,
        question: questionDetail,
        model: manifest.model,
        transport: manifest.transport,
        mode: manifest.mode,
        toolSet: manifest.toolSet,
        answer: isParseErrorAnswer(answer)
          ? {
              parseError: answer.parseError,
              citationCount: 0,
              citationFilePaths: [],
            }
          : {
              mode: answer.mode,
              confidence: answer.confidence,
              finalAnswer: answer.finalAnswer,
              ...(answer.mode === "open_book" ? { evidenceSummary: answer.evidenceSummary } : {}),
              citationCount: answer.citations.length,
              citationFilePaths: answer.citations.map((citation) => citation.filePath),
            },
        grade: {
          score: grade.answer.score,
          correct: grade.answer.correct,
          ...(grade.answer.grounded !== undefined ? { grounded: grade.answer.grounded } : {}),
          ...(grade.rubricStrength !== undefined ? { rubricStrength: grade.rubricStrength } : {}),
          agreement: deriveAgreement(grade, judge),
          mustMentionPassed: grade.answer.mustMentionPassed,
          mustMentionFailed: grade.answer.mustMentionFailed,
          mustNotMentionViolated: grade.answer.mustNotMentionViolated,
          failures: grade.failures,
          ...(grade.retrieval ? { retrieval: grade.retrieval } : {}),
        },
        ...(judge
          ? {
              judge: {
                status: judge.status,
                ...(judgeVerdict !== undefined ? { verdict: judgeVerdict } : {}),
                ...(judgeCorrectness !== undefined ? { correctness: judgeCorrectness } : {}),
                ...(judgeCompleteness !== undefined ? { completeness: judgeCompleteness } : {}),
                ...(judge.deprecatedPatternUse !== undefined ? { deprecatedPatternUse: judge.deprecatedPatternUse } : {}),
                ...(judge.referenceVerified !== undefined ? { referenceVerified: judge.referenceVerified } : {}),
                ...(judge.observations !== undefined ? { observations: judge.observations } : {}),
                ...(judgeCodeExample !== undefined ? { codeExample: judgeCodeExample } : {}),
                ...(judgeExplanation !== undefined ? { explanation: judgeExplanation } : {}),
                ...(judge.retrievalQuality !== undefined ? { retrievalQuality: judge.retrievalQuality } : {}),
                ...(judgeRecommendsCorrectPattern !== undefined ? { recommendsCorrectPattern: judgeRecommendsCorrectPattern } : {}),
                ...(judgeRecommendsDeprecatedPattern !== undefined ? { recommendsDeprecatedPattern: judgeRecommendsDeprecatedPattern } : {}),
                ...(judge.retrievalSupportsReferenceAnswer !== undefined ? { retrievalSupportsReferenceAnswer: judge.retrievalSupportsReferenceAnswer } : {}),
                ...(judge.reasoning ? { reasoning: judge.reasoning } : {}),
                ...(judge.costUsd !== undefined ? { costUsd: judge.costUsd } : {}),
              },
            }
          : {}),
        cost: {
          ...(collectUsd !== undefined ? { collectUsd } : {}),
          ...(judgeUsd !== undefined ? { judgeUsd } : {}),
          ...(totalUsd !== undefined ? { totalUsd } : {}),
        },
        errors: {
          collectHadError: trace.error !== undefined,
          judgeHadError: judge?.status === "error",
        },
        artifactPaths: manifest.artifactPaths,
      };
    });
}

function createRunCsvRows(runs: AggregateRunDetail[]): Array<Record<string, unknown>> {
  return runs.map((run) => ({
    runDirectory: run.runDirectory,
    runId: run.runId,
    questionId: run.question.questionId,
    questionTitle: run.question.title,
    question: run.question.question,
    evidenceBasis: run.question.evidenceBasis,
    platformScope: run.question.platformScope,
    questionShape: run.question.questionShape,
    modelProvider: run.model.provider,
    modelId: run.model.modelId,
    transportKind: run.transport.kind,
    mode: run.mode,
    toolSetName: run.toolSet.name,
    toolSetVersion: run.toolSet.version,
    answerMode: run.answer.mode,
    answerConfidence: run.answer.confidence,
    answerParseError: run.answer.parseError,
    answerCitationCount: run.answer.citationCount,
    answerCitationFilePaths: run.answer.citationFilePaths.join(" | "),
    answerCitationFilePathsJson: run.answer.citationFilePaths,
    evidenceSummary: run.answer.evidenceSummary,
    modelAnswer: run.answer.finalAnswer,
    answerScore: run.grade.score,
    answerCorrect: run.grade.correct,
    grounded: run.grade.grounded,
    rubricStrength: run.grade.rubricStrength,
    agreement: run.grade.agreement,
    mustMentionPassedCount: run.grade.mustMentionPassed.length,
    mustMentionFailedCount: run.grade.mustMentionFailed.length,
    mustNotMentionViolatedCount: run.grade.mustNotMentionViolated.length,
    mustMentionPassed: run.grade.mustMentionPassed.join(" | "),
    mustMentionPassedJson: run.grade.mustMentionPassed,
    mustMentionFailed: run.grade.mustMentionFailed.join(" | "),
    mustMentionFailedJson: run.grade.mustMentionFailed,
    mustNotMentionViolated: run.grade.mustNotMentionViolated.join(" | "),
    mustNotMentionViolatedJson: run.grade.mustNotMentionViolated,
    failures: run.grade.failures.join(" | "),
    failuresJson: run.grade.failures,
    retrievalHitAt1: run.grade.retrieval?.hitAt1,
    retrievalHitAtK: run.grade.retrieval?.hitAtK,
    retrievalMrr: run.grade.retrieval?.mrr,
    retrievalSearchCalls: run.grade.retrieval?.searchCalls,
    retrievalReformulations: run.grade.retrieval?.reformulations,
    filesReadBeforeFirstRelevantDoc: run.grade.retrieval?.filesReadBeforeFirstRelevantDoc,
    timeToFirstRelevantDocMs: run.grade.retrieval?.timeToFirstRelevantDocMs,
    bytesRead: run.grade.retrieval?.bytesRead,
    judgeStatus: run.judge?.status,
    judgeVerdict: run.judge?.verdict,
    judgeCorrectness: run.judge ? judgeCorrectnessValue(run.judge) : undefined,
    judgeCompleteness: run.judge?.completeness,
    judgeReferenceVerified: run.judge?.referenceVerified,
    judgeDeprecatedPatternUse: run.judge?.deprecatedPatternUse,
    judgeCodeExample: run.judge?.codeExample,
    judgeExplanation: run.judge?.explanation,
    judgeRetrievalQuality: run.judge?.retrievalQuality,
    judgeRecommendsCorrectPattern: run.judge?.recommendsCorrectPattern,
    judgeRecommendsDeprecatedPattern: run.judge?.recommendsDeprecatedPattern,
    judgeRetrievalSupportsReferenceAnswer: run.judge?.retrievalSupportsReferenceAnswer,
    judgeReasoning: run.judge?.reasoning,
    collectCostUsd: run.cost.collectUsd,
    judgeCostUsd: run.cost.judgeUsd,
    totalCostUsd: run.cost.totalUsd,
    collectHadError: run.errors.collectHadError,
    judgeHadError: run.errors.judgeHadError,
    tracePath: run.artifactPaths.trace,
    normalizedAnswerPath: run.artifactPaths.normalizedAnswer,
    judgePath: run.artifactPaths.judge,
    gradePath: run.artifactPaths.grade,
  }));
}

function createSummaryCsvRows(summaries: AggregateModelSummary[]): Array<Record<string, unknown>> {
  return sortSummaries(summaries).map((summary) => ({
    modelProvider: summary.model.provider,
    modelId: summary.model.modelId,
    mode: summary.mode,
    transportKind: summary.transport.kind,
    toolSetName: summary.toolSet.name,
    toolSetVersion: summary.toolSet.version,
    runs: summary.runs,
    meanAnswerScore: summary.meanAnswerScore,
    groundedRate: summary.groundedRate,
    meanRetrievalMrr: summary.meanRetrievalMrr,
    collectTrackedRuns: summary.cost?.collectTrackedRuns,
    judgeTrackedRuns: summary.cost?.judgeTrackedRuns,
    totalCollectCostUsd: summary.cost?.totalCollectCostUsd,
    totalJudgeCostUsd: summary.cost?.totalJudgeCostUsd,
    totalCostUsd: summary.cost?.totalCostUsd,
    meanCollectCostUsdPerRun: summary.cost?.meanCollectCostUsdPerRun,
    meanJudgeCostUsdPerRun: summary.cost?.meanJudgeCostUsdPerRun,
    meanTotalCostUsdPerRun: summary.cost?.meanTotalCostUsdPerRun,
    judgeRuns: summary.judge?.judgeRuns,
    judgeCorrectCount: summary.judge?.judgeCorrectCount,
    judgePartiallyCorrectCount: summary.judge?.judgePartiallyCorrectCount,
    judgeIncorrectCount: summary.judge?.judgeIncorrectCount,
    judgeCorrectRate: summary.judge ? summary.judge.judgeCorrectCount / summary.judge.judgeRuns : undefined,
    meanCorrectness: summary.judge?.meanCorrectness,
    correctnessNegativeCount: summary.judge?.correctnessNegativeCount,
    correctnessZeroCount: summary.judge?.correctnessZeroCount,
    correctnessPositiveCount: summary.judge?.correctnessPositiveCount,
    meanCompleteness: summary.judge?.meanCompleteness,
    completenessNegativeCount: summary.judge?.completenessNegativeCount,
    completenessZeroCount: summary.judge?.completenessZeroCount,
    completenessPositiveCount: summary.judge?.completenessPositiveCount,
    referenceVerifiedRate: summary.judge?.referenceVerifiedRate,
    meanCodeExample: summary.judge?.meanCodeExample,
    meanExplanation: summary.judge?.meanExplanation,
    meanRetrievalQuality: summary.judge?.meanRetrievalQuality,
    recommendsCorrectPatternRate: summary.judge?.recommendsCorrectPatternRate,
    recommendsDeprecatedPatternRate: summary.judge?.recommendsDeprecatedPatternRate,
    retrievalSupportsReferenceAnswerRate: summary.judge?.retrievalSupportsReferenceAnswerRate,
    runsWithAnyError: summary.errors?.runsWithAnyError,
    collectErrorRuns: summary.errors?.collectErrorRuns,
    judgeErrorRuns: summary.errors?.judgeErrorRuns,
  }));
}

function createEvidenceBasisCsvRows(summaries: AggregateModelSummary[]): Array<Record<string, unknown>> {
  return sortSummaries(summaries)
    .flatMap((summary) => (summary.evidenceBasisBreakdown ?? []).map((evidenceBasisSummary) => ({
      modelProvider: summary.model.provider,
      modelId: summary.model.modelId,
      mode: summary.mode,
      transportKind: summary.transport.kind,
      toolSetName: summary.toolSet.name,
      evidenceBasis: evidenceBasisSummary.evidenceBasis,
      runs: evidenceBasisSummary.runs,
      meanAnswerScore: evidenceBasisSummary.meanAnswerScore,
      groundedRate: evidenceBasisSummary.groundedRate,
      meanRetrievalMrr: evidenceBasisSummary.meanRetrievalMrr,
      judgeRuns: evidenceBasisSummary.judge?.judgeRuns,
      judgeCorrectCount: evidenceBasisSummary.judge?.judgeCorrectCount,
      judgePartiallyCorrectCount: evidenceBasisSummary.judge?.judgePartiallyCorrectCount,
      judgeIncorrectCount: evidenceBasisSummary.judge?.judgeIncorrectCount,
      meanCorrectness: evidenceBasisSummary.judge?.meanCorrectness,
      correctnessNegativeCount: evidenceBasisSummary.judge?.correctnessNegativeCount,
      correctnessZeroCount: evidenceBasisSummary.judge?.correctnessZeroCount,
      correctnessPositiveCount: evidenceBasisSummary.judge?.correctnessPositiveCount,
      meanCompleteness: evidenceBasisSummary.judge?.meanCompleteness,
      completenessNegativeCount: evidenceBasisSummary.judge?.completenessNegativeCount,
      completenessZeroCount: evidenceBasisSummary.judge?.completenessZeroCount,
      completenessPositiveCount: evidenceBasisSummary.judge?.completenessPositiveCount,
      referenceVerifiedRate: evidenceBasisSummary.judge?.referenceVerifiedRate,
      meanCodeExample: evidenceBasisSummary.judge?.meanCodeExample,
      meanExplanation: evidenceBasisSummary.judge?.meanExplanation,
      meanRetrievalQuality: evidenceBasisSummary.judge?.meanRetrievalQuality,
      recommendsCorrectPatternRate: evidenceBasisSummary.judge?.recommendsCorrectPatternRate,
      recommendsDeprecatedPatternRate: evidenceBasisSummary.judge?.recommendsDeprecatedPatternRate,
      retrievalSupportsReferenceAnswerRate: evidenceBasisSummary.judge?.retrievalSupportsReferenceAnswerRate,
    })));
}

export async function aggregateRuns(options: AggregateRunOptions): Promise<AggregateArtifact> {
  const executionDirectory = getSharedBenchmarkDirectory(options.runDirectories);
  const questionLookup = await loadQuestionLookup(executionDirectory);
  const accumulators = new Map<string, SummaryAccumulator>();
  const records: RunRecord[] = [];

  for (const runDirectory of options.runDirectories) {
    const manifest = await readJsonFile<RunManifest>(join(runDirectory, "manifest.json"));
    const trace = await readJsonFile<CollectTrace>(join(runDirectory, "trace.json"));
    const answer = await readJsonFile<NormalizedAnswerArtifact>(join(runDirectory, "normalized-answer.json"));
    const grade = await readJsonFile<GradeArtifact>(join(runDirectory, "grade.json"));
    const judge = await readPreferredJudgeArtifact(runDirectory);
    records.push({
      runDirectory,
      manifest,
      trace,
      answer,
      grade,
      questionDetail: resolveQuestionDetail({ manifest, trace, grade }, questionLookup),
      ...(judge ? { judge } : {}),
    });

    const key = summaryKey(manifest);
    const existing = accumulators.get(key) ?? {
      model: manifest.model,
      mode: manifest.mode,
      toolSet: manifest.toolSet,
      transport: manifest.transport,
      runs: 0,
      answerScoreTotal: 0,
      groundedRuns: 0,
      groundedTrue: 0,
      retrievalCount: 0,
      retrievalMrrTotal: 0,
      collectTrackedRuns: 0,
      judgeTrackedRuns: 0,
      collectCostUsdTotal: 0,
      judgeCostUsdTotal: 0,
      judgeRuns: 0,
      judgeCorrectCount: 0,
      judgePartiallyCorrectCount: 0,
      judgeIncorrectCount: 0,
      judgeCorrectnessTotal: 0,
      judgeCorrectnessNegativeCount: 0,
      judgeCorrectnessZeroCount: 0,
      judgeCorrectnessPositiveCount: 0,
      judgeCompletenessTotal: 0,
      judgeCompletenessNegativeCount: 0,
      judgeCompletenessZeroCount: 0,
      judgeCompletenessPositiveCount: 0,
      judgeCodeExampleTotal: 0,
      judgeExplanationTotal: 0,
      judgeRetrievalQualityTotal: 0,
      judgeRetrievalQualityRuns: 0,
      judgeReferenceVerifiedCount: 0,
      judgeReferenceVerifiedRuns: 0,
      judgeRecommendsCorrectCount: 0,
      judgeRecommendsDeprecatedCount: 0,
      judgeRetrievalSupportsCount: 0,
      judgeRetrievalSupportsRuns: 0,
      runsWithAnyError: 0,
      collectErrorRuns: 0,
      judgeErrorRuns: 0,
      evidenceBasisBreakdown: new Map(),
    };

    existing.runs += 1;
    existing.answerScoreTotal += grade.answer.score;

    const evidenceBasisAccumulator = existing.evidenceBasisBreakdown.get(grade.evidenceBasis)
      ?? createEvidenceBasisAccumulator(grade.evidenceBasis);
    evidenceBasisAccumulator.runs += 1;
    evidenceBasisAccumulator.answerScoreTotal += grade.answer.score;

    if (typeof trace.costUsd === "number") {
      existing.collectTrackedRuns += 1;
      existing.collectCostUsdTotal += trace.costUsd;
    }

    const collectHadError = trace.error !== undefined;
    const judgeHadError = judge?.status === "error";
    if (collectHadError) existing.collectErrorRuns += 1;
    if (judgeHadError) existing.judgeErrorRuns += 1;
    if (collectHadError || judgeHadError) existing.runsWithAnyError += 1;

    if (grade.answer.grounded !== undefined) {
      existing.groundedRuns += 1;
      evidenceBasisAccumulator.groundedRuns += 1;
      if (grade.answer.grounded) {
        existing.groundedTrue += 1;
        evidenceBasisAccumulator.groundedTrue += 1;
      }
    }

    if (grade.retrieval?.mrr !== undefined) {
      existing.retrievalCount += 1;
      existing.retrievalMrrTotal += grade.retrieval.mrr;
      evidenceBasisAccumulator.retrievalCount += 1;
      evidenceBasisAccumulator.retrievalMrrTotal += grade.retrieval.mrr;
    }

    if (typeof judge?.costUsd === "number") {
      existing.judgeTrackedRuns += 1;
      existing.judgeCostUsdTotal += judge.costUsd;
    }

    if (judge?.status === "scored") {
      existing.judgeRuns += 1;
      evidenceBasisAccumulator.judgeRuns += 1;

      const correctness = judgeCorrectnessValue(judge);
      if (correctness !== undefined) {
        existing.judgeCorrectnessTotal += correctness;
        evidenceBasisAccumulator.judgeCorrectnessTotal += correctness;
        if (correctness === -1) {
          existing.judgeCorrectnessNegativeCount += 1;
          evidenceBasisAccumulator.judgeCorrectnessNegativeCount += 1;
        } else if (correctness === 0) {
          existing.judgeCorrectnessZeroCount += 1;
          evidenceBasisAccumulator.judgeCorrectnessZeroCount += 1;
        } else {
          existing.judgeCorrectnessPositiveCount += 1;
          evidenceBasisAccumulator.judgeCorrectnessPositiveCount += 1;
        }
      }

      const derivedVerdict = judgeDerivedVerdict(judge);
      if (derivedVerdict === "correct") {
        existing.judgeCorrectCount += 1;
        evidenceBasisAccumulator.judgeCorrectCount += 1;
      } else if (derivedVerdict === "partially_correct") {
        existing.judgePartiallyCorrectCount += 1;
        evidenceBasisAccumulator.judgePartiallyCorrectCount += 1;
      } else if (derivedVerdict === "incorrect") {
        existing.judgeIncorrectCount += 1;
        evidenceBasisAccumulator.judgeIncorrectCount += 1;
      }

      const completeness = judgeCompletenessValue(judge);
      if (completeness !== undefined) {
        existing.judgeCompletenessTotal += completeness;
        evidenceBasisAccumulator.judgeCompletenessTotal += completeness;
        if (completeness === -1) {
          existing.judgeCompletenessNegativeCount += 1;
          evidenceBasisAccumulator.judgeCompletenessNegativeCount += 1;
        } else if (completeness === 0) {
          existing.judgeCompletenessZeroCount += 1;
          evidenceBasisAccumulator.judgeCompletenessZeroCount += 1;
        } else {
          existing.judgeCompletenessPositiveCount += 1;
          evidenceBasisAccumulator.judgeCompletenessPositiveCount += 1;
        }
      }

      if (judge.referenceVerified !== undefined) {
        existing.judgeReferenceVerifiedRuns += 1;
        evidenceBasisAccumulator.judgeReferenceVerifiedRuns += 1;
        if (judge.referenceVerified) {
          existing.judgeReferenceVerifiedCount += 1;
          evidenceBasisAccumulator.judgeReferenceVerifiedCount += 1;
        }
      }

      const derivedCodeExample = judgeDerivedCodeExample(judge);
      if (derivedCodeExample !== undefined) {
        existing.judgeCodeExampleTotal += derivedCodeExample;
        evidenceBasisAccumulator.judgeCodeExampleTotal += derivedCodeExample;
      }
      const derivedExplanation = judgeDerivedExplanation(judge);
      if (derivedExplanation !== undefined) {
        existing.judgeExplanationTotal += derivedExplanation;
        evidenceBasisAccumulator.judgeExplanationTotal += derivedExplanation;
      }
      if (judge.retrievalQuality !== undefined) {
        existing.judgeRetrievalQualityTotal += judge.retrievalQuality;
        existing.judgeRetrievalQualityRuns += 1;
        evidenceBasisAccumulator.judgeRetrievalQualityTotal += judge.retrievalQuality;
        evidenceBasisAccumulator.judgeRetrievalQualityRuns += 1;
      }
      const derivedRecommendsCorrectPattern = judgeDerivedRecommendsCorrectPattern(judge);
      if (derivedRecommendsCorrectPattern) {
        existing.judgeRecommendsCorrectCount += 1;
        evidenceBasisAccumulator.judgeRecommendsCorrectCount += 1;
      }
      const derivedRecommendsDeprecatedPattern = judgeDerivedRecommendsDeprecatedPattern(judge);
      if (derivedRecommendsDeprecatedPattern) {
        existing.judgeRecommendsDeprecatedCount += 1;
        evidenceBasisAccumulator.judgeRecommendsDeprecatedCount += 1;
      }
      if (judge.retrievalSupportsReferenceAnswer !== undefined) {
        existing.judgeRetrievalSupportsRuns += 1;
        evidenceBasisAccumulator.judgeRetrievalSupportsRuns += 1;
        if (judge.retrievalSupportsReferenceAnswer) {
          existing.judgeRetrievalSupportsCount += 1;
          evidenceBasisAccumulator.judgeRetrievalSupportsCount += 1;
        }
      }
    }

    existing.evidenceBasisBreakdown.set(grade.evidenceBasis, evidenceBasisAccumulator);
    accumulators.set(key, existing);
  }

  const summaries: AggregateModelSummary[] = [...accumulators.values()].map((accumulator) => {
    const base: AggregateModelSummary = {
      model: accumulator.model,
      mode: accumulator.mode,
      toolSet: accumulator.toolSet,
      transport: accumulator.transport,
      runs: accumulator.runs,
      meanAnswerScore: accumulator.runs === 0 ? 0 : accumulator.answerScoreTotal / accumulator.runs,
      ...(accumulator.groundedRuns === 0 ? {} : { groundedRate: accumulator.groundedTrue / accumulator.groundedRuns }),
      ...(accumulator.retrievalCount === 0 ? {} : { meanRetrievalMrr: accumulator.retrievalMrrTotal / accumulator.retrievalCount }),
    };

    if (accumulator.collectTrackedRuns > 0 || accumulator.judgeTrackedRuns > 0) {
      const totalTrackedRuns = Math.max(accumulator.collectTrackedRuns, accumulator.judgeTrackedRuns);
      const totalCostUsd = accumulator.collectCostUsdTotal + accumulator.judgeCostUsdTotal;
      const costMetrics: AggregateCostMetrics = {
        collectTrackedRuns: accumulator.collectTrackedRuns,
        judgeTrackedRuns: accumulator.judgeTrackedRuns,
        totalCollectCostUsd: accumulator.collectCostUsdTotal,
        totalJudgeCostUsd: accumulator.judgeCostUsdTotal,
        totalCostUsd,
        meanCollectCostUsdPerRun: accumulator.collectTrackedRuns === 0 ? 0 : accumulator.collectCostUsdTotal / accumulator.collectTrackedRuns,
        meanJudgeCostUsdPerRun: accumulator.judgeTrackedRuns === 0 ? 0 : accumulator.judgeCostUsdTotal / accumulator.judgeTrackedRuns,
        meanTotalCostUsdPerRun: totalTrackedRuns === 0 ? 0 : totalCostUsd / totalTrackedRuns,
      };
      base.cost = costMetrics;
    }

    const judgeMetrics = toJudgeMetrics(accumulator);
    if (judgeMetrics) base.judge = judgeMetrics;

    const errorMetrics: AggregateErrorMetrics = {
      runsWithAnyError: accumulator.runsWithAnyError,
      collectErrorRuns: accumulator.collectErrorRuns,
      judgeErrorRuns: accumulator.judgeErrorRuns,
    };
    if (errorMetrics.runsWithAnyError > 0 || errorMetrics.collectErrorRuns > 0 || errorMetrics.judgeErrorRuns > 0) {
      base.errors = errorMetrics;
    }

    const evidenceBasisBreakdown: AggregateEvidenceBasisSummary[] = [...accumulator.evidenceBasisBreakdown.values()]
      .sort((left, right) => left.evidenceBasis.localeCompare(right.evidenceBasis))
      .map((evidenceBasisAccumulator) => {
        const evidenceBasisJudgeMetrics = toJudgeMetrics(evidenceBasisAccumulator);
        return {
          evidenceBasis: evidenceBasisAccumulator.evidenceBasis,
          runs: evidenceBasisAccumulator.runs,
          meanAnswerScore: evidenceBasisAccumulator.answerScoreTotal / evidenceBasisAccumulator.runs,
          ...(evidenceBasisAccumulator.groundedRuns === 0 ? {} : { groundedRate: evidenceBasisAccumulator.groundedTrue / evidenceBasisAccumulator.groundedRuns }),
          ...(evidenceBasisAccumulator.retrievalCount === 0 ? {} : { meanRetrievalMrr: evidenceBasisAccumulator.retrievalMrrTotal / evidenceBasisAccumulator.retrievalCount }),
          ...(evidenceBasisJudgeMetrics ? { judge: evidenceBasisJudgeMetrics } : {}),
        };
      });

    if (evidenceBasisBreakdown.length > 0) base.evidenceBasisBreakdown = evidenceBasisBreakdown;
    return base;
  });

  const runDetails = createAggregateRunDetails(records);
  const artifact: AggregateArtifact = {
    benchmarkName: options.benchmarkName,
    rubricVersion: options.rubricVersion,
    generatedAt: new Date().toISOString(),
    summaries: sortSummaries(summaries),
    runs: runDetails,
  };

  await writeJsonFile(join(executionDirectory, "aggregate.json"), artifact);

  const runCsvHeaders = [
    "runDirectory",
    "runId",
    "questionId",
    "questionTitle",
    "question",
    "evidenceBasis",
    "platformScope",
    "questionShape",
    "modelProvider",
    "modelId",
    "transportKind",
    "mode",
    "toolSetName",
    "toolSetVersion",
    "answerMode",
    "answerConfidence",
    "answerParseError",
    "answerCitationCount",
    "answerCitationFilePaths",
    "answerCitationFilePathsJson",
    "evidenceSummary",
    "modelAnswer",
    "answerScore",
    "answerCorrect",
    "grounded",
    "rubricStrength",
    "agreement",
    "mustMentionPassedCount",
    "mustMentionFailedCount",
    "mustNotMentionViolatedCount",
    "mustMentionPassed",
    "mustMentionPassedJson",
    "mustMentionFailed",
    "mustMentionFailedJson",
    "mustNotMentionViolated",
    "mustNotMentionViolatedJson",
    "failures",
    "failuresJson",
    "retrievalHitAt1",
    "retrievalHitAtK",
    "retrievalMrr",
    "retrievalSearchCalls",
    "retrievalReformulations",
    "filesReadBeforeFirstRelevantDoc",
    "timeToFirstRelevantDocMs",
    "bytesRead",
    "judgeStatus",
    "judgeVerdict",
    "judgeCorrectness",
    "judgeCompleteness",
    "judgeReferenceVerified",
    "judgeDeprecatedPatternUse",
    "judgeCodeExample",
    "judgeExplanation",
    "judgeRetrievalQuality",
    "judgeRecommendsCorrectPattern",
    "judgeRecommendsDeprecatedPattern",
    "judgeRetrievalSupportsReferenceAnswer",
    "judgeReasoning",
    "collectCostUsd",
    "judgeCostUsd",
    "totalCostUsd",
    "collectHadError",
    "judgeHadError",
    "tracePath",
    "normalizedAnswerPath",
    "judgePath",
    "gradePath",
  ];

  const summaryCsvHeaders = [
    "modelProvider",
    "modelId",
    "mode",
    "transportKind",
    "toolSetName",
    "toolSetVersion",
    "runs",
    "meanAnswerScore",
    "groundedRate",
    "meanRetrievalMrr",
    "collectTrackedRuns",
    "judgeTrackedRuns",
    "totalCollectCostUsd",
    "totalJudgeCostUsd",
    "totalCostUsd",
    "meanCollectCostUsdPerRun",
    "meanJudgeCostUsdPerRun",
    "meanTotalCostUsdPerRun",
    "judgeRuns",
    "judgeCorrectCount",
    "judgePartiallyCorrectCount",
    "judgeIncorrectCount",
    "judgeCorrectRate",
    "meanCorrectness",
    "correctnessNegativeCount",
    "correctnessZeroCount",
    "correctnessPositiveCount",
    "meanCompleteness",
    "completenessNegativeCount",
    "completenessZeroCount",
    "completenessPositiveCount",
    "referenceVerifiedRate",
    "meanCodeExample",
    "meanExplanation",
    "meanRetrievalQuality",
    "recommendsCorrectPatternRate",
    "recommendsDeprecatedPatternRate",
    "retrievalSupportsReferenceAnswerRate",
    "runsWithAnyError",
    "collectErrorRuns",
    "judgeErrorRuns",
  ];

  const evidenceBasisCsvHeaders = [
    "modelProvider",
    "modelId",
    "mode",
    "transportKind",
    "toolSetName",
    "evidenceBasis",
    "runs",
    "meanAnswerScore",
    "groundedRate",
    "meanRetrievalMrr",
    "judgeRuns",
    "judgeCorrectCount",
    "judgePartiallyCorrectCount",
    "judgeIncorrectCount",
    "meanCorrectness",
    "correctnessNegativeCount",
    "correctnessZeroCount",
    "correctnessPositiveCount",
    "meanCompleteness",
    "completenessNegativeCount",
    "completenessZeroCount",
    "completenessPositiveCount",
    "referenceVerifiedRate",
    "meanCodeExample",
    "meanExplanation",
    "meanRetrievalQuality",
    "recommendsCorrectPatternRate",
    "recommendsDeprecatedPatternRate",
    "retrievalSupportsReferenceAnswerRate",
  ];

  const runCsvRows = createRunCsvRows(runDetails);
  const disagreementRows = runCsvRows.filter((row) => row.agreement !== "agree_correct" && row.agreement !== "agree_incorrect");
  await writeTextFile(join(executionDirectory, "aggregate-runs.csv"), toCsv(runCsvHeaders, runCsvRows));
  await writeTextFile(join(executionDirectory, "aggregate-disagreement.csv"), toCsv(runCsvHeaders, disagreementRows));
  await writeTextFile(join(executionDirectory, "aggregate-runs.jsonl"), toJsonLines(runDetails));
  await writeTextFile(join(executionDirectory, "aggregate-summary.csv"), toCsv(summaryCsvHeaders, createSummaryCsvRows(artifact.summaries)));
  await writeTextFile(join(executionDirectory, "aggregate-evidence-basis.csv"), toCsv(evidenceBasisCsvHeaders, createEvidenceBasisCsvRows(artifact.summaries)));

  return artifact;
}
