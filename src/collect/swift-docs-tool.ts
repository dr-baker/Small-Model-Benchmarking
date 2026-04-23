import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyYaml } from "yaml";
import type { SwiftDocsToolConfig } from "../shared/contracts.js";
import { loadProjectEnvVars } from "../shared/env-api-keys.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const documentPathCache = new Map<string, Map<string, string>>();
const documentUrlCache = new Map<string, Map<string, { doc_id?: string; normalized_md_path: string; title?: string; url: string }>>();

const SIMPLE_SEARCH_DEFAULTS = Object.freeze({
  top_docs: 5,
  top_chunks: 8,
  per_doc_chunk_limit: 2,
  semantic_limit: 4,
  semantic_max_distance: 0.25,
  output_mode: "compact" as const,
  macos_only: false,
});

const QUERY_STOPWORDS = new Set([
  "a", "an", "and", "api", "app", "apple", "apps", "best", "build", "by", "can", "code", "do", "docs", "for", "framework", "from", "how", "i", "in", "inside", "is", "it", "modern", "of", "on", "or", "pattern", "preferred", "should", "show", "swift", "swiftui", "the", "this", "to", "use", "using", "way", "what", "when", "with", "you", "your",
]);

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

interface SwiftDocsSearchArgs {
  query?: unknown;
  queries?: unknown;
  symbols?: unknown;
}

interface SwiftDocsSearchRequest {
  queries: string[];
  symbols: string[];
}

interface QuerySearchPlan {
  query: string;
  request: SwiftDocsHybridRequest;
}

type JsonRecord = Record<string, unknown>;

interface SearchHit {
  rank: number;
  kind: "page" | "chunk";
  path: string;
  title?: string | undefined;
  source: "symbol_lookup" | "linked_page" | "hybrid_page" | "hybrid_chunk";
  doc_id?: string | undefined;
  chunk_id?: string | undefined;
  snippet?: string | undefined;
  url?: string | undefined;
  supportCount?: number | undefined;
  supportingQueries?: string[] | undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((item): item is string => typeof item === "string"));
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

function normalizeQuery(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("swift_docs_search requires a non-empty query string");
  }
  return value.trim();
}

function normalizeQueries(query: unknown, queries: unknown): string[] {
  const normalized = uniqueStrings([
    ...(typeof query === "string" ? [normalizeQuery(query)] : []),
    ...normalizeStringArray(queries),
  ]).slice(0, 4);
  if (normalized.length === 0) {
    throw new Error("swift_docs_search requires query or queries with at least one non-empty string");
  }
  return normalized;
}

