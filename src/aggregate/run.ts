import { dirname, join } from "node:path";
import type { AggregateArtifact, AggregateModelSummary, BenchmarkMode, GradeArtifact, RunManifest, ToolSetDefinition } from "../shared/contracts.js";
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
  runs: number;
  answerScoreTotal: number;
  groundedRuns: number;
  groundedTrue: number;
  retrievalCount: number;
  retrievalMrrTotal: number;
}

function summaryKey(manifest: RunManifest): string {
  return [manifest.model.provider, manifest.model.modelId, manifest.mode, manifest.toolSet.name, manifest.toolSet.version].join("::");
}

function getSharedBenchmarkDirectory(runDirectories: string[]): string {
  const parents = [...new Set(runDirectories.map((runDirectory) => dirname(runDirectory)))];
  if (parents.length !== 1 || parents[0] === undefined) {
    throw new Error("Aggregate runs must belong to the same benchmark execution directory.");
  }
  return parents[0];
}

export async function aggregateRuns(options: AggregateRunOptions): Promise<AggregateArtifact> {
  const accumulators = new Map<string, SummaryAccumulator>();

  for (const runDirectory of options.runDirectories) {
    const manifest = await readJsonFile<RunManifest>(join(runDirectory, "manifest.json"));
    const grade = await readJsonFile<GradeArtifact>(join(runDirectory, "grade.json"));
    const key = summaryKey(manifest);
    const existing = accumulators.get(key) ?? {
      model: manifest.model,
      mode: manifest.mode,
      toolSet: manifest.toolSet,
      runs: 0,
      answerScoreTotal: 0,
      groundedRuns: 0,
      groundedTrue: 0,
      retrievalCount: 0,
      retrievalMrrTotal: 0,
    };

    existing.runs += 1;
    existing.answerScoreTotal += grade.answer.score;

    if (grade.answer.grounded !== undefined) {
      existing.groundedRuns += 1;
      if (grade.answer.grounded) {
        existing.groundedTrue += 1;
      }
    }

    if (grade.retrieval?.mrr !== undefined) {
      existing.retrievalCount += 1;
      existing.retrievalMrrTotal += grade.retrieval.mrr;
    }

    accumulators.set(key, existing);
  }

  const summaries: AggregateModelSummary[] = [...accumulators.values()].map((accumulator) => ({
    model: accumulator.model,
    mode: accumulator.mode,
    toolSet: accumulator.toolSet,
    runs: accumulator.runs,
    meanAnswerScore: accumulator.runs === 0 ? 0 : accumulator.answerScoreTotal / accumulator.runs,
    ...(accumulator.groundedRuns === 0
      ? {}
      : { groundedRate: accumulator.groundedTrue / accumulator.groundedRuns }),
    ...(accumulator.retrievalCount === 0
      ? {}
      : { meanRetrievalMrr: accumulator.retrievalMrrTotal / accumulator.retrievalCount }),
  }));

  const artifact: AggregateArtifact = {
    benchmarkName: options.benchmarkName,
    rubricVersion: options.rubricVersion,
    generatedAt: new Date().toISOString(),
    summaries,
  };

  await writeJsonFile(join(getSharedBenchmarkDirectory(options.runDirectories), "aggregate.json"), artifact);
  return artifact;
}
