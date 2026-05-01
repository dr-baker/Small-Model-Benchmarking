import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TOOLSET_LABELS = {
  none: 'No tools',
  read_only: 'Read only',
  read_grep: 'Read + grep',
  read_grep_glob: 'Read + grep + glob',
  swift_docs_hybrid: 'RAG v1',
  swift_docs_search_read: 'RAG v2',
  spoonfed_rag: 'Spoonfed RAG',
};

const TOOLSET_ICONS = {
  none: '◇',
  read_only: '📄',
  read_grep: '⌕',
  read_grep_glob: '🗂️',
  swift_docs_hybrid: '🧭',
  swift_docs_search_read: '🔎',
  spoonfed_rag: '🥄',
};

const MODEL_NAME_OVERRIDES = {
  'openai/gpt-oss-120b': 'GPT OSS 120B',
  'openai/gpt-oss-120b:baseten': 'GPT OSS 120B',
  'openai/gpt-oss-120b:nitro': 'GPT OSS 120B',
  'openai/gpt-oss-safeguard-20b': 'GPT OSS Safeguard 20B',
  'inception/mercury': 'Mercury',
  'nvidia/nemotron-3-super-120b': 'Nemotron 3 Super 120B',
  'qwen/qwen3-next-80b-a3b-thinking': 'Qwen3 Next 80B Thinking',
  'mistralai/devstral-small': 'Devstral Small',
  'z-ai/glm-4.7-flash': 'GLM 4.7 Flash',
};

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, '..', '..');
const benchmarkResultsRoot = process.env.BENCHMARK_RESULTS_ROOT
  ? path.resolve(process.env.BENCHMARK_RESULTS_ROOT)
  : path.join(repoRoot, 'benchmark-results');
const datasetPath = path.join(repoRoot, 'benchmark', 'dataset', 'swiftui-docs-chatbot-benchmark.v1.json');
const outputPath = path.join(appRoot, 'public', 'generated', 'recent-runs.json');
const datasetInfo = readDatasetInfo(datasetPath);
const completeRunThreshold = datasetInfo.questionCount;

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

function readManifest(manifestPath) {
  if (!manifestPath || !existsSync(manifestPath)) return undefined;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
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
      const sourceName = path.basename(path.dirname(absolutePath));
      aggregateFiles.push({
        sourceName,
        aggregatePath: absolutePath,
        aggregate,
        benchmarkRun: buildBenchmarkRun(sourceName, aggregate, absolutePath),
        mtimeMs: stats.mtimeMs,
      });
    }
  }
}

function readDatasetInfo(filePath) {
  if (!existsSync(filePath)) {
    return { datasetVersion: undefined, questionCount: null };
  }

  const dataset = JSON.parse(readFileSync(filePath, 'utf8'));
  return {
    datasetVersion: dataset.datasetVersion,
    questionCount: dataset.source?.questionCount ?? dataset.questions?.length ?? null,
  };
}

function isCanonicalRecentRun(entry) {
  const runs = entry.aggregate?.summaries?.[0]?.runs;
  return typeof runs === 'number' && typeof completeRunThreshold === 'number'
    ? runs >= completeRunThreshold
    : true;
}

function isExcludedRecentRun(entry) {
  const summary = entry.aggregate?.summaries?.[0] ?? {};
  const modelId = summary.model?.modelId ?? '';
  if (
    modelId.includes('nemotron-3-super') ||
    modelId.includes('trinity-mini') ||
    modelId.includes('liquid/lfm-2.5-1.2b-thinking') ||
    modelId.includes('x-ai/grok-4-fast')
  ) return true;

  const canonicalModelId = canonicalizeModelId(modelId);
  if (canonicalModelId === 'openai/gpt-oss-120b') {
    return deriveRoute(summary, entry.sourceName) !== 'baseten';
  }

  return false;
}

