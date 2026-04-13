import type { JsonValue } from "./json.js";

export const PIPELINE_CONTRACT_VERSION = "benchmark-contract.v1" as const;
export const ANSWER_RESPONSE_SCHEMA_VERSION = "answer-response.v1" as const;
export const JUDGE_VERDICT_SCHEMA_VERSION = "judge-verdict.v1" as const;

export type BenchmarkMode = "closed_book" | "open_book";
export type ToolSetName = "none" | "read_only" | "read_grep" | "read_grep_glob";
export type PromptTemplateId = "benchmark-answer-v1";
export type JudgePromptTemplateId = "judge-answer-v1";
export type JudgeVerdictLabel = "correct" | "partially_correct" | "incorrect";
export type JudgeQualitativeScore = 0 | 1 | 2;
export type GradingMethod = "deterministic";
export type JudgeArtifactStatus = "scored" | "skipped" | "error";

export interface ModelRef {
  provider: string;
  modelId: string;
  snapshot?: string;
}

export interface CorpusSnapshotRef {
  snapshotId: string;
  rootDir: string;
  manifestPath: string;
  manifestSha256: string;
}

export interface GoldEvidenceReference {
  filePath: string;
  anchor?: string;
  quote?: string;
  notes?: string;
}

export interface DatasetQuestion {
  id: string;
  title: string;
  question: string;
  referenceAnswer: string;
  pitfall: string;
  taxonomyTags: string[];
  goldEvidence: GoldEvidenceReference[];
  source: {
    file: string;
    questionNumber: number;
  };
}

export interface SamplingConfig {
  temperature?: number;
  topP?: number;
  seed?: number;
  replicateIndex?: number;
}

export interface ToolSetDefinition {
  name: ToolSetName;
  version: string;
  description: string;
  toolNames: readonly string[];
}

export interface CollectRunInput {
  contractVersion: typeof PIPELINE_CONTRACT_VERSION;
  runId: string;
  benchmarkName: string;
  model: ModelRef;
  mode: BenchmarkMode;
  toolSet: ToolSetDefinition;
  promptTemplateId: PromptTemplateId;
  promptTemplateVersion: string;
  responseSchemaVersion: typeof ANSWER_RESPONSE_SCHEMA_VERSION;
  rubricVersion: string;
  corpus: CorpusSnapshotRef;
  question: DatasetQuestion;
  sampling: SamplingConfig;
}

export interface PromptSnapshot {
  systemPrompt: string;
  userPrompt: string;
  availableTools: Array<{
    name: string;
    description: string;
  }>;
}

export interface CitationReference {
  filePath: string;
  anchor?: string;
  quote?: string;
  justification?: string;
}

export interface ClosedBookAnswerResponse {
  schemaVersion: typeof ANSWER_RESPONSE_SCHEMA_VERSION;
  mode: "closed_book";
  finalAnswer: string;
  confidence: number;
  citations: [];
}

export interface OpenBookAnswerResponse {
  schemaVersion: typeof ANSWER_RESPONSE_SCHEMA_VERSION;
  mode: "open_book";
  finalAnswer: string;
  confidence: number;
  citations: CitationReference[];
  evidenceSummary: string;
}

export type BenchmarkAnswerResponse = ClosedBookAnswerResponse | OpenBookAnswerResponse;

export interface JudgeProfile {
  id: string;
  version: string;
  description: string;
  model: ModelRef;
  toolSetName: ToolSetName;
  promptTemplateId: JudgePromptTemplateId;
  promptTemplateVersion: string;
  responseSchemaVersion: typeof JUDGE_VERDICT_SCHEMA_VERSION;
}

export interface JudgeProfileCatalog {
  version: string;
  profiles: JudgeProfile[];
}

export interface TraceEventRecord {
  observedAt: string;
  eventType: string;
  payload: JsonValue;
}

export interface ToolInvocationTrace {
  toolCallId: string;
  toolName: string;
  args: JsonValue;
  startedAt?: string;
  finishedAt?: string;
  isError?: boolean;
  result?: JsonValue;
  updates: JsonValue[];
}

