import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { BenchmarkMode, ModelRef, PromptTemplateId, JudgePromptTemplateId, ToolSetName, CorpusSnapshotRef } from "./contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "benchmark.yaml");

// --- Config shape ---

export interface SessionConfig {
  compaction: boolean;
  retry: boolean;
  maxRetries: number;
}

export interface BenchmarkConfig {
  benchmarkName: string;
  runId: string; // "auto" or explicit
  defaultModel: string; // "provider/modelId" format
  judgeModel: string | null;
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
  systemPrompts: {
    collect: string;
    judge: string;
  };
  modes: Record<BenchmarkMode, ToolSetName>;
  questions: "all" | string[];
}

// --- Parsing ---

function parseModelRef(raw: string): ModelRef {
  const [provider, ...rest] = raw.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    throw new Error(`Invalid model format: "${raw}". Expected provider/model-id (e.g. openrouter/openai/gpt-oss-120b:nitro)`);
  }
  return { provider, modelId };
}

function validateConfig(raw: unknown): asserts raw is BenchmarkConfig {
  if (!raw || typeof raw !== "object") throw new Error("Config is not an object");
  const c = raw as Record<string, unknown>;

  if (typeof c.benchmarkName !== "string") throw new Error("Missing benchmarkName");
  if (typeof c.runId !== "string") throw new Error("Missing runId");
  if (typeof c.defaultModel !== "string") throw new Error("Missing defaultModel");

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
  if (!c.systemPrompts || typeof c.systemPrompts !== "object") throw new Error("Missing systemPrompts");
  if (!c.modes || typeof c.modes !== "object") throw new Error("Missing modes");

  const validQuestions = c.questions === "all" || Array.isArray(c.questions);
  if (!validQuestions) throw new Error("questions must be 'all' or an array of IDs");
}

// --- Resolve helpers ---

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

// --- Public API ---

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

export function getDefaultModelRef(config: BenchmarkConfig): ModelRef {
  return parseModelRef(config.defaultModel);
}

export function getJudgeModelRef(config: BenchmarkConfig): ModelRef | null {
  if (!config.judgeModel) return null;
  return parseModelRef(config.judgeModel);
}
