import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function readElapsedMsFromTrace(tracePath) {
  if (!tracePath || !existsSync(tracePath)) return undefined;
  try {
    const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
    const elapsed = trace.elapsedMs;
    return typeof elapsed === 'number' && Number.isFinite(elapsed) ? elapsed : undefined;
  } catch {
    return undefined;
  }
}

function enrichAggregateWithTiming(aggregate) {
  if (!aggregate?.runs) return aggregate;

  const perRun = aggregate.runs.map((run) => {
    const tracePath = run.artifactPaths?.trace;
    const collectMs = readElapsedMsFromTrace(tracePath);
    if (collectMs != null) {
      run.timing = { ...(run.timing ?? {}), collectMs };
    }
    return collectMs;
  });

  const tracked = perRun.filter((v) => typeof v === 'number');
  if (tracked.length === 0) return aggregate;

  const totalCollectMs = tracked.reduce((sum, v) => sum + v, 0);
  const meanCollectMsPerRun = totalCollectMs / tracked.length;

  for (const summary of aggregate.summaries ?? []) {
    summary.timing = {
      trackedRuns: tracked.length,
      totalCollectMs,
      meanCollectMsPerRun,
    };
  }
  return aggregate;
}

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, '..', '..');
const benchmarkResultsRoot = process.env.BENCHMARK_RESULTS_ROOT
  ? path.resolve(process.env.BENCHMARK_RESULTS_ROOT)
  : path.join(repoRoot, 'benchmark-results');
const datasetPath = path.join(repoRoot, 'benchmark', 'dataset', 'swiftui-docs-chatbot-benchmark.v1.json');
const outputPath = path.join(appRoot, 'public', 'generated', 'recent-runs.json');
const completeRunThreshold = readExpectedQuestionCount(datasetPath);

function collectAggregateFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const aggregateFiles = [];
  walk(root, aggregateFiles);

  const included = aggregateFiles.filter((entry) => !isExcludedRecentRun(entry));
  const canonical = included.filter((entry) => isCanonicalRecentRun(entry));
  const selected = canonical.length > 0 ? canonical : included;

  return selected.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function walk(currentDirectory, aggregateFiles) {
  for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, aggregateFiles);
      continue;
    }

    if (entry.isFile() && entry.name === 'aggregate.json') {
      const aggregate = enrichAggregateWithTiming(JSON.parse(readFileSync(absolutePath, 'utf8')));
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

function isExcludedRecentRun(entry) {
  const modelId = entry.aggregate?.summaries?.[0]?.model?.modelId ?? '';
  return modelId.includes('nemotron-3-super') || modelId.includes('trinity-mini');
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
