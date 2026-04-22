import type {
  AggregateFile,
  AggregateRun,
  AggregateSummary,
  BundledSnapshot,
  EnrichedRun,
  EvidenceBasis,
  LoadedExecution,
  QuestionBank,
  QuestionBankInput,
  QuestionMeta,
  QuestionMetaInput,
  RecentRunsBundle,
} from '../types';

const GENERATED_ASSET_ROOT = `${import.meta.env.BASE_URL}generated`;

export const EMPTY_QUESTION_BANK: QuestionBank = {
  benchmarkName: 'benchmark',
  datasetVersion: 'unknown',
  rubricVersion: 'unknown',
  generatedAt: '',
  questions: {},
};

export const EMPTY_RECENT_RUNS_BUNDLE: RecentRunsBundle = {
  generatedAt: '',
  count: 0,
  runs: [],
};

export function buildQuestionList(questionBank: QuestionBank): QuestionMeta[] {
  return Object.values(questionBank.questions).sort((left, right) => left.order - right.order);
}

export function pickAggregateFiles(files: File[]): File[] {
  return files.filter((file) => {
    if (file.name === 'aggregate.json') {
      return true;
    }

    return file.webkitRelativePath.endsWith('/aggregate.json');
  });
}

export async function loadBundledSnapshot(): Promise<BundledSnapshot> {
  const [questionBankInput, recentRunsBundle] = await Promise.all([
    fetchJson<QuestionBankInput>(`${GENERATED_ASSET_ROOT}/question-bank.json`),
    fetchJson<RecentRunsBundle>(`${GENERATED_ASSET_ROOT}/recent-runs.json`),
  ]);

  const questionBank = normalizeQuestionBank(questionBankInput);
  const questionList = buildQuestionList(questionBank);
  const bundledExecutions = dedupeExecutions(
    (recentRunsBundle.runs ?? [])
      .map((entry) => {
        try {
          return parseAggregateData(entry.aggregate, entry.sourceName, questionBank);
        } catch {
          return null;
        }
      })
      .filter((execution): execution is LoadedExecution => execution !== null),
  );

  return {
    questionBank,
    questionList,
    recentRunsBundle,
    bundledExecutions,
  };
}

