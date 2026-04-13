import { readFile } from "node:fs/promises";
import type { BenchmarkMode, DatasetQuestion } from "../shared/contracts.js";

export async function loadPromptTemplate(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function renderPrompt(templatePath: string, mode: BenchmarkMode, question: DatasetQuestion): Promise<string> {
  const template = await loadPromptTemplate(templatePath);
  return `${template.trim()}\n\n## Active benchmark mode\n${mode}\n\n## Question metadata\n- id: ${question.id}\n- title: ${question.title}\n- taxonomyTags: ${question.taxonomyTags.join(", ")}\n\n## Benchmark question\n${question.question}\n`;
}
