import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSwiftDocsSearchTool } from "../../src/pipeline/collect/swift-docs-tool.js";
import { runLlmClient } from "../../src/llm/llm-client.js";
import { loadBenchmarkConfigWithMeta, parseModelRefFromString } from "../../src/core/config.js";
import { loadProjectEnvVars } from "../../src/llm/env-api-keys.js";
import { readJsonFile } from "../../src/core/io.js";
import { resolveModelApiKey } from "../../src/llm/api-key.js";
import type { DatasetQuestion, ModelRef } from "../../src/core/contracts.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "../..");

type SearchRequest = { query?: string; queries?: string[]; symbols?: string[] };

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

function extractJsonObject(text: string | undefined): any {
  if (!text) return {};
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  return {};
}

function resultText(result: any): string {
  return result.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") ?? "";
}

function compactSearch(raw: any): any {
  const trim = (items: any[], limit: number) => (Array.isArray(items) ? items.slice(0, limit) : []).map((x: any) => ({
    rank: x.rank,
    path: x.path ?? x.normalized_md_path,
    title: x.title,
    source: x.source,
    snippet: typeof x.snippet === "string" ? x.snippet.slice(0, 900) : undefined,
  }));
  return {
    query: raw.query,
    queries: raw.queries,
    symbols: raw.symbols,
    recommendedReads: trim(raw.recommendedReads, 8),
    hits: trim(raw.hits, 14),
  };
}

function uniquePaths(items: Array<{ path?: string }>): string[] {
  return [...new Set(items.map((item) => item.path).filter((path): path is string => typeof path === "string" && path.length > 0))];
}

function rerankPathsFromSearch(searches: any[]): string[] {
  const byPath = new Map<string, { path: string; score: number }>();
  const add = (item: any, base: number) => {
    const path = item?.path;
    if (typeof path !== "string" || path.length === 0) return;
    const text = `${path} ${item.title ?? ""} ${item.snippet ?? ""}`.toLowerCase();
    let score = base;
    if (path.startsWith("pages/documentation/swiftui/")) score += 20;
    if (path.includes("/view/") || /\([^)]*\)/.test(path)) score += 8;
    if (text.includes("deprecated") || text.includes("use ") && text.includes(" instead")) score += 18;
    if (text.includes("accessibility") || text.includes("voiceover")) score += 10;
    if (path.includes("sample") || path.includes("building-") || path.includes("tutorial")) score -= 12;
    score -= path.length / 200;
    const existing = byPath.get(path);
    byPath.set(path, { path, score: Math.max(existing?.score ?? Number.NEGATIVE_INFINITY, score) });
  };
  for (const search of searches) {
    (search.recommendedReads ?? []).forEach((item: any, index: number) => add(item, 100 - index * 3));
    (search.hits ?? []).forEach((item: any, index: number) => add(item, 75 - index * 2));
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score).map((x) => x.path);
}

async function llm(model: ModelRef, apiKey: string | undefined, transport: any, system: string, user: string) {
  return runLlmClient({ model, transport, messages: [{ role: "system", content: system }, { role: "user", content: user }], tools: [], apiKey });
}

async function readCorpusFile(corpusRoot: string, path: string): Promise<{ path: string; text: string; error?: string }> {
  const safe = path.replace(/^\/+/, "");
  try {
    const text = await readFile(join(corpusRoot, safe), "utf8");
    return { path: safe, text: text.slice(0, 12000) };
  } catch (error) {
    return { path: safe, text: "", error: error instanceof Error ? error.message : String(error) };
  }
}

