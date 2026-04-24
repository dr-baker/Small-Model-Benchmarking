import { join } from "node:path";
import type {
  BenchmarkAnswerResponse,
  CollectTrace,
  DatasetQuestion,
  FailureTaxonomyId,
  GradeArtifact,
  RetrievalMetrics,
  RubricDefinition,
  RubricStrength,
  RunManifest,
  ToolInvocationTrace,
} from "../shared/contracts.js";
import { readJsonFile, writeJsonFile } from "../shared/io.js";
import { inferEvidenceBasis, normalizeCorpusRelativePath } from "../shared/corpus-paths.js";
import { collectSwiftDocsRetrievedPaths, isSwiftDocsSearchToolName, parseSwiftDocsHybridToolResult } from "../shared/swift-docs-search.js";

interface GradeRunOptions {
  runDirectory: string;
  rubricPath: string;
  datasetPath: string;
}

function deriveFailures(answer: BenchmarkAnswerResponse, trace: CollectTrace): FailureTaxonomyId[] {
  const failures: FailureTaxonomyId[] = [];

  if (!answer.finalAnswer?.trim()) {
    failures.push("schema_parse_failure");
  }
  if (trace.error) {
    failures.push("run_error");
  }

  return failures;
}

function getToolResultSize(tool: ToolInvocationTrace): number {
  return typeof tool.result === "string" ? tool.result.length : JSON.stringify(tool.result ?? "").length;
}

function calculateReadRetrievalMetrics(trace: CollectTrace, question: DatasetQuestion, corpusRoot: string): RetrievalMetrics | undefined {
  if (trace.toolInvocations.length === 0) return undefined;

  let bytesRead = 0;
  let filesReadBeforeFirstRelevantDoc = 0;
  let timeToFirstRelevantDocMs: number | undefined;
  let hitAt1 = false;
  let hitAtK = false;
  let mrr: number | undefined;

  const relevantPaths = new Set(question.goldEvidence.map((e) => e.filePath));
  let readCount = 0;

  for (const tool of trace.toolInvocations) {
    if (tool.toolName === "read") {
      readCount += 1;
      const args = tool.args as { path?: string };
      const normalizedPath = normalizeCorpusRelativePath(args.path, corpusRoot);
      bytesRead += getToolResultSize(tool);

      if (normalizedPath && relevantPaths.has(normalizedPath)) {
        hitAtK = true;
        if (readCount === 1) hitAt1 = true;
        if (mrr === undefined) mrr = 1.0 / readCount;
        if (timeToFirstRelevantDocMs === undefined && tool.finishedAt && trace.events[0]?.observedAt) {
          timeToFirstRelevantDocMs = new Date(tool.finishedAt).getTime() - new Date(trace.events[0].observedAt).getTime();
        }
      } else if (!hitAtK) {
        filesReadBeforeFirstRelevantDoc += 1;
      }
    } else if (tool.toolName === "grep") {
      bytesRead += getToolResultSize(tool);
    }
  }

  return {
    bytesRead,
    filesReadBeforeFirstRelevantDoc,
    ...(timeToFirstRelevantDocMs !== undefined ? { timeToFirstRelevantDocMs } : {}),
    hitAt1,
    hitAtK,
    ...(mrr !== undefined ? { mrr } : {}),
  };
}

function searchCallHasRelevantPath(tool: ToolInvocationTrace, relevantPaths: Set<string>, corpusRoot: string): boolean {
  const parsed = parseSwiftDocsHybridToolResult(tool.result);
  if (!parsed) return false;

  for (const path of collectSwiftDocsRetrievedPaths(parsed)) {
    const normalizedPath = normalizeCorpusRelativePath(path, corpusRoot);
    if (normalizedPath && relevantPaths.has(normalizedPath)) return true;
  }
  return false;
}

