import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSwiftDocsSearchTool } from "../src/collect/swift-docs-tool.js";
import { runLlmClient } from "../src/shared/llm-client.js";
import { loadBenchmarkConfigWithMeta, parseModelRefFromString } from "../src/shared/config.js";
import { loadProjectEnvVars } from "../src/shared/env-api-keys.js";
import { readJsonFile } from "../src/shared/io.js";
import { resolveModelApiKey } from "../src/shared/api-key.js";
import type { DatasetQuestion } from "../src/shared/contracts.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..");

function parseCsv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function pickCompactSearch(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const trimList = (value: unknown, limit: number) => Array.isArray(value)
    ? value.slice(0, limit).map((item) => {
        if (!item || typeof item !== "object") return item;
        const x = item as Record<string, unknown>;
        return {
          rank: x.rank,
          path: x.path ?? x.normalized_md_path,
          title: x.title,
          source: x.source,
          snippet: typeof x.snippet === "string" ? x.snippet.slice(0, 700) : undefined,
        };
      })
    : [];
  return {
    queries: r.queries,
    symbols: r.symbols,
    recommendedReads: trimList(r.recommendedReads, 6),
    hits: trimList(r.hits, 12),
  };
}

function resultText(result: any): string {
  return result.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") ?? "";
}

async function main() {
  loadProjectEnvVars();
  const model = parseModelRefFromString(arg("model") ?? "openrouter/google/gemma-4-26b-a4b-it");
  const questionIds = parseCsv(arg("question"));
  const runId = arg("run-id") ?? "pure-rag-smoke";
  const compact = arg("compact") !== "false";
  const { config } = await loadBenchmarkConfigWithMeta();
  if (!config.swiftDocs) throw new Error("Missing swiftDocs config. Add benchmark.local.yaml or BENCHMARK_CONFIG.");
  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(config.paths.dataset);
  const questions = questionIds.length ? dataset.questions.filter((q) => questionIds.includes(q.id)) : dataset.questions.slice(0, 3);
  const searchTool = createSwiftDocsSearchTool(config.swiftDocs);
  const apiKey = await resolveModelApiKey(model);
  const outDir = resolve(REPO_ROOT, "benchmark-results", runId);
  await mkdir(outDir, { recursive: true });

  for (const q of questions) {
    const searchResult = await searchTool.execute("pure-rag-search", { query: q.question }, undefined);
    const parsed = JSON.parse(resultText(searchResult));
    const searchPayload = compact ? pickCompactSearch(parsed) : parsed;
    const prompt = [
      "Answer this SwiftUI question using ONLY the provided search results. Prefer modern, non-deprecated APIs. Be concise.",
      "",
      "## Search results",
      "```json",
      JSON.stringify(searchPayload, null, 2),
      "```",
      "",
      "## Question",
      q.question,
    ].join("\n");
    const llm = await runLlmClient({
      model,
      transport: config.transport,
      messages: [
        { role: "system", content: "Use the provided retrieved documentation context. Do not call tools." },
        { role: "user", content: prompt },
      ],
      tools: [],
      apiKey,
    });
    const artifact = { question: q, search: searchPayload, answer: llm.finalText, usage: llm.usage, events: llm.events, error: llm.error };
    await writeFile(join(outDir, `${q.id}.json`), JSON.stringify(artifact, null, 2));
    const rec = Array.isArray((searchPayload as any).recommendedReads) ? (searchPayload as any).recommendedReads.map((x: any) => x.path).slice(0, 4) : [];
    console.log(`\n## ${q.id}`);
    console.log(`recommended: ${rec.join(", ")}`);
    console.log(`usage: ${JSON.stringify(llm.usage)}`);
    console.log((llm.finalText ?? "<no answer>").slice(0, 1200));
  }
  console.log(`\nWrote ${outDir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
