import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyYaml } from "yaml";
import type { SwiftDocsToolConfig } from "../shared/contracts.js";
import { loadProjectEnvVars } from "../shared/env-api-keys.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const documentPathCache = new Map<string, Map<string, string>>();

interface SwiftDocsSearchHybridArgs {
  terms?: unknown;
  doc_terms?: unknown;
  semantic_queries?: unknown;
  top_docs?: unknown;
  top_chunks?: unknown;
  per_doc_chunk_limit?: unknown;
  related_from_top_docs?: unknown;
  related_limit?: unknown;
  semantic_limit?: unknown;
  semantic_max_distance?: unknown;
  module?: unknown;
  macos_only?: unknown;
  output_mode?: unknown;
}

interface SwiftDocsHybridRequest {
  terms: string[];
  doc_terms: string[];
  semantic_queries: string[];
  top_docs?: number;
  top_chunks?: number;
  per_doc_chunk_limit?: number;
  related_from_top_docs?: number;
  related_limit?: number;
  semantic_limit?: number;
  semantic_max_distance?: number;
  module?: string;
  macos_only?: boolean;
  output_mode: "compact" | "debug";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizePositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer when provided`);
  }
  return value;
}

function normalizePositiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || value <= 0) {
    throw new Error(`${field} must be a positive number when provided`);
  }
  return value;
}

function normalizeRequest(raw: unknown): SwiftDocsHybridRequest {
  const args = (raw && typeof raw === "object" ? raw : {}) as SwiftDocsSearchHybridArgs;
  const terms = normalizeStringArray(args.terms);
  const docTerms = normalizeStringArray(args.doc_terms);
  const semanticQueries = normalizeStringArray(args.semantic_queries);

  if (terms.length === 0 && docTerms.length === 0) {
    throw new Error("swift_docs_search_hybrid requires at least one item in terms or doc_terms");
  }
  if (semanticQueries.length === 0) {
    throw new Error("swift_docs_search_hybrid requires at least one semantic query");
  }

  const topDocs = normalizePositiveInteger(args.top_docs, "top_docs");
  const topChunks = normalizePositiveInteger(args.top_chunks, "top_chunks");
  const perDocChunkLimit = normalizePositiveInteger(args.per_doc_chunk_limit, "per_doc_chunk_limit");
  const relatedFromTopDocs = normalizePositiveInteger(args.related_from_top_docs, "related_from_top_docs");
  const relatedLimit = normalizePositiveInteger(args.related_limit, "related_limit");
  const semanticLimit = normalizePositiveInteger(args.semantic_limit, "semantic_limit");
  const semanticMaxDistance = normalizePositiveNumber(args.semantic_max_distance, "semantic_max_distance");
  const outputMode = args.output_mode === "debug" ? "debug" : "compact";
  const macosOnly = typeof args.macos_only === "boolean" ? args.macos_only : undefined;
  const module = typeof args.module === "string" && args.module.trim().length > 0 ? args.module.trim() : undefined;

  return {
    terms,
    doc_terms: docTerms,
    semantic_queries: semanticQueries,
    ...(topDocs !== undefined ? { top_docs: topDocs } : {}),
    ...(topChunks !== undefined ? { top_chunks: topChunks } : {}),
    ...(perDocChunkLimit !== undefined ? { per_doc_chunk_limit: perDocChunkLimit } : {}),
    ...(relatedFromTopDocs !== undefined ? { related_from_top_docs: relatedFromTopDocs } : {}),
    ...(relatedLimit !== undefined ? { related_limit: relatedLimit } : {}),
    ...(semanticLimit !== undefined ? { semantic_limit: semanticLimit } : {}),
    ...(semanticMaxDistance !== undefined ? { semantic_max_distance: semanticMaxDistance } : {}),
    ...(module ? { module } : {}),
    ...(macosOnly !== undefined ? { macos_only: macosOnly } : {}),
    output_mode: outputMode,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveSwiftDocsCli(repoRoot: string): Promise<string> {
  const localCli = resolve(repoRoot, ".venv/bin/swift-docs");
  return (await pathExists(localCli)) ? localCli : "swift-docs";
}

async function loadDocumentPathIndex(dbPath: string): Promise<Map<string, string>> {
  const manifestPath = resolve(dirname(dbPath), "..", "manifest", "documents.jsonl");
  const cached = documentPathCache.get(manifestPath);
  if (cached) return cached;

  const index = new Map<string, string>();
  if (!(await pathExists(manifestPath))) {
    documentPathCache.set(manifestPath, index);
    return index;
  }

  const content = await readFile(manifestPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as { doc_id?: unknown; normalized_md_path?: unknown };
    if (typeof parsed.doc_id === "string" && typeof parsed.normalized_md_path === "string") {
      index.set(parsed.doc_id, parsed.normalized_md_path);
    }
  }

  documentPathCache.set(manifestPath, index);
  return index;
}

function enrichHybridResult(raw: unknown, documentPaths: Map<string, string>) {
  const payload = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];

  const enrichedPages = pages.map((page) => {
    const item = page && typeof page === "object" ? page as Record<string, unknown> : {};
    const docId = typeof item.doc_id === "string" ? item.doc_id : undefined;
    const normalizedPath = typeof item.normalized_md_path === "string"
      ? item.normalized_md_path
      : (docId ? documentPaths.get(docId) : undefined) ?? null;
    return {
      ...item,
      normalized_md_path: normalizedPath,
    };
  });

  const enrichedChunks = chunks.map((chunk) => {
    const item = chunk && typeof chunk === "object" ? chunk as Record<string, unknown> : {};
    const docId = typeof item.doc_id === "string" ? item.doc_id : undefined;
    return {
      ...item,
      normalized_md_path: docId ? documentPaths.get(docId) ?? null : null,
    };
  });

  return {
    ...payload,
    pages: enrichedPages,
    chunks: enrichedChunks,
  };
}

async function execFileText(file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(file, args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      maxBuffer: 1024 * 1024 * 4,
    }, (error, stdout, stderr) => {
      if (error) {
        const details = [
          `swift-docs command failed: ${error.message}`,
          stderr.trim().length > 0 ? `stderr:\n${stderr.trim()}` : undefined,
          stdout.trim().length > 0 ? `stdout:\n${stdout.trim()}` : undefined,
        ].filter((item): item is string => Boolean(item));
        rejectPromise(new Error(details.join("\n\n")));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

export function createSwiftDocsSearchHybridTool(config: SwiftDocsToolConfig) {
  return {
    name: "swift_docs_search_hybrid",
    description: "Run Swift Docs hybrid retrieval. Provide terms, doc_terms, and semantic_queries. Result includes ranked pages and chunks with normalized_md_path values you can cite in the final answer.",
    parameters: {
      type: "object",
      properties: {
        terms: { type: "array", items: { type: "string" }, description: "Short literal chunk-search terms." },
        doc_terms: { type: "array", items: { type: "string" }, description: "Exact symbols or page hints." },
        semantic_queries: { type: "array", items: { type: "string" }, description: "Natural-language semantic queries." },
        top_docs: { type: "integer", minimum: 1 },
        top_chunks: { type: "integer", minimum: 1 },
        per_doc_chunk_limit: { type: "integer", minimum: 1 },
        related_from_top_docs: { type: "integer", minimum: 1 },
        related_limit: { type: "integer", minimum: 1 },
        semantic_limit: { type: "integer", minimum: 1 },
        semantic_max_distance: { type: "number", exclusiveMinimum: 0 },
        module: { type: "string" },
        macos_only: { type: "boolean" },
        output_mode: { type: "string", enum: ["compact", "debug"] },
      },
      required: ["terms", "doc_terms", "semantic_queries"],
      additionalProperties: false,
    },
    prepareArguments: normalizeRequest,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const request = normalizeRequest(params);
      const env = {
        ...process.env,
        ...loadProjectEnvVars(REPO_ROOT),
        ...loadProjectEnvVars(config.repoRoot),
      };
      const cli = await resolveSwiftDocsCli(config.repoRoot);
      const tempDir = await mkdtemp(join(tmpdir(), "swift-docs-search-"));
      const requestPath = join(tempDir, "request.yaml");

      try {
        await writeFile(requestPath, stringifyYaml(request), "utf8");
        const args = ["search-hybrid", "--request-file", requestPath, "--db", config.dbPath];
        if (config.configPath) args.push("--config", config.configPath);
        const { stdout } = await execFileText(
          cli,
          args,
          signal ? { cwd: config.repoRoot, env, signal } : { cwd: config.repoRoot, env },
        );
        const parsed = JSON.parse(stdout) as unknown;
        const documentPaths = await loadDocumentPathIndex(config.dbPath);
        const enriched = enrichHybridResult(parsed, documentPaths);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(enriched, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`swift_docs_search_hybrid failed: ${message}`);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}
