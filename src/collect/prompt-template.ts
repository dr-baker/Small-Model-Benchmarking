import { readFile } from "node:fs/promises";
import type { BenchmarkMode, DatasetQuestion, PromptMessageSnapshot } from "../shared/contracts.js";

export async function loadPromptTemplate(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function renderPromptMessages(templatePath: string, mode: BenchmarkMode, question: DatasetQuestion): Promise<PromptMessageSnapshot[]> {
  const template = await loadPromptTemplate(templatePath);
  return [
    { role: "user", content: template.trim() },
    {
      role: "user",
      content: `## Active benchmark mode\n${mode}\n\n## Question metadata\n- id: ${question.id}\n- title: ${question.title}\n- taxonomyTags: ${question.taxonomyTags.join(", ")}`,
    },
    {
      role: "user",
      content: `## Benchmark question\n${question.question}`,
    },
  ];
}

export async function renderPrompt(templatePath: string, mode: BenchmarkMode, question: DatasetQuestion): Promise<string> {
  const messages = await renderPromptMessages(templatePath, mode, question);
  return messages.map((message) => message.content).join("\n\n").trimEnd() + "\n";
}