export interface CollectTrace {
  runId: string;
  prompt: PromptSnapshot;
  events: TraceEventRecord[];
  toolInvocations: ToolInvocationTrace[];
  finalAssistantText?: string;
  finalAssistantMessage?: JsonValue;
  usage?: JsonValue;
  costUsd?: number;
  error?: JsonValue;
  elapsedMs: number;
}

export interface RunManifest {
  contractVersion: typeof PIPELINE_CONTRACT_VERSION;
  runId: string;
  benchmarkName: string;
  createdAt: string;
  piSdkVersion: string;
  model: ModelRef;
  mode: BenchmarkMode;
  toolSet: ToolSetDefinition;
  promptTemplateId: PromptTemplateId;
  promptTemplateVersion: string;
  responseSchemaVersion: typeof ANSWER_RESPONSE_SCHEMA_VERSION;
  rubricVersion: string;
  corpus: CorpusSnapshotRef;
  questionId: string;
  sampling: SamplingConfig;
  artifactPaths: {
    trace: string;
    normalizedAnswer: string;
    judge?: string;
    grade?: string;
    aggregate?: string;
  };
}

export type FailureTaxonomyId =
  | "no_relevant_doc_found"
  | "relevant_doc_found_wrong_synthesis"
  | "correct_without_support"
  | "outdated_doc_preferred"
  | "excessive_search_cost"
  | "schema_parse_failure"
  | "run_error";

export interface QuestionRubric {
  questionId: string;
  mustMention: string[];
  mustNotMention: string[];
}

export interface RubricDefinition {
  version: string;
  description: string;
  failureTaxonomy: FailureTaxonomyId[];
  questions: QuestionRubric[];
  notes: string[];
}

export interface RetrievalMetrics {
  hitAt1?: boolean;
  hitAtK?: boolean;
  mrr?: number;
  timeToFirstRelevantDocMs?: number;
  filesReadBeforeFirstRelevantDoc?: number;
  bytesRead?: number;
}

export interface JudgeArtifact {
  schemaVersion: typeof JUDGE_VERDICT_SCHEMA_VERSION;
  runId: string;
  questionId: string;
  recommendsCorrectPattern?: boolean;
  recommendsDeprecatedPattern?: boolean;
  completeness?: JudgeQualitativeScore;
  codeExample?: JudgeQualitativeScore;
  explanation?: JudgeQualitativeScore;
  verdict?: JudgeVerdictLabel;
  reasoning?: string;
  status: JudgeArtifactStatus;
  judgedAt: string;
  judgeProfileId: string;
  judgeProfileVersion: string;
  judgeModel: ModelRef;
  toolSet: ToolSetDefinition;
  promptTemplateId: JudgePromptTemplateId;
  promptTemplateVersion: string;
  answerSha256: string;
  prompt: PromptSnapshot;
  toolInvocations: ToolInvocationTrace[];
  skipReason?: string;
  rawResponseText?: string;
  usage?: JsonValue;
  costUsd?: number;
  error?: JsonValue;
  elapsedMs: number;
  notes: string[];
}

export interface AnswerGrade {
  score: number;
  correct: boolean;
  grounded?: boolean;
  gradingMethod: GradingMethod;
  mustMentionPassed: string[];
  mustMentionFailed: string[];
  mustNotMentionViolated: string[];
  notes: string[];
}

export interface GradeArtifact {
  runId: string;
  rubricVersion: string;
  questionId: string;
  answer: AnswerGrade;
  retrieval?: RetrievalMetrics;
  failures: FailureTaxonomyId[];
}

export interface AggregateJudgeMetrics {
  judgeRuns: number;
  judgeCorrectCount: number;
  judgePartiallyCorrectCount: number;
  judgeIncorrectCount: number;
  meanCompleteness: number;
  meanCodeExample: number;
  meanExplanation: number;
  recommendsCorrectPatternRate: number;
  recommendsDeprecatedPatternRate: number;
}

export interface AggregateModelSummary {
  model: ModelRef;
  mode: BenchmarkMode;
  toolSet: ToolSetDefinition;
  runs: number;
  meanAnswerScore: number;
  groundedRate?: number;
  meanRetrievalMrr?: number;
  judge?: AggregateJudgeMetrics;
}

export interface AggregateArtifact {
  benchmarkName: string;
  rubricVersion: string;
  generatedAt: string;
  summaries: AggregateModelSummary[];
}