function buildBenchmarkRun(sourceName, aggregate, aggregatePath) {
  const summary = aggregate.summaries?.[0] ?? {};
  const runs = aggregate.runs ?? [];
  const provider = summary.model?.provider ?? 'unknown-provider';
  const rawModelId = summary.model?.modelId ?? 'unknown-model';
  const modelId = canonicalizeModelId(rawModelId);
  const toolset = buildToolsetProfile(summary);
  const route = deriveRoute(summary, sourceName);
  const corpus = readCorpusFromFirstManifest(runs);
  const id = [sourceName, provider, modelId, toolset.key, aggregate.generatedAt ?? 'unknown'].join('::');

  return {
    id,
    sourceName,
    benchmarkName: aggregate.benchmarkName,
    generatedAt: aggregate.generatedAt,
    aggregatePath,
    model: {
      provider,
      modelId,
      label: modelLabel(modelId),
      family: modelFamily(modelId),
    },
    toolset,
    mode: summary.mode,
    answerCollectionMode: summary.answerCollectionMode,
    thinkingLevel: deriveThinkingLevel(sourceName, modelId),
    transport: {
      kind: summary.transport?.kind,
      route,
      reasoning: deriveReasoningLabel(sourceName, modelId),
    },
    corpus: {
      datasetVersion: datasetInfo.datasetVersion,
      rubricVersion: aggregate.rubricVersion,
      snapshotId: corpus?.snapshotId,
      manifestSha256: corpus?.manifestSha256,
    },
    metrics: buildMetrics(summary, runs),
    aggregate,
  };
}

function buildToolsetProfile(summary) {
  const key = summary.toolSet?.name ?? (summary.mode === 'closed_book' ? 'none' : 'unknown-tools');
  return {
    key,
    label: TOOLSET_LABELS[key] ?? humanizeLoose(key),
    icon: TOOLSET_ICONS[key] ?? '🧰',
    version: summary.toolSet?.version,
    description: summary.toolSet?.description,
    toolNames: summary.toolSet?.toolNames ?? [],
  };
}

function buildMetrics(summary, runs) {
  const questionCount = summary.runs ?? runs.length;
  const judgedQuestionCount = summary.judge?.judgeRuns ?? runs.filter(hasJudgeSignal).length;
  const correctCount = summary.judge?.judgeCorrectCount ?? runs.filter((run) => run.judge?.correctness === 1 || run.judge?.verdict === 'correct').length;
  const partialCount = summary.judge?.judgePartiallyCorrectCount ?? runs.filter((run) => run.judge?.correctness === 0 || run.judge?.verdict === 'partially_correct').length;
  const incorrectCount = summary.judge?.judgeIncorrectCount ?? runs.filter((run) => run.judge?.correctness === -1 || run.judge?.verdict === 'incorrect').length;
  const errorCount = summary.errors?.runsWithAnyError ?? runs.filter((run) => run.errors?.collectHadError || run.errors?.judgeHadError).length;

  return {
    questionCount,
    judgedQuestionCount,
    correctCount,
    partialCount,
    incorrectCount,
    correctRate: ratio(correctCount, judgedQuestionCount),
    correctnessScore: summary.judge?.meanCorrectness,
    completenessScore: summary.judge?.meanCompleteness,
    referenceVerifiedRate: summary.judge?.referenceVerifiedRate,
    totalCostUsd: summary.cost?.totalCostUsd,
    collectCostUsd: summary.cost?.totalCollectCostUsd,
    judgeCostUsd: summary.cost?.totalJudgeCostUsd,
    costPerQuestionUsd: summary.cost?.meanTotalCostUsdPerRun,
    totalCollectMs: summary.timing?.totalCollectMs,
    collectMsPerQuestion: summary.timing?.meanCollectMsPerRun,
    errorCount,
    collectErrorCount: summary.errors?.collectErrorRuns ?? runs.filter((run) => run.errors?.collectHadError).length,
    judgeErrorCount: summary.errors?.judgeErrorRuns ?? runs.filter((run) => run.errors?.judgeHadError).length,
    errorRate: ratio(errorCount, questionCount),
  };
}