function calculateSwiftDocsHybridRetrievalMetrics(trace: CollectTrace, question: DatasetQuestion, corpusRoot: string): RetrievalMetrics | undefined {
  const successfulSearchCalls = trace.toolInvocations.filter((tool) => isSwiftDocsSearchToolName(tool.toolName) && !tool.isError);
  if (successfulSearchCalls.length === 0) return undefined;

  const relevantPaths = new Set(question.goldEvidence.map((e) => e.filePath));
  const traceStartedAt = trace.events[0]?.observedAt;
  let bytesRead = 0;
  let firstRelevantCallIndex: number | undefined;
  let timeToFirstRelevantDocMs: number | undefined;

  successfulSearchCalls.forEach((tool, index) => {
    bytesRead += getToolResultSize(tool);
    if (firstRelevantCallIndex !== undefined) return;
    if (!searchCallHasRelevantPath(tool, relevantPaths, corpusRoot)) return;

    firstRelevantCallIndex = index;
    if (tool.finishedAt && traceStartedAt) {
      timeToFirstRelevantDocMs = new Date(tool.finishedAt).getTime() - new Date(traceStartedAt).getTime();
    }
  });

  return {
    bytesRead,
    searchCalls: successfulSearchCalls.length,
    reformulations: Math.max(0, successfulSearchCalls.length - 1),
    ...(timeToFirstRelevantDocMs !== undefined ? { timeToFirstRelevantDocMs } : {}),
    hitAt1: firstRelevantCallIndex === 0,
    hitAtK: firstRelevantCallIndex !== undefined,
  };
}

function calculateRetrievalMetrics(trace: CollectTrace, question: DatasetQuestion, corpusRoot: string): RetrievalMetrics | undefined {
  return calculateSwiftDocsHybridRetrievalMetrics(trace, question, corpusRoot) ?? calculateReadRetrievalMetrics(trace, question, corpusRoot);
}

function collectRetrievedPaths(trace: CollectTrace, corpusRoot: string): Set<string> {
  const paths = new Set<string>();

  for (const tool of trace.toolInvocations) {
    if (tool.toolName === "read") {
      const path = normalizeCorpusRelativePath((tool.args as { path?: string }).path, corpusRoot);
      if (typeof path === "string" && path.length > 0) paths.add(path);
      continue;
    }

    if (isSwiftDocsSearchToolName(tool.toolName)) {
      const parsed = parseSwiftDocsHybridToolResult(tool.result);
      if (!parsed) continue;
      for (const path of collectSwiftDocsRetrievedPaths(parsed)) {
        const normalizedPath = normalizeCorpusRelativePath(path, corpusRoot);
        if (normalizedPath) paths.add(normalizedPath);
      }
    }
  }

  return paths;
}

type SentenceClassification = "warning_only" | "fallback" | "recommended" | "unclear";

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\r\n]+/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isDelimitedRegexMatcher(matcher: string): boolean {
  return matcher.length >= 2 && matcher.startsWith("/") && matcher.endsWith("/");
}

function buildRubricMatcherRegex(matcher: string): RegExp | undefined {
  if (!isDelimitedRegexMatcher(matcher)) return undefined;

  try {
    return new RegExp(matcher.slice(1, -1), "i");
  } catch {
    return undefined;
  }
}

export function matchesRubricMatcher(text: string, matcher: string): boolean {
  const regex = buildRubricMatcherRegex(matcher);
  if (regex) return regex.test(text);
  return text.toLowerCase().includes(matcher.toLowerCase());
}

