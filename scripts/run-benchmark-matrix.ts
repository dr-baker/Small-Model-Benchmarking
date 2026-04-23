import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { stringify as stringifyYaml } from "yaml";
import type { AnswerCollectionMode, ModelTransportConfig, ToolSetName } from "../src/shared/contracts.js";
import { loadBenchmarkConfigWithMeta, parseModelRefFromString, type BenchmarkBatchNumber, type BenchmarkConfig } from "../src/shared/config.js";
import { readJsonFile } from "../src/shared/io.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..");
const LOG_ROOT = resolve(REPO_ROOT, ".tmp", "benchmark-matrix-logs");

interface MatrixDefaults {
  questionIds: string[];
  modes?: string[];
  toolSet?: ToolSetName;
  batchSize?: number;
  batchNumber?: BenchmarkBatchNumber;
  resume?: boolean;
  stopOnError?: boolean;
  answerCollectionMode?: AnswerCollectionMode;
}

interface MatrixEntry {
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

interface BenchmarkMatrixFile {
  defaults: MatrixDefaults;
  entries: MatrixEntry[];
  parallelism?: number;
}

interface CliArgs {
  matrixPath: string;
  parallelism?: number;
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
  if (raw === "auto") return "auto";
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  throw new Error("batchNumber must be 'auto' or a positive integer when provided");
}

async function writeTempBenchmarkConfig(config: BenchmarkConfig): Promise<{ configPath: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "benchmark-matrix-config-"));
  const configPath = join(dir, "benchmark.yaml");
  await writeFile(configPath, stringifyYaml(config), "utf8");
  return { configPath, dir };
}

function buildCommandArgs(entry: MatrixEntry, defaults: MatrixDefaults): string[] {
  const questionIds = entry.questionIds ?? defaults.questionIds;
  if (!questionIds || questionIds.length === 0) {
    throw new Error(`Matrix entry ${entry.runId} has no questionIds and defaults.questionIds is empty`);
  }

  const modes = entry.modes ?? defaults.modes ?? ["open_book"];
  const batchSize = entry.batchSize ?? defaults.batchSize ?? questionIds.length;
  const batchNumber = entry.batchNumber ?? defaults.batchNumber ?? 1;
  const resume = entry.resume ?? defaults.resume ?? false;
  const stopOnError = entry.stopOnError ?? defaults.stopOnError ?? false;

  const args = [
    "run",
    "test:run",
    "--",
    `--run-id=${entry.runId}`,
    `--model=${entry.model}`,
    `--question=${questionIds.join(",")}`,
    `--mode=${modes.join(",")}`,
    `--batch-size=${batchSize}`,
    `--batch-number=${batchNumber}`,
    `--resume=${resume}`,
    `--stop-on-error=${stopOnError}`,
  ];

  const toolSet = entry.toolSet ?? defaults.toolSet;
  if (toolSet) args.push(`--tool-set=${toolSet}`);

  const answerCollectionMode = entry.answerCollectionMode ?? defaults.answerCollectionMode;
  if (answerCollectionMode) args.push(`--answer-collection-mode=${answerCollectionMode}`);

  return args;
}

async function runEntry(entry: MatrixEntry, defaults: MatrixDefaults, baseConfig: BenchmarkConfig): Promise<{ runId: string; logPath: string; success: boolean }> {
  parseModelRefFromString(entry.model);

  const logPath = join(LOG_ROOT, `${basename(entry.runId)}.log`);
  await mkdir(LOG_ROOT, { recursive: true });

  const effectiveConfig = entry.transport ? mergeValue(baseConfig, { transport: entry.transport }) : baseConfig;
  const tempConfig = entry.transport ? await writeTempBenchmarkConfig(effectiveConfig) : undefined;

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

      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.on("error", rejectPromise);
      child.on("close", async (code) => {
        const output = Buffer.concat(chunks).toString("utf8");
        await writeFile(logPath, output, "utf8");
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`Entry ${entry.runId} failed with exit code ${code}. See ${logPath}`));
      });
    });

    return { runId: entry.runId, logPath, success: true };
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

async function main() {
  const cli = parseCliArgs(process.argv);
  const matrix = await readJsonFile<BenchmarkMatrixFile>(resolve(REPO_ROOT, cli.matrixPath));
  const { config } = await loadBenchmarkConfigWithMeta();

  if (!matrix.defaults?.questionIds || matrix.defaults.questionIds.length === 0) {
    throw new Error("Matrix defaults.questionIds must contain at least one question id");
  }
  if (!Array.isArray(matrix.entries) || matrix.entries.length === 0) {
    throw new Error("Matrix must contain at least one entry");
  }

  const parallelism = cli.parallelism ?? matrix.parallelism ?? 1;
  const failures: Array<{ runId: string; error: string }> = [];

  console.log(`Running ${matrix.entries.length} matrix entries with parallelism=${parallelism}`);
  await runWithConcurrency(matrix.entries, parallelism, async (entry) => {
    console.log(`\n==> ${entry.runId}`);
    try {
      const result = await runEntry(entry, matrix.defaults, config);
      console.log(`done: ${result.runId}`);
      console.log(`log: ${result.logPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ runId: entry.runId, error: message });
      console.error(message);
    }
  });

  if (failures.length > 0) {
    console.error("\nMatrix completed with failures:");
    for (const failure of failures) {
      console.error(`- ${failure.runId}: ${failure.error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nMatrix completed successfully.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
