import { resolve } from "node:path";
import { runCollect } from "../src/collect/run.js";
import { judgeRun } from "../src/judge/run.js";
import { gradeRun } from "../src/grade/run.js";
import { aggregateRuns } from "../src/aggregate/run.js";
import { readJsonFile } from "../src/shared/io.js";
import { loadBenchmarkConfig, parseModelRefFromString, getPromptTemplatePath, getDefaultModelRef, getJudgeModelRef, type BenchmarkConfig } from "../src/shared/config.js";
import { loadToolSetCatalog } from "../src/collect/tool-sets.js";
import type { DatasetQuestion, ModelRef } from "../src/shared/contracts.js";

function parseCliArgs(argv: string[]): { model?: string; judgeModel?: string; question?: string; mode?: string } {
  const result: { model?: string; judgeModel?: string; question?: string; mode?: string } = {};
  for (const arg of argv) {
    if (arg.startsWith("--model=")) result.model = arg.split("=")[1];
    else if (arg.startsWith("--judge-model=")) result.judgeModel = arg.split("=")[1];
    else if (arg.startsWith("--question=")) result.question = arg.split("=")[1];
    else if (arg.startsWith("--mode=")) result.mode = arg.split("=")[1];
  }
  return result;
}

function selectQuestions(config: BenchmarkConfig, allQuestions: DatasetQuestion[]): DatasetQuestion[] {
  if (config.questions === "all") return allQuestions;
  const wanted = new Set(config.questions);
  return allQuestions.filter((q) => wanted.has(q.id));
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const config = await loadBenchmarkConfig();

  // CLI overrides
  const modelRef: ModelRef = cli.model ? parseModelRefFromString(cli.model) : getDefaultModelRef(config);
  const judgeModelRef: ModelRef | undefined = cli.judgeModel
    ? parseModelRefFromString(cli.judgeModel)
    : getJudgeModelRef(config) ?? undefined;

  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(config.paths.dataset);
  const questions = selectQuestions(config, dataset.questions);
  const catalog = await loadToolSetCatalog(config.paths.toolSets);

  const modes = cli.mode ? [cli.mode as keyof typeof config.modes] : (Object.keys(config.modes) as Array<keyof typeof config.modes>);

  const runQuestion = async (question: DatasetQuestion) => {
    const runDirs: string[] = [];

    for (const mode of modes) {
      const toolSetName = config.modes[mode];
      const toolSet = catalog.get(toolSetName);
      if (!toolSet) throw new Error(`Unknown tool set: ${toolSetName}`);

      const runId = config.runId === "auto" ? `${slugify(question.id)}-${mode}-${Date.now()}` : `${config.runId}-${mode}`;

      console.log(`\n==> [${mode.toUpperCase()} | ${question.id}] Running collect stage...`);
      const collectOutput = await runCollect({
        contractVersion: "benchmark-contract.v1",
        runId,
        benchmarkName: config.benchmarkName,
        model: modelRef,
        mode,
        toolSet,
        promptTemplateId: "benchmark-answer-v1",
        promptTemplatePath: getPromptTemplatePath(config, "benchmark-answer-v1"),
        promptTemplateVersion: "v1",
        responseSchemaVersion: "answer-response.v1",
        rubricVersion: "rubric.v1",
        corpus: config.corpus,
        question,
        sampling: {},
        systemPrompt: config.systemPrompts.collect,
      });

      console.log(`==> [${mode.toUpperCase()} | ${question.id}] Running judge stage...`);
      await judgeRun({
        runDirectory: collectOutput.runDirectory,
        datasetPath: config.paths.dataset,
        judgeProfilePath: config.paths.judgeProfiles,
        judgeProfileId: config.judgeProfileId,
        promptTemplatePath: getPromptTemplatePath(config, "judge-answer-v1"),
        systemPrompt: config.systemPrompts.judge,
        toolSetCatalogPath: config.paths.toolSets,
        ...(judgeModelRef ? { judgeModelOverride: judgeModelRef } : {}),
      });

      console.log(`==> [${mode.toUpperCase()} | ${question.id}] Running grade stage...`);
      await gradeRun({
        runDirectory: collectOutput.runDirectory,
        rubricPath: config.paths.rubric,
        datasetPath: config.paths.dataset,
      });

      runDirs.push(collectOutput.runDirectory);
    }

    return runDirs;
  };

  const allRunDirs: string[] = [];
  for (const question of questions) {
    const dirs = await runQuestion(question);
    allRunDirs.push(...dirs);
  }

  if (allRunDirs.length === 0) {
    console.log("No runs executed.");
    return;
  }

  console.log("\n==> Running aggregate stage...");
  const aggregateOutput = await aggregateRuns({
    runDirectories: allRunDirs,
    benchmarkName: config.benchmarkName,
    rubricVersion: "rubric.v1",
  });

  console.log("\n==> RESULTS COMPARISON:");
  for (const summary of aggregateOutput.summaries) {
    const gradeLine = `Grade: ${summary.meanAnswerScore.toFixed(2)}`;
    const groundedLine = summary.groundedRate !== undefined ? ` | Grounded: ${(summary.groundedRate * 100).toFixed(0)}%` : "";
    const mrrLine = summary.meanRetrievalMrr !== undefined ? ` | MRR: ${summary.meanRetrievalMrr.toFixed(2)}` : "";
    const judgeLine = summary.judge
      ? ` | Judge: ${summary.judge.judgeCorrectCount}/${summary.judge.judgeRuns} correct, ${summary.judge.judgePartiallyCorrectCount} partial, ${summary.judge.judgeIncorrectCount} incorrect` +
        ` | Completeness: ${summary.judge.meanCompleteness.toFixed(1)}` +
        ` | Code: ${summary.judge.meanCodeExample.toFixed(1)}` +
        ` | Explanation: ${summary.judge.meanExplanation.toFixed(1)}` +
        ` | DeprecatedRate: ${(summary.judge.recommendsDeprecatedPatternRate * 100).toFixed(0)}%`
      : " | Judge: (no scored runs)";
    console.log(`- ${summary.mode} | ${gradeLine}${groundedLine}${mrrLine}${judgeLine}`);
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

main().catch(console.error);