function classifySentenceContainingPhrase(sentence: string): SentenceClassification {
  const normalizedSentence = sentence.toLowerCase().replace(/\s+/g, " ").trim();
  const warningOnlyMarkers = [
    /^(?:no[,.]?|don'?t\b|do not\b|avoid\b|never\b|prefer\b|deprecated\b)/,
    /\b(?:don't use|do not use|should not use|shouldn't use|never use|avoid using)\b/,
    /\b(?:will not|won't|does not|doesn't|is not|isn't|are not|aren't|cannot|can't|shouldn't|wouldn't|mustn't)\b/,
    /\b(?:deprecated|legacy|warning|wrong pattern|old way|older pattern)\b/,
  ];
  if (warningOnlyMarkers.some((marker) => marker.test(normalizedSentence))) return "warning_only";

  const fallbackMarkers = [
    /\b(?:instead of|rather than|replace(?:s|d by)?|replaced by|alternative|fallback)\b/,
  ];
  if (fallbackMarkers.some((marker) => marker.test(normalizedSentence))) return "fallback";

  const recommendedMarkers = [
    /\b(?:use|should|recommend(?:ed)?|choose|prefer)\b/,
  ];
  if (recommendedMarkers.some((marker) => marker.test(normalizedSentence))) return "recommended";

  return "unclear";
}

function collectSentenceClassificationsForMatcher(finalAnswer: string, matcher: string): SentenceClassification[] {
  return splitSentences(finalAnswer)
    .filter((sentence) => matchesRubricMatcher(sentence, matcher))
    .map((sentence) => classifySentenceContainingPhrase(sentence));
}

export function isWarningOnlyMention(finalAnswer: string, matcher: string): boolean {
  const classifications = collectSentenceClassificationsForMatcher(finalAnswer, matcher);
  return classifications.length > 0 && classifications.every((classification) => classification === "warning_only");
}

function isNonNegatedMention(finalAnswer: string, matcher: string): boolean {
  const negativeMarkers = [
    /^(?:no[,.]?|don'?t\b|do not\b|avoid\b|never\b|deprecated\b)/,
    /\b(?:don't use|do not use|should not use|shouldn't use|never use|avoid using|will not|won't|does not|doesn't|is not|isn't|are not|aren't|cannot|can't|wouldn't|mustn't|instead of|rather than|replace(?:s|d by)?|replaced by|legacy|warning|wrong pattern|old way|older pattern)\b/,
  ];

  return splitSentences(finalAnswer).some((sentence) => {
    const normalizedSentence = sentence.toLowerCase().replace(/\s+/g, " ").trim();
    return matchesRubricMatcher(normalizedSentence, matcher) && !negativeMarkers.some((marker) => marker.test(normalizedSentence));
  });
}

function inferRubricStrength(questionRubric: RubricDefinition["questions"][number] | undefined): RubricStrength | undefined {
  if (!questionRubric) return undefined;

  const mustMentionCount = questionRubric.mustMention.length;
  const mustNotMentionCount = questionRubric.mustNotMention.length;
  const mustMentionAnyOfCount = questionRubric.mustMentionAnyOf?.length ?? 0;
  const totalRules = mustMentionCount + mustNotMentionCount + mustMentionAnyOfCount;

  if (totalRules === 0) return "low";
  if (questionRubric.expectedStance !== undefined || mustMentionAnyOfCount > 0) return "high";
  if (totalRules <= 2) return "medium";
  return "high";
}

export async function gradeRun(options: GradeRunOptions): Promise<GradeArtifact> {
  const trace = await readJsonFile<CollectTrace>(join(options.runDirectory, "trace.json"));
  const answer = await readJsonFile<BenchmarkAnswerResponse>(join(options.runDirectory, "normalized-answer.json"));
  const manifest = await readJsonFile<RunManifest>(join(options.runDirectory, "manifest.json"));

  const rubric = await readJsonFile<RubricDefinition>(options.rubricPath);
  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(options.datasetPath);

  const questionId = manifest.questionId ?? "unknown";
  const question = dataset.questions.find((q) => q.id === questionId);
  const questionRubric = rubric.questions.find((q) => q.questionId === questionId);
  const failures = deriveFailures(answer, trace);
  const corpusRoot = manifest.corpus.rootDir;

  const mustMentionPassed: string[] = [];
  const mustMentionFailed: string[] = [];
  const mustMentionAnyOfPassed: string[][] = [];
  const mustMentionAnyOfFailed: string[][] = [];
  const mustNotMentionViolated: string[] = [];
  let correct = false;
  let score = 0;
  let grounded: boolean | undefined;
  const rubricStrength = inferRubricStrength(questionRubric);

  if (answer.finalAnswer?.trim() && questionRubric) {
    const finalAnswer = answer.finalAnswer;
    const expectedStance = questionRubric.expectedStance ?? "neutral";

    for (const matcher of questionRubric.mustMention) {
      if (matchesRubricMatcher(finalAnswer, matcher)) {
        mustMentionPassed.push(matcher);
      } else {
        mustMentionFailed.push(matcher);
      }
    }

    for (const group of questionRubric.mustMentionAnyOf ?? []) {
      const matchedMatcher = group.find((matcher) => matchesRubricMatcher(finalAnswer, matcher));
      if (matchedMatcher) {
        mustMentionAnyOfPassed.push(group);
      } else {
        mustMentionAnyOfFailed.push(group);
      }
    }

    for (const matcher of questionRubric.mustNotMention) {
      if (matchesRubricMatcher(finalAnswer, matcher) && !isWarningOnlyMention(finalAnswer, matcher)) {
        mustNotMentionViolated.push(matcher);
      }
    }

    const coverageScores: number[] = [];
    if (questionRubric.mustMention.length > 0) {
      coverageScores.push(mustMentionPassed.length / questionRubric.mustMention.length);
    }
    const anyOfGroups = questionRubric.mustMentionAnyOf ?? [];
    if (anyOfGroups.length > 0) {
      coverageScores.push(mustMentionAnyOfPassed.length / anyOfGroups.length);
    }

    const stanceSatisfied = expectedStance === "affirmative"
      ? (questionRubric.mustMention.some((phrase) => isNonNegatedMention(finalAnswer, phrase))
        || anyOfGroups.some((group) => group.some((phrase) => isNonNegatedMention(finalAnswer, phrase))))
      : expectedStance === "negative"
        ? questionRubric.mustNotMention.some((phrase) => isWarningOnlyMention(finalAnswer, phrase))
        : true;

    score = mustNotMentionViolated.length > 0 || !stanceSatisfied
      ? 0
      : coverageScores.length === 0
        ? 1.0
        : coverageScores.reduce((sum, value) => sum + value, 0) / coverageScores.length;

    const passThreshold = questionRubric.passThreshold ?? 1.0;
    correct = score >= passThreshold && mustNotMentionViolated.length === 0 && stanceSatisfied;

    if (answer.mode === "open_book") {
      const retrievedPaths = collectRetrievedPaths(trace, corpusRoot);
      const citations = answer.citations ?? [];
      const citationsValid = citations.length > 0 && citations.every((citation) => retrievedPaths.has(citation.filePath));
      grounded = citationsValid;
      if (!grounded) {
        failures.push("correct_without_support");
      }
    }
  }

  const retrieval = question ? calculateRetrievalMetrics(trace, question, corpusRoot) : undefined;
  if (retrieval?.hitAtK === false) failures.push("no_relevant_doc_found");
  if (retrieval?.hitAtK && !correct) failures.push("relevant_doc_found_wrong_synthesis");

  const artifact: GradeArtifact = {
    runId: trace.runId,
    rubricVersion: rubric.version,
    questionId,
    evidenceBasis: question?.evidenceBasis ?? inferEvidenceBasis({ goldEvidence: question?.goldEvidence ?? [] }),
    platformScope: question?.platformScope ?? "all",
    questionShape: question?.questionShape ?? "targeted",
    ...(rubricStrength !== undefined ? { rubricStrength } : {}),
    answer: {
      score,
      correct,
      ...(grounded !== undefined ? { grounded } : {}),
      gradingMethod: "deterministic",
      mustMentionPassed,
      mustMentionFailed,
      ...(questionRubric?.mustMentionAnyOf?.length ? { mustMentionAnyOfPassed, mustMentionAnyOfFailed } : {}),
      mustNotMentionViolated,
      notes: [
        "Answer graded via deterministic text matching over final text.",
        "Rubric matchers may be exact phrases or slash-delimited regexes for narrow call-shape checks.",
        "mustNotMention only forgives sentence-level warning-only mentions that explicitly frame the forbidden phrase as the wrong pattern.",
        "expectedStance is applied only when the rubric provides it for a yes/no question.",
        "When mustMentionAnyOf groups are present, score reflects concept-group coverage instead of binary exact-match only grading.",
        "This artifact intentionally does not consume judge.json; LLM judging is a separate stage for later comparison.",
      ],
    },
    ...(retrieval ? { retrieval } : {}),
    failures: [...new Set(failures)],
  };

  await writeJsonFile(join(options.runDirectory, "grade.json"), artifact);
  return artifact;
}
