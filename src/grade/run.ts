import { join } from "node:path";
import type {
  BenchmarkAnswerResponse,
  CollectTrace,
  DatasetQuestion,
  FailureTaxonomyId,
  GradeArtifact,
  RetrievalMetrics,
  RubricDefinition,
  RunManifest,
} from "../shared/contracts.js";
import { readJsonFile, writeJsonFile } from "../shared/io.js";
import { inferQuestionType, normalizeCorpusRelativePath } from "../shared/corpus-paths.js";

interface GradeRunOptions {
  runDirectory: string;
  rubricPath: string;
  datasetPath: string;
}

function deriveFailures(answer: BenchmarkAnswerResponse | { parseError: string }, trace: CollectTrace): FailureTaxonomyId[] {
  const failures: FailureTaxonomyId[] = [];

  if ("parseError" in answer) {
    failures.push("schema_parse_failure");
  }
  if (trace.error) {
    failures.push("run_error");
  }

  return failures;
}

function calculateRetrievalMetrics(trace: CollectTrace, question: DatasetQuestion, corpusRoot: string): RetrievalMetrics | undefined {
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
      const content = JSON.stringify(tool.result ?? "");
      bytesRead += content.length;

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
      const resultStr = typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result ?? "");
      bytesRead += resultStr.length;
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDeprecatedMentionContext(finalAnswer: string, phrase: string): boolean {
  const escapedPhrase = escapeRegex(phrase);
  const pattern = new RegExp(`.{0,80}${escapedPhrase}.{0,80}`, "gi");
  const contexts = finalAnswer.match(pattern) ?? [];
  if (contexts.length === 0) return false;

  const warningMarkers = [
    "deprecated",
    "legacy",
    "avoid",
    "do not use",
    "don't use",
    "should not use",
    "shouldn't use",
    "never use",
    "instead of",
    "rather than",
    "replace",
    "replaces",
    "replaced by",
    "warning",
    "wrong pattern",
    "old way",
    "older pattern",
    "not ",
  ];

  return contexts.every((context) => {
    const normalizedContext = context.toLowerCase();
    return warningMarkers.some((marker) => normalizedContext.includes(marker));
  });
}

export async function gradeRun(options: GradeRunOptions): Promise<GradeArtifact> {
  const trace = await readJsonFile<CollectTrace>(join(options.runDirectory, "trace.json"));
  const answer = await readJsonFile<BenchmarkAnswerResponse | { parseError: string }>(join(options.runDirectory, "normalized-answer.json"));
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
  const mustNotMentionViolated: string[] = [];
  let correct = false;
  let score = 0;
  let grounded: boolean | undefined;

  if (!("parseError" in answer) && questionRubric) {
    const finalAnswer = answer.finalAnswer.toLowerCase();

    for (const phrase of questionRubric.mustMention) {
      if (finalAnswer.includes(phrase.toLowerCase())) {
        mustMentionPassed.push(phrase);
      } else {
        mustMentionFailed.push(phrase);
      }
    }

    for (const phrase of questionRubric.mustNotMention) {
      if (finalAnswer.includes(phrase.toLowerCase()) && !isDeprecatedMentionContext(finalAnswer, phrase.toLowerCase())) {
        mustNotMentionViolated.push(phrase);
      }
    }

    correct = mustMentionFailed.length === 0 && mustNotMentionViolated.length === 0;
    score = correct ? 1.0 : 0.0;

    if (answer.mode === "open_book") {
      const readPaths = new Set(
        trace.toolInvocations
          .filter((tool) => tool.toolName === "read")
          .map((tool) => normalizeCorpusRelativePath((tool.args as { path?: string }).path, corpusRoot))
          .filter((path): path is string => typeof path === "string" && path.length > 0),
      );

      const citationsValid = answer.citations.length > 0 && answer.citations.every((citation) => readPaths.has(citation.filePath));
      grounded = citationsValid;
      if (!grounded) {
        failures.push("correct_without_support");
      }
    }
  }

  const retrieval = question ? calculateRetrievalMetrics(trace, question, corpusRoot) : undefined;

  const artifact: GradeArtifact = {
    runId: trace.runId,
    rubricVersion: rubric.version,
    questionId,
    questionType: question?.questionType ?? inferQuestionType({ goldEvidence: question?.goldEvidence ?? [] }),
    answer: {
      score,
      correct,
      ...(grounded !== undefined ? { grounded } : {}),
      gradingMethod: "deterministic",
      mustMentionPassed,
      mustMentionFailed,
      mustNotMentionViolated,
      notes: [
        "Answer graded via deterministic text matching over final text.",
        "Deprecated APIs mentioned only as warnings are ignored by must-not-match checks.",
        "This artifact intentionally does not consume judge.json; LLM judging is a separate stage for later comparison.",
      ],
    },
    ...(retrieval ? { retrieval } : {}),
    failures: [...new Set(failures)],
  };

  await writeJsonFile(join(options.runDirectory, "grade.json"), artifact);
  return artifact;
}
