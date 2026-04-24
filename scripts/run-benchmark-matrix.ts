import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AnswerCollectionMode, ModelTransportConfig, ToolSetName } from "../src/shared/contracts.js";
import { loadBenchmarkConfigWithMeta, parseModelRefFromString, type BenchmarkBatchNumber, type BenchmarkConfig } from "../src/shared/config.js";
import { readJsonFile } from "../src/shared/io.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..");
const LOG_ROOT = resolve(REPO_ROOT, ".tmp", "benchmark-matrix-logs");

type MatrixValidationRate = number;

interface MatrixDefaults {
  questionIds?: string[];
  modes?: string[];
  toolSet?: ToolSetName;
  batchSize?: number;
  batchNumber?: BenchmarkBatchNumber;
  resume?: boolean;
  stopOnError?: boolean;
  answerCollectionMode?: AnswerCollectionMode;
  transport?: Partial<ModelTransportConfig>;
}

interface MatrixEntry {
  id?: string;
  runId: string;
  model: string;
  transport?: Partial<ModelTransportConfig>;
  questionIds?: string[];
  modes?: string[];
  toolSet?: ToolSetName;
  batchSize?: number;
  batchNumber?: BenchmarkBatchNumber;
  resume?: boolean;
  stopOnError?: boolean;
  answerCollectionMode?: AnswerCollectionMode;
}

interface StructuredFallbackConfig {
  enabled: boolean;
  minRuns?: number;
  minAnswerParseErrorRate?: MatrixValidationRate;
  maxOtherCollectErrorRate?: MatrixValidationRate;
  maxJudgeErrorRate?: MatrixValidationRate;
  targetAnswerCollectionMode?: AnswerCollectionMode;
  runIdSuffix?: string;
}

interface PhaseValidationConfig {
  maxAnyErrorRate?: MatrixValidationRate;
  maxCollectErrorRate?: MatrixValidationRate;
  maxJudgeErrorRate?: MatrixValidationRate;
  requireAggregate?: boolean;
  structuredFallback?: StructuredFallbackConfig;
}

interface MatrixPhase extends MatrixDefaults {
  name: string;
  parallelism?: number;
  entries?: MatrixEntry[];
  validation?: PhaseValidationConfig;
}

interface BenchmarkMatrixFile {
  defaults?: MatrixDefaults;
  entries: MatrixEntry[];
  parallelism?: number;
  phases?: MatrixPhase[];
}

interface CliArgs {
  matrixPath: string;
  parallelism?: number;
}

interface EntryExecutionSnapshot {
  questionIds: string[];
  answerCollectionMode?: AnswerCollectionMode;
}

interface RunEntrySuccess {
  key: string;
  runId: string;
  executionDirectory: string;
  logPath: string;
  snapshot: EntryExecutionSnapshot;
}

interface RunEntryFailure {
  key: string;
  runId: string;
  executionDirectory: string;
  logPath: string;
  error: string;
}

interface AggregateRunRecord {
  question?: {
    questionId?: string;
  };
  answer?: {
    parseError?: string;
  };
  errors?: {
    collectHadError?: boolean;
    judgeHadError?: boolean;
  };
}

interface EntryPhaseStats {
  key: string;
  runId: string;
  executionDirectory: string;
  questionIds: string[];
  answerCollectionMode?: AnswerCollectionMode;
  totalRuns: number;
  anyErrorCount: number;
  collectErrorCount: number;
  judgeErrorCount: number;
  answerParseErrorCount: number;
  noFinalTextCount: number;
  otherCollectErrorCount: number;
}

interface PhaseValidationResult {
  shouldStop: boolean;
  stopReasons: string[];
  fallbackEntryKeys: string[];
  stats: EntryPhaseStats[];
}

function parsePositiveInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function parseCliArgs(argv: string[]): CliArgs {
  let matrixPath: string | undefined;
  let parallelism: number | undefined;

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--matrix=")) matrixPath = arg.split("=")[1];
    else if (arg.startsWith("--parallel=")) parallelism = parsePositiveInteger(arg.split("=")[1] ?? "", "--parallel");
    else if (arg === "--help") {
      console.log("Usage: npm run test:matrix -- --matrix=path/to/matrix.json [--parallel=3]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!matrixPath) throw new Error("Missing --matrix=path/to/matrix.json");
  return { matrixPath, parallelism };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeValue<T>(baseValue: T, overrideValue: unknown): T {
  if (overrideValue === undefined) return baseValue;
  if (!isObject(baseValue) || !isObject(overrideValue)) return overrideValue as T;
  const merged: Record<string, unknown> = { ...baseValue };
  for (const [key, value] of Object.entries(overrideValue)) {
    merged[key] = mergeValue((baseValue as Record<string, unknown>)[key], value);
  }
  return merged as T;
}

function parseBatchNumber(raw: unknown): BenchmarkBatchNumber | undefined {
  if (raw === undefined) return undefined;
  if (raw === "auto" || raw === "all") return raw;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  throw new Error("batchNumber must be 'auto', 'all', or a positive integer when provided");
}

function getEntryKey(entry: MatrixEntry): string {
  return entry.id ?? entry.runId;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

function getExecutionDirectory(benchmarkName: string, runId: string): string {
  return resolve(REPO_ROOT, "benchmark-results", `${slugify(benchmarkName)}--${slugify(runId)}`);
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function validateRate(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1 when provided`);
  }
}

function validateStructuredFallback(config: StructuredFallbackConfig | undefined, label: string): void {
  if (!config) return;
  if (typeof config.enabled !== "boolean") throw new Error(`${label}.enabled must be boolean`);
  if (config.minRuns !== undefined && (!Number.isInteger(config.minRuns) || config.minRuns <= 0)) {
    throw new Error(`${label}.minRuns must be a positive integer when provided`);
  }
  validateRate(config.minAnswerParseErrorRate, `${label}.minAnswerParseErrorRate`);
  validateRate(config.maxOtherCollectErrorRate, `${label}.maxOtherCollectErrorRate`);
  validateRate(config.maxJudgeErrorRate, `${label}.maxJudgeErrorRate`);
  if (config.targetAnswerCollectionMode !== undefined
    && config.targetAnswerCollectionMode !== "structured_json"
    && config.targetAnswerCollectionMode !== "lazy_text") {
    throw new Error(`${label}.targetAnswerCollectionMode must be structured_json or lazy_text when provided`);
  }
  if (config.runIdSuffix !== undefined && typeof config.runIdSuffix !== "string") {
    throw new Error(`${label}.runIdSuffix must be a string when provided`);
  }
}

function validatePhaseValidation(config: PhaseValidationConfig | undefined, label: string): void {
  if (!config) return;
  validateRate(config.maxAnyErrorRate, `${label}.maxAnyErrorRate`);
  validateRate(config.maxCollectErrorRate, `${label}.maxCollectErrorRate`);
  validateRate(config.maxJudgeErrorRate, `${label}.maxJudgeErrorRate`);
  if (config.requireAggregate !== undefined && typeof config.requireAggregate !== "boolean") {
    throw new Error(`${label}.requireAggregate must be boolean when provided`);
  }
  validateStructuredFallback(config.structuredFallback, `${label}.structuredFallback`);
}

function validateMatrixFile(matrix: BenchmarkMatrixFile): void {
  if (!Array.isArray(matrix.entries) || matrix.entries.length === 0) {
    throw new Error("Matrix must contain at least one entry");
  }
  for (const [index, entry] of matrix.entries.entries()) {
    if (typeof entry.runId !== "string" || entry.runId.length === 0) throw new Error(`entries[${index}].runId must be a non-empty string`);
    if (typeof entry.model !== "string" || entry.model.length === 0) throw new Error(`entries[${index}].model must be a non-empty string`);
    parseModelRefFromString(entry.model);
    parseBatchNumber(entry.batchNumber);
  }
  if (matrix.defaults?.batchNumber !== undefined) parseBatchNumber(matrix.defaults.batchNumber);
  if (matrix.phases) {
    for (const [index, phase] of matrix.phases.entries()) {
      if (typeof phase.name !== "string" || phase.name.length === 0) throw new Error(`phases[${index}].name must be a non-empty string`);
      parseBatchNumber(phase.batchNumber);
      validatePhaseValidation(phase.validation, `phases[${index}].validation`);
    }
  }
}

async function writeTempBenchmarkConfig(config: BenchmarkConfig): Promise<{ configPath: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "benchmark-matrix-config-"));
  const configPath = join(dir, "benchmark.yaml");
  await writeFile(configPath, stringifyYaml(config), "utf8");
  return { configPath, dir };
}

function buildCommandArgs(entry: MatrixEntry, defaults: MatrixDefaults): string[] {
  const questionIds = entry.questionIds ?? defaults.questionIds;
  const modes = entry.modes ?? defaults.modes ?? ["open_book"];
  const batchSize = entry.batchSize ?? defaults.batchSize ?? (questionIds && questionIds.length > 0 ? questionIds.length : undefined);
  const batchNumber = entry.batchNumber ?? defaults.batchNumber ?? (batchSize !== undefined ? 1 : undefined);
  const resume = entry.resume ?? defaults.resume ?? false;
  const stopOnError = entry.stopOnError ?? defaults.stopOnError ?? false;

  const args = [
    "run",
    "test:run",
    "--",
    `--run-id=${entry.runId}`,
    `--model=${entry.model}`,
    `--mode=${modes.join(",")}`,
    `--resume=${resume}`,
    `--stop-on-error=${stopOnError}`,
  ];

  if (batchSize !== undefined) args.push(`--batch-size=${batchSize}`);
  if (batchNumber !== undefined) args.push(`--batch-number=${batchNumber}`);

  if (questionIds && questionIds.length > 0) {
    args.push(`--question=${questionIds.join(",")}`);
  }

  const toolSet = entry.toolSet ?? defaults.toolSet;
  if (toolSet) args.push(`--tool-set=${toolSet}`);

  const answerCollectionMode = entry.answerCollectionMode ?? defaults.answerCollectionMode;
  if (answerCollectionMode) args.push(`--answer-collection-mode=${answerCollectionMode}`);

  return args;
}

async function loadExecutionSnapshot(executionDirectory: string): Promise<EntryExecutionSnapshot> {
  const raw = await readFile(join(executionDirectory, "execution-config.yaml"), "utf8");
  const parsed = parseYaml(raw) as Record<string, unknown>;
  const execution = isObject(parsed.execution) ? parsed.execution : {};
  const batch = isObject(parsed.batch) ? parsed.batch : {};
  return {
    questionIds: Array.isArray(batch.questionIds) ? batch.questionIds.filter((value): value is string => typeof value === "string" && value.length > 0) : [],
    answerCollectionMode:
      execution.answerCollectionMode === "structured_json" || execution.answerCollectionMode === "lazy_text"
        ? execution.answerCollectionMode
        : undefined,
  };
}

async function waitForStreamFinish(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  if (stream.closed || stream.destroyed) return;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.once("finish", () => resolvePromise());
    stream.once("error", rejectPromise);
    stream.end();
  });
}

async function runEntry(entry: MatrixEntry, defaults: MatrixDefaults, baseConfig: BenchmarkConfig): Promise<RunEntrySuccess> {
  parseModelRefFromString(entry.model);

  const logPath = join(LOG_ROOT, `${basename(entry.runId)}.log`);
  await mkdir(LOG_ROOT, { recursive: true });

  const effectiveTransportOverride = mergeValue(defaults.transport ?? {}, entry.transport ?? {});
  const effectiveConfig = Object.keys(effectiveTransportOverride).length > 0
    ? mergeValue(baseConfig, { transport: effectiveTransportOverride })
    : baseConfig;
  const tempConfig = Object.keys(effectiveTransportOverride).length > 0 ? await writeTempBenchmarkConfig(effectiveConfig) : undefined;
  const executionDirectory = getExecutionDirectory(baseConfig.benchmarkName, entry.runId);

  try {
    const args = buildCommandArgs(entry, defaults);
    const env = {
      ...process.env,
      ...(tempConfig ? { BENCHMARK_CONFIG: tempConfig.configPath } : {}),
    };

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn("npm", args, {
        cwd: REPO_ROOT,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const logStream = createWriteStream(logPath, { flags: "w" });
      logStream.write(`# ${new Date().toISOString()}\n`);
      logStream.write(`$ npm ${args.join(" ")}\n\n`);

      const handleChunk = (chunk: Buffer | string) => {
        logStream.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      };

      child.stdout.on("data", handleChunk);
      child.stderr.on("data", handleChunk);
      child.on("error", async (error) => {
        logStream.write(`\n[runner-error] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        await waitForStreamFinish(logStream).catch(() => {});
        rejectPromise(error);
      });
      child.on("close", async (code) => {
        logStream.write(`\n[exit-code] ${code ?? "null"}\n`);
        await waitForStreamFinish(logStream);
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`Entry ${entry.runId} failed with exit code ${code}. See ${logPath}`));
      });
    });

    const snapshot = await loadExecutionSnapshot(executionDirectory);
    return {
      key: getEntryKey(entry),
      runId: entry.runId,
      executionDirectory,
      logPath,
      snapshot,
    };
  } finally {
    if (tempConfig) {
      await rm(tempConfig.dir, { recursive: true, force: true });
    }
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      await worker(next);
    }
  });
  await Promise.all(workers);
}

async function loadAggregateRunRecords(executionDirectory: string): Promise<AggregateRunRecord[]> {
  const path = join(executionDirectory, "aggregate-runs.jsonl");
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AggregateRunRecord);
}

function summarizeEntryPhase(success: RunEntrySuccess, records: AggregateRunRecord[]): EntryPhaseStats {
  const wantedQuestions = new Set(success.snapshot.questionIds);
  const relevantRecords = wantedQuestions.size === 0
    ? records
    : records.filter((record) => {
        const questionId = record.question?.questionId;
        return typeof questionId === "string" && wantedQuestions.has(questionId);
      });

  const answerParseErrorCount = relevantRecords.filter((record) => typeof record.answer?.parseError === "string" && record.answer.parseError.length > 0).length;
  const noFinalTextCount = relevantRecords.filter((record) => (record.answer?.parseError ?? "") === "Assistant produced no final text.").length;
  const collectErrorCount = relevantRecords.filter((record) => record.errors?.collectHadError === true).length;
  const judgeErrorCount = relevantRecords.filter((record) => record.errors?.judgeHadError === true).length;
  const anyErrorCount = relevantRecords.filter((record) => record.errors?.collectHadError === true || record.errors?.judgeHadError === true).length;
  const otherCollectErrorCount = relevantRecords.filter((record) => record.errors?.collectHadError === true && !(typeof record.answer?.parseError === "string" && record.answer.parseError.length > 0)).length;

  return {
    key: success.key,
    runId: success.runId,
    executionDirectory: success.executionDirectory,
    questionIds: success.snapshot.questionIds,
    answerCollectionMode: success.snapshot.answerCollectionMode,
    totalRuns: relevantRecords.length,
    anyErrorCount,
    collectErrorCount,
    judgeErrorCount,
    answerParseErrorCount,
    noFinalTextCount,
    otherCollectErrorCount,
  };
}

function shouldApplyStructuredFallback(stats: EntryPhaseStats, config: StructuredFallbackConfig | undefined): boolean {
  if (!config?.enabled) return false;
  if (stats.answerCollectionMode !== "structured_json") return false;
  if (stats.totalRuns < (config.minRuns ?? 1)) return false;

  const answerParseErrorRate = stats.answerParseErrorCount / stats.totalRuns;
  const otherCollectErrorRate = stats.otherCollectErrorCount / stats.totalRuns;
  const judgeErrorRate = stats.judgeErrorCount / stats.totalRuns;

  return answerParseErrorRate >= (config.minAnswerParseErrorRate ?? 0.5)
    && otherCollectErrorRate <= (config.maxOtherCollectErrorRate ?? 0.1)
    && judgeErrorRate <= (config.maxJudgeErrorRate ?? 0.25);
}

function appendRunIdSuffix(runId: string, suffix: string): string {
  return runId.endsWith(suffix) ? runId : `${runId}${suffix}`;
}

function applyStructuredFallback(entry: MatrixEntry, config: StructuredFallbackConfig): MatrixEntry {
  return {
    ...entry,
    runId: appendRunIdSuffix(entry.runId, config.runIdSuffix ?? "-lazy"),
    answerCollectionMode: config.targetAnswerCollectionMode ?? "lazy_text",
  };
}

async function validatePhase(params: {
  phase: MatrixPhase;
  successes: RunEntrySuccess[];
  failures: RunEntryFailure[];
}): Promise<PhaseValidationResult> {
  const validation = params.phase.validation;
  const stopReasons = params.failures.map((failure) => `${failure.runId}: command failed (${failure.error})`);
  const fallbackEntryKeys: string[] = [];
  const stats: EntryPhaseStats[] = [];

  if (!validation) {
    return {
      shouldStop: stopReasons.length > 0,
      stopReasons,
      fallbackEntryKeys,
      stats,
    };
  }

  for (const success of params.successes) {
    try {
      const records = await loadAggregateRunRecords(success.executionDirectory);
      const entryStats = summarizeEntryPhase(success, records);
      stats.push(entryStats);

      if (entryStats.totalRuns === 0) {
        if (validation.requireAggregate !== false) {
          stopReasons.push(`${success.runId}: aggregate did not contain any runs for the current phase questions`);
        }
        continue;
      }

      if (shouldApplyStructuredFallback(entryStats, validation.structuredFallback)) {
        fallbackEntryKeys.push(success.key);
        continue;
      }

      const anyErrorRate = entryStats.anyErrorCount / entryStats.totalRuns;
      const collectErrorRate = entryStats.collectErrorCount / entryStats.totalRuns;
      const judgeErrorRate = entryStats.judgeErrorCount / entryStats.totalRuns;

      if (validation.maxAnyErrorRate !== undefined && anyErrorRate > validation.maxAnyErrorRate) {
        stopReasons.push(`${success.runId}: any-error rate ${formatRate(anyErrorRate)} exceeded ${formatRate(validation.maxAnyErrorRate)}`);
      }
      if (validation.maxCollectErrorRate !== undefined && collectErrorRate > validation.maxCollectErrorRate) {
        stopReasons.push(`${success.runId}: collect-error rate ${formatRate(collectErrorRate)} exceeded ${formatRate(validation.maxCollectErrorRate)}`);
      }
      if (validation.maxJudgeErrorRate !== undefined && judgeErrorRate > validation.maxJudgeErrorRate) {
        stopReasons.push(`${success.runId}: judge-error rate ${formatRate(judgeErrorRate)} exceeded ${formatRate(validation.maxJudgeErrorRate)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stopReasons.push(`${success.runId}: failed to inspect phase results (${message})`);
    }
  }

  return {
    shouldStop: stopReasons.length > 0,
    stopReasons,
    fallbackEntryKeys,
    stats,
  };
}

function mergeDefaults(baseDefaults: MatrixDefaults, phase: MatrixPhase): MatrixDefaults {
  return {
    ...baseDefaults,
    ...phase,
    transport: mergeValue(baseDefaults.transport ?? {}, phase.transport ?? {}),
  };
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const matrix = await readJsonFile<BenchmarkMatrixFile>(resolve(REPO_ROOT, cli.matrixPath));
  validateMatrixFile(matrix);
  const { config } = await loadBenchmarkConfigWithMeta();

  const baseDefaults = matrix.defaults ?? {};
  const baseEntries = matrix.entries.map((entry) => ({ ...entry }));
  const phases = matrix.phases && matrix.phases.length > 0
    ? matrix.phases
    : [{ name: "matrix", entries: baseEntries, parallelism: matrix.parallelism } satisfies MatrixPhase];
  const activeEntries = new Map(baseEntries.map((entry) => [getEntryKey(entry), { ...entry }]));

  for (const phase of phases) {
    const resolvedDefaults = mergeDefaults(baseDefaults, phase);
    const phaseEntries = phase.entries && phase.entries.length > 0
      ? phase.entries.map((entry) => ({ ...entry }))
      : Array.from(activeEntries.values()).map((entry) => ({ ...entry }));
    const parallelism = cli.parallelism ?? phase.parallelism ?? matrix.parallelism ?? 1;
    const failures: RunEntryFailure[] = [];
    const successes: RunEntrySuccess[] = [];

    console.log(`\n== Phase: ${phase.name} ==`);
    console.log(`Running ${phaseEntries.length} entry/entries with parallelism=${parallelism}`);

    await runWithConcurrency(phaseEntries, parallelism, async (entry) => {
      const liveLogPath = join(LOG_ROOT, `${basename(entry.runId)}.log`);
      console.log(`\n==> ${entry.runId}`);
      console.log(`log (live): ${liveLogPath}`);
      try {
        const result = await runEntry(entry, resolvedDefaults, config);
        successes.push(result);
        console.log(`done: ${result.runId}`);
        console.log(`log: ${result.logPath}`);
        if (result.snapshot.questionIds.length > 0) {
          console.log(`phase questions: ${result.snapshot.questionIds.join(", ")}`);
        }
        if (result.snapshot.answerCollectionMode) {
          console.log(`answer collection mode: ${result.snapshot.answerCollectionMode}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure: RunEntryFailure = {
          key: getEntryKey(entry),
          runId: entry.runId,
          executionDirectory: getExecutionDirectory(config.benchmarkName, entry.runId),
          logPath: join(LOG_ROOT, `${basename(entry.runId)}.log`),
          error: message,
        };
        failures.push(failure);
        console.error(message);
      }
    });

    const validation = await validatePhase({ phase, successes, failures });

    if (validation.stats.length > 0) {
      console.log(`\nPhase summary: ${phase.name}`);
      for (const stats of validation.stats) {
        const anyErrorRate = stats.totalRuns === 0 ? 0 : stats.anyErrorCount / stats.totalRuns;
        const collectErrorRate = stats.totalRuns === 0 ? 0 : stats.collectErrorCount / stats.totalRuns;
        const judgeErrorRate = stats.totalRuns === 0 ? 0 : stats.judgeErrorCount / stats.totalRuns;
        const answerParseErrorRate = stats.totalRuns === 0 ? 0 : stats.answerParseErrorCount / stats.totalRuns;
        console.log(
          `- ${stats.runId}: runs=${stats.totalRuns}, anyError=${formatRate(anyErrorRate)}, collectError=${formatRate(collectErrorRate)}, judgeError=${formatRate(judgeErrorRate)}, answerParseError=${formatRate(answerParseErrorRate)}`,
        );
      }
    }

    if (validation.fallbackEntryKeys.length > 0 && phase.validation?.structuredFallback?.enabled) {
      console.log(`\nStructured-output fallback triggered for ${validation.fallbackEntryKeys.length} entr${validation.fallbackEntryKeys.length === 1 ? "y" : "ies"}:`);
      for (const key of validation.fallbackEntryKeys) {
        const activeEntry = activeEntries.get(key);
        if (!activeEntry) continue;
        const updatedEntry = applyStructuredFallback(activeEntry, phase.validation.structuredFallback);
        activeEntries.set(key, updatedEntry);
        console.log(`- ${activeEntry.runId} -> ${updatedEntry.runId} (${updatedEntry.answerCollectionMode})`);
      }
    }

    if (validation.shouldStop) {
      console.error(`\nStopping after phase ${phase.name}:`);
      for (const reason of validation.stopReasons) {
        console.error(`- ${reason}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  console.log("\nMatrix completed successfully.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