export async function loadExecutionsFromFiles(
  files: File[],
  questionBank: QuestionBank,
): Promise<{ executions: LoadedExecution[]; errors: string[] }> {
  const errors: string[] = [];
  const parsed = await Promise.all(
    files.map(async (file) => {
      try {
        return await parseAggregateFile(file, questionBank);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${file.name}: ${message}`);
        return null;
      }
    }),
  );

  return {
    executions: parsed.filter((value): value is LoadedExecution => value !== null),
    errors,
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function parseAggregateFile(file: File, questionBank: QuestionBank): Promise<LoadedExecution> {
  const text = await file.text();
  const aggregate = JSON.parse(text) as AggregateFile;
  const sourceName = deriveSourceName(file, aggregate, aggregate.runs?.[0]);
  return parseAggregateData(aggregate, sourceName, questionBank);
}

function parseAggregateData(
  aggregate: AggregateFile,
  sourceName: string,
  questionBank: QuestionBank,
): LoadedExecution {
  const normalizedAggregate = normalizeAggregateFile(aggregate);
  const summary = normalizedAggregate.summaries?.[0];

  if (!summary) {
    throw new Error('missing summaries[0]');
  }

  const rawRuns = normalizedAggregate.runs ?? [];
  if (!Array.isArray(rawRuns) || rawRuns.length === 0) {
    throw new Error('missing runs[]');
  }

  const runs = rawRuns.map((run) => enrichRun(run, questionBank));
  const runsByQuestionId = Object.fromEntries(runs.map((run) => [run.questionId, run]));
  const label = deriveLabel(summary);
  const shortLabel = deriveShortLabel(summary);
  const id = [sourceName, label, normalizedAggregate.generatedAt ?? 'unknown'].join('::');

  return {
    id,
    sourceName,
    label,
    shortLabel,
    aggregate: normalizedAggregate,
    summary,
    runs,
    runsByQuestionId,
  };
}

function enrichRun(run: AggregateRun, questionBank: QuestionBank): EnrichedRun {
  const questionId = run.question.questionId ?? run.question.id ?? 'unknown-question';
  return {
    ...run,
    question: normalizeAggregateQuestion(run.question),
    questionId,
    meta: questionBank.questions[questionId] ?? null,
  };
}

function normalizeQuestionBank(input: QuestionBankInput): QuestionBank {
  return {
    benchmarkName: input.benchmarkName,
    datasetVersion: input.datasetVersion,
    rubricVersion: input.rubricVersion,
    generatedAt: input.generatedAt,
    questions: Object.fromEntries(
      Object.entries(input.questions ?? {}).map(([id, question]) => [id, normalizeQuestionMeta(question)]),
    ),
  };
}

function normalizeQuestionMeta(question: QuestionMetaInput): QuestionMeta {
  return {
    ...question,
    evidenceBasis: resolveEvidenceBasis(question.evidenceBasis, question.questionType),
  };
}

function normalizeAggregateFile(aggregate: AggregateFile): AggregateFile {
  return {
    ...aggregate,
    summaries: aggregate.summaries?.map((summary) => normalizeAggregateSummary(summary)),
    runs: aggregate.runs?.map((run) => normalizeAggregateRun(run)),
  };
}

function normalizeAggregateSummary(summary: AggregateSummary): AggregateSummary {
  const evidenceBasisBreakdown =
    summary.evidenceBasisBreakdown ??
    summary.questionTypeBreakdown?.flatMap((entry) => {
      const evidenceBasis = resolveEvidenceBasis(undefined, entry.questionType);
      if (!evidenceBasis) {
        return [];
      }

      return [
        {
          evidenceBasis,
          runs: entry.runs,
          meanAnswerScore: entry.meanAnswerScore,
          groundedRate: entry.groundedRate,
          meanRetrievalMrr: entry.meanRetrievalMrr,
          judge: normalizeJudgeSummary(entry.judge),
        },
      ];
    });

  return {
    ...summary,
    evidenceBasisBreakdown,
    questionTypeBreakdown: summary.questionTypeBreakdown,
    judge: normalizeJudgeSummary(summary.judge),
  };
}

function normalizeAggregateRun(run: AggregateRun): AggregateRun {
  return {
    ...run,
    question: normalizeAggregateQuestion(run.question),
    grade: run.grade
      ? {
          ...run.grade,
        }
      : run.grade,
    judge: run.judge ? normalizeAggregateJudge(run.judge) : run.judge,
  };
}

function normalizeAggregateQuestion(question: AggregateRun['question']): AggregateRun['question'] {
  const evidenceBasis = resolveEvidenceBasis(question.evidenceBasis, question.questionType);
  return {
    ...question,
    ...(evidenceBasis ? { evidenceBasis } : {}),
  };
}

function normalizeJudgeSummary(summary: AggregateSummary['judge']): AggregateSummary['judge'] {
  if (!summary) {
    return summary;
  }

  const normalized = {
    ...summary,
  };

  const derivedJudgeRuns =
    summary.judgeRuns ??
    ([summary.judgeCorrectCount, summary.judgePartiallyCorrectCount, summary.judgeIncorrectCount].some(
      (value) => typeof value === 'number',
    )
      ? (summary.judgeCorrectCount ?? 0) +
        (summary.judgePartiallyCorrectCount ?? 0) +
        (summary.judgeIncorrectCount ?? 0)
      : undefined);

  if (
    derivedJudgeRuns &&
    [summary.judgeCorrectCount, summary.judgePartiallyCorrectCount, summary.judgeIncorrectCount].some(
      (value) => typeof value === 'number',
    )
  ) {
    normalized.meanCorrectness ??=
      ((summary.judgeCorrectCount ?? 0) - (summary.judgeIncorrectCount ?? 0)) /
      derivedJudgeRuns;
    normalized.correctnessNegativeCount ??= summary.judgeIncorrectCount ?? 0;
    normalized.correctnessZeroCount ??= summary.judgePartiallyCorrectCount ?? 0;
    normalized.correctnessPositiveCount ??= summary.judgeCorrectCount ?? 0;
  }

  if (
    typeof normalized.meanCompleteness === 'number' &&
    normalized.completenessNegativeCount === undefined &&
    normalized.completenessZeroCount === undefined &&
    normalized.completenessPositiveCount === undefined &&
    normalized.meanCompleteness >= 0 &&
    normalized.meanCompleteness <= 2
  ) {
    normalized.meanCompleteness -= 1;
  }

  return normalized;
}

function normalizeAggregateJudge(judge: NonNullable<AggregateRun['judge']>): NonNullable<AggregateRun['judge']> {
  const correctness = normalizeJudgeCorrectness(judge.correctness, judge.verdict);
  const verdict = judge.verdict ?? judgeVerdictFromCorrectness(correctness);
  const completeness = normalizeJudgeCompleteness(judge.completeness, judge.correctness, judge.verdict);

  return {
    ...judge,
    ...(verdict ? { verdict } : {}),
    ...(correctness !== undefined ? { correctness } : {}),
    ...(completeness !== undefined ? { completeness } : {}),
  };
}

function normalizeJudgeCorrectness(
  correctness: number | undefined,
  verdict: string | undefined,
): number | undefined {
  if (correctness === -1 || correctness === 0 || correctness === 1) {
    return correctness;
  }

  if (verdict === 'correct') {
    return 1;
  }
  if (verdict === 'partially_correct') {
    return 0;
  }
  if (verdict === 'incorrect') {
    return -1;
  }

  return undefined;
}

function normalizeJudgeCompleteness(
  completeness: number | undefined,
  correctness: number | undefined,
  verdict: string | undefined,
): number | undefined {
  if (completeness == null) {
    return undefined;
  }

  if (correctness === undefined && verdict !== undefined && completeness >= 0 && completeness <= 2) {
    return completeness - 1;
  }

  return completeness;
}

function judgeVerdictFromCorrectness(
  correctness: number | undefined,
): 'correct' | 'partially_correct' | 'incorrect' | undefined {
  if (correctness === 1) {
    return 'correct';
  }
  if (correctness === 0) {
    return 'partially_correct';
  }
  if (correctness === -1) {
    return 'incorrect';
  }
  return undefined;
}

function resolveEvidenceBasis(
  evidenceBasis: EvidenceBasis | undefined,
  questionType: string | undefined,
): EvidenceBasis {
  if (evidenceBasis === 'corpus' || evidenceBasis === 'curated') {
    return evidenceBasis;
  }

  if (questionType === 'corpus_backed') {
    return 'corpus';
  }

  return 'curated';
}

function deriveSourceName(
  file: File | null,
  aggregate: AggregateFile,
  firstRun: AggregateRun | undefined,
): string {
  if (file?.webkitRelativePath) {
    return file.webkitRelativePath.split('/')[0] ?? file.name;
  }

  const aggregatePath = firstRun?.artifactPaths?.aggregate;
  if (aggregatePath) {
    const parts = aggregatePath.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return parts[parts.length - 2] ?? file?.name ?? 'aggregate.json';
    }
  }

  if (file?.name) {
    return file.name;
  }

  if (aggregate.benchmarkName) {
    return `${aggregate.benchmarkName}-${aggregate.generatedAt ?? 'run'}`;
  }

  return 'uploaded-aggregate';
}

function deriveLabel(summary: AggregateSummary): string {
  const model = summary.model?.modelId ?? 'unknown-model';
  const provider = summary.model?.provider ?? 'unknown-provider';
  const toolSet = summary.toolSet?.name ?? 'unknown-tools';
  const mode = formatMode(summary.mode);

  return `${provider} / ${model} / ${toolSet} / ${mode}`;
}

function deriveShortLabel(summary: AggregateSummary): string {
  const modelParts = summary.model?.modelId?.split('/') ?? [];
  const model = modelParts[modelParts.length - 1] ?? 'unknown-model';
  const toolSet = summary.toolSet?.name ?? 'unknown-tools';
  const mode =
    summary.mode === 'open_book'
      ? 'open'
      : summary.mode === 'closed_book'
        ? 'closed'
        : summary.mode ?? 'mode';
  return `${model} · ${toolSet} · ${mode}`;
}

export function formatMode(mode: string | undefined): string {
  if (mode === 'open_book') {
    return 'open-book';
  }
  if (mode === 'closed_book') {
    return 'closed-book';
  }
  return mode ?? 'unknown';
}

export function dedupeExecutions(executions: LoadedExecution[]): LoadedExecution[] {
  const seen = new Set<string>();
  return executions.filter((execution) => {
    if (seen.has(execution.id)) {
      return false;
    }
    seen.add(execution.id);
    return true;
  });
}
