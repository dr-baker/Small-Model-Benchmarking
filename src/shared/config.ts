import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { BenchmarkMode, ModelRef, PromptTemplateId, JudgePromptTemplateId, ToolSetName, CorpusSnapshotRef } from "./contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "benchmark.yaml");

export interface SessionConfig {
  compaction: boolean;
  retry: boolean;
  maxRetries: number;
}

export interface BenchmarkModelConfig {
  candidates: string[];
  judge: string | null;
}

export interface BenchmarkExecutionConfig {
  resume: boolean;
  stopOnError: boolean;
}

export type BenchmarkBatchNumber = number | "auto";

export interface BenchmarkBatchConfig {
  size: number | null;
  number: BenchmarkBatchNumber;
}

export interface BenchmarkConfig {
  benchmarkName: string;
  runId: string; // "auto" or explicit execution id
  models: BenchmarkModelConfig;
  paths: {
    dataset: string;
    toolSets: string;
    judgeProfiles: string;
    rubric: string;
    promptTemplates: Record<string, string>;
  };
  corpus: CorpusSnapshotRef;
  judgeProfileId: string;
  session: SessionConfig;
  execution: BenchmarkExecutionConfig;
  batch: BenchmarkBatchConfig;
  systemPrompts: {
    collect: string;
    judge: string;
  };
  modes: Record<BenchmarkMode, ToolSetName>;
  questions: "all" | string[];
}

function parseModelRef(raw: string): ModelRef {
  const [provider, ...rest] = raw.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    throw new Error(`Invalid model format: "${raw}". Expected provider/model-id (e.g. openrouter/openai/gpt-oss-120b:nitro)`);
  }
  return { provider, modelId };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateConfig(raw: unknown): asserts raw is BenchmarkConfig {
  if (!raw || typeof raw !== "object") throw new Error("Config is not an object");
  const c = raw as Record<string, unknown>;

  if (typeof c.benchmarkName !== "string") throw new Error("Missing benchmarkName");
  if (typeof c.runId !== "string") throw new Error("Missing runId");

  if (!c.models || typeof c.models !== "object") throw new Error("Missing models");
  const models = c.models as Record<string, unknown>;
  if (!isStringArray(models.candidates) || models.candidates.length === 0) {
    throw new Error("models.candidates must be a non-empty array of provider/model strings");
  }
  if (!(models.judge === null || typeof models.judge === "string")) {
    throw new Error("models.judge must be null or a provider/model string");
  }

  if (!c.paths || typeof c.paths !== "object") throw new Error("Missing paths");
  const paths = c.paths as Record<string, unknown>;
  if (typeof paths.dataset !== "string") throw new Error("Missing paths.dataset");
  if (typeof paths.toolSets !== "string") throw new Error("Missing paths.toolSets");
  if (typeof paths.judgeProfiles !== "string") throw new Error("Missing paths.judgeProfiles");
  if (typeof paths.rubric !== "string") throw new Error("Missing paths.rubric");
  if (!paths.promptTemplates || typeof paths.promptTemplates !== "object") throw new Error("Missing paths.promptTemplates");

  if (!c.corpus || typeof c.corpus !== "object") throw new Error("Missing corpus");
  if (typeof c.judgeProfileId !== "string") throw new Error("Missing judgeProfileId");

  if (!c.session || typeof c.session !== "object") throw new Error("Missing session");
  if (!c.execution || typeof c.execution !== "object") throw new Error("Missing execution");
  const execution = c.execution as Record<string, unknown>;
  if (typeof execution.resume !== "boolean") throw new Error("execution.resume must be boolean");
  if (typeof execution.stopOnError !== "boolean") throw new Error("execution.stopOnError must be boolean");

  if (!c.batch || typeof c.batch !== "object") throw new Error("Missing batch");
  const batch = c.batch as Record<string, unknown>;
  if (!(batch.size === null || isPositiveInteger(batch.size))) {
    throw new Error("batch.size must be null or a positive integer");
  }
  if (!(batch.number === "auto" || isPositiveInteger(batch.number))) {
    throw new Error("batch.number must be 'auto' or a positive integer");
  }

  if (!c.systemPrompts || typeof c.systemPrompts !== "object") throw new Error("Missing systemPrompts");
  if (!c.modes || typeof c.modes !== "object") throw new Error("Missing modes");

  const validQuestions = c.questions === "all" || Array.isArray(c.questions);
  if (!validQuestions) throw new Error("questions must be 'all' or an array of IDs");
}

function resolvePath(relativeOrAbsolute: string): string {
  if (relativeOrAbsolute.startsWith("/")) return relativeOrAbsolute;
  return resolve(REPO_ROOT, relativeOrAbsolute);
}

export function resolvePaths(config: BenchmarkConfig): BenchmarkConfig {
  return {
    ...config,
    paths: {
      dataset: resolvePath(config.paths.dataset),
      toolSets: resolvePath(config.paths.toolSets),
      judgeProfiles: resolvePath(config.paths.judgeProfiles),
      rubric: resolvePath(config.paths.rubric),
      promptTemplates: Object.fromEntries(
        Object.entries(config.paths.promptTemplates).map(([k, v]) => [k, resolvePath(v)]),
      ),
    },
    corpus: {
      ...config.corpus,
      rootDir: resolvePath(config.corpus.rootDir),
      manifestPath: resolvePath(config.corpus.manifestPath),
    },
  };
}

export async function loadBenchmarkConfig(path?: string): Promise<BenchmarkConfig> {
  const configPath = path ? resolvePath(path) : DEFAULT_CONFIG_PATH;
  const raw = parseYaml(await readFile(configPath, "utf8"));
  validateConfig(raw);
  return resolvePaths(raw);
}

export function parseModelRefFromString(raw: string): ModelRef {
  return parseModelRef(raw);
}

export function getPromptTemplatePath(config: BenchmarkConfig, id: PromptTemplateId | JudgePromptTemplateId): string {
  const p = config.paths.promptTemplates[id];
  if (!p) throw new Error(`No prompt template path configured for: ${id}`);
  return p;
}

export function getCandidateModelRefs(config: BenchmarkConfig): ModelRef[] {
  return config.models.candidates.map(parseModelRef);
}

export function getJudgeModelRef(config: BenchmarkConfig): ModelRef | null {
  if (!config.models.judge) return null;
  return parseModelRef(config.models.judge);
}
