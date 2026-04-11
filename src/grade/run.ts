import { join } from "node:path";
import type { BenchmarkAnswerResponse, CollectTrace, FailureTaxonomyId, GradeArtifact, RetrievalMetrics, RubricDefinition, DatasetQuestion } from "../shared/contracts.js";
import { readJsonFile, writeJsonFile } from "../shared/io.js";

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

function calculateRetrievalMetrics(trace: CollectTrace, question: DatasetQuestion): RetrievalMetrics | undefined {
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
      readCount++;
      const args = tool.args as { path?: string };
      const content = JSON.stringify(tool.result ?? "");
      bytesRead += content.length;

      if (args.path && relevantPaths.has(args.path)) {
        hitAtK = true;
        if (readCount === 1) hitAt1 = true;
        if (mrr === undefined) mrr = 1.0 / readCount;
        if (timeToFirstRelevantDocMs === undefined && tool.finishedAt && trace.events[0]?.observedAt) {
          timeToFirstRelevantDocMs = new Date(tool.finishedAt).getTime() - new Date(trace.events[0].observedAt).getTime();
        }
      } else {
        if (!hitAtK) {
          filesReadBeforeFirstRelevantDoc++;
        }
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

export async function gradeRun(options: GradeRunOptions): Promise<GradeArtifact> {
  const trace = await readJsonFile<CollectTrace>(join(options.runDirectory, "trace.json"));
  const answer = await readJsonFile<BenchmarkAnswerResponse | { parseError: string }>(join(options.runDirectory, "normalized-answer.json"));
  const manifest = await readJsonFile<{ questionId?: string }>(join(options.runDirectory, "manifest.json"));

  const rubric = await readJsonFile<RubricDefinition>(options.rubricPath);
  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(options.datasetPath);
  
  const questionId = manifest.questionId ?? "unknown";
  const question = dataset.questions.find((q) => q.id === questionId);
  const questionRubric = rubric.questions.find((q) => q.questionId === questionId);

  const failures = deriveFailures(answer, trace);
  
  const mustMentionPassed: string[] = [];
  const mustMentionFailed: string[] = [];
  const mustNotMentionViolated: string[] = [];
  let correct = false;
  let score = 0;
  let grounded: boolean | undefined = undefined;

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
      if (finalAnswer.includes(phrase.toLowerCase())) {
        mustNotMentionViolated.push(phrase);
      }
    }

    correct = mustMentionFailed.length === 0 && mustNotMentionViolated.length === 0;
    score = correct ? 1.0 : 0.0;

    if (answer.mode === "open_book") {
      const readPaths = new Set(
        trace.toolInvocations
          .filter(t => t.toolName === "read")
          .map(t => (t.args as { path?: string }).path)
          .filter(Boolean)
      );
      
      const citationsValid = answer.citations.length > 0 && answer.citations.every(c => readPaths.has(c.filePath));
      grounded = citationsValid;
      if (!grounded) {
        failures.push("correct_without_support");
      }
    }
  }

  const retrieval = question ? calculateRetrievalMetrics(trace, question) : undefined;

  const artifact: GradeArtifact = {
    runId: trace.runId,
    rubricVersion: rubric.version,
    questionId,
    answer: {
      score,
      correct,
      ...(grounded !== undefined ? { grounded } : {}),
      mustMentionPassed,
      mustMentionFailed,
      mustNotMentionViolated,
      notes: [
        "Answer graded via automated text matching over final text.",
      ],
    },
    ...(retrieval ? { retrieval } : {}),
    failures,
  };

  await writeJsonFile(join(options.runDirectory, "grade.json"), artifact);
  return artifact;
}
