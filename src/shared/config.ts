import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type {
  BenchmarkMode,
  ModelRef,
  PromptTemplateId,
  JudgePromptTemplateId,
  ToolSetName,
  CorpusSnapshotRef,
  JudgeProfile,
  ModelTransportConfig,
  SessionConfig,
  ThinkingLevel,
  OpenRouterReasoningEffort,
  SwiftDocsToolConfig,
  AnswerCollectionMode,
} from "./contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "benchmark.yaml");
const DEFAULT_LOCAL_CONFIG_PATH = resolve(REPO_ROOT, "benchmark.local.yaml");

export interface BenchmarkConfigPaths {
  basePath: string;
  overridePath?: string;
}

export interface LoadedBenchmarkConfig {
  config: BenchmarkConfig;
  configPaths: BenchmarkConfigPaths;
}

export interface BenchmarkModelConfig {
  candidates: string[];
}

export interface BenchmarkExecutionConfig {
  resume: boolean;
  stopOnError: boolean;
  maxParseRetries: number;
  answerCollectionMode: AnswerCollectionMode;
}

export type BenchmarkBatchNumber = number | "auto";

export interface BenchmarkBatchConfig {
  size: number | null;
  number: BenchmarkBatchNumber;
}

export interface BenchmarkConfig {
  benchmarkName: string;
  runId: string; // "auto" or explicit execution id
  transport: ModelTransportConfig;
  models: BenchmarkModelConfig;
  judge: {
    model: string;
    transport?: ModelTransportConfig;
    profile: JudgeProfile;
  };
  paths: {
    dataset: string;
    toolSets: string;
    rubric: string;
    promptTemplates: Record<string, string>;
  };
  corpus: CorpusSnapshotRef;
  swiftDocs?: SwiftDocsToolConfig;
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

const VALID_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const VALID_OPENROUTER_REASONING_EFFORTS: OpenRouterReasoningEffort[] = ["minimal", "low", "medium", "high"];

function validateTransportConfig(raw: unknown, label: string): asserts raw is ModelTransportConfig {
  if (!raw || typeof raw !== "object") throw new Error(`Missing ${label}`);
  const transport = raw as Record<string, unknown>;

  if (transport.kind !== "openrouter" && transport.kind !== "pi") {
    throw new Error(`${label}.kind must be 'openrouter' or 'pi'`);
  }

  if (transport.kind === "pi") {
    if (!transport.session || typeof transport.session !== "object") {
      throw new Error(`${label}.session must be provided for ${label}.kind='pi'`);
    }
    const session = transport.session as Record<string, unknown>;
    if (typeof session.compaction !== "boolean") throw new Error(`${label}.session.compaction must be boolean`);
    if (typeof session.retry !== "boolean") throw new Error(`${label}.session.retry must be boolean`);
    if (!isPositiveInteger(session.maxRetries) && session.maxRetries !== 0) {
      throw new Error(`${label}.session.maxRetries must be a non-negative integer`);
    }
    if (session.thinkingLevel !== undefined && !VALID_THINKING_LEVELS.includes(session.thinkingLevel as ThinkingLevel)) {
      throw new Error(`${label}.session.thinkingLevel must be one of ${VALID_THINKING_LEVELS.join(", ")}`);
    }
  }

  if (transport.openRouterRouting !== undefined) {
    if (transport.kind !== "openrouter") {
      throw new Error(`${label}.openRouterRouting is only supported when ${label}.kind='openrouter'`);
    }
    if (typeof transport.openRouterRouting !== "object" || transport.openRouterRouting === null) {
      throw new Error(`${label}.openRouterRouting must be an object`);
    }
    const routing = transport.openRouterRouting as Record<string, unknown>;
    if (routing.order !== undefined && !isNonEmptyStringArray(routing.order)) {
      throw new Error(`${label}.openRouterRouting.order must be an array of non-empty strings`);
    }
    if (routing.only !== undefined && !isNonEmptyStringArray(routing.only)) {
      throw new Error(`${label}.openRouterRouting.only must be an array of non-empty strings`);
    }
  }

  if (transport.openRouterUseStructuredOutputs !== undefined) {
    if (transport.kind !== "openrouter") {
      throw new Error(`${label}.openRouterUseStructuredOutputs is only supported when ${label}.kind='openrouter'`);
    }
    if (typeof transport.openRouterUseStructuredOutputs !== "boolean") {
      throw new Error(`${label}.openRouterUseStructuredOutputs must be boolean`);
    }
  }

  if (transport.openRouterRetryDelaysMs !== undefined) {
    if (transport.kind !== "openrouter") {
      throw new Error(`${label}.openRouterRetryDelaysMs is only supported when ${label}.kind='openrouter'`);
    }
    if (!Array.isArray(transport.openRouterRetryDelaysMs) || !transport.openRouterRetryDelaysMs.every(isNonNegativeInteger)) {
      throw new Error(`${label}.openRouterRetryDelaysMs must be an array of non-negative integers`);
    }
  }

  if (transport.openRouterReasoningEffort !== undefined) {
    if (transport.kind !== "openrouter") {
      throw new Error(`${label}.openRouterReasoningEffort is only supported when ${label}.kind='openrouter'`);
    }
    if (!VALID_OPENROUTER_REASONING_EFFORTS.includes(transport.openRouterReasoningEffort as OpenRouterReasoningEffort)) {
      throw new Error(`${label}.openRouterReasoningEffort must be one of ${VALID_OPENROUTER_REASONING_EFFORTS.join(", ")}`);
    }
  }
}

function validateConfig(raw: unknown): asserts raw is BenchmarkConfig {
  if (!raw || typeof raw !== "object") throw new Error("Config is not an object");
  const c = raw as Record<string, unknown>;

  if (typeof c.benchmarkName !== "string") throw new Error("Missing benchmarkName");
  if (typeof c.runId !== "string") throw new Error("Missing runId");

  if (!c.models || typeof c.models !== "object") throw new Error("Missing models");
  const models = c.models as Record<string, unknown>;
  validateTransportConfig(c.transport, "transport");

  if (!isStringArray(models.candidates) || models.candidates.length === 0) {
    throw new Error("models.candidates must be a non-empty array of provider/model strings");
  }

  if (!c.judge || typeof c.judge !== "object") throw new Error("Missing judge");
  const judge = c.judge as Record<string, unknown>;
  if (typeof judge.model !== "string") throw new Error("judge.model must be a provider/model string");
  if (judge.transport !== undefined) {
    validateTransportConfig(judge.transport, "judge.transport");
  }
  if (!judge.profile || typeof judge.profile !== "object") throw new Error("Missing judge.profile");
  const profile = judge.profile as Record<string, unknown>;
  if (typeof profile.id !== "string") throw new Error("judge.profile.id must be a string");
  if (typeof profile.version !== "string") throw new Error("judge.profile.version must be a string");
  if (typeof profile.description !== "string") throw new Error("judge.profile.description must be a string");
  if (typeof profile.toolSetName !== "string") throw new Error("judge.profile.toolSetName must be a string");
  if (typeof profile.promptTemplateId !== "string") throw new Error("judge.profile.promptTemplateId must be a string");
  if (typeof profile.promptTemplateVersion !== "string") throw new Error("judge.profile.promptTemplateVersion must be a string");
  if (profile.responseSchemaVersion !== "judge-verdict.v1") throw new Error("judge.profile.responseSchemaVersion must be 'judge-verdict.v1'");

  if (!c.paths || typeof c.paths !== "object") throw new Error("Missing paths");
  const paths = c.paths as Record<string, unknown>;
  if (typeof paths.dataset !== "string") throw new Error("Missing paths.dataset");
  if (typeof paths.toolSets !== "string") throw new Error("Missing paths.toolSets");
  if (typeof paths.rubric !== "string") throw new Error("Missing paths.rubric");
  if (!paths.promptTemplates || typeof paths.promptTemplates !== "object") throw new Error("Missing paths.promptTemplates");

  if (!c.corpus || typeof c.corpus !== "object") throw new Error("Missing corpus");
  if (c.swiftDocs !== undefined) {
    if (!c.swiftDocs || typeof c.swiftDocs !== "object") throw new Error("swiftDocs must be an object when provided");
    const swiftDocs = c.swiftDocs as Record<string, unknown>;
    if (typeof swiftDocs.repoRoot !== "string") throw new Error("swiftDocs.repoRoot must be a string");
    if (typeof swiftDocs.dbPath !== "string") throw new Error("swiftDocs.dbPath must be a string");
    if (swiftDocs.configPath !== undefined && typeof swiftDocs.configPath !== "string") {
      throw new Error("swiftDocs.configPath must be a string when provided");
    }
  }
  if (!c.execution || typeof c.execution !== "object") throw new Error("Missing execution");
  const execution = c.execution as Record<string, unknown>;
  if (typeof execution.resume !== "boolean") throw new Error("execution.resume must be boolean");
  if (typeof execution.stopOnError !== "boolean") throw new Error("execution.stopOnError must be boolean");
  if (!isPositiveInteger(execution.maxParseRetries) && execution.maxParseRetries !== 0) {
    throw new Error("execution.maxParseRetries must be a non-negative integer");
  }
  if (execution.answerCollectionMode !== "structured_json" && execution.answerCollectionMode !== "lazy_text") {
    throw new Error("execution.answerCollectionMode must be 'structured_json' or 'lazy_text'");
  }

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeConfigValue(baseValue: unknown, overrideValue: unknown): unknown {
  if (overrideValue === undefined) return baseValue;
  if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) return overrideValue;

  const merged: Record<string, unknown> = { ...baseValue };
  for (const [key, value] of Object.entries(overrideValue)) {
    merged[key] = mergeConfigValue(baseValue[key], value);
  }
  return merged;
}

async function readYamlFileIfExists(path: string): Promise<unknown | undefined> {
  try {
    return parseYaml(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function resolvePaths(config: BenchmarkConfig): BenchmarkConfig {
  return {
    ...config,
    paths: {
      dataset: resolvePath(config.paths.dataset),
      toolSets: resolvePath(config.paths.toolSets),
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
    ...(config.swiftDocs
      ? {
          swiftDocs: {
            ...config.swiftDocs,
            repoRoot: resolvePath(config.swiftDocs.repoRoot),
            dbPath: resolvePath(config.swiftDocs.dbPath),
            ...(config.swiftDocs.configPath ? { configPath: resolvePath(config.swiftDocs.configPath) } : {}),
          },
        }
      : {}),
  };
}

export async function loadBenchmarkConfigWithMeta(path?: string): Promise<LoadedBenchmarkConfig> {
  const explicitConfigPath = path ?? process.env.BENCHMARK_CONFIG;
  const basePath = explicitConfigPath ? resolvePath(explicitConfigPath) : DEFAULT_CONFIG_PATH;
  const baseRaw = parseYaml(await readFile(basePath, "utf8"));
  const overridePath = explicitConfigPath ? undefined : DEFAULT_LOCAL_CONFIG_PATH;
  const overrideRaw = overridePath ? await readYamlFileIfExists(overridePath) : undefined;
  const mergedRaw = overrideRaw === undefined ? baseRaw : mergeConfigValue(baseRaw, overrideRaw);
  if (mergedRaw && typeof mergedRaw === "object") {
    const execution = (mergedRaw as Record<string, unknown>).execution;
    if (execution && typeof execution === "object" && !("answerCollectionMode" in execution)) {
      (execution as Record<string, unknown>).answerCollectionMode = "structured_json";
    }
  }

  validateConfig(mergedRaw);
  return {
    config: resolvePaths(mergedRaw),
    configPaths: {
      basePath,
      ...(overrideRaw !== undefined && overridePath ? { overridePath } : {}),
    },
  };
}

export async function loadBenchmarkConfig(path?: string): Promise<BenchmarkConfig> {
  return (await loadBenchmarkConfigWithMeta(path)).config;
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

export function getJudgeModelRef(config: BenchmarkConfig): ModelRef {
  return parseModelRef(config.judge.model);
}

export function getJudgeTransportConfig(config: BenchmarkConfig): ModelTransportConfig {
  return config.judge.transport ?? config.transport;
}
