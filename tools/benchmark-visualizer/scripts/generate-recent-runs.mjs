import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, '..', '..');
const benchmarkResultsRoot = path.join(repoRoot, 'benchmark-results');
const datasetPath = path.join(repoRoot, 'benchmark', 'dataset', 'swiftui-docs-chatbot-benchmark.v1.json');
const outputPath = path.join(appRoot, 'src', 'generated', 'recent-runs.json');
const limit = 9;
const completeRunThreshold = readExpectedQuestionCount(datasetPath);

function collectAggregateFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const aggregateFiles = [];
  walk(root, aggregateFiles);

  const canonical = aggregateFiles.filter((entry) => isCanonicalRecentRun(entry));
  const selected = canonical.length >= limit ? canonical : aggregateFiles;

  return selected.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, limit);
}

function walk(currentDirectory, aggregateFiles) {
  for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, aggregateFiles);
      continue;
    }

    if (entry.isFile() && entry.name === 'aggregate.json') {
      const aggregate = JSON.parse(readFileSync(absolutePath, 'utf8'));
      const stats = statSync(absolutePath);
      aggregateFiles.push({
        sourceName: path.basename(path.dirname(absolutePath)),
        aggregatePath: absolutePath,
        aggregate,
        mtimeMs: stats.mtimeMs,
      });
    }
  }
}

function readExpectedQuestionCount(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  const dataset = JSON.parse(readFileSync(filePath, 'utf8'));
  return dataset.source?.questionCount ?? dataset.questions?.length ?? null;
}

function isCanonicalRecentRun(entry) {
  const runs = entry.aggregate?.summaries?.[0]?.runs;
  return typeof runs === 'number' && typeof completeRunThreshold === 'number'
    ? runs >= completeRunThreshold
    : true;
}

const recentRuns = collectAggregateFiles(benchmarkResultsRoot).map((entry) => ({
  sourceName: entry.sourceName,
  aggregate: entry.aggregate,
}));

const payload = {
  generatedAt: new Date().toISOString(),
  count: recentRuns.length,
  runs: recentRuns,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`Wrote ${outputPath} with ${recentRuns.length} run(s)`);
