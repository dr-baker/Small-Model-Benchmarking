import { basename, normalize, relative, resolve, sep } from "node:path";
import type { BenchmarkQuestionType, CorpusSnapshotRef, DatasetQuestion } from "./contracts.js";

function normalizeForComparison(value: string): string {
  return normalize(value).replace(/\\/g, "/");
}

function trimLeadingDotSlash(value: string): string {
  return value.replace(/^\.\//, "").replace(/^\//, "");
}

export function normalizeCorpusRelativePath(filePath: string | undefined, corpusRoot: string): string | undefined {
  if (!filePath || filePath.trim().length === 0) return undefined;

  const trimmed = filePath.trim();
  const normalizedInput = normalizeForComparison(trimmed);
  const normalizedRoot = normalizeForComparison(resolve(corpusRoot));
  const rootName = basename(normalizedRoot);

  if (normalizedInput === rootName) return "";

  if (normalizedInput.startsWith(`${normalizedRoot}/`)) {
    return trimLeadingDotSlash(normalizedInput.slice(normalizedRoot.length + 1));
  }

  const rootMarker = `/${rootName}/`;
  const rootMarkerIndex = normalizedInput.indexOf(rootMarker);
  if (rootMarkerIndex >= 0) {
    return trimLeadingDotSlash(normalizedInput.slice(rootMarkerIndex + rootMarker.length));
  }

  if (normalizedInput.startsWith(`${rootName}/`)) {
    return trimLeadingDotSlash(normalizedInput.slice(rootName.length + 1));
  }

  if (!trimmed.startsWith("/")) {
    return trimLeadingDotSlash(normalizedInput);
  }

  return undefined;
}

export function resolvePathWithinCorpus(filePath: string | undefined, corpusRoot: string): string {
  const root = resolve(corpusRoot);
  if (!filePath || filePath.trim().length === 0 || filePath === ".") return root;

  const candidate = filePath.startsWith("/") ? resolve(filePath) : resolve(root, filePath);
  const rel = relative(root, candidate);
  if (rel === "" || rel === ".") return root;
  const normalizedRel = normalize(rel);
  if (normalizedRel === ".." || normalizedRel.startsWith(`..${sep}`)) {
    throw new Error(`Path escapes corpus root: ${filePath}`);
  }
  return candidate;
}

export function normalizeCitationFilePath(filePath: string | undefined, corpusRoot: string): string | undefined {
  return normalizeCorpusRelativePath(filePath, corpusRoot);
}

export function inferQuestionType(question: Pick<DatasetQuestion, "goldEvidence">): BenchmarkQuestionType {
  return question.goldEvidence.length > 0 ? "corpus_backed" : "best_practice";
}

export function buildCorpusSnapshotWithRelativeRoot(corpus: CorpusSnapshotRef): CorpusSnapshotRef {
  return {
    ...corpus,
    rootDir: normalizeForComparison(corpus.rootDir),
    manifestPath: normalizeForComparison(corpus.manifestPath),
  };
}
