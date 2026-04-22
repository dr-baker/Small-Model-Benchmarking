export type EvidenceBasis = 'corpus' | 'curated';
export type LegacyQuestionType = 'corpus_backed' | 'best_practice';
export type DeterministicAgreement =
  | 'agree_correct'
  | 'agree_incorrect'
  | 'det_only_positive'
  | 'judge_only_positive'
  | 'det_advisory';
export type RubricStrength = 'low' | 'medium' | 'high';

export interface QuestionMetaInput {
  id: string;
  order: number;
  title: string;
  question: string;
  referenceAnswer: string;
  pitfall: string;
  evidenceBasis?: EvidenceBasis;
  questionType?: LegacyQuestionType;
  platformScope: string;
  questionShape: string;
  taxonomyTags: string[];
  goldEvidence: Array<{ filePath: string }>;
  rubric: {
    mustMention: string[];
    mustMentionAnyOf?: string[][];
    mustNotMention: string[];
    passThreshold?: number;
  };
}

export interface QuestionMeta extends QuestionMetaInput {
  evidenceBasis: EvidenceBasis;
}

export interface QuestionBankInput {
  benchmarkName: string;
  datasetVersion: string;
  rubricVersion: string;
  generatedAt: string;
  questions: Record<string, QuestionMetaInput>;
}

export interface QuestionBank extends QuestionBankInput {
  questions: Record<string, QuestionMeta>;
}

export interface AggregateJudgeSummary {
  judgeRuns?: number;
  judgeCorrectCount?: number;
  judgePartiallyCorrectCount?: number;
  judgeIncorrectCount?: number;
  meanCorrectness?: number;
  correctnessNegativeCount?: number;
  correctnessZeroCount?: number;
  correctnessPositiveCount?: number;
  meanCompleteness?: number;
  completenessNegativeCount?: number;
  completenessZeroCount?: number;
  completenessPositiveCount?: number;
  meanCodeExample?: number;
  meanExplanation?: number;
  meanRetrievalQuality?: number;
  referenceVerifiedRate?: number;
  recommendsCorrectPatternRate?: number;
  recommendsDeprecatedPatternRate?: number;
  retrievalSupportsReferenceAnswerRate?: number;
}

export interface AggregateEvidenceBasisSummary {
  evidenceBasis: EvidenceBasis;
  runs?: number;
  meanAnswerScore?: number;
  groundedRate?: number;
  meanRetrievalMrr?: number;
  judge?: AggregateJudgeSummary;
}

export interface AggregateQuestionTypeSummary {
  questionType: string;
  runs?: number;
  meanAnswerScore?: number;
  groundedRate?: number;
  meanRetrievalMrr?: number;
  judge?: AggregateJudgeSummary;
}

export interface AggregateSummary {
  model?: {
    provider?: string;
    modelId?: string;
  };
  mode?: string;
  toolSet?: {
    name?: string;
    version?: string;
    description?: string;
    toolNames?: string[];
  };
  runs?: number;
  meanAnswerScore?: number;
  groundedRate?: number;
  meanRetrievalMrr?: number;
  cost?: {
    meanCollectCostUsdPerRun?: number;
    meanJudgeCostUsdPerRun?: number;
    meanTotalCostUsdPerRun?: number;
    totalCostUsd?: number;
  };
  judge?: AggregateJudgeSummary;
  errors?: {
    runsWithAnyError?: number;
    collectErrorRuns?: number;
    judgeErrorRuns?: number;
  };
  evidenceBasisBreakdown?: AggregateEvidenceBasisSummary[];
  questionTypeBreakdown?: AggregateQuestionTypeSummary[];
}

export interface AggregateRun {
  runDirectory?: string;
  runId: string;
  question: {
    questionId?: string;
    id?: string;
    evidenceBasis?: EvidenceBasis;
    questionType?: string;
    platformScope?: string;
    questionShape?: string;
    title?: string;
    question?: string;
  };
  model?: {
    provider?: string;
    modelId?: string;
  };
  mode?: string;
  toolSet?: {
    name?: string;
  };
  answer?: {
    mode?: string;
    confidence?: number;
    finalAnswer?: string;
    evidenceSummary?: string;
    citationCount?: number;
    citationFilePaths?: string[];
  };
  grade?: {
    score?: number;
    correct?: boolean;
    grounded?: boolean;
    rubricStrength?: RubricStrength;
    agreement?: DeterministicAgreement;
    mustMentionPassed?: string[];
    mustMentionFailed?: string[];
    mustNotMentionViolated?: string[];
    failures?: string[];
    retrieval?: {
      bytesRead?: number;
      filesReadBeforeFirstRelevantDoc?: number;
      timeToFirstRelevantDocMs?: number;
      hitAt1?: boolean;
      hitAtK?: boolean;
      mrr?: number;
    };
  };
  judge?: {
    status?: string;
    verdict?: string;
    correctness?: number;
    completeness?: number;
    deprecatedPatternUse?: string;
    referenceVerified?: boolean;
    codeExample?: number;
    explanation?: number;
    retrievalQuality?: number;
    recommendsCorrectPattern?: boolean;
    recommendsDeprecatedPattern?: boolean;
    retrievalSupportsReferenceAnswer?: boolean;
    observations?: {
      hasCode?: boolean;
      hasExplanation?: boolean;
      mode?: string;
    };
    reasoning?: string;
    costUsd?: number;
  };
  cost?: {
    collectUsd?: number;
    judgeUsd?: number;
    totalUsd?: number;
  };
  errors?: {
    collectHadError?: boolean;
    judgeHadError?: boolean;
  };
  artifactPaths?: {
    aggregate?: string;
  };
}

export interface AggregateFile {
  benchmarkName?: string;
  rubricVersion?: string;
  generatedAt?: string;
  summaries?: AggregateSummary[];
  runs?: AggregateRun[];
}

export interface EnrichedRun extends AggregateRun {
  questionId: string;
  meta: QuestionMeta | null;
}

export interface LoadedExecution {
  id: string;
  sourceName: string;
  label: string;
  shortLabel: string;
  aggregate: AggregateFile;
  summary: AggregateSummary;
  runs: EnrichedRun[];
  runsByQuestionId: Record<string, EnrichedRun>;
}

export interface RecentRunsBundle {
  generatedAt: string;
  count: number;
  runs: Array<{
    sourceName: string;
    aggregate: AggregateFile;
  }>;
}

export interface BundledSnapshot {
  questionBank: QuestionBank;
  questionList: QuestionMeta[];
  recentRunsBundle: RecentRunsBundle;
  bundledExecutions: LoadedExecution[];
}
