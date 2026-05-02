import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CollectRunInput, ModelRef, ToolInvocationTrace, TraceEventRecord } from "../../core/contracts.js";
import type { JsonValue } from "../../core/json.js";
import { runLlmClient, type LlmClientResult } from "../../llm/llm-client.js";
import { resolveModelApiKey } from "../../llm/api-key.js";
import { createSwiftDocsSearchTool } from "./swift-docs-tool.js";

interface SpoonfedRagResult {
  finalResult: LlmClientResult;
  toolInvocations: ToolInvocationTrace[];
  events: TraceEventRecord[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number };
  costUsd?: number;
  prompt: string;
}

type SearchRequest = { query?: string; queries?: string[]; symbols?: string[] };

function extractJsonObject(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>; } catch { /* fall through */ }
  }
  return {};
}

function resultText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n") ?? "";
}

function compactSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const trim = (value: unknown, limit: number) => (Array.isArray(value) ? value.slice(0, limit) : []).map((item) => {
    if (!item || typeof item !== "object") return item;
    const x = item as Record<string, unknown>;
    const snippet = typeof x.snippet === "string" ? x.snippet.slice(0, 900) : undefined;
    return {
      rank: x.rank,
      path: x.path ?? x.normalized_md_path,
      title: x.title,
      source: x.source,
      ...(snippet ? { snippet } : {}),
    };
  });
  return {
    query: raw.query,
    queries: raw.queries,
    symbols: raw.symbols,
    recommendedReads: trim(raw.recommendedReads, 8),
    hits: trim(raw.hits, 14),
  };
}

function rerankPathsFromSearch(searches: Record<string, unknown>[]): string[] {
  const byPath = new Map<string, { path: string; score: number }>();
  const add = (item: unknown, base: number) => {
    if (!item || typeof item !== "object") return;
    const x = item as Record<string, unknown>;
    const path = x.path;
    if (typeof path !== "string" || path.length === 0) return;
    const text = `${path} ${x.title ?? ""} ${x.snippet ?? ""}`.toLowerCase();
    let score = base;
    if (path.startsWith("pages/documentation/swiftui/")) score += 20;
    if (path.includes("/view/") || /\([^)]*\)/.test(path)) score += 8;
    if (text.includes("deprecated") || (text.includes("use ") && text.includes(" instead"))) score += 18;
    if (text.includes("accessibility") || text.includes("voiceover")) score += 10;
    if (path.includes("sample") || path.includes("building-") || path.includes("tutorial")) score -= 12;
    score -= path.length / 200;
    const existing = byPath.get(path);
    byPath.set(path, { path, score: Math.max(existing?.score ?? Number.NEGATIVE_INFINITY, score) });
  };
  for (const search of searches) {
    const recommendedReads = search.recommendedReads;
    const hits = search.hits;
    if (Array.isArray(recommendedReads)) recommendedReads.forEach((item, index) => add(item, 100 - index * 3));
    if (Array.isArray(hits)) hits.forEach((item, index) => add(item, 75 - index * 2));
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score).map((item) => item.path);
}

async function readCorpusFile(corpusRoot: string, path: string): Promise<{ path: string; text: string; error?: string }> {
  const safe = path.replace(/^\/+/, "");
  try {
    return { path: safe, text: (await readFile(join(corpusRoot, safe), "utf8")).slice(0, 12000) };
  } catch (error) {
    return { path: safe, text: "", error: error instanceof Error ? error.message : String(error) };
  }
}

function addUsage(total: SpoonfedRagResult["usage"], result: LlmClientResult): void {
  const usage = result.usage;
  if (!usage || typeof usage !== "object") return;
  const u = usage as Record<string, unknown>;
  total.promptTokens += typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  total.completionTokens += typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
  total.totalTokens += typeof u.total_tokens === "number" ? u.total_tokens : 0;
  if (typeof u.cost === "number") total.cost = (total.cost ?? 0) + u.cost;
}

async function callModel(input: CollectRunInput, model: ModelRef, apiKey: string | undefined, system: string, user: string): Promise<LlmClientResult> {
  return runLlmClient({
    model,
    transport: input.transport,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    tools: [],
    apiKey,
  });
}

