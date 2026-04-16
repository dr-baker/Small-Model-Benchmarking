import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AggregateArtifact,
  AggregateCostMetrics,
  AggregateJudgeMetrics,
  AggregateModelSummary,
  AggregateQuestionTypeSummary,
  BenchmarkMode,
  BenchmarkQuestionType,
  CollectTrace,
  GradeArtifact,
  JudgeArtifact,
  RunManifest,
  ToolSetDefinition,
} from "../shared/contracts.js";
import { readJsonFile, writeJsonFile } from "../shared/io.js";

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
  judgeRecommendsCorrectCount: number;
  judgeRecommendsDeprecatedCount: number;
  questionTypeBreakdown: Map<BenchmarkQuestionType, QuestionTypeAccumulator>;
}

interface QuestionTypeAccumulator {
  questionType: BenchmarkQuestionType;
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
  judgeRecommendsCorrectCount: number;
  judgeRecommendsDeprecatedCount: number;
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

function createQuestionTypeAccumulator(questionType: BenchmarkQuestionType): QuestionTypeAccumulator {
  return {
    questionType,
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
    judgeRecommendsCorrectCount: 0,
    judgeRecommendsDeprecatedCount: 0,
  };
}

function toJudgeMetrics(accumulator: Pick<QuestionTypeAccumulator, "judgeRuns" | "judgeCorrectCount" | "judgePartiallyCorrectCount" | "judgeIncorrectCount" | "judgeCompletenessTotal" | "judgeCodeExampleTotal" | "judgeExplanationTotal" | "judgeRecommendsCorrectCount" | "judgeRecommendsDeprecatedCount">): AggregateJudgeMetrics | undefined {
  if (accumulator.judgeRuns === 0) return undefined;
  return {
    judgeRuns: accumulator.judgeRuns,
    judgeCorrectCount: accumulator.judgeCorrectCount,
    judgePartiallyCorrectCount: accumulator.judgePartiallyCorrectCount,
    judgeIncorrectCount: accumulator.judgeIncorrectCount,
    meanCompleteness: accumulator.judgeCompletenessTotal / accumulator.judgeRuns,
    meanCodeExample: accumulator.judgeCodeExampleTotal / accumulator.judgeRuns,
    meanExplanation: accumulator.judgeExplanationTotal / accumulator.judgeRuns,
    recommendsCorrectPatternRate: accumulator.judgeRecommendsCorrectCount / accumulator.judgeRuns,
    recommendsDeprecatedPatternRate: accumulator.judgeRecommendsDeprecatedCount / accumulator.judgeRuns,
  };
}

export async function aggregateRuns(options: AggregateRunOptions): Promise<AggregateArtifact> {
  const accumulators = new Map<string, SummaryAccumulator>();

  for (const runDirectory of options.runDirectories) {
    const manifest = await readJsonFile<RunManifest>(join(runDirectory, "manifest.json"));
    const trace = await readJsonFile<CollectTrace>(join(runDirectory, "trace.json"));
    const grade = await readJsonFile<GradeArtifact>(join(runDirectory, "grade.json"));
    const judge = await readOptionalJsonFile<JudgeArtifact>(join(runDirectory, "judge.json"));
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
      judgeRecommendsCorrectCount: 0,
      judgeRecommendsDeprecatedCount: 0,
      questionTypeBreakdown: new Map(),
    };

    existing.runs += 1;
    existing.answerScoreTotal += grade.answer.score;

    const questionTypeAccumulator = existing.questionTypeBreakdown.get(grade.questionType)
      ?? createQuestionTypeAccumulator(grade.questionType);
    questionTypeAccumulator.runs += 1;
    questionTypeAccumulator.answerScoreTotal += grade.answer.score;

    if (typeof trace.costUsd === "number") {
      existing.collectTrackedRuns += 1;
      existing.collectCostUsdTotal += trace.costUsd;
    }

    if (grade.answer.grounded !== undefined) {
      existing.groundedRuns += 1;
      questionTypeAccumulator.groundedRuns += 1;
      if (grade.answer.grounded) {
        existing.groundedTrue += 1;
        questionTypeAccumulator.groundedTrue += 1;
      }
    }

    if (grade.retrieval?.mrr !== undefined) {
      existing.retrievalCount += 1;
      existing.retrievalMrrTotal += grade.retrieval.mrr;
      questionTypeAccumulator.retrievalCount += 1;
      questionTypeAccumulator.retrievalMrrTotal += grade.retrieval.mrr;
    }

    if (typeof judge?.costUsd === "number") {
      existing.judgeTrackedRuns += 1;
      existing.judgeCostUsdTotal += judge.costUsd;
    }

    if (judge?.status === "scored") {
      existing.judgeRuns += 1;
      questionTypeAccumulator.judgeRuns += 1;
      if (judge.verdict === "correct") {
        existing.judgeCorrectCount += 1;
        questionTypeAccumulator.judgeCorrectCount += 1;
      }
      else if (judge.verdict === "partially_correct") {
        existing.judgePartiallyCorrectCount += 1;
        questionTypeAccumulator.judgePartiallyCorrectCount += 1;
      }
      else if (judge.verdict === "incorrect") {
        existing.judgeIncorrectCount += 1;
        questionTypeAccumulator.judgeIncorrectCount += 1;
      }
      if (judge.completeness !== undefined) {
        existing.judgeCompletenessTotal += judge.completeness;
        questionTypeAccumulator.judgeCompletenessTotal += judge.completeness;
      }
      if (judge.codeExample !== undefined) {
        existing.judgeCodeExampleTotal += judge.codeExample;
        questionTypeAccumulator.judgeCodeExampleTotal += judge.codeExample;
      }
      if (judge.explanation !== undefined) {
        existing.judgeExplanationTotal += judge.explanation;
        questionTypeAccumulator.judgeExplanationTotal += judge.explanation;
      }
      if (judge.recommendsCorrectPattern) {
        existing.judgeRecommendsCorrectCount += 1;
        questionTypeAccumulator.judgeRecommendsCorrectCount += 1;
      }
      if (judge.recommendsDeprecatedPattern) {
        existing.judgeRecommendsDeprecatedCount += 1;
        questionTypeAccumulator.judgeRecommendsDeprecatedCount += 1;
      }
    }

    existing.questionTypeBreakdown.set(grade.questionType, questionTypeAccumulator);
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
      ...(accumulator.groundedRuns === 0
        ? {}
        : { groundedRate: accumulator.groundedTrue / accumulator.groundedRuns }),
      ...(accumulator.retrievalCount === 0
        ? {}
        : { meanRetrievalMrr: accumulator.retrievalMrrTotal / accumulator.retrievalCount }),
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
    if (judgeMetrics) {
      base.judge = judgeMetrics;
    }

    const questionTypeBreakdown: AggregateQuestionTypeSummary[] = [...accumulator.questionTypeBreakdown.values()]
      .sort((left, right) => left.questionType.localeCompare(right.questionType))
      .map((questionTypeAccumulator) => {
        const questionTypeJudgeMetrics = toJudgeMetrics(questionTypeAccumulator);
        return {
          questionType: questionTypeAccumulator.questionType,
          runs: questionTypeAccumulator.runs,
          meanAnswerScore: questionTypeAccumulator.answerScoreTotal / questionTypeAccumulator.runs,
          ...(questionTypeAccumulator.groundedRuns === 0
            ? {}
            : { groundedRate: questionTypeAccumulator.groundedTrue / questionTypeAccumulator.groundedRuns }),
          ...(questionTypeAccumulator.retrievalCount === 0
            ? {}
            : { meanRetrievalMrr: questionTypeAccumulator.retrievalMrrTotal / questionTypeAccumulator.retrievalCount }),
          ...(questionTypeJudgeMetrics ? { judge: questionTypeJudgeMetrics } : {}),
        };
      });

    if (questionTypeBreakdown.length > 0) {
      base.questionTypeBreakdown = questionTypeBreakdown;
    }

    return base;
  });

  const artifact: AggregateArtifact = {
    benchmarkName: options.benchmarkName,
    rubricVersion: options.rubricVersion,
    generatedAt: new Date().toISOString(),
    summaries,
  };

  await writeJsonFile(join(getSharedBenchmarkDirectory(options.runDirectories), "aggregate.json"), artifact);
  return artifact;
}
