import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { aggregateRuns, listAggregateReadyRunDirectories } from "../src/aggregate/run.js";
import { runCollect } from "../src/collect/run.js";
import { loadToolSetCatalog } from "../src/collect/tool-sets.js";
import { gradeRun } from "../src/grade/run.js";
import { judgeRun } from "../src/judge/run.js";
import type { AnswerCollectionMode, DatasetQuestion, ModelRef, ToolSetName } from "../src/shared/contracts.js";
import { loadBenchmarkConfigWithMeta, getCandidateModelRefs, getJudgeModelRef, getJudgeTransportConfig, getPromptTemplatePath, parseModelRefFromString, type BenchmarkBatchNumber, type BenchmarkConfig, type BenchmarkConfigPaths } from "../src/shared/config.js";
import { readJsonFile, writeJsonFile, writeTextFile } from "../src/shared/io.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..");

interface CliArgs {
  model?: string;
  judgeModel?: string;
  transport?: "openrouter" | "pi";
  openRouterReasoningEffort?: "minimal" | "low" | "medium" | "high";
  questionIds?: string[];
  modes?: string[];
  toolSet?: ToolSetName;
  runId?: string;
  batchSize?: number;
  batchNumber?: BenchmarkBatchNumber;
  resume?: boolean;
  stopOnError?: boolean;
  answerCollectionMode?: AnswerCollectionMode;
}

interface RunStageState {
  manifest: boolean;
  trace: boolean;
  normalizedAnswer: boolean;
  judge: boolean;
  grade: boolean;
}

function parseBoolean(raw: string, flagName: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${flagName} must be true or false`);
}

function parsePositiveInteger(raw: string, flagName: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return value;
}

function parseBatchNumber(raw: string): BenchmarkBatchNumber {
  return raw === "auto" ? "auto" : parsePositiveInteger(raw, "--batch-number");
}

function parseCsv(raw: string): string[] {
  return raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--model=")) result.model = arg.split("=")[1];
    else if (arg.startsWith("--judge-model=")) result.judgeModel = arg.split("=")[1];
    else if (arg.startsWith("--question=")) result.questionIds = parseCsv(arg.split("=")[1] ?? "");
    else if (arg.startsWith("--transport=")) {
      const transport = arg.split("=")[1];
      if (transport !== "openrouter" && transport !== "pi") throw new Error("--transport must be openrouter or pi");
      result.transport = transport;
    }
    else if (arg.startsWith("--mode=")) result.modes = parseCsv(arg.split("=")[1] ?? "");
    else if (arg.startsWith("--openrouter-reasoning-effort=")) {
      const effort = arg.split("=")[1];
      if (effort !== "minimal" && effort !== "low" && effort !== "medium" && effort !== "high") {
        throw new Error("--openrouter-reasoning-effort must be minimal, low, medium, or high");
      }
      result.openRouterReasoningEffort = effort;
    }
    else if (arg.startsWith("--tool-set=")) result.toolSet = arg.split("=")[1] as ToolSetName;
    else if (arg.startsWith("--run-id=")) result.runId = arg.split("=")[1];
    else if (arg.startsWith("--batch-size=")) result.batchSize = parsePositiveInteger(arg.split("=")[1] ?? "", "--batch-size");
    else if (arg.startsWith("--batch-number=")) result.batchNumber = parseBatchNumber(arg.split("=")[1] ?? "");
    else if (arg.startsWith("--resume=")) result.resume = parseBoolean(arg.split("=")[1] ?? "", "--resume");
    else if (arg.startsWith("--stop-on-error=")) result.stopOnError = parseBoolean(arg.split("=")[1] ?? "", "--stop-on-error");
    else if (arg.startsWith("--answer-collection-mode=")) {
      const answerCollectionMode = arg.split("=")[1];
      if (answerCollectionMode !== "structured_json" && answerCollectionMode !== "lazy_text") {
        throw new Error("--answer-collection-mode must be structured_json or lazy_text");
      }
      result.answerCollectionMode = answerCollectionMode;
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function selectQuestions(config: BenchmarkConfig, allQuestions: DatasetQuestion[], cliQuestionIds?: string[]): DatasetQuestion[] {
  const configuredQuestions = config.questions === "all"
    ? allQuestions
    : allQuestions.filter((question) => new Set(config.questions).has(question.id));

  if (!cliQuestionIds || cliQuestionIds.length === 0) return configuredQuestions;
  const wanted = new Set(cliQuestionIds);
  return configuredQuestions.filter((question) => wanted.has(question.id));
}

function applyBatch(questions: DatasetQuestion[], size: number | null, number: number): DatasetQuestion[] {
  if (size === null) return questions;
  const start = (number - 1) * size;
  if (start >= questions.length) {
    throw new Error(`Batch ${number} is out of range for ${questions.length} selected question(s) with batch size ${size}`);
  }
  return questions.slice(start, start + size);
}

function countBatches(questions: DatasetQuestion[], batchSize: number): number {
  return Math.ceil(questions.length / batchSize);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

function createAutoExecutionId(benchmarkName: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(benchmarkName)}`;
}

