import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BenchmarkMode, DatasetQuestion, PromptTemplateId } from "../shared/contracts.js";

const PROMPT_TEMPLATE_PATHS: Record<PromptTemplateId, string> = {
  "benchmark-answer-v1": resolve("prompts/benchmark-answer-v1.md"),
};

export async function loadPromptTemplate(templateId: PromptTemplateId): Promise<string> {
  const path = PROMPT_TEMPLATE_PATHS[templateId];
  return readFile(path, "utf8");
}

export async function renderPrompt(templateId: PromptTemplateId, mode: BenchmarkMode, question: DatasetQuestion): Promise<string> {
  const template = await loadPromptTemplate(templateId);
  return `${template.trim()}\n\n## Active benchmark mode\n${mode}\n\n## Question metadata\n- id: ${question.id}\n- title: ${question.title}\n- taxonomyTags: ${question.taxonomyTags.join(", ")}\n\n## Benchmark question\n${question.question}\n`;
}
