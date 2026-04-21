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
  judgeCompletenessTotal: number;
  judgeCodeExampleTotal: number;
  judgeExplanationTotal: number;
  judgeRetrievalQualityTotal: number;
  judgeRecommendsCorrectCount: number;
  judgeRecommendsDeprecatedCount: number;
  judgeRetrievalSupportsCount: number;
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
  judgeCompletenessTotal: number;
  judgeCodeExampleTotal: number;
  judgeExplanationTotal: number;
  judgeRetrievalQualityTotal: number;
  judgeRecommendsCorrectCount: number;
  judgeRecommendsDeprecatedCount: number;
  judgeRetrievalSupportsCount: number;
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
    judgeCompletenessTotal: 0,
    judgeCodeExampleTotal: 0,
    judgeExplanationTotal: 0,
    judgeRetrievalQualityTotal: 0,
    judgeRecommendsCorrectCount: 0,
    judgeRecommendsDeprecatedCount: 0,
    judgeRetrievalSupportsCount: 0,
  };
}

function toJudgeMetrics(accumulator: Pick<EvidenceBasisAccumulator, "judgeRuns" | "judgeCorrectCount" | "judgePartiallyCorrectCount" | "judgeIncorrectCount" | "judgeCompletenessTotal" | "judgeCodeExampleTotal" | "judgeExplanationTotal" | "judgeRetrievalQualityTotal" | "judgeRecommendsCorrectCount" | "judgeRecommendsDeprecatedCount" | "judgeRetrievalSupportsCount">): AggregateJudgeMetrics | undefined {
  if (accumulator.judgeRuns === 0) return undefined;
  return {
    judgeRuns: accumulator.judgeRuns,
    judgeCorrectCount: accumulator.judgeCorrectCount,
    judgePartiallyCorrectCount: accumulator.judgePartiallyCorrectCount,
    judgeIncorrectCount: accumulator.judgeIncorrectCount,
    meanCompleteness: accumulator.judgeCompletenessTotal / accumulator.judgeRuns,
    meanCodeExample: accumulator.judgeCodeExampleTotal / accumulator.judgeRuns,
    meanExplanation: accumulator.judgeExplanationTotal / accumulator.judgeRuns,
    meanRetrievalQuality: accumulator.judgeRetrievalQualityTotal / accumulator.judgeRuns,
    recommendsCorrectPatternRate: accumulator.judgeRecommendsCorrectCount / accumulator.judgeRuns,
    recommendsDeprecatedPatternRate: accumulator.judgeRecommendsDeprecatedCount / accumulator.judgeRuns,
    retrievalSupportsReferenceAnswerRate: accumulator.judgeRetrievalSupportsCount / accumulator.judgeRuns,
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
                ...(judge.verdict ? { verdict: judge.verdict } : {}),
                ...(judge.completeness !== undefined ? { completeness: judge.completeness } : {}),
                ...(judge.codeExample !== undefined ? { codeExample: judge.codeExample } : {}),
                ...(judge.explanation !== undefined ? { explanation: judge.explanation } : {}),
                ...(judge.retrievalQuality !== undefined ? { retrievalQuality: judge.retrievalQuality } : {}),
                ...(judge.recommendsCorrectPattern !== undefined ? { recommendsCorrectPattern: judge.recommendsCorrectPattern } : {}),
                ...(judge.recommendsDeprecatedPattern !== undefined ? { recommendsDeprecatedPattern: judge.recommendsDeprecatedPattern } : {}),
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
    judgeCompleteness: run.judge?.completeness,
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
    meanCompleteness: summary.judge?.meanCompleteness,
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
      meanCompleteness: evidenceBasisSummary.judge?.meanCompleteness,
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
    const judge = await readOptionalJsonFile<JudgeArtifact>(join(runDirectory, "judge.json"));
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
      judgeCompletenessTotal: 0,
      judgeCodeExampleTotal: 0,
      judgeExplanationTotal: 0,
      judgeRetrievalQualityTotal: 0,
      judgeRecommendsCorrectCount: 0,
      judgeRecommendsDeprecatedCount: 0,
      judgeRetrievalSupportsCount: 0,
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
      if (judge.verdict === "correct") {
        existing.judgeCorrectCount += 1;
        evidenceBasisAccumulator.judgeCorrectCount += 1;
      } else if (judge.verdict === "partially_correct") {
        existing.judgePartiallyCorrectCount += 1;
        evidenceBasisAccumulator.judgePartiallyCorrectCount += 1;
      } else if (judge.verdict === "incorrect") {
        existing.judgeIncorrectCount += 1;
        evidenceBasisAccumulator.judgeIncorrectCount += 1;
      }
      if (judge.completeness !== undefined) {
        existing.judgeCompletenessTotal += judge.completeness;
        evidenceBasisAccumulator.judgeCompletenessTotal += judge.completeness;
      }
      if (judge.codeExample !== undefined) {
        existing.judgeCodeExampleTotal += judge.codeExample;
        evidenceBasisAccumulator.judgeCodeExampleTotal += judge.codeExample;
      }
      if (judge.explanation !== undefined) {
        existing.judgeExplanationTotal += judge.explanation;
        evidenceBasisAccumulator.judgeExplanationTotal += judge.explanation;
      }
      if (judge.retrievalQuality !== undefined) {
        existing.judgeRetrievalQualityTotal += judge.retrievalQuality;
        evidenceBasisAccumulator.judgeRetrievalQualityTotal += judge.retrievalQuality;
      }
      if (judge.recommendsCorrectPattern) {
        existing.judgeRecommendsCorrectCount += 1;
        evidenceBasisAccumulator.judgeRecommendsCorrectCount += 1;
      }
      if (judge.recommendsDeprecatedPattern) {
        existing.judgeRecommendsDeprecatedCount += 1;
        evidenceBasisAccumulator.judgeRecommendsDeprecatedCount += 1;
      }
      if (judge.retrievalSupportsReferenceAnswer) {
        existing.judgeRetrievalSupportsCount += 1;
        evidenceBasisAccumulator.judgeRetrievalSupportsCount += 1;
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
    "judgeCompleteness",
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
    "meanCompleteness",
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
    "meanCompleteness",
    "meanCodeExample",
    "meanExplanation",
    "meanRetrievalQuality",
    "recommendsCorrectPatternRate",
    "recommendsDeprecatedPatternRate",
    "retrievalSupportsReferenceAnswerRate",
  ];

  await writeTextFile(join(executionDirectory, "aggregate-runs.csv"), toCsv(runCsvHeaders, createRunCsvRows(runDetails)));
  await writeTextFile(join(executionDirectory, "aggregate-runs.jsonl"), toJsonLines(runDetails));
  await writeTextFile(join(executionDirectory, "aggregate-summary.csv"), toCsv(summaryCsvHeaders, createSummaryCsvRows(artifact.summaries)));
  await writeTextFile(join(executionDirectory, "aggregate-evidence-basis.csv"), toCsv(evidenceBasisCsvHeaders, createEvidenceBasisCsvRows(artifact.summaries)));

  return artifact;
}