export async function runSpoonfedRagCollect(input: CollectRunInput, corpusRoot: string): Promise<SpoonfedRagResult> {
  if (!input.swiftDocs) throw new Error("spoonfed_rag requires swiftDocs config.");
  const apiKey = await resolveModelApiKey(input.model);
  const events: TraceEventRecord[] = [];
  const toolInvocations: ToolInvocationTrace[] = [];
  const usage: SpoonfedRagResult["usage"] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const question = input.question.question;
  const queryPrompt = `Generate a Swift Docs search request for this user question. Return ONLY JSON with keys: queries (2-4 concise search queries) and optional symbols (API names). Do not answer.\n\nQuestion: ${question}`;
  const queryResult = await callModel(input, input.model, apiKey, "You generate high-recall documentation search queries using only the user's question.", queryPrompt);
  events.push(...queryResult.events); addUsage(usage, queryResult);
  const request = extractJsonObject(queryResult.finalText) as SearchRequest;
  if (!Array.isArray(request.queries) && !request.query) request.queries = [question];

  const searchTool = createSwiftDocsSearchTool(input.swiftDocs);
  const runSearch = async (toolCallId: string, params: SearchRequest): Promise<Record<string, unknown>> => {
    const invocation: ToolInvocationTrace = { toolCallId, toolName: "swift_docs_search", args: params as JsonValue, startedAt: new Date().toISOString(), updates: [] };
    toolInvocations.push(invocation);
    const result = await searchTool.execute(toolCallId, params, undefined);
    invocation.finishedAt = new Date().toISOString();
    invocation.result = resultText(result) as JsonValue;
    return compactSearch(JSON.parse(resultText(result)) as Record<string, unknown>);
  };

  const search = await runSearch("spoonfed-search", request);
  const searches = [search];

  const refinePrompt = `User question:\n${question}\n\nSearch request used:\n${JSON.stringify(request, null, 2)}\n\nSearch results:\n${JSON.stringify(search, null, 2)}\n\nDo these results contain enough directly relevant documentation to answer? If not, propose ONE refined Swift Docs search request. Return ONLY JSON: {"enough":true} or {"enough":false,"query":"...","symbols":["..."]}. Use only the user question and the search results above.`;
  const refineResult = await callModel(input, input.model, apiKey, "You decide whether retrieved documentation is sufficient and refine searches when needed.", refinePrompt);
  events.push(...refineResult.events); addUsage(usage, refineResult);
  const refine = extractJsonObject(refineResult.finalText);
  if (refine.enough === false && typeof refine.query === "string" && refine.query.trim()) {
    const symbols = Array.isArray(refine.symbols) ? refine.symbols.filter((x): x is string => typeof x === "string") : [];
    searches.push(await runSearch("spoonfed-refine-search", { query: refine.query, ...(symbols.length > 0 ? { symbols } : {}) }));
  }

  const readPrompt = `Question: ${question}\n\nSearch results:\n${JSON.stringify(searches, null, 2)}\n\nWhich files do you want to inspect before answering? Return ONLY JSON: {"paths":["path1","path2"]}. Pick 1-3 paths from recommendedReads/hits. Prefer canonical pages that directly answer the question.`;
  const readChoiceResult = await callModel(input, input.model, apiKey, "You choose the smallest set of documentation files needed to answer.", readPrompt);
  events.push(...readChoiceResult.events); addUsage(usage, readChoiceResult);
  const chosen = extractJsonObject(readChoiceResult.finalText).paths;
  const modelPaths = Array.isArray(chosen) ? chosen.filter((x): x is string => typeof x === "string") : [];
  const paths = [...new Set([...modelPaths.slice(0, 2), ...rerankPathsFromSearch(searches).slice(0, 3)])].slice(0, 4);

  const docs = await Promise.all(paths.map((path) => readCorpusFile(corpusRoot, path)));
  for (const doc of docs) {
    toolInvocations.push({
      toolCallId: `spoonfed-read-${toolInvocations.length + 1}`,
      toolName: "read",
      args: { path: doc.path },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      isError: Boolean(doc.error),
      result: (doc.error ? `Error: ${doc.error}` : doc.text) as JsonValue,
      updates: [],
    });
  }

  const finalPrompt = `Answer the SwiftUI question using the retrieved documentation below. Answer what the user should do, not merely what is possible. If the docs show a newer replacement, deprecation, or accessibility requirement, make that primary. Be concise and actionable.\n\nQuestion: ${question}\n\nRetrieved docs:\n${docs.map((d) => `\n--- FILE: ${d.path}${d.error ? ` ERROR: ${d.error}` : ""} ---\n${d.text}`).join("\n")}`;
  const finalResult = await callModel(input, input.model, apiKey, "You answer from provided documentation context. Do not call tools.", finalPrompt);
  events.push(...finalResult.events); addUsage(usage, finalResult);

  return {
    finalResult,
    toolInvocations,
    events,
    usage,
    ...(usage.cost !== undefined ? { costUsd: usage.cost } : {}),
    prompt: [queryPrompt, refinePrompt, readPrompt, finalPrompt].join("\n\n---\n\n"),
  };
}
