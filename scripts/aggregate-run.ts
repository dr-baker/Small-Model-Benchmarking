import { join, resolve } from "node:path";
import { aggregateRuns, listAggregateReadyRunDirectories } from "../src/aggregate/run.js";
import type { RunManifest } from "../src/shared/contracts.js";
import { readJsonFile } from "../src/shared/io.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..");

interface CliArgs {
  executionDir?: string;
  runId?: string;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--execution-dir=")) result.executionDir = arg.split("=")[1];
    else if (arg.startsWith("--run-id=")) result.runId = arg.split("=")[1];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function resolveExecutionDirectory(runId: string): string {
  return resolve(REPO_ROOT, "benchmark-results", `swiftui-docs-chatbot-benchmark--${slugify(runId)}`);
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const executionDirectory = cli.executionDir
    ? resolve(cli.executionDir)
    : cli.runId
      ? resolveExecutionDirectory(cli.runId)
      : undefined;

  if (!executionDirectory) {
    throw new Error("Provide --execution-dir=/abs/or/relative/path or --run-id=<explicit-run-id>");
  }

  const runDirectories = await listAggregateReadyRunDirectories(executionDirectory);
  if (runDirectories.length === 0) {
    throw new Error(`No completed run directories with grade.json found under ${executionDirectory}`);
  }

  const firstManifest = await readJsonFile<RunManifest>(join(runDirectories[0]!, "manifest.json"));
  const artifact = await aggregateRuns({
    runDirectories,
    benchmarkName: firstManifest.benchmarkName,
    rubricVersion: firstManifest.rubricVersion,
  });

  console.log(`Execution directory: ${executionDirectory}`);
  console.log(`Aggregated runs: ${runDirectories.length}`);
  console.log("Wrote:");
  console.log(`- ${resolve(executionDirectory, "aggregate.json")}`);
  console.log(`- ${resolve(executionDirectory, "aggregate-summary.csv")}`);
  console.log(`- ${resolve(executionDirectory, "aggregate-question-types.csv")}`);
  console.log(`- ${resolve(executionDirectory, "aggregate-runs.csv")}`);
  console.log(`- ${resolve(executionDirectory, "aggregate-runs.jsonl")}`);
  console.log("\nSummaries:");
  for (const summary of artifact.summaries) {
    const judgeLine = summary.judge
      ? `judge=${summary.judge.judgeCorrectCount}/${summary.judge.judgeRuns} correct, ${summary.judge.judgePartiallyCorrectCount} partial, ${summary.judge.judgeIncorrectCount} incorrect`
      : "judge=n/a";
    console.log(`- ${summary.model.provider}/${summary.model.modelId} | ${summary.mode} | toolSet=${summary.toolSet.name} | score=${summary.meanAnswerScore.toFixed(2)} | ${judgeLine}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