function hasJudgeSignal(run) {
  return Boolean(run.judge?.verdict || typeof run.judge?.correctness === 'number');
}

function readCorpusFromFirstManifest(runs) {
  for (const run of runs) {
    const manifest = readManifest(pathFromArtifact(run.artifactPaths?.trace, 'manifest.json'));
    if (manifest?.corpus) {
      return {
        snapshotId: manifest.corpus.snapshotId,
        manifestSha256: manifest.corpus.manifestSha256,
      };
    }
  }
  return undefined;
}

function pathFromArtifact(artifactPath, fileName) {
  if (!artifactPath) return undefined;
  return path.join(path.dirname(artifactPath), fileName);
}

function deriveRoute(summary, sourceName) {
  const routing = summary.transport?.openRouterRouting;
  const routedProvider = routing?.only?.[0] ?? routing?.order?.[0];
  if (typeof routedProvider === 'string' && routedProvider.length > 0) return routedProvider;

  const modelId = summary.model?.modelId?.toLowerCase() ?? '';
  if (modelId.endsWith(':baseten')) return 'baseten';
  if (modelId.endsWith(':nitro')) return 'nitro';

  const normalizedSourceName = sourceName.toLowerCase();
  if (normalizedSourceName.includes('cerebras')) return 'cerebras';
  if (normalizedSourceName.includes('baseten')) return 'baseten';
  if (normalizedSourceName.includes('deepinfra')) return 'deepinfra';
  if (normalizedSourceName.includes('groq')) return 'groq';
  return undefined;
}

function canonicalizeModelId(modelId) {
  const normalized = modelId.toLowerCase();
  if (normalized === 'openai/gpt-oss-120b:baseten' || normalized === 'openai/gpt-oss-120b:nitro') {
    return 'openai/gpt-oss-120b';
  }
  return modelId;
}

function deriveThinkingLevel(sourceName, modelId) {
  const source = `${sourceName} ${modelId}`.toLowerCase();
  if (source.includes('think-hard') || source.includes('thinking-high')) return 'high';
  if (source.includes('thinking') || source.includes('think')) return 'medium';
  return undefined;
}

function deriveReasoningLabel(sourceName, modelId) {
  const source = `${sourceName} ${modelId}`.toLowerCase();
  if (source.includes('thinking') || source.includes('reasoning') || source.includes('think-hard')) return 'reasoning enabled';
  return undefined;
}

function modelLabel(modelId) {
  const normalized = modelId.toLowerCase();
  if (MODEL_NAME_OVERRIDES[normalized]) return MODEL_NAME_OVERRIDES[normalized];
  const leaf = modelId.split('/').pop() ?? modelId;
  return leaf
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bOss\b/g, 'OSS')
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bGlm\b/g, 'GLM');
}

function modelFamily(modelId) {
  const leaf = (modelId.split('/').pop() ?? modelId).split(':')[0];
  return leaf.split(/[-_]/).slice(0, 2).join(' ') || leaf;
}

function humanizeLoose(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bJson\b/g, 'JSON')
    .replace(/\bDocs\b/g, 'Docs');
}

function ratio(numerator, denominator) {
  if (typeof numerator !== 'number' || typeof denominator !== 'number' || denominator === 0) {
    return undefined;
  }
  return numerator / denominator;
}

const recentRuns = collectAggregateFiles(benchmarkResultsRoot).map((entry) => ({
  sourceName: entry.sourceName,
  benchmarkRun: entry.benchmarkRun,
}));

const payload = {
  generatedAt: new Date().toISOString(),
  count: recentRuns.length,
  runs: recentRuns,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`Wrote ${outputPath} with ${recentRuns.length} benchmark run(s)`);