function normalizeSymbols(value: unknown): string[] {
  return normalizeStringArray(value).slice(0, 8);
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

function normalizeSimpleSearchRequest(raw: unknown): SwiftDocsSearchRequest {
  const args = (raw && typeof raw === "object" ? raw : {}) as SwiftDocsSearchArgs;
  return {
    queries: normalizeQueries(args.query, args.queries),
    symbols: normalizeSymbols(args.symbols),
  };
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

async function resolveSwiftDocsCli(repoRoot: string): Promise<string> {
  const localCli = resolve(repoRoot, ".venv/bin/swift-docs");
  return (await pathExists(localCli)) ? localCli : "swift-docs";
}

function normalizeCorpusRelativePath(path: string | null | undefined, dbPath: string): string | null {
  if (typeof path !== "string" || path.trim().length === 0) return null;
  const trimmed = path.trim().replace(/\\/g, "/");
  const corpusDirName = basename(resolve(dirname(dbPath), ".."));
  const prefix = `${corpusDirName}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function normalizeDocUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim().length === 0) return null;
  const trimmed = url.trim().replace(/[\[\]]+/g, "").replace(/\/+$/g, "");
  return trimmed.toLowerCase();
}

function extractAppleDocUrls(text: string | undefined): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const matches = text.match(/https:\/\/developer\.apple\.com\/documentation\/[A-Za-z0-9_\/.\-():\[\]]+/g) ?? [];
  return uniqueStrings(matches.map((match) => normalizeDocUrl(match) ?? undefined));
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
      const normalized = normalizeCorpusRelativePath(parsed.normalized_md_path, dbPath);
      if (normalized) index.set(parsed.doc_id, normalized);
    }
  }

  documentPathCache.set(manifestPath, index);
  return index;
}

async function loadDocumentUrlIndex(dbPath: string): Promise<Map<string, { doc_id?: string; normalized_md_path: string; title?: string; url: string }>> {
  const manifestPath = resolve(dirname(dbPath), "..", "manifest", "documents.jsonl");
  const cached = documentUrlCache.get(manifestPath);
  if (cached) return cached;

  const index = new Map<string, { doc_id?: string; normalized_md_path: string; title?: string; url: string }>();
  if (!(await pathExists(manifestPath))) {
    documentUrlCache.set(manifestPath, index);
    return index;
  }

  const content = await readFile(manifestPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as { doc_id?: unknown; normalized_md_path?: unknown; title?: unknown; url?: unknown };
    if (typeof parsed.normalized_md_path !== "string" || typeof parsed.url !== "string") continue;
    const normalizedPath = normalizeCorpusRelativePath(parsed.normalized_md_path, dbPath);
    const normalizedUrl = normalizeDocUrl(parsed.url);
    if (!normalizedPath || !normalizedUrl) continue;
    index.set(normalizedUrl, {
      ...(typeof parsed.doc_id === "string" ? { doc_id: parsed.doc_id } : {}),
      normalized_md_path: normalizedPath,
      ...(typeof parsed.title === "string" ? { title: parsed.title } : {}),
      url: parsed.url,
    });
  }

  documentUrlCache.set(manifestPath, index);
  return index;
}

function enrichHybridResult(raw: unknown, documentPaths: Map<string, string>, dbPath: string) {
  const payload = raw && typeof raw === "object" ? raw as JsonRecord : {};
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];

  const enrichedPages = pages.map((page) => {
    const item = page && typeof page === "object" ? page as JsonRecord : {};
    const docId = typeof item.doc_id === "string" ? item.doc_id : undefined;
    const normalizedPath = typeof item.normalized_md_path === "string"
      ? normalizeCorpusRelativePath(item.normalized_md_path, dbPath)
      : (docId ? documentPaths.get(docId) : undefined) ?? null;
    return {
      ...item,
      normalized_md_path: normalizedPath,
    };
  });

  const enrichedChunks = chunks.map((chunk) => {
    const item = chunk && typeof chunk === "object" ? chunk as JsonRecord : {};
    const docId = typeof item.doc_id === "string" ? item.doc_id : undefined;
    const normalizedPath = typeof item.normalized_md_path === "string"
      ? normalizeCorpusRelativePath(item.normalized_md_path, dbPath)
      : (docId ? documentPaths.get(docId) : undefined) ?? null;
    return {
      ...item,
      normalized_md_path: normalizedPath,
    };
  });

  return {
    ...payload,
    pages: enrichedPages,
    chunks: enrichedChunks,
  };
}

function enrichLookupResults(raw: unknown, documentPaths: Map<string, string>, dbPath: string): JsonRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const record = item && typeof item === "object" ? item as JsonRecord : {};
    const docId = typeof record.doc_id === "string" ? record.doc_id : undefined;
    const normalizedPath = typeof record.normalized_md_path === "string"
      ? normalizeCorpusRelativePath(record.normalized_md_path, dbPath)
      : (docId ? documentPaths.get(docId) : undefined) ?? null;
    return {
      ...record,
      normalized_md_path: normalizedPath,
    };
  });
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

async function runSwiftDocsJsonCommand(config: SwiftDocsToolConfig, commandArgs: string[], signal?: AbortSignal): Promise<unknown> {
  const env = {
    ...process.env,
    ...loadProjectEnvVars(REPO_ROOT),
    ...loadProjectEnvVars(config.repoRoot),
  };
  const cli = await resolveSwiftDocsCli(config.repoRoot);
  const { stdout } = await execFileText(
    cli,
    commandArgs,
    signal ? { cwd: config.repoRoot, env, signal } : { cwd: config.repoRoot, env },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`swift-docs returned invalid JSON: ${message}`);
  }
}

function extractInformativeTokens(query: string): string[] {
  const tokens = query.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? [];
  return tokens.filter((token) => {
    const normalized = token.toLowerCase();
    return normalized.length >= 3 && !QUERY_STOPWORDS.has(normalized);
  });
}

function deriveQueryTerms(query: string): string[] {
  const filtered = extractInformativeTokens(query);
  const terms = uniqueStrings(filtered).slice(0, 6);
  const lowered = query.toLowerCase();
  if ((lowered.includes("async") || lowered.includes("await")) && /(delay|sleep|wait)/.test(lowered)) {
    return uniqueStrings(["try await", ...terms]).slice(0, 6);
  }
  return terms;
}

function deriveQueryPhrases(query: string): string[] {
  const tokens = extractInformativeTokens(query).map((token) => token.toLowerCase());
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  for (let i = 0; i < tokens.length - 2; i += 1) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return uniqueStrings(phrases).slice(0, 4);
}

function normalizeLookupTerm(symbol: string): string {
  const slashTrimmed = symbol.includes("/") ? symbol.split("/").pop() ?? symbol : symbol;
  return slashTrimmed.trim();
}

function stripSymbolSignature(symbol: string): string {
  const lookup = normalizeLookupTerm(symbol)
    .replace(/\([^)]*\)/g, "")
    .replace(/^.*[/.]/, "")
    .trim();
  return lookup;
}

function deriveSymbolTerms(symbol: string): string[] {
  const lookup = normalizeLookupTerm(symbol);
  const base = stripSymbolSignature(symbol);
  const literal = base.replace(/[._:]+/g, " ").replace(/\s+/g, " ").trim();
  return uniqueStrings([lookup, base, literal]);
}

function buildSimpleHybridRequest(query: string, symbols: string[]): SwiftDocsHybridRequest {
  const lowered = query.toLowerCase();
  const asyncDelayHeuristic = (lowered.includes("async") || lowered.includes("await")) && /(delay|sleep|wait)/.test(lowered);
  const heuristicSymbols = asyncDelayHeuristic ? ["Task.sleep"] : [];
  const allSymbols = uniqueStrings([...symbols, ...heuristicSymbols]);
  const symbolTerms = allSymbols.flatMap(deriveSymbolTerms);
  const phraseTerms = deriveQueryPhrases(query);
  const terms = uniqueStrings([...symbolTerms, ...phraseTerms, ...deriveQueryTerms(query)]).slice(0, 8);
  const docTerms = uniqueStrings(allSymbols.flatMap((symbol) => {
    const lookup = normalizeLookupTerm(symbol);
    const base = stripSymbolSignature(symbol);
    return [lookup, base];
  })).slice(0, 6);
  const semanticQueries = uniqueStrings([
    query,
    `recommended modern API or pattern for ${query}`,
    ...(phraseTerms.length > 0 ? [`documentation guidance for ${phraseTerms.join(' ; ')}`] : []),
    ...(allSymbols.length > 0 ? [`${allSymbols.join(' ')} ${query}`] : []),
    ...(asyncDelayHeuristic ? ["wait before continuing in async code with Task.sleep"] : []),
  ]).slice(0, 4);

  return {
    terms: terms.length > 0 ? terms : [query],
    doc_terms: docTerms,
    semantic_queries: semanticQueries,
    ...SIMPLE_SEARCH_DEFAULTS,
  };
}

function buildSimpleHybridPlans(request: SwiftDocsSearchRequest): QuerySearchPlan[] {
  return request.queries.map((query) => ({
    query,
    request: buildSimpleHybridRequest(query, request.symbols),
  }));
}

function toLowercaseKeywordSet(values: string[]): string[] {
  return uniqueStrings(values.map((value) => normalizeComparable(value)).filter((value) => value.length > 0));
}

function countKeywordOverlaps(haystack: string, keywords: string[]): number {
  const normalizedHaystack = normalizeComparable(haystack);
  return keywords.reduce((count, keyword) => count + (normalizedHaystack.includes(keyword) ? 1 : 0), 0);
}

function collectCombinedPages(symbolResults: JsonRecord[], hybridResult: JsonRecord): JsonRecord[] {
  const pages = Array.isArray(hybridResult.pages) ? hybridResult.pages : [];
  const byKey = new Map<string, JsonRecord>();

  const pushPage = (record: JsonRecord, source: string) => {
    const docId = typeof record.doc_id === "string" ? record.doc_id : undefined;
    const path = typeof record.normalized_md_path === "string" ? record.normalized_md_path : undefined;
    const key = path ?? docId ?? JSON.stringify(record);
    const existing = byKey.get(key);
    const existingSources = Array.isArray(existing?.sources) ? existing.sources.filter((item): item is string => typeof item === "string") : [];
    const recordSources = Array.isArray(record.sources) ? record.sources.filter((item): item is string => typeof item === "string") : [];
    const existingQueries = Array.isArray(existing?.query_support) ? existing.query_support.filter((item): item is string => typeof item === "string") : [];
    const recordQueries = Array.isArray(record.query_support) ? record.query_support.filter((item): item is string => typeof item === "string") : [];
    byKey.set(key, {
      ...existing,
      ...record,
      ...(uniqueStrings([...existingSources, ...recordSources, source]).length > 0 ? { sources: uniqueStrings([...existingSources, ...recordSources, source]) } : {}),
      ...(uniqueStrings([...existingQueries, ...recordQueries]).length > 0 ? { query_support: uniqueStrings([...existingQueries, ...recordQueries]) } : {}),
    });
  };

  symbolResults.forEach((result) => pushPage(result, "symbol_lookup"));
  pages.filter((page): page is JsonRecord => Boolean(page) && typeof page === "object").forEach((page) => pushPage(page, "hybrid"));
  return Array.from(byKey.values());
}

function mergeSearchRecords(records: JsonRecord[], buildKey: (record: JsonRecord) => string): JsonRecord[] {
  const byKey = new Map<string, JsonRecord>();

  for (const record of records) {
    const key = buildKey(record);
    const existing = byKey.get(key);
    const existingSources = Array.isArray(existing?.sources) ? existing.sources.filter((item): item is string => typeof item === "string") : [];
    const recordSources = Array.isArray(record.sources) ? record.sources.filter((item): item is string => typeof item === "string") : [];
    const existingQueries = Array.isArray(existing?.query_support) ? existing.query_support.filter((item): item is string => typeof item === "string") : [];
    const recordQueries = Array.isArray(record.query_support) ? record.query_support.filter((item): item is string => typeof item === "string") : [];
    byKey.set(key, {
      ...existing,
      ...record,
      ...(uniqueStrings([...existingSources, ...recordSources]).length > 0 ? { sources: uniqueStrings([...existingSources, ...recordSources]) } : {}),
      ...(uniqueStrings([...existingQueries, ...recordQueries]).length > 0 ? { query_support: uniqueStrings([...existingQueries, ...recordQueries]) } : {}),
    });
  }

  return Array.from(byKey.values());
}

function mergeHybridResults(results: Array<{ query: string; result: JsonRecord }>): JsonRecord {
  const pages = mergeSearchRecords(
    results.flatMap(({ query, result }) => (Array.isArray(result.pages) ? result.pages : [])
      .filter((item): item is JsonRecord => Boolean(item) && typeof item === "object")
      .map((item) => ({
        ...item,
        query_support: uniqueStrings([
          ...(Array.isArray(item.query_support) ? item.query_support.filter((value): value is string => typeof value === "string") : []),
          query,
        ]),
      }))),
    (record) => {
      const path = typeof record.normalized_md_path === "string" ? record.normalized_md_path : undefined;
      const docId = typeof record.doc_id === "string" ? record.doc_id : undefined;
      return path ?? docId ?? JSON.stringify(record);
    },
  );

  const chunks = mergeSearchRecords(
    results.flatMap(({ query, result }) => (Array.isArray(result.chunks) ? result.chunks : [])
      .filter((item): item is JsonRecord => Boolean(item) && typeof item === "object")
      .map((item) => ({
        ...item,
        query_support: uniqueStrings([
          ...(Array.isArray(item.query_support) ? item.query_support.filter((value): value is string => typeof value === "string") : []),
          query,
        ]),
      }))),
    (record) => {
      const chunkId = typeof record.chunk_id === "string" ? record.chunk_id : undefined;
      const path = typeof record.normalized_md_path === "string" ? record.normalized_md_path : undefined;
      const snippet = typeof record.snippet === "string" ? record.snippet : undefined;
      return chunkId ?? `${path ?? "chunk"}::${snippet ?? JSON.stringify(record)}`;
    },
  );

  return { pages, chunks };
}

function collectLinkedPagesFromSnippets(hybridResult: JsonRecord, documentUrlIndex: Map<string, { doc_id?: string; normalized_md_path: string; title?: string; url: string }>): JsonRecord[] {
  const linkedPagesByPath = new Map<string, JsonRecord>();
  const records = [
    ...(Array.isArray(hybridResult.pages) ? hybridResult.pages : []),
    ...(Array.isArray(hybridResult.chunks) ? hybridResult.chunks : []),
  ].filter((item): item is JsonRecord => Boolean(item) && typeof item === "object");

  for (const record of records) {
    const snippet = typeof record.snippet === "string" ? record.snippet : undefined;
    const supportingQueries = Array.isArray(record.query_support) ? record.query_support.filter((item): item is string => typeof item === "string") : [];
    for (const url of extractAppleDocUrls(snippet)) {
      const linked = documentUrlIndex.get(url);
      if (!linked) continue;
      const existing = linkedPagesByPath.get(linked.normalized_md_path);
      const existingQueries = Array.isArray(existing?.query_support) ? existing.query_support.filter((item): item is string => typeof item === "string") : [];
      linkedPagesByPath.set(linked.normalized_md_path, {
        ...existing,
        ...(linked.doc_id ? { doc_id: linked.doc_id } : {}),
        normalized_md_path: linked.normalized_md_path,
        ...(linked.title ? { title: linked.title } : {}),
        url: linked.url,
        sources: ["snippet_link"],
        ...(uniqueStrings([...existingQueries, ...supportingQueries]).length > 0 ? { query_support: uniqueStrings([...existingQueries, ...supportingQueries]) } : {}),
      });
    }
  }

  return Array.from(linkedPagesByPath.values());
}

function rankSearchHits(params: {
  queries: string[];
  symbols: string[];
  symbolResults: JsonRecord[];
  linkedPageResults: JsonRecord[];
  hybridResult: JsonRecord;
}): { hits: SearchHit[]; recommendedReads: Array<{ rank: number; path: string; title?: string | undefined; source: SearchHit["source"]; snippet?: string | undefined; supportCount?: number | undefined; supportingQueries?: string[] | undefined }>; pages: JsonRecord[]; chunks: JsonRecord[] } {
  const pages = collectCombinedPages([...params.symbolResults, ...params.linkedPageResults], params.hybridResult);
  const chunks = (Array.isArray(params.hybridResult.chunks) ? params.hybridResult.chunks : [])
    .filter((chunk): chunk is JsonRecord => Boolean(chunk) && typeof chunk === "object");

  const queryKeywords = toLowercaseKeywordSet(params.queries.flatMap((query) => [...deriveQueryTerms(query), ...deriveQueryPhrases(query)]));
  const symbolKeywords = toLowercaseKeywordSet(params.symbols.flatMap(deriveSymbolTerms));
  const queryKeywordCount = queryKeywords.length;
  const hitsByKey = new Map<string, Omit<SearchHit, "rank"> & { _score: number }>();

  const pushHit = (candidate: Omit<SearchHit, "rank">) => {
    const path = candidate.path.trim();
    if (!path) return;
    const supportingQueries = uniqueStrings(candidate.supportingQueries ?? []);
    const supportCount = Math.max(supportingQueries.length, 1);
    const haystack = [candidate.title, candidate.snippet, candidate.path, candidate.url].filter((value): value is string => typeof value === "string").join(" ");
    const normalizedHaystack = normalizeComparable(haystack);
    const titleTokens = normalizeComparable(candidate.title ?? "").split(" ").filter(Boolean);
    const titleOverlap = countKeywordOverlaps(candidate.title ?? "", queryKeywords);
    const overlap = countKeywordOverlaps(haystack, queryKeywords);
    const symbolOverlap = countKeywordOverlaps(haystack, symbolKeywords);
    const pathDepth = path.split("/").length;
    let score = candidate.source === "symbol_lookup"
      ? 300
      : candidate.source === "linked_page"
        ? 255
        : candidate.kind === "page"
          ? 165
          : 170;
    if (candidate.path.startsWith("pages/documentation/")) score += 40;
    if (candidate.path === "pages/documentation/swiftui.md") score -= 80;
    if (candidate.path.startsWith("raw/") || candidate.path.startsWith("manifest/")) score -= 120;
    score += overlap * 10;
    score += titleOverlap * 18;
    score += symbolOverlap * 16;
    score += Math.min(pathDepth, 8) * 2;
    if (/\(|\)|:/.test(path)) score += 18;
    if (candidate.source === "linked_page") score += 10;
    if (overlap >= 2) score += 25;
    if (supportCount > 1) score += 24 + ((supportCount - 2) * 10);
    if (titleTokens.length <= 1 && overlap <= 1 && queryKeywordCount >= 4 && candidate.source !== "symbol_lookup") score -= 75;
    if (/collectiongroup|framework/.test(normalizedHaystack)) score -= 20;
    score -= candidate.path.length / 100;

    const key = candidate.kind === "chunk"
      ? `chunk:${candidate.chunk_id ?? candidate.path}`
      : `page:${candidate.path}`;
    const existing = hitsByKey.get(key);
    const mergedSupportingQueries = uniqueStrings([...(existing?.supportingQueries ?? []), ...supportingQueries]);
    const next = {
      ...existing,
      ...candidate,
      path,
      supportingQueries: mergedSupportingQueries.length > 0 ? mergedSupportingQueries : undefined,
      supportCount: Math.max(mergedSupportingQueries.length, supportCount),
      _score: Math.max(existing?._score ?? Number.NEGATIVE_INFINITY, score + (mergedSupportingQueries.length > supportCount ? (mergedSupportingQueries.length - supportCount) * 10 : 0)),
    };
    hitsByKey.set(key, next);
  };

  params.symbolResults.forEach((item) => {
    const path = typeof item.normalized_md_path === "string" ? item.normalized_md_path : undefined;
    if (!path) return;
    pushHit({
      kind: "page",
      path,
      title: typeof item.title === "string" ? item.title : undefined,
      source: "symbol_lookup",
      doc_id: typeof item.doc_id === "string" ? item.doc_id : undefined,
      snippet: typeof item.snippet === "string" ? item.snippet : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      supportingQueries: Array.isArray(item.query_support) ? item.query_support.filter((query): query is string => typeof query === "string") : undefined,
    });
  });

  params.linkedPageResults.forEach((item) => {
    const path = typeof item.normalized_md_path === "string" ? item.normalized_md_path : undefined;
    if (!path) return;
    pushHit({
      kind: "page",
      path,
      title: typeof item.title === "string" ? item.title : undefined,
      source: "linked_page",
      doc_id: typeof item.doc_id === "string" ? item.doc_id : undefined,
      snippet: typeof item.snippet === "string" ? item.snippet : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      supportingQueries: Array.isArray(item.query_support) ? item.query_support.filter((query): query is string => typeof query === "string") : undefined,
    });
  });

  pages.forEach((item) => {
    const path = typeof item.normalized_md_path === "string" ? item.normalized_md_path : undefined;
    if (!path) return;
    pushHit({
      kind: "page",
      path,
      title: typeof item.title === "string" ? item.title : undefined,
      source: Array.isArray(item.sources) && item.sources.includes("symbol_lookup")
        ? "symbol_lookup"
        : Array.isArray(item.sources) && item.sources.includes("snippet_link")
          ? "linked_page"
          : "hybrid_page",
      doc_id: typeof item.doc_id === "string" ? item.doc_id : undefined,
      snippet: typeof item.snippet === "string" ? item.snippet : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      supportingQueries: Array.isArray(item.query_support) ? item.query_support.filter((query): query is string => typeof query === "string") : undefined,
    });
  });

  chunks.forEach((item) => {
    const path = typeof item.normalized_md_path === "string" ? item.normalized_md_path : undefined;
    if (!path) return;
    pushHit({
      kind: "chunk",
      path,
      title: typeof item.title === "string" ? item.title : undefined,
      source: "hybrid_chunk",
      doc_id: typeof item.doc_id === "string" ? item.doc_id : undefined,
      chunk_id: typeof item.chunk_id === "string" ? item.chunk_id : undefined,
      snippet: typeof item.snippet === "string" ? item.snippet : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      supportingQueries: Array.isArray(item.query_support) ? item.query_support.filter((query): query is string => typeof query === "string") : undefined,
    });
  });

  const hits = Array.from(hitsByKey.values())
    .sort((a, b) => b._score - a._score)
    .slice(0, 12)
    .map(({ _score: _ignored, ...hit }, index) => ({ ...hit, rank: index + 1 }));

  const recommendedReads: Array<{ rank: number; path: string; title?: string | undefined; source: SearchHit["source"]; snippet?: string | undefined; supportCount?: number | undefined; supportingQueries?: string[] | undefined }> = [];
  const seenReadPaths = new Set<string>();
  for (const hit of hits) {
    if (seenReadPaths.has(hit.path)) continue;
    seenReadPaths.add(hit.path);
    recommendedReads.push({
      rank: recommendedReads.length + 1,
      path: hit.path,
      title: hit.title,
      source: hit.source,
      ...(hit.snippet ? { snippet: hit.snippet } : {}),
      ...(hit.supportCount && hit.supportCount > 1 ? { supportCount: hit.supportCount } : {}),
      ...(hit.supportingQueries && hit.supportingQueries.length > 1 ? { supportingQueries: hit.supportingQueries } : {}),
    });
    if (recommendedReads.length >= 6) break;
  }

  return { hits, recommendedReads, pages, chunks };
}

async function runHybridSearch(config: SwiftDocsToolConfig, request: SwiftDocsHybridRequest, signal?: AbortSignal): Promise<JsonRecord> {
  const tempDir = await mkdtemp(join(tmpdir(), "swift-docs-search-"));
  const requestPath = join(tempDir, "request.yaml");

  try {
    await writeFile(requestPath, stringifyYaml(request), "utf8");
    const args = ["search-hybrid", "--request-file", requestPath, "--db", config.dbPath];
    if (config.configPath) args.push("--config", config.configPath);
    const parsed = await runSwiftDocsJsonCommand(config, args, signal);
    return (parsed && typeof parsed === "object" ? parsed : {}) as JsonRecord;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runLookupSymbol(config: SwiftDocsToolConfig, symbol: string, signal?: AbortSignal): Promise<unknown> {
  const args = ["lookup-symbol", symbol, "--db", config.dbPath, "--limit", "5"];
  if (config.configPath) args.push("--config", config.configPath);
  args.push("--all-platforms");
  return runSwiftDocsJsonCommand(config, args, signal);
}

async function runSearchChunks(config: SwiftDocsToolConfig, query: string, signal?: AbortSignal): Promise<unknown> {
  const args = ["search-chunks", query, "--db", config.dbPath, "--limit", "4"];
  if (config.configPath) args.push("--config", config.configPath);
  args.push("--all-platforms");
  return runSwiftDocsJsonCommand(config, args, signal);
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
      try {
        const parsed = await runHybridSearch(config, request, signal);
        const documentPaths = await loadDocumentPathIndex(config.dbPath);
        const enriched = enrichHybridResult(parsed, documentPaths, config.dbPath);
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
      }
    },
  };
}

export function createSwiftDocsSearchTool(config: SwiftDocsToolConfig) {
  return {
    name: "swift_docs_search",
    description: "Search the Swift Docs corpus and return the best files to read next. You can provide one query or a small set of query variants in `queries`; the tool runs them in parallel, unifies the results, and returns the best files to read next. Use this first, then call read on the returned recommendedReads paths before you finalize or cite anything.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A single natural-language query for what you are trying to answer." },
        queries: { type: "array", items: { type: "string" }, description: "Optional 2-4 concise query variants when you want broader coverage in one parallel search call." },
        symbols: { type: "array", items: { type: "string" }, description: "Optional exact API or symbol hints to bias retrieval toward the right docs." },
      },
      anyOf: [
        { required: ["query"] },
        { required: ["queries"] },
      ],
      additionalProperties: false,
    },
    prepareArguments: normalizeSimpleSearchRequest,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const request = normalizeSimpleSearchRequest(params);
      try {
        const hybridPlans = buildSimpleHybridPlans(request);
        const [documentPaths, documentUrlIndex] = await Promise.all([
          loadDocumentPathIndex(config.dbPath),
          loadDocumentUrlIndex(config.dbPath),
        ]);
        const lookupCandidates = uniqueStrings(request.symbols.flatMap((symbol) => {
          const lookup = normalizeLookupTerm(symbol);
          const base = stripSymbolSignature(symbol);
          return [lookup, base];
        }));
        const lookupResponses = await Promise.all(lookupCandidates.map(async (symbol) => ({
          symbol,
          result: await runLookupSymbol(config, symbol, signal).catch(() => []),
        })));
        const symbolResults = enrichLookupResults(lookupResponses.flatMap((response) => response.result), documentPaths, config.dbPath);
        const fallbackChunkQueries = uniqueStrings(lookupResponses
          .filter((response) => !Array.isArray(response.result) || response.result.length === 0)
          .map((response) => deriveSymbolTerms(response.symbol).find((term) => term.includes(" ")) ?? response.symbol.replace(/[._:]+/g, " ").trim()));
        const fallbackChunkResults = enrichLookupResults(
          (await Promise.all(fallbackChunkQueries.map((query) => runSearchChunks(config, query, signal).catch(() => [])))).flat(),
          documentPaths,
          config.dbPath,
        );
        const hybridResults = await Promise.all(hybridPlans.map(async (plan) => ({
          query: plan.query,
          result: enrichHybridResult(await runHybridSearch(config, plan.request, signal), documentPaths, config.dbPath),
        })));
        const mergedHybridResult = mergeHybridResults(hybridResults);
        const hybridChunks = Array.isArray(mergedHybridResult.chunks) ? mergedHybridResult.chunks.filter((chunk) => Boolean(chunk) && typeof chunk === "object") as JsonRecord[] : [];
        const mergedHybridWithFallbacks = {
          ...mergedHybridResult,
          chunks: [...fallbackChunkResults, ...hybridChunks],
        };
        const linkedPageResults = collectLinkedPagesFromSnippets(mergedHybridWithFallbacks, documentUrlIndex);
        const ranked = rankSearchHits({
          queries: request.queries,
          symbols: request.symbols,
          symbolResults,
          linkedPageResults,
          hybridResult: mergedHybridWithFallbacks,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                query: request.queries[0],
                queries: request.queries,
                symbols: request.symbols,
                queryPlans: hybridPlans.map((plan) => ({
                  query: plan.query,
                  terms: plan.request.terms,
                  doc_terms: plan.request.doc_terms,
                  semantic_queries: plan.request.semantic_queries,
                })),
                recommendedReads: ranked.recommendedReads,
                hits: ranked.hits,
                pages: ranked.pages,
                chunks: ranked.chunks,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`swift_docs_search failed: ${message}`);
      }
    },
  };
}