function getExecutionDirectory(benchmarkName: string, configuredRunId: string): string {
  const executionId = configuredRunId === "auto"
    ? createAutoExecutionId(benchmarkName)
    : `${slugify(benchmarkName)}--${slugify(configuredRunId)}`;
  return resolve(REPO_ROOT, "benchmark-results", executionId);
}

function getRunId(model: ModelRef, mode: string, questionId: string, toolSetName: string, defaultToolSetName: string): string {
  const base = `${slugify(model.provider)}--${slugify(model.modelId)}--${slugify(questionId)}--${slugify(mode)}`;
  return toolSetName === defaultToolSetName ? base : `${base}--${slugify(toolSetName)}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getRunStageState(runDirectory: string): Promise<RunStageState> {
  const [manifest, trace, normalizedAnswer, judge, grade] = await Promise.all([
    pathExists(join(runDirectory, "manifest.json")),
    pathExists(join(runDirectory, "trace.json")),
    pathExists(join(runDirectory, "normalized-answer.json")),
    pathExists(join(runDirectory, "judge.json")),
    pathExists(join(runDirectory, "grade.json")),
  ]);
  return { manifest, trace, normalizedAnswer, judge, grade };
}

function assertResumableCollectState(runDirectory: string, stageState: RunStageState): void {
  const collectFiles = [stageState.manifest, stageState.trace, stageState.normalizedAnswer];
  const hasAnyCollectFiles = collectFiles.some(Boolean);
  const hasAllCollectFiles = collectFiles.every(Boolean);
  if (hasAnyCollectFiles && !hasAllCollectFiles) {
    throw new Error(`Run directory has a partial collect stage and cannot be resumed safely: ${runDirectory}`);
  }
}

async function isRunComplete(runDirectory: string): Promise<boolean> {
  return pathExists(join(runDirectory, "grade.json"));
}

async function detectNextIncompleteBatchNumber(params: {
  questions: DatasetQuestion[];
  batchSize: number;
  executionDirectory: string;
  models: ModelRef[];
  modes: string[];
  resolveToolSetName: (mode: string) => string;
  getDefaultToolSetName: (mode: string) => string;
}): Promise<number> {
  const totalBatches = countBatches(params.questions, params.batchSize);
  for (let batchNumber = 1; batchNumber <= totalBatches; batchNumber += 1) {
    const batchQuestions = applyBatch(params.questions, params.batchSize, batchNumber);
    let batchComplete = true;

    for (const question of batchQuestions) {
      for (const model of params.models) {
        for (const mode of params.modes) {
          const toolSetName = params.resolveToolSetName(mode);
          const defaultToolSetName = params.getDefaultToolSetName(mode);
          const runDirectory = join(params.executionDirectory, getRunId(model, mode, question.id, toolSetName, defaultToolSetName));
          if (!(await isRunComplete(runDirectory))) {
            batchComplete = false;
            break;
          }
        }
        if (!batchComplete) break;
      }
      if (!batchComplete) break;
    }

    if (!batchComplete) return batchNumber;
  }

  return totalBatches;
}

function normalizeTransportForArtifact(transport: BenchmarkConfig["transport"]): Record<string, unknown> {
  if (transport.kind === "openrouter") {
    return {
      kind: transport.kind,
      ...(transport.openRouterRouting ? { openRouterRouting: transport.openRouterRouting } : {}),
      ...(transport.openRouterUseStructuredOutputs !== undefined ? { openRouterUseStructuredOutputs: transport.openRouterUseStructuredOutputs } : {}),
      ...(transport.openRouterRetryDelaysMs ? { openRouterRetryDelaysMs: transport.openRouterRetryDelaysMs } : {}),
      ...(transport.openRouterReasoningEffort ? { openRouterReasoningEffort: transport.openRouterReasoningEffort } : {}),
    };
  }

  return {
    kind: transport.kind,
    ...(transport.session ? { session: transport.session } : {}),
  };
}

async function writeExecutionArtifacts(params: {
  executionDirectory: string;
  config: BenchmarkConfig;
  cli: CliArgs;
  effectiveRunId: string;
  candidateModels: ModelRef[];
  judgeModelRef: ModelRef;
  transport: BenchmarkConfig["transport"];
  judgeTransport: BenchmarkConfig["transport"];
  modes: string[];
  selectedQuestions: DatasetQuestion[];
  toolSetOverride?: ToolSetName;
  batchSize: number | null;
  configuredBatchNumber: BenchmarkBatchNumber;
  resolvedBatchNumber: number;
  batchQuestions: DatasetQuestion[];
  executionResume: boolean;
  stopOnError: boolean;
  answerCollectionMode: AnswerCollectionMode;
  configPaths: BenchmarkConfigPaths;
}): Promise<void> {
  const executionYaml = stringifyYaml({
    benchmarkName: params.config.benchmarkName,
    runId: params.effectiveRunId,
    transport: normalizeTransportForArtifact(params.transport),
    models: {
      candidates: params.candidateModels.map((model) => `${model.provider}/${model.modelId}`),
    },
    judge: {
      model: `${params.judgeModelRef.provider}/${params.judgeModelRef.modelId}`,
      transport: normalizeTransportForArtifact(params.judgeTransport),
      ...(params.config.judge.retry ? { retry: params.config.judge.retry } : {}),
      profile: params.config.judge.profile,
    },
    paths: params.config.paths,
    corpus: params.config.corpus,
    ...(params.config.swiftDocs ? { swiftDocs: params.config.swiftDocs } : {}),
    execution: {
      ...params.config.execution,
      resume: params.executionResume,
      stopOnError: params.stopOnError,
      answerCollectionMode: params.answerCollectionMode,
    },
    batch: {
      size: params.batchSize,
      requestedNumber: params.configuredBatchNumber,
      resolvedNumber: params.resolvedBatchNumber,
      questionIds: params.batchQuestions.map((question) => question.id),
    },
    systemPrompts: params.config.systemPrompts,
    modes: Object.fromEntries(params.modes.map((mode) => [mode, params.toolSetOverride ?? params.config.modes[mode as keyof typeof params.config.modes]])),
    questions: params.selectedQuestions.map((question) => question.id),
  });

  await writeTextFile(join(params.executionDirectory, "execution-config.yaml"), executionYaml);
  await writeJsonFile(join(params.executionDirectory, "execution-metadata.json"), {
    generatedAt: new Date().toISOString(),
    configPaths: params.configPaths,
    executionDirectory: params.executionDirectory,
    benchmarkName: params.config.benchmarkName,
    effectiveRunId: params.effectiveRunId,
    cliOverrides: {
      ...(params.cli.model ? { model: params.cli.model } : {}),
      ...(params.cli.judgeModel ? { judgeModel: params.cli.judgeModel } : {}),
      ...(params.cli.transport ? { transport: params.cli.transport } : {}),
      ...(params.cli.questionIds ? { questionIds: params.cli.questionIds } : {}),
      ...(params.cli.modes ? { modes: params.cli.modes } : {}),
      ...(params.cli.runId ? { runId: params.cli.runId } : {}),
      ...(params.cli.toolSet ? { toolSet: params.cli.toolSet } : {}),
      ...(params.cli.openRouterReasoningEffort ? { openRouterReasoningEffort: params.cli.openRouterReasoningEffort } : {}),
      ...(params.cli.batchSize ? { batchSize: params.cli.batchSize } : {}),
      ...(params.cli.batchNumber ? { batchNumber: params.cli.batchNumber } : {}),
      ...(params.cli.resume !== undefined ? { resume: params.cli.resume } : {}),
      ...(params.cli.stopOnError !== undefined ? { stopOnError: params.cli.stopOnError } : {}),
      ...(params.cli.answerCollectionMode !== undefined ? { answerCollectionMode: params.cli.answerCollectionMode } : {}),
    },
    aggregateOutputs: {
      json: join(params.executionDirectory, "aggregate.json"),
      summaryCsv: join(params.executionDirectory, "aggregate-summary.csv"),
      evidenceBasisCsv: join(params.executionDirectory, "aggregate-evidence-basis.csv"),
      runsCsv: join(params.executionDirectory, "aggregate-runs.csv"),
      disagreementCsv: join(params.executionDirectory, "aggregate-disagreement.csv"),
      runsJsonl: join(params.executionDirectory, "aggregate-runs.jsonl"),
    },
  });
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const { config, configPaths } = await loadBenchmarkConfigWithMeta();

  const effectiveRunId = cli.runId ?? config.runId;
  const executionResume = cli.resume ?? config.execution.resume;
  const stopOnError = cli.stopOnError ?? config.execution.stopOnError;
  const answerCollectionMode = cli.answerCollectionMode ?? config.execution.answerCollectionMode;
  const configuredBatchNumber = cli.batchNumber ?? config.batch.number;
  const batchSize = cli.batchSize ?? config.batch.size;

  const candidateModels = cli.model
    ? [parseModelRefFromString(cli.model)]
    : getCandidateModelRefs(config);
  const judgeModelRef: ModelRef = cli.judgeModel
    ? parseModelRefFromString(cli.judgeModel)
    : getJudgeModelRef(config);
  const transport = {
    ...config.transport,
    ...(cli.transport ? { kind: cli.transport } : {}),
    ...(cli.openRouterReasoningEffort ? { openRouterReasoningEffort: cli.openRouterReasoningEffort } : {}),
  };
  const judgeTransport = cli.transport ? { ...getJudgeTransportConfig(config), kind: cli.transport } : getJudgeTransportConfig(config);

  if (executionResume && effectiveRunId === "auto") {
    console.warn("Warning: execution.resume=true with runId=auto only resumes within this invocation. Set an explicit runId for resumable/idempotent batches across invocations.");
  }

  const executionDirectory = getExecutionDirectory(config.benchmarkName, effectiveRunId);
  console.log(`Execution directory: ${executionDirectory}`);
  console.log(`Config: ${configPaths.basePath}${configPaths.overridePath ? ` + ${configPaths.overridePath}` : ""}`);

  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(config.paths.dataset);
  const selectedQuestions = selectQuestions(config, dataset.questions, cli.questionIds);
  const catalog = await loadToolSetCatalog(config.paths.toolSets);
  const resolveToolSetName = (mode: string) => cli.toolSet ?? config.modes[mode as keyof typeof config.modes];
  const getDefaultToolSetName = (mode: string) => config.modes[mode as keyof typeof config.modes];
  const modes = cli.modes && cli.modes.length > 0
    ? cli.modes as Array<keyof typeof config.modes>
    : (Object.keys(config.modes) as Array<keyof typeof config.modes>);

  const batchNumber = batchSize === null
    ? 1
    : configuredBatchNumber === "auto"
      ? await detectNextIncompleteBatchNumber({
          questions: selectedQuestions,
          batchSize,
          executionDirectory,
          models: candidateModels,
          modes,
          resolveToolSetName,
          getDefaultToolSetName,
        })
      : configuredBatchNumber;

  const questions = applyBatch(selectedQuestions, batchSize, batchNumber);

  await writeExecutionArtifacts({
    executionDirectory,
    config,
    cli,
    effectiveRunId,
    candidateModels,
    judgeModelRef,
    transport,
    judgeTransport,
    modes,
    selectedQuestions,
    toolSetOverride: cli.toolSet,
    batchSize,
    configuredBatchNumber,
    resolvedBatchNumber: batchNumber,
    batchQuestions: questions,
    executionResume,
    stopOnError,
    answerCollectionMode,
    configPaths,
  });

  console.log(`Selected ${questions.length} question(s), ${candidateModels.length} model(s), ${modes.length} mode(s).`);
  if (batchSize !== null) {
    const autoLabel = configuredBatchNumber === "auto" ? " (auto-detected)" : "";
    console.log(`Batch ${batchNumber} with size ${batchSize}.${autoLabel}`);
  }

  let observedErrors = false;

  for (const modelRef of candidateModels) {
    for (const question of questions) {
      for (const mode of modes) {
        const toolSetName = resolveToolSetName(mode);
        const defaultToolSetName = getDefaultToolSetName(mode);
        const toolSet = catalog.get(toolSetName);
        if (!toolSet) throw new Error(`Unknown tool set: ${toolSetName}`);

        const runId = getRunId(modelRef, mode, question.id, toolSetName, defaultToolSetName);
        const runDirectory = join(executionDirectory, runId);
        const stageState = await getRunStageState(runDirectory);
        assertResumableCollectState(runDirectory, stageState);

        if (!executionResume && (stageState.manifest || stageState.trace || stageState.normalizedAnswer || stageState.judge || stageState.grade)) {
          throw new Error(`Run directory already exists: ${runDirectory}. Set execution.resume=true or choose a different runId.`);
        }

        if (executionResume && stageState.grade) {
          console.log(`\n==> [${modelRef.provider}/${modelRef.modelId} | ${mode.toUpperCase()} | toolSet=${toolSetName} | ${question.id}] Skipping completed run.`);
          continue;
        }

        console.log(`\n==> [${modelRef.provider}/${modelRef.modelId} | ${mode.toUpperCase()} | toolSet=${toolSetName} | ${question.id}]`);

        let collectHadError = false;
        let collectParseRetriesUsed = 0;
        if (!stageState.manifest || !stageState.trace || !stageState.normalizedAnswer) {
          console.log("   collect: running");
          const collectOutput = await runCollect({
            contractVersion: "benchmark-contract.v1",
            runId,
            executionDirectory,
            benchmarkName: config.benchmarkName,
            model: modelRef,
            transport,
            mode,
            toolSet,
            promptTemplateId: "benchmark-answer-v1",
            promptTemplatePath: getPromptTemplatePath(config, "benchmark-answer-v1"),
            promptTemplateVersion: "v1",
            responseSchemaVersion: "answer-response.v1",
            rubricVersion: "rubric.v1",
            corpus: config.corpus,
            ...(config.swiftDocs ? { swiftDocs: config.swiftDocs } : {}),
            question,
            sampling: {},
            systemPrompt: config.systemPrompts.collect,
            answerCollectionMode,
            maxParseRetries: config.execution.maxParseRetries,
          });
          collectHadError = collectOutput.hasError;
          collectParseRetriesUsed = collectOutput.trace.collectRetry?.parseRetriesUsed ?? 0;
        } else {
          console.log("   collect: skipped (artifacts already exist)");
          const normalizedAnswer = await readJsonFile<{ parseError?: string }>(join(runDirectory, "normalized-answer.json"));
          const trace = await readJsonFile<{ error?: unknown; collectRetry?: { parseRetriesUsed?: number } }>(join(runDirectory, "trace.json"));
          collectHadError = typeof normalizedAnswer.parseError === "string" || trace.error !== undefined;
          collectParseRetriesUsed = trace.collectRetry?.parseRetriesUsed ?? 0;
        }

        if (collectParseRetriesUsed > 0) {
          console.log(`   collect: parse retries used = ${collectParseRetriesUsed}`);
        }

        let judgeHadError = false;
        if (!stageState.judge) {
          console.log("   judge: running");
          const judgeOutput = await judgeRun({
            runDirectory,
            datasetPath: config.paths.dataset,
            judgeProfile: config.judge.profile,
            promptTemplatePath: getPromptTemplatePath(config, "judge-answer-v1"),
            systemPrompt: config.systemPrompts.judge,
            toolSetCatalogPath: config.paths.toolSets,
            transport: judgeTransport,
            retryPolicy: config.judge.retry,
            judgeModelOverride: judgeModelRef,
          });
          judgeHadError = judgeOutput.artifact.status === "error";
        } else {
          console.log("   judge: skipped (artifact already exists)");
          const judgeArtifact = await readJsonFile<{ status?: string }>(join(runDirectory, "judge.json"));
          judgeHadError = judgeArtifact.status === "error";
        }

        if (!stageState.grade) {
          console.log("   grade: running");
          await gradeRun({
            runDirectory,
            rubricPath: config.paths.rubric,
            datasetPath: config.paths.dataset,
          });
        } else {
          console.log("   grade: skipped (artifact already exists)");
        }

        if (collectHadError || judgeHadError) {
          observedErrors = true;
          console.warn(`   warning: run completed with recorded errors (${collectHadError ? "collect" : ""}${collectHadError && judgeHadError ? ", " : ""}${judgeHadError ? "judge" : ""})`);
          if (stopOnError) {
            throw new Error(`Stopping early because stopOnError=true and run recorded errors: ${runDirectory}`);
          }
        }
      }
    }
  }

  const aggregateReadyRunDirs = await listAggregateReadyRunDirectories(executionDirectory);
  if (aggregateReadyRunDirs.length === 0) {
    console.log("No completed runs available for aggregation.");
    return;
  }

  console.log("\n==> Running aggregate stage...");
  const aggregateOutput = await aggregateRuns({
    runDirectories: aggregateReadyRunDirs,
    benchmarkName: config.benchmarkName,
    rubricVersion: "rubric.v1",
  });

  console.log("\n==> RESULTS COMPARISON:");
  for (const summary of aggregateOutput.summaries) {
    const gradeLine = `Grade: ${summary.meanAnswerScore.toFixed(2)}`;
    const groundedLine = summary.groundedRate !== undefined ? ` | Grounded: ${(summary.groundedRate * 100).toFixed(0)}%` : "";
    const mrrLine = summary.meanRetrievalMrr !== undefined ? ` | MRR: ${summary.meanRetrievalMrr.toFixed(2)}` : "";
    const costLine = summary.cost
      ? ` | Cost: $${summary.cost.totalCostUsd.toFixed(4)} total ($${summary.cost.meanTotalCostUsdPerRun.toFixed(4)}/run; collect $${summary.cost.totalCollectCostUsd.toFixed(4)}, judge $${summary.cost.totalJudgeCostUsd.toFixed(4)})`
      : " | Cost: unavailable";
    const judgeLine = summary.judge
      ? ` | Judge correctness: ${summary.judge.meanCorrectness.toFixed(2)} (-1:${summary.judge.correctnessNegativeCount} 0:${summary.judge.correctnessZeroCount} 1:${summary.judge.correctnessPositiveCount})`
        + ` | Completeness: ${summary.judge.meanCompleteness.toFixed(2)} (-1:${summary.judge.completenessNegativeCount} 0:${summary.judge.completenessZeroCount} 1:${summary.judge.completenessPositiveCount})`
        + (summary.judge.referenceVerifiedRate !== undefined ? ` | ReferenceVerified: ${(summary.judge.referenceVerifiedRate * 100).toFixed(0)}%` : "")
        + ` | DeprecatedRate: ${(summary.judge.recommendsDeprecatedPatternRate * 100).toFixed(0)}%`
        + ` | Legacy verdicts c/p/i: ${summary.judge.judgeCorrectCount}/${summary.judge.judgePartiallyCorrectCount}/${summary.judge.judgeIncorrectCount}`
      : " | Judge: (no scored runs)";
    const errorLine = summary.errors
      ? ` | Errors: any=${summary.errors.runsWithAnyError}/${summary.runs}, collect=${summary.errors.collectErrorRuns}, judge=${summary.errors.judgeErrorRuns}`
      : "";
    console.log(`- ${summary.model.provider}/${summary.model.modelId} | ${summary.mode} | toolSet=${summary.toolSet.name} | transport=${summary.transport.kind} | ${gradeLine}${groundedLine}${mrrLine}${costLine}${judgeLine}${errorLine}`);
  }

  console.log("\n==> Aggregate artifacts:");
  console.log(`- ${join(executionDirectory, "execution-config.yaml")}`);
  console.log(`- ${join(executionDirectory, "execution-metadata.json")}`);
  console.log(`- ${join(executionDirectory, "aggregate.json")}`);
  console.log(`- ${join(executionDirectory, "aggregate-summary.csv")}`);
  console.log(`- ${join(executionDirectory, "aggregate-evidence-basis.csv")}`);
  console.log(`- ${join(executionDirectory, "aggregate-runs.csv")}`);
  console.log(`- ${join(executionDirectory, "aggregate-disagreement.csv")}`);
  console.log(`- ${join(executionDirectory, "aggregate-runs.jsonl")}`);

  if (observedErrors) {
    console.warn("\nCompleted with recorded run errors. See trace.json and judge.json artifacts in the execution directory for details.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
