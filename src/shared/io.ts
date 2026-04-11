import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFile(path, serializeJson(value), "utf8");
}

export function assertPathWithinDirectory(baseDir: string, candidatePath: string): string {
  const resolvedBaseDir = resolve(baseDir);
  const resolvedCandidate = resolve(candidatePath);
  if (resolvedCandidate !== resolvedBaseDir && !resolvedCandidate.startsWith(`${resolvedBaseDir}/`)) {
    throw new Error(`Path ${resolvedCandidate} escapes base directory ${resolvedBaseDir}`);
  }
  return resolvedCandidate;
}