async function runOne(model: ModelRef, apiKey: string | undefined, transport: any, q: DatasetQuestion, searchTool: any, corpusRoot: string, outDir: string) {
  const queryPrompt = `Generate a Swift Docs search request for this user question. Return ONLY JSON with keys: queries (2-4 concise search queries) and optional symbols (API names). Do not answer.\n\nQuestion: ${q.question}`;
  const queryResp = await llm(model, apiKey, transport, "You generate high-recall documentation search queries using only the user's question.", queryPrompt);
  const request: SearchRequest = extractJsonObject(queryResp.finalText);
  if (!Array.isArray(request.queries) && !request.query) request.queries = [q.question];

  const searchResult = await searchTool.execute("spoonfeed-search", request, undefined);
  const searchRaw = JSON.parse(resultText(searchResult));
  const search = compactSearch(searchRaw);
  const searches = [search];

  const refinePrompt = `User question:\n${q.question}\n\nSearch request used:\n${JSON.stringify(request, null, 2)}\n\nSearch results:\n${JSON.stringify(search, null, 2)}\n\nDo these results contain enough directly relevant documentation to answer? If not, propose ONE refined Swift Docs search request. Return ONLY JSON: {"enough":true} or {"enough":false,"query":"...","symbols":["..."]}. Use only the user question and the search results above.`;
  const refineResp = await llm(model, apiKey, transport, "You decide whether retrieved documentation is sufficient and refine searches when needed.", refinePrompt);
  const refine = extractJsonObject(refineResp.finalText);
  let refinedSearch: any | undefined;
  if (refine?.enough === false && typeof refine.query === "string" && refine.query.trim()) {
    const refinedRequest: SearchRequest = { query: refine.query, symbols: Array.isArray(refine.symbols) ? refine.symbols.filter((x: unknown): x is string => typeof x === "string") : undefined };
    const refinedResult = await searchTool.execute("spoonfeed-refine-search", refinedRequest, undefined);
    refinedSearch = compactSearch(JSON.parse(resultText(refinedResult)));
    searches.push(refinedSearch);
  }

  const readPrompt = `Question: ${q.question}\n\nSearch results:\n${JSON.stringify(searches, null, 2)}\n\nWhich files do you want to inspect before answering? Return ONLY JSON: {"paths":["path1","path2"]}. Pick 1-3 paths from recommendedReads/hits. Prefer canonical pages that directly answer the question.`;
  const readResp = await llm(model, apiKey, transport, "You choose the smallest set of documentation files needed to answer.", readPrompt);
  const chosen = extractJsonObject(readResp.finalText).paths;
  const modelPaths = Array.isArray(chosen) ? chosen.filter((x: unknown): x is string => typeof x === "string") : [];
  const autoPaths = rerankPathsFromSearch(searches).slice(0, 3);
  const paths = [...new Set([...modelPaths.slice(0, 2), ...autoPaths])].slice(0, 4);
  const docs = await Promise.all(paths.map((p: string) => readCorpusFile(corpusRoot, p)));

  const finalPrompt = `Answer the SwiftUI question using the retrieved documentation below. Answer what the user should do, not merely what is possible. If the docs show a newer replacement, deprecation, or accessibility requirement, make that primary. Be concise and actionable.\n\nQuestion: ${q.question}\n\nRetrieved docs:\n${docs.map((d) => `\n--- FILE: ${d.path}${d.error ? ` ERROR: ${d.error}` : ""} ---\n${d.text}`).join("\n")}`;
  const finalResp = await llm(model, apiKey, transport, "You answer from provided documentation context. Do not call tools.", finalPrompt);

  const artifact = { question: { id: q.id, question: q.question }, queryResponse: queryResp.finalText, request, search, refineResponse: refineResp.finalText, refinedSearch, readChoiceResponse: readResp.finalText, paths, docs, answer: finalResp.finalText, usage: { query: queryResp.usage, refine: refineResp.usage, readChoice: readResp.usage, final: finalResp.usage }, errors: { query: queryResp.error, refine: refineResp.error, readChoice: readResp.error, final: finalResp.error } };
  await writeFile(join(outDir, `${model.modelId.replace(/[^a-z0-9._-]+/gi, "-")}--${q.id}.json`), JSON.stringify(artifact, null, 2));
  console.log(`\n## ${model.modelId} / ${q.id}`);
  console.log(`request: ${JSON.stringify(request)}`);
  console.log(`top: ${(search.recommendedReads ?? []).slice(0, 4).map((x: any) => x.path).join(", ")}`);
  console.log(`read: ${paths.join(", ")}`);
  console.log((finalResp.finalText ?? "<no answer>").slice(0, 1000));
}

async function main() {
  loadProjectEnvVars();
  const models = csv(arg("models") ?? arg("model") ?? "openrouter/google/gemma-4-26b-a4b-it,openrouter/x-ai/grok-4.1-fast").map(parseModelRefFromString);
  const qids = csv(arg("question") ?? "q06-differently-styled-text-on-one-line,q07-rounding-corners-on-a-container,q16-empty-search-state,q58-swiftdata-relationships-with-cloudkit,q63-menu-with-only-an-icon-label");
  const runId = arg("run-id") ?? "spoonfeed-rag-smoke";
  const { config } = await loadBenchmarkConfigWithMeta();
  if (!config.swiftDocs) throw new Error("Missing swiftDocs config.");
  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(config.paths.dataset);
  const questions = dataset.questions.filter((q) => qids.includes(q.id));
  const searchTool = createSwiftDocsSearchTool(config.swiftDocs);
  const corpusRoot = resolve(REPO_ROOT, config.corpus.rootDir);
  const outDir = resolve(REPO_ROOT, "benchmark-results", runId);
  await mkdir(outDir, { recursive: true });
  for (const model of models) {
    const apiKey = await resolveModelApiKey(model);
    for (const q of questions) await runOne(model, apiKey, config.transport, q, searchTool, corpusRoot, outDir);
  }
  console.log(`\nWrote ${outDir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
