import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  EMPTY_QUESTION_BANK,
  EMPTY_RECENT_RUNS_BUNDLE,
  buildQuestionList,
  dedupeExecutions,
  loadBundledSnapshot,
  loadExecutionsFromFiles,
  pickAggregateFiles,
} from './lib/aggregate';
import type { BundledSnapshot, EnrichedRun, LoadedExecution, QuestionMeta } from './types';

type FilterMode = 'all' | 'interesting' | 'errors' | 'disagreement';
type SortMode = 'dataset' | 'judge-risk' | 'most-disagreement';
type ThemeMode = 'light' | 'dark';
type AnswerSortMode = 'execution-order' | 'score-desc' | 'judge-best' | 'cost-low';
type ChartScoreMode = 'correct-rate' | 'correctness-score';
type ParetoFrontierFilterKey = 'cost-correct-rate' | 'time-correct-rate' | 'cost-correctness-score' | 'time-correctness-score';
type Tone = 'success' | 'warn' | 'danger' | 'accent' | 'neutral';

const ALL_METADATA_FILTER_VALUE = '__all__';
const OTHER_PLATFORM_FILTER_VALUE = '__other__';
const THEME_STORAGE_KEY = 'benchmark-visualizer-theme';
const LazyMarkdownBlock = lazy(() => import('./components/MarkdownBlock'));

type QuestionMetadataFilterValue = typeof ALL_METADATA_FILTER_VALUE | string;

interface QuestionGroup {
  meta: QuestionMeta;
  answers: Array<{
    execution: LoadedExecution;
    run: EnrichedRun | null;
  }>;
  averageScore: number | null;
  judgeCorrectRate: number | null;
  judgeCorrectnessScore: number | null;
  meanCompleteness: number | null;
  referenceVerifiedRate: number | null;
  judgeCoverageRate: number | null;
  judgeCoverageCount: number;
  disagreementCount: number;
  hasErrors: boolean;
  hasIncorrect: boolean;
}

interface ScatterAxis {
  label: string;
  value: (execution: LoadedExecution) => number | undefined;
  format: (value: number | undefined) => string;
  higherIsBetter: boolean;
}

interface LedgerColumn {
  label: string;
  higherIsBetter: boolean;
  value: (execution: LoadedExecution) => number | undefined;
  format: (value: number | undefined, execution?: LoadedExecution) => string;
}

interface LedgerExtremes {
  min: number;
  max: number;
  distinctCount: number;
}

interface ToolsetSummary {
  key: string;
  label: string;
  icon: string;
  executions: LoadedExecution[];
  runCount: number;
  judgedRuns: number;
  correctRate: number | null;
  correctnessScore: number | null;
  medianCorrectnessScore: number | null;
  referenceVerifiedRate: number | null;
  retrievalQuality: number | null;
  costPerQuestion: number | null;
  timePerQuestionMs: number | null;
  errorRate: number | null;
}

interface MatrixCellSummary {
  execution: LoadedExecution;
  correctRate: number | null;
  correctnessScore: number | null;
  costPerQuestion: number | null;
  errorRate: number | null;
}

interface ModelToolMatrix {
  models: string[];
  toolsets: Array<{ key: string; label: string }>;
  cells: Map<string, MatrixCellSummary>;
}

interface SearchStoryHighlights {
  bestOverall: ToolsetSummary | null;
  cheapestGood: ToolsetSummary | null;
  fastestGood: ToolsetSummary | null;
  unstable: ToolsetSummary[];
}

function computeExtremes(executions: LoadedExecution[], column: LedgerColumn): LedgerExtremes | null {
  const values: number[] = [];
  for (const execution of executions) {
    const value = column.value(execution);
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return null;
  const distinct = new Set(values);
  return { min: Math.min(...values), max: Math.max(...values), distinctCount: distinct.size };
}

function rankValue(
  value: number | undefined,
  extremes: LedgerExtremes | null,
  higherIsBetter: boolean,
): 'is-best' | 'is-worst' | '' {
  if (extremes == null || typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (extremes.distinctCount < 2) return '';
  if (higherIsBetter) {
    if (value === extremes.max) return 'is-best';
    if (value === extremes.min) return 'is-worst';
  } else {
    if (value === extremes.min) return 'is-best';
    if (value === extremes.max) return 'is-worst';
  }
  return '';
}

const PARETO_FRONTIER_FILTERS: Array<{
  key: ParetoFrontierFilterKey;
  label: string;
  xAxis: ScatterAxis;
  yAxis: ScatterAxis;
}> = [
  {
    key: 'cost-correct-rate',
    label: 'Cost vs correct rate',
    xAxis: {
      label: 'Cost / question',
      value: (execution) => execution.summary.cost?.meanTotalCostUsdPerRun,
      format: (value) => formatUsd(value, 4),
      higherIsBetter: false,
    },
    yAxis: {
      label: 'Correct rate',
      value: (execution) => ratio(execution.summary.judge?.judgeCorrectCount, execution.summary.judge?.judgeRuns),
      format: (value) => formatPercent(value),
      higherIsBetter: true,
    },
  },
  {
    key: 'time-correct-rate',
    label: 'Time vs correct rate',
    xAxis: {
      label: 'Time / question',
      value: (execution) => execution.summary.timing?.meanCollectMsPerRun,
      format: (value) => formatDuration(value),
      higherIsBetter: false,
    },
    yAxis: {
      label: 'Correct rate',
      value: (execution) => ratio(execution.summary.judge?.judgeCorrectCount, execution.summary.judge?.judgeRuns),
      format: (value) => formatPercent(value),
      higherIsBetter: true,
    },
  },
  {
    key: 'cost-correctness-score',
    label: 'Cost vs correctness score',
    xAxis: {
      label: 'Cost / question',
      value: (execution) => execution.summary.cost?.meanTotalCostUsdPerRun,
      format: (value) => formatUsd(value, 4),
      higherIsBetter: false,
    },
    yAxis: {
      label: 'Correctness score',
      value: (execution) => getJudgeCorrectnessScore(execution.summary),
      format: (value) => formatNumber(value, 2),
      higherIsBetter: true,
    },
  },
  {
    key: 'time-correctness-score',
    label: 'Time vs correctness score',
    xAxis: {
      label: 'Time / question',
      value: (execution) => execution.summary.timing?.meanCollectMsPerRun,
      format: (value) => formatDuration(value),
      higherIsBetter: false,
    },
    yAxis: {
      label: 'Correctness score',
      value: (execution) => getJudgeCorrectnessScore(execution.summary),
      format: (value) => formatNumber(value, 2),
      higherIsBetter: true,
    },
  },
];

const DEFAULT_PARETO_FRONTIER_FILTERS = PARETO_FRONTIER_FILTERS.map((filter) => filter.key);

function App() {
  const [bundledSnapshot, setBundledSnapshot] = useState<BundledSnapshot | null>(null);
  const [bundleLoadError, setBundleLoadError] = useState<string | null>(null);
  const [executions, setExecutions] = useState<LoadedExecution[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('interesting');
  const [sortMode, setSortMode] = useState<SortMode>('dataset');
  const [answerSortMode, setAnswerSortMode] = useState<AnswerSortMode>('execution-order');
  const [chartScoreMode, setChartScoreMode] = useState<ChartScoreMode>('correct-rate');
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [executionOrder, setExecutionOrder] = useState<string[]>([]);
  const [hiddenExecutionIds, setHiddenExecutionIds] = useState<string[]>([]);
  const [hiddenRunTypes, setHiddenRunTypes] = useState<string[]>([]);
  const [maxErrorRatePercent, setMaxErrorRatePercent] = useState(10);
  const [paretoFrontierOnly, setParetoFrontierOnly] = useState(false);
  const [selectedParetoFrontierFilters, setSelectedParetoFrontierFilters] = useState<ParetoFrontierFilterKey[]>(DEFAULT_PARETO_FRONTIER_FILTERS);
  const [selectedTaxonomyTag, setSelectedTaxonomyTag] = useState<QuestionMetadataFilterValue>(ALL_METADATA_FILTER_VALUE);
  const [selectedPlatformScope, setSelectedPlatformScope] = useState<QuestionMetadataFilterValue>(ALL_METADATA_FILTER_VALUE);
  const [selectedQuestionShape, setSelectedQuestionShape] = useState<QuestionMetadataFilterValue>(ALL_METADATA_FILTER_VALUE);
  const [selectedEvidenceBasis, setSelectedEvidenceBasis] = useState<QuestionMetadataFilterValue>(ALL_METADATA_FILTER_VALUE);
  const [openAnswerRows, setOpenAnswerRows] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const questionBank = bundledSnapshot?.questionBank ?? EMPTY_QUESTION_BANK;
  const questionList = bundledSnapshot?.questionList ?? buildQuestionList(questionBank);
  const recentRunsBundle = bundledSnapshot?.recentRunsBundle ?? EMPTY_RECENT_RUNS_BUNDLE;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    void loadBundledSnapshot()
      .then((snapshot) => {
        if (cancelled) return;
        const bundledExecutions = [...snapshot.bundledExecutions].sort((left, right) =>
          left.label.localeCompare(right.label),
        );
        setBundledSnapshot(snapshot);
        setExecutions(bundledExecutions);
        setExecutionOrder(bundledExecutions.map((execution) => execution.id));
        setBundleLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setBundleLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const executionIds = new Set(executions.map((execution) => execution.id));
    setExecutionOrder((current) => {
      const kept = current.filter((id) => executionIds.has(id));
      const missing = executions.map((execution) => execution.id).filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
    setHiddenExecutionIds((current) => current.filter((id) => executionIds.has(id)));
  }, [executions]);

  const orderedExecutions = useMemo(() => {
    const executionById = new Map(executions.map((execution) => [execution.id, execution]));
    return executionOrder
      .map((executionId) => executionById.get(executionId))
      .filter((execution): execution is LoadedExecution => execution !== undefined);
  }, [executionOrder, executions]);

  const runTypeOptions = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; count: number }>();
    for (const execution of orderedExecutions) {
      const { key, label } = getRunTypeInfo(execution);
      const entry = seen.get(key);
      if (entry) entry.count += 1;
      else seen.set(key, { key, label, count: 1 });
    }
    return Array.from(seen.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [orderedExecutions]);

  const baseVisibleExecutions = useMemo(() => {
    const hiddenIds = new Set(hiddenExecutionIds);
    const hiddenTypes = new Set(hiddenRunTypes);
    return orderedExecutions.filter((execution) => {
      if (hiddenIds.has(execution.id)) return false;
      if (hiddenTypes.has(getRunTypeInfo(execution).key)) return false;
      const errorRate = getExecutionErrorRate(execution.summary);
      if (errorRate != null && errorRate > maxErrorRatePercent / 100) return false;
      return true;
    });
  }, [hiddenExecutionIds, hiddenRunTypes, maxErrorRatePercent, orderedExecutions]);

  useEffect(() => {
    setSelectedParetoFrontierFilters((current) => current.filter((key) => DEFAULT_PARETO_FRONTIER_FILTERS.includes(key)));
  }, []);

  const paretoFrontierExecutionIdsByFilter = useMemo(() => {
    return new Map(
      PARETO_FRONTIER_FILTERS.map((filter) => {
        const points = baseVisibleExecutions
          .map((execution) => ({
            execution,
            x: filter.xAxis.value(execution),
            y: filter.yAxis.value(execution),
          }))
          .filter(
            (point): point is { execution: LoadedExecution; x: number; y: number } =>
              typeof point.x === 'number' && typeof point.y === 'number',
          );
        const frontier = computeParetoFrontier(points, filter.xAxis.higherIsBetter, filter.yAxis.higherIsBetter);
        return [filter.key, new Set(frontier.map((point) => point.execution.id))];
      }),
    );
  }, [baseVisibleExecutions]);

  const visibleExecutions = useMemo(() => {
    if (!paretoFrontierOnly) {
      return baseVisibleExecutions;
    }

    const allowedIds = new Set<string>();
    for (const key of selectedParetoFrontierFilters) {
      const frontierIds = paretoFrontierExecutionIdsByFilter.get(key);
      frontierIds?.forEach((id) => allowedIds.add(id));
    }

    return baseVisibleExecutions.filter((execution) => allowedIds.has(execution.id));
  }, [baseVisibleExecutions, paretoFrontierExecutionIdsByFilter, paretoFrontierOnly, selectedParetoFrontierFilters]);

  const selectedParetoFrontierModelCount = useMemo(() => {
    const ids = new Set<string>();
    for (const key of selectedParetoFrontierFilters) {
      const frontierIds = paretoFrontierExecutionIdsByFilter.get(key);
      frontierIds?.forEach((id) => ids.add(id));
    }
    return ids.size;
  }, [paretoFrontierExecutionIdsByFilter, selectedParetoFrontierFilters]);

  const toggleRunTypeVisibility = (key: string) => {
    setHiddenRunTypes((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  };

  const questionGroups = useMemo(
    () => buildQuestionGroups(visibleExecutions, questionList),
    [questionList, visibleExecutions],
  );

  const toolsetSummaries = useMemo(
    () => buildToolsetSummaries(visibleExecutions),
    [visibleExecutions],
  );

  const modelToolMatrix = useMemo(
    () => buildModelToolMatrix(visibleExecutions),
    [visibleExecutions],
  );

  const searchStoryHighlights = useMemo(
    () => buildSearchStoryHighlights(toolsetSummaries),
    [toolsetSummaries],
  );

  const chartScoreAxis = useMemo<ScatterAxis>(() => {
    if (chartScoreMode === 'correctness-score') {
      return {
        label: 'Correctness score',
        value: (execution) => getJudgeCorrectnessScore(execution.summary),
        format: (value) => formatNumber(value, 2),
        higherIsBetter: true,
      };
    }

    return {
      label: 'Correct rate',
      value: (execution) => ratio(execution.summary.judge?.judgeCorrectCount, execution.summary.judge?.judgeRuns),
      format: (value) => formatPercent(value),
      higherIsBetter: true,
    };
  }, [chartScoreMode]);

  const questionMetadataOptions = useMemo(() => {
    const taxonomyTags = new Set<string>();
    const platformScopes = new Set<string>();
    const questionShapes = new Set<string>();
    const evidenceBases = new Set<string>();

    for (const group of questionGroups) {
      group.meta.taxonomyTags.forEach((tag) => taxonomyTags.add(tag));
      if (group.meta.platformScope) platformScopes.add(group.meta.platformScope);
      if (group.meta.questionShape) questionShapes.add(group.meta.questionShape);
      if (group.meta.evidenceBasis) evidenceBases.add(group.meta.evidenceBasis);
    }

    return {
      taxonomyTags: Array.from(taxonomyTags).sort((left, right) => left.localeCompare(right)),
      platformScopes: Array.from(platformScopes).sort((left, right) => left.localeCompare(right)),
      questionShapes: Array.from(questionShapes).sort((left, right) => left.localeCompare(right)),
      evidenceBases: Array.from(evidenceBases).sort((left, right) => left.localeCompare(right)),
    };
  }, [questionGroups]);

  const visibleQuestionGroups = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = questionGroups.filter((group) => {
      const textMatches =
        normalizedSearch.length === 0 ||
        group.meta.id.toLowerCase().includes(normalizedSearch) ||
        group.meta.title.toLowerCase().includes(normalizedSearch) ||
        group.meta.question.toLowerCase().includes(normalizedSearch) ||
        group.meta.referenceAnswer.toLowerCase().includes(normalizedSearch) ||
        group.meta.taxonomyTags.some((tag) => tag.toLowerCase().includes(normalizedSearch));
      const taxonomyMatches =
        selectedTaxonomyTag === ALL_METADATA_FILTER_VALUE || group.meta.taxonomyTags.includes(selectedTaxonomyTag);
      const platformMatches = matchesPlatformScopeFilter(selectedPlatformScope, group.meta.platformScope);
      const shapeMatches =
        selectedQuestionShape === ALL_METADATA_FILTER_VALUE || group.meta.questionShape === selectedQuestionShape;
      const evidenceMatches =
        selectedEvidenceBasis === ALL_METADATA_FILTER_VALUE || group.meta.evidenceBasis === selectedEvidenceBasis;

      if (!textMatches || !taxonomyMatches || !platformMatches || !shapeMatches || !evidenceMatches) return false;
      if (filterMode === 'all') return true;
      if (filterMode === 'interesting') return group.hasIncorrect || group.hasErrors || group.disagreementCount > 1;
      if (filterMode === 'errors') return group.hasErrors;
      if (filterMode === 'disagreement') return group.disagreementCount > 1;
      return true;
    });

    return filtered.sort((left, right) => compareQuestionGroups(left, right, sortMode));
  }, [
    filterMode,
    questionGroups,
    search,
    selectedEvidenceBasis,
    selectedPlatformScope,
    selectedQuestionShape,
    selectedTaxonomyTag,
    sortMode,
  ]);

  useEffect(() => {
    if (visibleQuestionGroups.length === 0) {
      setSelectedQuestionId(null);
      return;
    }
    const hasSelected = visibleQuestionGroups.some((group) => group.meta.id === selectedQuestionId);
    if (!hasSelected) {
      setSelectedQuestionId(visibleQuestionGroups[0]?.meta.id ?? null);
    }
  }, [selectedQuestionId, visibleQuestionGroups]);

  const selectedGroup = useMemo(
    () => visibleQuestionGroups.find((group) => group.meta.id === selectedQuestionId) ?? null,
    [selectedQuestionId, visibleQuestionGroups],
  );

  const selectedQuestionIndex = selectedGroup
    ? visibleQuestionGroups.findIndex((group) => group.meta.id === selectedGroup.meta.id)
    : -1;

  const selectedAnswerRows = useMemo(() => {
    if (!selectedGroup) return [];
    return sortAnswerRows(selectedGroup.answers, answerSortMode);
  }, [answerSortMode, selectedGroup]);

  const selectedBestJudgeRun = useMemo(() => {
    return selectedAnswerRows
      .map(({ run }) => run)
      .filter((run): run is EnrichedRun => hasJudgeSignal(run))
      .reduce<EnrichedRun | null>((best, run) => {
        if (!best || compareJudgePriority(run, best) > 0) return run;
        return best;
      }, null);
  }, [selectedAnswerRows]);

  const strongestExecution = useMemo(() => {
    return [...visibleExecutions].sort((left, right) =>
      compareNullableMetric(getJudgeCorrectnessScore(right.summary), getJudgeCorrectnessScore(left.summary)) ||
      compareNullableMetric(ratio(right.summary.judge?.judgeCorrectCount, right.summary.judge?.judgeRuns), ratio(left.summary.judge?.judgeCorrectCount, left.summary.judge?.judgeRuns)) ||
      compareNullableMetric(right.summary.judge?.meanCompleteness, left.summary.judge?.meanCompleteness) ||
      compareNullableMetric(left.summary.cost?.meanTotalCostUsdPerRun, right.summary.cost?.meanTotalCostUsdPerRun),
    )[0] ?? null;
  }, [visibleExecutions]);

  const cheapestReliableExecution = useMemo(() => {
    const reliable = visibleExecutions.filter((execution) => {
      const score = getJudgeCorrectnessScore(execution.summary) ?? Number.NEGATIVE_INFINITY;
      const errorRate = getExecutionErrorRate(execution.summary) ?? 0;
      return score >= 0 && errorRate <= 0.1 && execution.summary.cost?.meanTotalCostUsdPerRun != null;
    });
    return reliable.sort((left, right) =>
      compareNullableMetric(left.summary.cost?.meanTotalCostUsdPerRun, right.summary.cost?.meanTotalCostUsdPerRun) ||
      compareNullableMetric(getJudgeCorrectnessScore(right.summary), getJudgeCorrectnessScore(left.summary)),
    )[0] ?? null;
  }, [visibleExecutions]);

  const fastestReliableExecution = useMemo(() => {
    const reliable = visibleExecutions.filter((execution) => {
      const score = getJudgeCorrectnessScore(execution.summary) ?? Number.NEGATIVE_INFINITY;
      const errorRate = getExecutionErrorRate(execution.summary) ?? 0;
      return score >= 0 && errorRate <= 0.1 && execution.summary.timing?.meanCollectMsPerRun != null;
    });
    return reliable.sort((left, right) =>
      compareNullableMetric(left.summary.timing?.meanCollectMsPerRun, right.summary.timing?.meanCollectMsPerRun) ||
      compareNullableMetric(getJudgeCorrectnessScore(right.summary), getJudgeCorrectnessScore(left.summary)),
    )[0] ?? null;
  }, [visibleExecutions]);


  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    if (!bundledSnapshot) {
      setMessages((current) => ['Bundled question metadata is still loading.', ...current].slice(0, 6));
      return;
    }
    const pickedFiles = pickAggregateFiles(Array.from(fileList));
    if (pickedFiles.length === 0) {
      setMessages((current) => ['No aggregate.json files found.', ...current].slice(0, 6));
      return;
    }
    const { executions: loaded, errors } = await loadExecutionsFromFiles(pickedFiles, bundledSnapshot.questionBank);
    setExecutions((current) => {
      const merged = dedupeExecutions([...current, ...loaded]);
      return merged.sort((left, right) => left.label.localeCompare(right.label));
    });
    if (loaded.length > 0) {
      setMessages((current) => [`Added ${loaded.length} execution(s).`, ...errors, ...current].slice(0, 6));
    } else {
      setMessages((current) => [...errors, ...current].slice(0, 6));
    }
  }

  function removeExecution(executionId: string) {
    setExecutions((current) => current.filter((execution) => execution.id !== executionId));
  }

  function clearAll() {
    setExecutions([]);
    setMessages([]);
    setExecutionOrder([]);
    setHiddenExecutionIds([]);
    setOpenAnswerRows({});
  }

  function restoreRecentRuns() {
    if (!bundledSnapshot) return;
    const bundledExecutions = [...bundledSnapshot.bundledExecutions].sort((left, right) =>
      left.label.localeCompare(right.label),
    );
    setExecutions(bundledExecutions);
    setExecutionOrder(bundledExecutions.map((execution) => execution.id));
    setHiddenExecutionIds([]);
    setOpenAnswerRows({});
  }

  function toggleExecutionVisibility(executionId: string) {
    setHiddenExecutionIds((current) =>
      current.includes(executionId)
        ? current.filter((id) => id !== executionId)
        : [...current, executionId],
    );
  }

  function moveExecution(executionId: string, direction: -1 | 1) {
    setExecutionOrder((current) => {
      const index = current.indexOf(executionId);
      if (index < 0) return current;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  function showAllExecutions() {
    setHiddenExecutionIds([]);
  }

  function hideAllExecutions() {
    setHiddenExecutionIds(executions.map((execution) => execution.id));
  }

  function setAllVisibleAnswerRows(open: boolean) {
    if (!selectedGroup) return;
    const nextEntries = selectedAnswerRows.map(({ execution }) => [
      makeAnswerRowKey(selectedGroup.meta.id, execution.id),
      open,
    ] as const);
    setOpenAnswerRows((current) => ({ ...current, ...Object.fromEntries(nextEntries) }));
  }

  function toggleAnswerRow(questionId: string, executionId: string) {
    const key = makeAnswerRowKey(questionId, executionId);
    setOpenAnswerRows((current) => ({
      ...current,
      [key]: !(current[key] ?? false),
    }));
  }

  function moveQuestionSelection(direction: -1 | 1) {
    if (selectedQuestionIndex < 0) return;
    const nextIndex = selectedQuestionIndex + direction;
    const nextGroup = visibleQuestionGroups[nextIndex];
    if (nextGroup) setSelectedQuestionId(nextGroup.meta.id);
  }

  return (
    <div className={`workspace-shell ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setSidebarOpen((current) => !current)}
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      >
        {sidebarOpen ? '‹' : '›'}
      </button>

      <aside className="desk-sidebar">
        <div className="desk-sidebar-inner">
          <div className="sidebar-masthead">
            <h1>Benchmark Visualizer</h1>
          </div>

          <details className="sidebar-section" open>
            <summary><span className="disclosure">Data</span></summary>
            <div className="sidebar-section-body">
              <div className="button-stack">
                <button type="button" className="button button-solid" onClick={() => fileInputRef.current?.click()}>
                  Add aggregate files
                </button>
                <button type="button" className="button" onClick={() => folderInputRef.current?.click()}>
                  Add run folders
                </button>
                <button type="button" className="button" onClick={restoreRecentRuns}>
                  Restore recent
                </button>
                <button type="button" className="button button-ghost" onClick={clearAll}>
                  Clear
                </button>
              </div>
            </div>
          </details>

          <details className="sidebar-section" open>
            <summary><span className="disclosure">Jump to</span></summary>
            <nav className="section-nav">
              <a href="#overview">Overview</a>
              <a href="#search-story">Search story</a>
              <a href="#question-review">Question review</a>
              <a href="#metric-desk">Metric desk</a>
            </nav>
          </details>

          {runTypeOptions.length > 1 ? (
            <details className="sidebar-section" open>
              <summary><span className="disclosure">Run types ({runTypeOptions.length})</span></summary>
              <div className="sidebar-section-body">
                <div className="run-type-list">
                  {runTypeOptions.map((option) => {
                    const isHidden = hiddenRunTypes.includes(option.key);
                    return (
                      <label key={option.key} className={`run-type-row ${isHidden ? 'is-hidden' : ''}`}>
                        <input
                          type="checkbox"
                          checked={!isHidden}
                          onChange={() => toggleRunTypeVisibility(option.key)}
                        />
                        <span className="run-type-label">{option.label}</span>
                        <span className="run-type-count">{option.count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </details>
          ) : null}

          <details className="sidebar-section" open>
            <summary><span className="disclosure">Quality filter</span></summary>
            <div className="sidebar-section-body">
              <label className="slider-filter">
                <div className="slider-filter-head">
                  <span>Max error rate</span>
                  <strong>{maxErrorRatePercent}%</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={maxErrorRatePercent}
                  onChange={(event) => setMaxErrorRatePercent(Number(event.target.value))}
                />
              </label>
              <div className="slider-filter-foot">
                <span>Showing runs at or below {maxErrorRatePercent}% errors.</span>
                {maxErrorRatePercent < 100 ? (
                  <button type="button" className="button button-tiny" onClick={() => setMaxErrorRatePercent(100)}>
                    Show all error rates
                  </button>
                ) : null}
              </div>
            </div>
          </details>

          <details className="sidebar-section" open>
            <summary><span className="disclosure">Pareto frontier</span></summary>
            <div className="sidebar-section-body">
              <label className={`run-type-row ${paretoFrontierOnly ? '' : 'is-hidden'}`}>
                <input
                  type="checkbox"
                  checked={paretoFrontierOnly}
                  onChange={() => setParetoFrontierOnly((current) => !current)}
                />
                <span className="run-type-label">Only models on selected frontiers</span>
                <span className="run-type-count">{selectedParetoFrontierModelCount}</span>
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="button button-tiny"
                  onClick={() => setSelectedParetoFrontierFilters(DEFAULT_PARETO_FRONTIER_FILTERS)}
                >
                  All charts
                </button>
                <button
                  type="button"
                  className="button button-tiny"
                  onClick={() => setSelectedParetoFrontierFilters([])}
                >
                  No charts
                </button>
              </div>
              <div className="run-type-list">
                {PARETO_FRONTIER_FILTERS.map((filter) => {
                  const isSelected = selectedParetoFrontierFilters.includes(filter.key);
                  const frontierCount = paretoFrontierExecutionIdsByFilter.get(filter.key)?.size ?? 0;
                  return (
                    <label key={filter.key} className={`run-type-row ${isSelected ? '' : 'is-hidden'}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          setSelectedParetoFrontierFilters((current) =>
                            current.includes(filter.key)
                              ? current.filter((key) => key !== filter.key)
                              : [...current, filter.key],
                          )
                        }
                      />
                      <span className="run-type-label">{filter.label}</span>
                      <span className="run-type-count">{frontierCount}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </details>

          <details className="sidebar-section" open>
            <summary><span className="disclosure">Question metadata</span></summary>
            <div className="sidebar-section-body">
              <label className="control-field">
                <span>Taxonomy tag</span>
                <select value={selectedTaxonomyTag} onChange={(event) => setSelectedTaxonomyTag(event.target.value)}>
                  <option value={ALL_METADATA_FILTER_VALUE}>All tags</option>
                  {questionMetadataOptions.taxonomyTags.map((tag) => (
                    <option key={tag} value={tag}>{humanizeToken(tag)}</option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <span>Platform</span>
                <select value={selectedPlatformScope} onChange={(event) => setSelectedPlatformScope(event.target.value)}>
                  <option value={ALL_METADATA_FILTER_VALUE}>All platforms</option>
                  <option value={OTHER_PLATFORM_FILTER_VALUE}>Other (not macOS)</option>
                  {questionMetadataOptions.platformScopes.map((scope) => (
                    <option key={scope} value={scope}>{formatPlatformScopeLabel(scope)}</option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <span>Question shape</span>
                <select value={selectedQuestionShape} onChange={(event) => setSelectedQuestionShape(event.target.value)}>
                  <option value={ALL_METADATA_FILTER_VALUE}>All shapes</option>
                  {questionMetadataOptions.questionShapes.map((shape) => (
                    <option key={shape} value={shape}>{humanizeToken(shape)}</option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <span>Evidence basis</span>
                <select value={selectedEvidenceBasis} onChange={(event) => setSelectedEvidenceBasis(event.target.value)}>
                  <option value={ALL_METADATA_FILTER_VALUE}>All evidence</option>
                  {questionMetadataOptions.evidenceBases.map((basis) => (
                    <option key={basis} value={basis}>{humanizeToken(basis)}</option>
                  ))}
                </select>
              </label>
              <div className="question-list-meta">
                {visibleQuestionGroups.length} matching question{visibleQuestionGroups.length === 1 ? '' : 's'}
              </div>
            </div>
          </details>

          <details className="sidebar-section" open>
            <summary><span className="disclosure">Models ({orderedExecutions.length})</span></summary>
            <div className="sidebar-section-body">
              <div className="button-row">
                <button type="button" className="button button-tiny" onClick={showAllExecutions}>Show all</button>
                <button type="button" className="button button-tiny" onClick={hideAllExecutions}>Hide all</button>
              </div>
              <div className="model-manager-list">
                {orderedExecutions.map((execution, index) => {
                  const isHidden = hiddenExecutionIds.includes(execution.id);
                  return (
                    <div key={execution.id} className={`model-manager-row ${isHidden ? 'is-hidden' : ''}`} title={execution.display.fullLabel}>
                      <label className="model-visibility-toggle">
                        <input
                          type="checkbox"
                          checked={!isHidden}
                          onChange={() => toggleExecutionVisibility(execution.id)}
                        />
                        <span title={execution.display.fullLabel}>{execution.display.primaryLabel}</span>
                      </label>
                      <div className="model-manager-actions">
                        <button
                          type="button"
                          className="icon-button"
                          disabled={index === 0}
                          onClick={() => moveExecution(execution.id, -1)}
                          aria-label={`Move ${execution.display.primaryLabel} up`}
                        >↑</button>
                        <button
                          type="button"
                          className="icon-button"
                          disabled={index === orderedExecutions.length - 1}
                          onClick={() => moveExecution(execution.id, 1)}
                          aria-label={`Move ${execution.display.primaryLabel} down`}
                        >↓</button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => removeExecution(execution.id)}
                          aria-label={`Remove ${execution.display.primaryLabel}`}
                        >×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>

          <details className="sidebar-section">
            <summary><span className="disclosure">Theme</span></summary>
            <div className="sidebar-section-body">
              <div className="theme-toggle" role="tablist" aria-label="Theme">
                <button
                  type="button"
                  className={`theme-option ${theme === 'light' ? 'is-active' : ''}`}
                  onClick={() => setTheme('light')}
                >Light</button>
                <button
                  type="button"
                  className={`theme-option ${theme === 'dark' ? 'is-active' : ''}`}
                  onClick={() => setTheme('dark')}
                >Dark</button>
              </div>
            </div>
          </details>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            multiple
            hidden
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.currentTarget.value = '';
            }}
            {...({ webkitdirectory: '' } as Record<string, string>)}
          />
        </div>
      </aside>

      <main className="report-main">
        <header className="panel masthead">
          <div className="masthead-top">
            <div>
              <h2>Comparative benchmark</h2>
              <div className="masthead-meta">
                Which models search docs well, which toolsets help most, and what quality/cost/time tradeoffs each run makes · dataset {questionBank.datasetVersion} · rubric {questionBank.rubricVersion} · snapshot {formatTimestamp(recentRunsBundle.generatedAt)}
              </div>
            </div>
            <div
              className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                void handleFiles(event.dataTransfer.files);
              }}
            >
              Drop aggregate.json
            </div>
          </div>
          <section className="summary-card decision-summary">
            <div className="summary-card-copy">
              <h3>What this page is trying to answer</h3>
              <p>
                The useful view is not a wall of per-model bars; it is whether tool access changes answer quality enough to justify
                its cost and latency. Start with the toolset comparison, then use the model ledger and question review to inspect
                the cases behind the aggregate scores.
              </p>
              <p>
                Primary KPIs: judge correctness score, correct rate, completeness, reference verification, errors, cost per question,
                and time per question. Deterministic answer score and retrieval MRR stay secondary debugging signals.
              </p>
            </div>
            <div className="decision-kpi-grid">
              <div className={`decision-kpi-card tone-${scoreTone(searchStoryHighlights.bestOverall?.correctnessScore)}`}>
                <span>Best toolset</span>
                <strong>{searchStoryHighlights.bestOverall?.label ?? '—'}</strong>
                <em>{formatNumber(searchStoryHighlights.bestOverall?.correctnessScore, 2)} score · {formatPercent(searchStoryHighlights.bestOverall?.correctRate)} correct</em>
              </div>
              <div className={`decision-kpi-card tone-${scoreTone(strongestExecution ? getJudgeCorrectnessScore(strongestExecution.summary) : undefined)}`}>
                <span>Strongest run</span>
                <strong>{strongestExecution?.display.primaryLabel ?? '—'}</strong>
                <em>{strongestExecution ? `${formatNumber(getJudgeCorrectnessScore(strongestExecution.summary), 2)} score · ${strongestExecution.display.toolSetLabel}` : 'no visible run'}</em>
              </div>
              <div className="decision-kpi-card">
                <span>Cheapest reliable</span>
                <strong>{cheapestReliableExecution?.display.primaryLabel ?? '—'}</strong>
                <em>{cheapestReliableExecution ? `${formatUsd(cheapestReliableExecution.summary.cost?.meanTotalCostUsdPerRun, 4)} / q · ${cheapestReliableExecution.display.toolSetLabel}` : 'no score ≥ 0 run'}</em>
              </div>
              <div className="decision-kpi-card">
                <span>Fastest reliable</span>
                <strong>{fastestReliableExecution?.display.primaryLabel ?? '—'}</strong>
                <em>{fastestReliableExecution ? `${formatDuration(fastestReliableExecution.summary.timing?.meanCollectMsPerRun)} / q · ${fastestReliableExecution.display.toolSetLabel}` : 'no score ≥ 0 run'}</em>
              </div>
            </div>
          </section>
        </header>

        {bundleLoadError ? (
          <section className="panel empty-panel">
            <h3>Bundled snapshot failed to load</h3>
            <p>{bundleLoadError}</p>
          </section>
        ) : null}

        {messages.length > 0 ? (
          <div className="note-strip">
            {messages.join(' · ')}
          </div>
        ) : null}

        {executions.length === 0 ? (
          <section className="panel empty-panel">
            <h3>{bundledSnapshot ? 'No benchmark runs loaded' : 'Loading benchmark snapshot…'}</h3>
            <p>
              {bundledSnapshot
                ? 'Restore recent runs from the sidebar, drop an aggregate.json, or upload run folders.'
                : 'Fetching bundled benchmark metadata and recent run summaries.'}
            </p>
          </section>
        ) : visibleExecutions.length === 0 ? (
          <section className="panel empty-panel">
            <h3>All models hidden</h3>
            <p>Re-enable at least one model in the sidebar to compare.</p>
            <div className="button-row">
              <button type="button" className="button button-solid" onClick={showAllExecutions}>Show all</button>
            </div>
          </section>
        ) : (
          <>
            <ToolsetStorySection
              summaries={toolsetSummaries}
              matrix={modelToolMatrix}
              highlights={searchStoryHighlights}
            />

            <section id="overview" className="panel section-panel">
              <div className="section-heading">
                <h3>Overview</h3>
              </div>
              {(() => {
                const ledgerColumns: LedgerColumn[] = [
                  { label: 'Correct', higherIsBetter: true, value: (ex) => ratio(ex.summary.judge?.judgeCorrectCount, ex.summary.judge?.judgeRuns), format: (v) => formatPercent(v) },
                  { label: 'Complete', higherIsBetter: true, value: (ex) => ex.summary.judge?.meanCompleteness, format: (v) => formatNumber(v, 2) },
                  { label: 'Total cost', higherIsBetter: false, value: (ex) => ex.summary.cost?.totalCostUsd, format: (v) => formatUsd(v, 2) },
                  { label: 'Judge cost', higherIsBetter: false, value: (ex) => ex.summary.cost?.totalJudgeCostUsd, format: (v) => formatUsd(v, 2) },
                  { label: 'Total time', higherIsBetter: false, value: (ex) => ex.summary.timing?.totalCollectMs, format: (v) => formatDuration(v) },
                  { label: 'Coverage', higherIsBetter: true, value: (ex) => ratio(ex.summary.judge?.judgeRuns, ex.summary.runs), format: (_v, ex) => formatCount(ex?.summary.judge?.judgeRuns, ex?.summary.runs) },
                  { label: 'Errored runs', higherIsBetter: false, value: (ex) => ratio(ex.summary.errors?.runsWithAnyError, ex.summary.runs), format: (_v, ex) => formatCount(ex?.summary.errors?.runsWithAnyError, ex?.summary.runs) },
                ];
                const extremes = ledgerColumns.map((column) => computeExtremes(visibleExecutions, column));
                return (
                  <>
                    <div className="ledger-table-head">
                      <span>Model</span>
                      {ledgerColumns.map((column) => (
                        <span key={column.label}>{column.label}</span>
                      ))}
                      <span aria-hidden />
                    </div>
                    <div className="ledger-stack">
                      {visibleExecutions.map((execution) => (
                        <details key={execution.id} className="ledger-row">
                          <summary className="ledger-row-summary">
                            <div className="ledger-model-cell">
                              <ExecutionLabel execution={execution} />
                            </div>
                            {ledgerColumns.map((column, index) => {
                              const value = column.value(execution);
                              const extreme = extremes[index];
                              const rank = rankValue(value, extreme, column.higherIsBetter);
                              return (
                                <span key={column.label} className={`ledger-metric-cell ${rank}`}>
                                  {column.format(value, execution)}
                                </span>
                              );
                            })}
                            <span className="ledger-row-chevron disclosure" aria-hidden />
                          </summary>
                          <div className="ledger-row-body">
                            <div className="metric-pair-grid">
                              <MetricPair label="Runs" value={String(execution.summary.runs ?? '—')} />
                              <MetricPair label="Correct" value={formatPercent(ratio(execution.summary.judge?.judgeCorrectCount, execution.summary.judge?.judgeRuns))} />
                              <MetricPair label="Completeness" value={formatNumber(execution.summary.judge?.meanCompleteness, 2)} />
                              <MetricPair label="Reference verified" value={formatPercent(execution.summary.judge?.referenceVerifiedRate)} />
                              <MetricPair label="Coverage" value={formatCount(execution.summary.judge?.judgeRuns, execution.summary.runs)} />
                              <MetricPair label="Errored runs" value={formatCount(execution.summary.errors?.runsWithAnyError, execution.summary.runs)} />
                              <MetricPair label="Total cost" value={formatUsd(execution.summary.cost?.totalCostUsd, 4)} />
                              <MetricPair label="Total collect cost" value={formatUsd(execution.summary.cost?.totalCollectCostUsd, 4)} />
                              <MetricPair label="Total judge cost" value={formatUsd(execution.summary.cost?.totalJudgeCostUsd, 4)} />
                              <MetricPair label="Cost / question" value={formatUsd(execution.summary.cost?.meanTotalCostUsdPerRun, 4)} />
                              <MetricPair label="Judge cost / question" value={formatUsd(execution.summary.cost?.meanJudgeCostUsdPerRun, 4)} />
                              <MetricPair label="Total time" value={formatDuration(execution.summary.timing?.totalCollectMs)} />
                              <MetricPair label="Time / question" value={formatDuration(execution.summary.timing?.meanCollectMsPerRun)} />
                            </div>
                            {getSummaryBreakdownEntries(execution.summary).length > 0 ? (
                              <div className="breakdown-ledger">
                                {getSummaryBreakdownEntries(execution.summary).map((entry) => (
                                  <div
                                    key={`${execution.id}-${entry.evidenceBasis ?? entry.questionType ?? 'breakdown'}`}
                                    className="breakdown-ledger-row"
                                  >
                                    <strong>{humanizeToken(entry.evidenceBasis ?? entry.questionType ?? 'unknown')}</strong>
                                    <span>{entry.runs ?? 0} runs</span>
                                    <span>{formatPercent(ratio(entry.judge?.judgeCorrectCount, entry.judge?.judgeRuns))} correct</span>
                                    <span>{formatNumber(entry.judge?.meanCompleteness, 2)} complete</span>
                                    <span>{formatPercent(entry.judge?.referenceVerifiedRate)} ref</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </details>
                      ))}
                    </div>
                  </>
                );
              })()}
            </section>

            <section id="question-review" className="panel section-panel">
              <div className="section-heading">
                <h3>Question review</h3>
              </div>

              <div className="review-layout">
                <aside className="question-list-pane">
                  <div className="question-list-toolbar">
                    <label className="control-field">
                      <span>Search</span>
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="id, title, text…"
                      />
                    </label>
                    <div className="question-filter-row">
                      <label className="control-field">
                        <span>Filter</span>
                        <select value={filterMode} onChange={(event) => setFilterMode(event.target.value as FilterMode)}>
                          <option value="interesting">Interesting</option>
                          <option value="all">All</option>
                          <option value="errors">Errors</option>
                          <option value="disagreement">Disagreement</option>
                        </select>
                      </label>
                      <label className="control-field">
                        <span>Sort</span>
                        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                          <option value="dataset">Dataset</option>
                          <option value="judge-risk">Weakest first</option>
                          <option value="most-disagreement">Disagreement</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="question-list-meta">{visibleQuestionGroups.length} question{visibleQuestionGroups.length === 1 ? '' : 's'}</div>
                  <div className="question-list-rail">
                    {visibleQuestionGroups.map((group) => {
                      const isActive = group.meta.id === selectedQuestionId;
                      return (
                        <button
                          key={group.meta.id}
                          type="button"
                          className={`question-list-item ${isActive ? 'is-active' : ''}`}
                          onClick={() => setSelectedQuestionId(group.meta.id)}
                        >
                          <div className="question-list-item-top">
                            <span className={`score-dot tone-${scoreTone(group.judgeCorrectnessScore)}`} />
                            <span>{padQuestionOrder(group.meta.order)}</span>
                            <span>{formatNumber(group.judgeCorrectnessScore, 2)}</span>
                            {group.hasErrors ? <span style={{ color: 'var(--danger)' }}>err</span> : null}
                          </div>
                          <strong>{group.meta.title}</strong>
                          <div className="question-list-item-foot">
                            <span>{humanizeToken(group.meta.evidenceBasis)}</span>
                            <span>{formatCount(group.judgeCoverageCount, visibleExecutions.length)} judged</span>
                            {group.disagreementCount > 1 ? <span>disagree {group.disagreementCount}</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <div className="question-focus-pane">
                  {selectedGroup ? (
                    <>
                      <div className="focus-nav">
                        <button
                          type="button"
                          className="button button-tiny"
                          disabled={selectedQuestionIndex <= 0}
                          onClick={() => moveQuestionSelection(-1)}
                        >← Prev</button>
                        <div className="focus-nav-meta">
                          {selectedQuestionIndex + 1} / {visibleQuestionGroups.length}
                        </div>
                        <button
                          type="button"
                          className="button button-tiny"
                          disabled={selectedQuestionIndex < 0 || selectedQuestionIndex >= visibleQuestionGroups.length - 1}
                          onClick={() => moveQuestionSelection(1)}
                        >Next →</button>
                      </div>

                      <header className="focus-question-header">
                        <h3>{padQuestionOrder(selectedGroup.meta.order)} · {selectedGroup.meta.title}</h3>
                        <p>{selectedGroup.meta.question}</p>
                        <div className="focus-meta-line">
                          <span className="mono">{selectedGroup.meta.id}</span>
                          <span>{humanizeToken(selectedGroup.meta.evidenceBasis)}</span>
                          <span>{humanizeToken(selectedGroup.meta.questionShape)}</span>
                          <span>{formatPlatformScopeLabel(selectedGroup.meta.platformScope)}</span>
                          <span>{formatCount(selectedGroup.judgeCoverageCount, visibleExecutions.length)} judged</span>
                          {selectedGroup.disagreementCount > 1 ? <span>disagreement {selectedGroup.disagreementCount}</span> : null}
                        </div>
                        <div className="focus-header-badges">
                          <Badge tone={scoreTone(selectedGroup.judgeCorrectnessScore)}>
                            correctness {formatNumber(selectedGroup.judgeCorrectnessScore, 2)}
                          </Badge>
                          <Badge tone="neutral">
                            completeness {formatNumber(selectedGroup.meanCompleteness, 2)}
                          </Badge>
                          {selectedGroup.hasErrors ? <Badge tone="danger">errors</Badge> : null}
                        </div>
                      </header>

                      <div className="question-dossier-grid">
                        <section className="dossier-panel">
                          <div className="panel-topline">Reference answer</div>
                          <MarkdownBlock text={selectedGroup.meta.referenceAnswer} />
                        </section>
                        <section className="dossier-panel">
                          <div className="panel-topline">Deterministic rubric</div>
                          <RubricList title="Must mention" items={selectedGroup.meta.rubric.mustMention} tone="success" />
                          <RubricGroupList title="One from each group" groups={selectedGroup.meta.rubric.mustMentionAnyOf ?? []} tone="warn" />
                          <RubricList title="Must not mention" items={selectedGroup.meta.rubric.mustNotMention} tone="danger" />
                          {selectedGroup.meta.pitfall ? (
                            <div className="pitfall-line">Pitfall: {selectedGroup.meta.pitfall}</div>
                          ) : null}
                          {selectedGroup.meta.taxonomyTags.length > 0 ? (
                            <div>
                              <div className="panel-topline" style={{ marginTop: 8 }}>Taxonomy tags</div>
                              <ul className="path-list">
                                {selectedGroup.meta.taxonomyTags.map((tag) => (
                                  <li key={`${selectedGroup.meta.id}-${tag}`}>{tag}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {selectedGroup.meta.goldEvidence.length > 0 ? (
                            <div>
                              <div className="panel-topline" style={{ marginTop: 8 }}>Gold evidence</div>
                              <ul className="path-list">
                                {selectedGroup.meta.goldEvidence.map((evidence) => (
                                  <li key={`${selectedGroup.meta.id}-${evidence.filePath}`}>{evidence.filePath}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </section>
                      </div>

                      <section className="focus-scoreboard">
                        <div className="focus-scoreboard-head">
                          <h4>Answers ({selectedAnswerRows.length})</h4>
                          <div className="scoreboard-controls">
                            <label className="inline-control">
                              <span>Sort</span>
                              <select value={answerSortMode} onChange={(event) => setAnswerSortMode(event.target.value as AnswerSortMode)}>
                                <option value="execution-order">Model order</option>
                                <option value="score-desc">Best score</option>
                                <option value="judge-best">Best judge</option>
                                <option value="cost-low">Lowest cost</option>
                              </select>
                            </label>
                            <button type="button" className="button button-tiny" onClick={() => setAllVisibleAnswerRows(true)}>Expand all</button>
                            <button type="button" className="button button-tiny" onClick={() => setAllVisibleAnswerRows(false)}>Collapse all</button>
                          </div>
                        </div>

                        <div className="scoreboard-wrap">
                          <table className="scoreboard-table">
                            <thead>
                              <tr>
                                <th>Model</th>
                                <th>Correctness</th>
                                <th>Completeness</th>
                                <th>Cost</th>
                                <th aria-label="Expand" style={{ width: 40 }} />
                              </tr>
                            </thead>
                            <tbody>
                              {selectedAnswerRows.map(({ execution, run }) => {
                                const key = makeAnswerRowKey(selectedGroup.meta.id, execution.id);
                                const isOpen = openAnswerRows[key] ?? false;
                                const isBest =
                                  run != null &&
                                  selectedBestJudgeRun != null &&
                                  compareJudgePriority(run, selectedBestJudgeRun) === 0;
                                const hasError = Boolean(run?.errors?.collectHadError || run?.errors?.judgeHadError);
                                const rowClassName = [
                                  'score-row',
                                  isBest ? 'is-best' : '',
                                  hasError ? 'has-error' : '',
                                ].filter(Boolean).join(' ');

                                return (
                                  <FragmentRow key={`${selectedGroup.meta.id}-${execution.id}`}>
                                    <tr
                                      className={rowClassName}
                                      onClick={() => toggleAnswerRow(selectedGroup.meta.id, execution.id)}
                                      style={{ cursor: 'pointer' }}
                                    >
                                      <th>
                                        <div className="table-model-cell">
                                          <ExecutionLabel execution={execution} compact />
                                        </div>
                                      </th>
                                      <td>
                                        {run?.judge?.verdict || run?.judge?.correctness != null ? (
                                          <Badge tone={verdictTone(run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}>
                                            {humanizeToken(run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}
                                          </Badge>
                                        ) : '—'}
                                      </td>
                                      <td>{formatJudgeAxis(run?.judge?.completeness)}</td>
                                      <td>{formatUsd(run?.cost?.totalUsd, 4)}</td>
                                      <td>
                                        <span className={`disclosure ${isOpen ? 'is-open' : ''}`} aria-hidden />
                                      </td>
                                    </tr>
                                    {isOpen ? (
                                      <tr className="score-detail-row">
                                        <td colSpan={5}>
                                          {run ? (
                                            <div className="score-detail-body">
                                              <section className="detail-answer-column">
                                                <div className="detail-section-heading">Answer</div>
                                                <MarkdownBlock text={run.answer?.finalAnswer ?? 'No answer captured.'} />
                                                {run.answer?.evidenceSummary ? (
                                                  <details className="inline-details">
                                                    <summary><span className="disclosure">Evidence summary</span></summary>
                                                    <div className="evidence-summary">{run.answer.evidenceSummary}</div>
                                                  </details>
                                                ) : null}
                                                {run.answer?.citationFilePaths?.length ? (
                                                  <details className="inline-details">
                                                    <summary><span className="disclosure">Citations ({run.answer.citationFilePaths.length})</span></summary>
                                                    <ul className="path-list">
                                                      {run.answer.citationFilePaths.map((filePath) => (
                                                        <li key={`${run.runId}-${filePath}`}>{filePath}</li>
                                                      ))}
                                                    </ul>
                                                  </details>
                                                ) : null}
                                              </section>
                                              <aside className="detail-meta-column">
                                                <div className="detail-section">
                                                  <div className="judge-primary">
                                                    <div className="judge-primary-cell">
                                                      <span>Correctness</span>
                                                      <Badge tone={verdictTone(run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}>
                                                        {humanizeToken(run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? '—')}
                                                      </Badge>
                                                    </div>
                                                    <div className="judge-primary-cell">
                                                      <span>Completeness</span>
                                                      <strong>{formatJudgeAxis(run.judge?.completeness)}</strong>
                                                    </div>
                                                  </div>
                                                  {run.judge?.reasoning ? (
                                                    <div className="judge-reasoning">{run.judge.reasoning}</div>
                                                  ) : null}
                                                </div>

                                                {hasError ? (
                                                  <div className="detail-section">
                                                    <div className="detail-section-heading">Errors</div>
                                                    <div className="focus-header-badges">
                                                      {run.errors?.collectHadError ? <Badge tone="danger">collect error</Badge> : null}
                                                      {run.errors?.judgeHadError ? <Badge tone="danger">judge error</Badge> : null}
                                                    </div>
                                                  </div>
                                                ) : null}

                                                <details className="inline-details">
                                                  <summary><span className="disclosure">Judge details</span></summary>
                                                  <div className="metric-pair-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                                    <MetricPair label="Ref verified" value={formatBoolean(run.judge?.referenceVerified)} />
                                                    <MetricPair label="Status" value={run.judge?.status ?? '—'} />
                                                    <MetricPair label="Code example" value={formatJudgeScore(run.judge?.codeExample)} />
                                                    <MetricPair label="Explanation" value={formatJudgeScore(run.judge?.explanation)} />
                                                    <MetricPair label="Retrieval" value={formatJudgeScore(run.judge?.retrievalQuality)} />
                                                    <MetricPair label="Supports ref" value={formatBoolean(run.judge?.retrievalSupportsReferenceAnswer)} />
                                                    <MetricPair label="Correct pattern" value={formatBoolean(run.judge?.recommendsCorrectPattern)} />
                                                    <MetricPair label="Deprecated pattern" value={formatBoolean(run.judge?.recommendsDeprecatedPattern)} />
                                                  </div>
                                                </details>

                                                <details className="inline-details">
                                                  <summary><span className="disclosure">Deterministic grader</span></summary>
                                                  <div className="metric-pair-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                                    <MetricPair label="Score" value={run.grade?.score == null ? '—' : String(run.grade.score)} />
                                                    <MetricPair label="Grounded" value={run.grade?.grounded ? 'yes' : 'no'} />
                                                    <MetricPair label="Citations" value={String(run.answer?.citationCount ?? 0)} />
                                                    <MetricPair label="Agreement" value={run.grade?.agreement ? humanizeToken(run.grade.agreement) : '—'} />
                                                    <MetricPair label="Confidence" value={formatNumber(run.answer?.confidence, 2)} />
                                                    <MetricPair label="Cost" value={formatUsd(run.cost?.totalUsd, 4)} />
                                                    <MetricPair label="Time" value={formatDuration(run.timing?.collectMs)} />
                                                  </div>
                                                  {(run.grade?.mustMentionPassed?.length || run.grade?.mustMentionFailed?.length || run.grade?.mustNotMentionViolated?.length) ? (
                                                    <div style={{ marginTop: 8 }}>
                                                      <RubricList title="Passed" items={run.grade?.mustMentionPassed ?? []} tone="success" compact />
                                                      <RubricList title="Missed" items={run.grade?.mustMentionFailed ?? []} tone="warn" compact />
                                                      <RubricList title="Violated" items={run.grade?.mustNotMentionViolated ?? []} tone="danger" compact />
                                                    </div>
                                                  ) : null}
                                                </details>
                                              </aside>
                                            </div>
                                          ) : (
                                            <div className="missing-answer">No matching run for this question.</div>
                                          )}
                                        </td>
                                      </tr>
                                    ) : null}
                                  </FragmentRow>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </>
                  ) : (
                    <section className="panel empty-panel">
                      <h3>No question in current filter</h3>
                      <p>Relax search or filter to resume review.</p>
                    </section>
                  )}
                </div>
              </div>
            </section>

            <section id="metric-desk" className="panel section-panel">
              <div className="section-heading metric-desk-heading">
                <div>
                  <h3>Tradeoff desk</h3>
                  <p>Only the decision charts stay here: quality against cost and latency, with the Pareto frontier highlighted.</p>
                </div>
                <div className="chart-score-toggle" role="tablist" aria-label="Chart score metric">
                  <button
                    type="button"
                    className={`theme-option ${chartScoreMode === 'correct-rate' ? 'is-active' : ''}`}
                    onClick={() => setChartScoreMode('correct-rate')}
                    aria-pressed={chartScoreMode === 'correct-rate'}
                  >
                    Correct rate
                  </button>
                  <button
                    type="button"
                    className={`theme-option ${chartScoreMode === 'correctness-score' ? 'is-active' : ''}`}
                    onClick={() => setChartScoreMode('correctness-score')}
                    aria-pressed={chartScoreMode === 'correctness-score'}
                  >
                    Correctness score
                  </button>
                </div>
              </div>
              <div className="metric-desk-scatters">
                <MetricDeskScatter
                  executions={visibleExecutions}
                  xAxis={{
                    label: 'Cost / question',
                    value: (execution) => execution.summary.cost?.meanTotalCostUsdPerRun,
                    format: (value) => formatUsd(value, 4),
                    higherIsBetter: false,
                  }}
                  yAxis={chartScoreAxis}
                />
                <MetricDeskScatter
                  executions={visibleExecutions}
                  xAxis={{
                    label: 'Time / question',
                    value: (execution) => execution.summary.timing?.meanCollectMsPerRun,
                    format: (value) => formatDuration(value),
                    higherIsBetter: false,
                  }}
                  yAxis={chartScoreAxis}
                />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}


function ExecutionLabel({ execution, compact = false }: { execution: LoadedExecution; compact?: boolean }) {
  const chips = [
    `${execution.toolset.icon} ${execution.toolset.label}`,
    execution.display.routeLabel ? `via ${execution.display.routeLabel}` : null,
    execution.benchmarkRun.thinkingLevel ? `${execution.benchmarkRun.thinkingLevel} thinking` : null,
    compact ? null : execution.display.answerModeLabel,
    ...execution.display.variants,
  ].filter((chip): chip is string => Boolean(chip));

  return (
    <>
      <strong>{execution.display.primaryLabel}</strong>
      <span className="execution-chip-line">
        {chips.map((chip) => (
          <span key={`${execution.id}-${chip}`} className="execution-chip">{chip}</span>
        ))}
      </span>
    </>
  );
}

function ToolsetStorySection({
  summaries,
  matrix,
  highlights,
}: {
  summaries: ToolsetSummary[];
  matrix: ModelToolMatrix;
  highlights: SearchStoryHighlights;
}) {
  if (summaries.length === 0) return null;
  const highlightCards = [
    { label: 'Best search quality', summary: highlights.bestOverall, value: (summary: ToolsetSummary) => formatPercent(summary.correctRate) },
    { label: 'Best cheap option', summary: highlights.cheapestGood, value: (summary: ToolsetSummary) => formatUsd(summary.costPerQuestion, 4) },
    { label: 'Fastest acceptable', summary: highlights.fastestGood, value: (summary: ToolsetSummary) => formatDuration(summary.timePerQuestionMs) },
  ];

  return (
    <section id="search-story" className="panel section-panel">
      <div className="section-heading">
        <h3>Search story</h3>
        <p>
          This view groups the visible runs by toolset on corpus-backed questions so the page answers both questions at once:
          which models can search the docs, and which search setup actually helps.
        </p>
      </div>

      <div className="story-callouts">
        {highlightCards.map((card) => (
          <div key={card.label} className="story-callout-card">
            <span>{card.label}</span>
            <strong>{card.summary?.label ?? '—'}</strong>
            <em>{card.summary ? card.value(card.summary) : 'no eligible toolset'}</em>
          </div>
        ))}
        <div className="story-callout-card">
          <span>Watch list</span>
          <strong>{highlights.unstable.length === 0 ? 'No unstable toolsets' : `${highlights.unstable.length} unstable`}</strong>
          <em>{highlights.unstable.map((summary) => summary.label).join(', ') || '≤10% error rate'}</em>
        </div>
      </div>

      <div className="toolset-leaderboard-wrap">
        <table className="toolset-leaderboard">
          <thead>
            <tr>
              <th>Toolset</th>
              <th>Runs</th>
              <th>Correct</th>
              <th>Mean score</th>
              <th>Median</th>
              <th>Ref verified</th>
              <th>Retrieval</th>
              <th>Cost/q</th>
              <th>Time/q</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary, index) => (
              <tr key={summary.key} className={index === 0 ? 'is-leader' : ''}>
                <th><span className="toolset-name"><span aria-hidden>{summary.icon}</span>{summary.label}</span></th>
                <td>{formatCount(summary.judgedRuns, summary.runCount)}</td>
                <td>{formatPercent(summary.correctRate)}</td>
                <td>{formatNumber(summary.correctnessScore, 2)}</td>
                <td>{formatNumber(summary.medianCorrectnessScore, 2)}</td>
                <td>{formatPercent(summary.referenceVerifiedRate)}</td>
                <td>{formatJudgeScore(summary.retrievalQuality ?? undefined)}</td>
                <td>{formatUsd(summary.costPerQuestion, 4)}</td>
                <td>{formatDuration(summary.timePerQuestionMs)}</td>
                <td>{formatPercent(summary.errorRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      <ToolsetComparisonBars summaries={summaries} />

      <div className="model-tool-matrix-wrap">
        <div className="panel-topline">Model × toolset matrix</div>
        <div className="model-tool-matrix" style={{ gridTemplateColumns: `minmax(150px, 1.1fr) repeat(${matrix.toolsets.length}, minmax(120px, 1fr))` }}>
          <div className="matrix-corner">Model</div>
          {matrix.toolsets.map((toolset) => (
            <div key={toolset.key} className="matrix-head">{toolset.label}</div>
          ))}
          {matrix.models.flatMap((model) => [
            <div key={`${model}-label`} className="matrix-model">{model}</div>,
            ...matrix.toolsets.map((toolset) => {
              const cell = matrix.cells.get(matrixKey(model, toolset.key));
              return (
                <div key={`${model}-${toolset.key}`} className={`matrix-cell ${cell ? `tone-${scoreTone(cell.correctnessScore)}` : 'is-empty'}`} title={cell?.execution.display.fullLabel}>
                  {cell ? (
                    <>
                      <strong>{formatPercent(cell.correctRate)}</strong>
                      <span>{formatNumber(cell.correctnessScore, 2)} score</span>
                      <em>{formatUsd(cell.costPerQuestion, 4)} · {formatPercent(cell.errorRate)} err</em>
                    </>
                  ) : '—'}
                </div>
              );
            }),
          ])}
        </div>
      </div>
    </section>
  );
}

function ToolsetComparisonBars({ summaries }: { summaries: ToolsetSummary[] }) {
  if (summaries.length === 0) return null;
  const maxCost = Math.max(...summaries.map((summary) => summary.costPerQuestion ?? 0), Number.EPSILON);
  const maxTime = Math.max(...summaries.map((summary) => summary.timePerQuestionMs ?? 0), Number.EPSILON);

  return (
    <div className="toolset-bars-card">
      <div className="panel-topline">Toolset deltas at a glance</div>
      <div className="toolset-bars-grid">
        {summaries.map((summary) => {
          const scoreWidth = signedMetricWidth(summary.correctnessScore, -1, 1);
          const correctWidth = ratioToWidth(summary.correctRate);
          const costWidth = ratioToWidth(summary.costPerQuestion == null ? null : summary.costPerQuestion / maxCost);
          const timeWidth = ratioToWidth(summary.timePerQuestionMs == null ? null : summary.timePerQuestionMs / maxTime);
          return (
            <div key={summary.key} className="toolset-bars-row">
              <div className="toolset-bars-label">
                <strong><span className="toolset-name"><span aria-hidden>{summary.icon}</span>{summary.label}</span></strong>
                <span>{formatCount(summary.judgedRuns, summary.runCount)} judged · {formatPercent(summary.errorRate)} errors</span>
              </div>
              <ToolsetBar label="Score" value={formatNumber(summary.correctnessScore, 2)} width={scoreWidth} tone={scoreTone(summary.correctnessScore)} />
              <ToolsetBar label="Correct" value={formatPercent(summary.correctRate)} width={correctWidth} tone={scoreTone(summary.correctnessScore)} />
              <ToolsetBar label="Cost/q" value={formatUsd(summary.costPerQuestion, 4)} width={costWidth} tone="neutral" />
              <ToolsetBar label="Time/q" value={formatDuration(summary.timePerQuestionMs)} width={timeWidth} tone="neutral" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolsetBar({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: string;
  width: number;
  tone: Tone;
}) {
  return (
    <div className="toolset-bar-cell">
      <div className="toolset-bar-meta">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="toolset-bar-track">
        <div className={`toolset-bar-fill tone-${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function signedMetricWidth(value: number | null | undefined, min: number, max: number): number {
  if (value == null || Number.isNaN(value)) return 0;
  const normalized = (value - min) / (max - min || 1);
  return ratioToWidth(normalized);
}

function ratioToWidth(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(4, Math.min(100, Math.round(value * 100)));
}

const SCATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
  '#0d9488', '#be185d',
];

function MetricDeskScatter({
  executions,
  xAxis,
  yAxis,
}: {
  executions: LoadedExecution[];
  xAxis: ScatterAxis;
  yAxis: ScatterAxis;
}) {
  const points = useMemo(() => {
    return executions
      .map((execution, index) => ({
        execution,
        x: xAxis.value(execution),
        y: yAxis.value(execution),
        color: SCATTER_PALETTE[index % SCATTER_PALETTE.length],
      }))
      .filter(
        (point): point is {
          execution: LoadedExecution;
          x: number;
          y: number;
          color: string;
        } => typeof point.x === 'number' && typeof point.y === 'number',
      );
  }, [executions, xAxis, yAxis]);

  if (points.length === 0) {
    return (
      <div className="metric-card">
        <div className="metric-card-head">
          <strong>{yAxis.label} vs {xAxis.label}</strong>
        </div>
        <div className="empty-inline">no data</div>
      </div>
    );
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xDataMin = Math.min(...xValues);
  const xDataMax = Math.max(...xValues);
  const yDataMin = Math.min(...yValues);
  const yDataMax = Math.max(...yValues);

  const xDomain = niceDomain(xDataMin, xDataMax, xAxis.higherIsBetter);
  const yDomain = niceDomain(yDataMin, yDataMax, yAxis.higherIsBetter);

  const width = 420;
  const height = 280;
  const padLeft = 60;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 48;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const xRange = xDomain.max - xDomain.min || 1;
  const yRange = yDomain.max - yDomain.min || 1;

  const projectX = (value: number) => padLeft + ((value - xDomain.min) / xRange) * plotWidth;
  const projectY = (value: number) => padTop + plotHeight - ((value - yDomain.min) / yRange) * plotHeight;

  const xTicks = makeTicks(xDomain.min, xDomain.max, 5);
  const yTicks = makeTicks(yDomain.min, yDomain.max, 5);

  const frontier = computeParetoFrontier(points, xAxis.higherIsBetter, yAxis.higherIsBetter);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeId = hoveredId ?? pinnedId;
  const hasActive = activeId != null;
  const activePoint = hasActive ? points.find((point) => point.execution.id === activeId) : undefined;

  const togglePinned = (id: string) => {
    setPinnedId((current) => (current === id ? null : id));
  };

  return (
    <div className="metric-card scatter-card">
      <div className="metric-card-head">
        <strong>{yAxis.label} vs {xAxis.label}</strong>
        <span>{paretoCornerLabel(xAxis.higherIsBetter, yAxis.higherIsBetter)} is best</span>
      </div>
      <svg className="scatter-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yAxis.label} vs ${xAxis.label}`}>
        <rect
          x={padLeft}
          y={padTop}
          width={plotWidth}
          height={plotHeight}
          className="scatter-plot-area"
        />
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={padLeft} y1={projectY(tick)} x2={width - padRight} y2={projectY(tick)} className="scatter-gridline" />
            <text x={padLeft - 8} y={projectY(tick)} className="scatter-axis-label" textAnchor="end" dominantBaseline="middle">
              {yAxis.format(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={projectX(tick)} y1={padTop} x2={projectX(tick)} y2={height - padBottom} className="scatter-gridline" />
            <text x={projectX(tick)} y={height - padBottom + 14} className="scatter-axis-label" textAnchor="middle">
              {xAxis.format(tick)}
            </text>
          </g>
        ))}
        <line x1={padLeft} y1={height - padBottom} x2={width - padRight} y2={height - padBottom} className="scatter-axis" />
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} className="scatter-axis" />
        <text
          x={padLeft + plotWidth / 2}
          y={height - 8}
          className="scatter-axis-title"
          textAnchor="middle"
        >
          {xAxis.label}
        </text>
        <text
          x={14}
          y={padTop + plotHeight / 2}
          className="scatter-axis-title"
          textAnchor="middle"
          transform={`rotate(-90 14 ${padTop + plotHeight / 2})`}
        >
          {yAxis.label}
        </text>
        {frontier.length >= 2 ? (
          <polyline
            className="scatter-frontier"
            points={frontier
              .map((point) => `${projectX(point.x)},${projectY(point.y)}`)
              .join(' ')}
          />
        ) : null}
        {points.map((point) => {
          const isFrontier = frontier.some((frontierPoint) => frontierPoint.execution.id === point.execution.id);
          const isActive = activeId === point.execution.id;
          const isPinned = pinnedId === point.execution.id;
          const isDimmed = hasActive && !isActive;
          const radius = isActive ? 8 : isFrontier ? 7 : 5.5;
          return (
            <g
              key={point.execution.id}
              className={`scatter-point ${isDimmed ? 'is-dimmed' : ''} ${isActive ? 'is-active' : ''}`}
              onMouseEnter={() => setHoveredId(point.execution.id)}
              onMouseLeave={() => setHoveredId((current) => (current === point.execution.id ? null : current))}
              onClick={() => togglePinned(point.execution.id)}
              style={{ cursor: 'pointer' }}
            >
              <title>{`${point.execution.display.fullLabel}\n${yAxis.label}: ${yAxis.format(point.y)}\n${xAxis.label}: ${xAxis.format(point.x)}`}</title>
              <circle
                cx={projectX(point.x)}
                cy={projectY(point.y)}
                r={radius}
                className={`scatter-dot ${isFrontier ? 'is-frontier' : ''} ${isPinned ? 'is-pinned' : ''}`}
                style={{ fill: point.color }}
              />
            </g>
          );
        })}
        {activePoint ? (
          <ScatterCallout
            point={activePoint}
            xAxis={xAxis}
            yAxis={yAxis}
            projectX={projectX}
            projectY={projectY}
            plotRight={width - padRight}
            plotTop={padTop}
            plotBottom={height - padBottom}
            plotLeft={padLeft}
          />
        ) : null}
      </svg>
      <div className="scatter-legend">
        {points.map((point) => {
          const isActive = activeId === point.execution.id;
          const isPinned = pinnedId === point.execution.id;
          const isDimmed = hasActive && !isActive;
          return (
            <button
              key={point.execution.id}
              type="button"
              className={`scatter-legend-item ${isActive ? 'is-active' : ''} ${isPinned ? 'is-pinned' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
              title={point.execution.display.fullLabel}
              onMouseEnter={() => setHoveredId(point.execution.id)}
              onMouseLeave={() => setHoveredId((current) => (current === point.execution.id ? null : current))}
              onClick={() => togglePinned(point.execution.id)}
            >
              <span className="scatter-legend-swatch" style={{ background: point.color }} />
              <span className="scatter-legend-label">{point.execution.display.primaryLabel}</span>
              <span className="scatter-legend-value">
                {yAxis.format(point.y)} · {xAxis.format(point.x)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScatterCallout({
  point,
  xAxis,
  yAxis,
  projectX,
  projectY,
  plotLeft,
  plotRight,
  plotTop,
  plotBottom,
}: {
  point: { execution: LoadedExecution; x: number; y: number; color: string };
  xAxis: ScatterAxis;
  yAxis: ScatterAxis;
  projectX: (value: number) => number;
  projectY: (value: number) => number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
}) {
  const cx = projectX(point.x);
  const cy = projectY(point.y);
  const labelLines = [
    point.execution.display.primaryLabel,
    `${point.execution.display.toolSetLabel} · ${yAxis.format(point.y)} · ${xAxis.format(point.x)}`,
  ];
  const maxLineLen = Math.max(...labelLines.map((line) => line.length));
  const boxWidth = Math.max(110, Math.min(220, maxLineLen * 6.4 + 16));
  const boxHeight = 34;
  const gap = 12;

  let boxX = cx + gap;
  let anchor = 'start';
  if (boxX + boxWidth > plotRight) {
    boxX = cx - gap - boxWidth;
    anchor = 'end';
  }
  if (boxX < plotLeft) {
    boxX = Math.min(Math.max(cx - boxWidth / 2, plotLeft), plotRight - boxWidth);
    anchor = 'start';
  }

  let boxY = cy - boxHeight / 2;
  if (boxY < plotTop) boxY = plotTop;
  if (boxY + boxHeight > plotBottom) boxY = plotBottom - boxHeight;

  const textX = anchor === 'end' ? boxX + boxWidth - 8 : boxX + 8;
  const textAnchor = anchor === 'end' ? 'end' : 'start';

  return (
    <g className="scatter-callout" pointerEvents="none">
      <rect
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        rx={4}
        className="scatter-callout-box"
      />
      <rect
        x={boxX}
        y={boxY}
        width={3}
        height={boxHeight}
        className="scatter-callout-accent"
        style={{ fill: point.color }}
      />
      <text x={textX} y={boxY + 14} textAnchor={textAnchor} className="scatter-callout-title">
        {labelLines[0]}
      </text>
      <text x={textX} y={boxY + 28} textAnchor={textAnchor} className="scatter-callout-sub">
        {labelLines[1]}
      </text>
    </g>
  );
}


function buildToolsetSummaries(executions: LoadedExecution[]): ToolsetSummary[] {
  const groups = new Map<string, LoadedExecution[]>();
  for (const execution of executions) {
    const key = execution.display.toolSetKey;
    const group = groups.get(key);
    if (group) group.push(execution);
    else groups.set(key, [execution]);
  }

  return Array.from(groups.entries())
    .map(([key, groupExecutions]) => summarizeToolset(key, groupExecutions))
    .sort((left, right) => compareNullableMetric(right.correctRate, left.correctRate)
      || compareNullableMetric(right.correctnessScore, left.correctnessScore)
      || compareNullableMetric(left.errorRate, right.errorRate)
      || left.label.localeCompare(right.label));
}

function summarizeToolset(key: string, executions: LoadedExecution[]): ToolsetSummary {
  const searchRuns = executions.flatMap((execution) => execution.runs.filter(isSearchBackedRun));
  const runs = searchRuns.length > 0 ? searchRuns : executions.flatMap((execution) => execution.runs);
  const judgedRuns = runs.filter(hasJudgeSignal);
  const correctRuns = judgedRuns.filter((run) => run.judge?.verdict === 'correct' || run.judge?.correctness === 1).length;
  const referenceRuns = judgedRuns.filter((run) => typeof run.judge?.referenceVerified === 'boolean');
  const retrievalScores = judgedRuns
    .map((run) => run.judge?.retrievalQuality)
    .filter((value): value is number => typeof value === 'number');
  const correctnessScores = runs.map((run) => getRunCorrectnessScore(run));
  const totalRuns = executions.reduce((sum, execution) => sum + (execution.summary.runs ?? 0), 0);
  const totalErrors = executions.reduce((sum, execution) => sum + (execution.summary.errors?.runsWithAnyError ?? 0), 0);

  return {
    key,
    label: executions[0]?.toolset.label ?? executions[0]?.display.toolSetLabel ?? humanizeToken(key),
    icon: executions[0]?.toolset.icon ?? '🧰',
    executions,
    runCount: runs.length,
    judgedRuns: judgedRuns.length,
    correctRate: judgedRuns.length > 0 ? correctRuns / judgedRuns.length : null,
    correctnessScore: averageNumbers(correctnessScores),
    medianCorrectnessScore: medianNumbers(correctnessScores),
    referenceVerifiedRate: referenceRuns.length > 0
      ? referenceRuns.filter((run) => run.judge?.referenceVerified === true).length / referenceRuns.length
      : null,
    retrievalQuality: averageNumbers(retrievalScores),
    costPerQuestion: averageNumbers(executions.map((execution) => execution.summary.cost?.meanTotalCostUsdPerRun)),
    timePerQuestionMs: averageNumbers(executions.map((execution) => execution.summary.timing?.meanCollectMsPerRun)),
    errorRate: totalRuns > 0 ? totalErrors / totalRuns : null,
  };
}

function buildSearchStoryHighlights(summaries: ToolsetSummary[]): SearchStoryHighlights {
  const useful = summaries.filter((summary) => summary.key !== 'none' && summary.judgedRuns > 0);
  const stable = useful.filter((summary) => (summary.errorRate ?? 0) <= 0.1);
  const goodEnough = stable.filter((summary) => (summary.correctRate ?? Number.NEGATIVE_INFINITY) >= 0.5);
  return {
    bestOverall: useful[0] ?? null,
    cheapestGood: [...(goodEnough.length > 0 ? goodEnough : stable)].sort((left, right) => compareNullableMetric(left.costPerQuestion, right.costPerQuestion))[0] ?? null,
    fastestGood: [...(goodEnough.length > 0 ? goodEnough : stable)].sort((left, right) => compareNullableMetric(left.timePerQuestionMs, right.timePerQuestionMs))[0] ?? null,
    unstable: useful.filter((summary) => (summary.errorRate ?? 0) > 0.1),
  };
}

function buildModelToolMatrix(executions: LoadedExecution[]): ModelToolMatrix {
  const models = Array.from(new Set(executions.map((execution) => execution.display.primaryLabel))).sort();
  const toolsetMap = new Map<string, string>();
  for (const execution of executions) toolsetMap.set(execution.toolset.key, `${execution.toolset.icon} ${execution.toolset.label}`);
  const toolsets = Array.from(toolsetMap.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) => toolsetSortRank(left.key) - toolsetSortRank(right.key) || left.label.localeCompare(right.label));
  const cells = new Map<string, MatrixCellSummary>();

  for (const execution of executions) {
    const model = execution.display.primaryLabel;
    const key = matrixKey(model, execution.toolset.key);
    const cell = summarizeMatrixCell(execution);
    const existing = cells.get(key);
    if (!existing || compareMatrixCells(cell, existing) < 0) {
      cells.set(key, cell);
    }
  }

  return { models, toolsets, cells };
}

function summarizeMatrixCell(execution: LoadedExecution): MatrixCellSummary {
  return {
    execution,
    correctRate: ratio(execution.summary.judge?.judgeCorrectCount, execution.summary.judge?.judgeRuns) ?? null,
    correctnessScore: getJudgeCorrectnessScore(execution.summary) ?? null,
    costPerQuestion: execution.summary.cost?.meanTotalCostUsdPerRun ?? null,
    errorRate: ratio(execution.summary.errors?.runsWithAnyError, execution.summary.runs) ?? null,
  };
}

function compareMatrixCells(left: MatrixCellSummary, right: MatrixCellSummary): number {
  return compareNullableMetric(right.correctnessScore, left.correctnessScore)
    || compareNullableMetric(right.correctRate, left.correctRate)
    || compareNullableMetric(left.errorRate, right.errorRate)
    || compareNullableMetric(left.costPerQuestion, right.costPerQuestion);
}

function matrixKey(model: string, toolsetKey: string): string {
  return `${model}::${toolsetKey}`;
}

function toolsetSortRank(key: string): number {
  const order = ['none', 'read_only', 'read_grep', 'read_grep_glob', 'swift_docs_hybrid', 'swift_docs_search_read'];
  const index = order.indexOf(key);
  return index >= 0 ? index : order.length;
}

function isSearchBackedRun(run: EnrichedRun): boolean {
  return run.meta?.evidenceBasis === 'corpus' || run.question.evidenceBasis === 'corpus' || run.question.questionType === 'corpus_backed';
}

function averageNumbers(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function medianNumbers(values: Array<number | null | undefined>): number | null {
  const numbers = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (numbers.length === 0) return null;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 1) return numbers[middle] ?? null;
  const left = numbers[middle - 1];
  const right = numbers[middle];
  return left == null || right == null ? null : (left + right) / 2;
}

function compareNullableMetric(left: number | null | undefined, right: number | null | undefined): number {
  const leftMissing = left == null || Number.isNaN(left);
  const rightMissing = right == null || Number.isNaN(right);
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return left - right;
}

function getRunTypeInfo(execution: LoadedExecution): { key: string; label: string } {
  const key = `${execution.display.modeKey}/${execution.display.toolSetKey}`;
  const label = `${execution.display.modeLabel} · ${execution.display.toolSetLabel}`;
  return { key, label };
}

function paretoCornerLabel(xHigherIsBetter: boolean, yHigherIsBetter: boolean): string {
  const vertical = yHigherIsBetter ? 'top' : 'bottom';
  const horizontal = xHigherIsBetter ? 'right' : 'left';
  return `${vertical}-${horizontal}`;
}

function niceDomain(min: number, max: number, higherIsBetter: boolean): { min: number; max: number } {
  if (min === max) {
    const delta = Math.abs(min) * 0.1 || 1;
    return { min: min - delta, max: max + delta };
  }
  const range = max - min;
  const pad = range * 0.08;
  let domainMin = min - pad;
  let domainMax = max + pad;
  if (min >= 0 && min < range * 0.4) domainMin = 0;
  if (!higherIsBetter && domainMin < 0 && min >= 0) domainMin = 0;
  return { min: domainMin, max: domainMax };
}

function computeParetoFrontier<T extends { x: number; y: number; execution: LoadedExecution }>(
  points: T[],
  xHigherIsBetter: boolean,
  yHigherIsBetter: boolean,
): T[] {
  const frontier = points.filter((candidate) => {
    return !points.some((other) => {
      if (other === candidate) return false;
      const xDominates = xHigherIsBetter ? other.x >= candidate.x : other.x <= candidate.x;
      const yDominates = yHigherIsBetter ? other.y >= candidate.y : other.y <= candidate.y;
      const strictlyBetter =
        (xHigherIsBetter ? other.x > candidate.x : other.x < candidate.x) ||
        (yHigherIsBetter ? other.y > candidate.y : other.y < candidate.y);
      return xDominates && yDominates && strictlyBetter;
    });
  });
  return frontier.sort((left, right) => left.x - right.x);
}

function makeTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const step = (max - min) / count;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(min + step * i);
  return ticks;
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: Tone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function RubricList({
  title,
  items,
  tone,
  compact,
}: {
  title: string;
  items: string[];
  tone: 'success' | 'warn' | 'danger' | 'neutral';
  compact?: boolean;
}) {
  if (compact && items.length === 0) return null;
  return (
    <div className="rubric-block">
      <div className={`rubric-block-title tone-${tone}`}>{title}</div>
      {items.length === 0 ? (
        <div className="empty-inline">none</div>
      ) : (
        <ul className="rubric-list">
          {items.map((item) => (
            <li key={`${title}-${item}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RubricGroupList({
  title,
  groups,
  tone,
}: {
  title: string;
  groups: string[][];
  tone: 'success' | 'warn' | 'danger' | 'neutral';
}) {
  if (groups.length === 0) return null;
  return (
    <div className="rubric-block">
      <div className={`rubric-block-title tone-${tone}`}>{title}</div>
      {groups.map((group, index) => (
        <div key={`${title}-${index}`} className="rubric-group">
          <div className="rubric-group-label">group {index + 1}</div>
          <ul className="rubric-list">
            {group.map((item) => (
              <li key={`${title}-${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MarkdownBlock({ text }: { text: string }) {
  return (
    <Suspense fallback={<pre className="markdown-block markdown-fallback">{text}</pre>}>
      <LazyMarkdownBlock text={text} />
    </Suspense>
  );
}

type SummaryBreakdownEntry = {
  evidenceBasis?: string;
  questionType?: string;
  runs?: number;
  meanAnswerScore?: number;
  groundedRate?: number;
  meanRetrievalMrr?: number;
  judge?: LoadedExecution['summary']['judge'];
};

function getSummaryBreakdownEntries(summary: LoadedExecution['summary']): SummaryBreakdownEntry[] {
  return summary.evidenceBasisBreakdown ?? summary.questionTypeBreakdown ?? [];
}

function judgeVerdictFromCorrectness(
  correctness: number | undefined,
): 'correct' | 'partially_correct' | 'incorrect' | undefined {
  if (correctness === 1) return 'correct';
  if (correctness === 0) return 'partially_correct';
  if (correctness === -1) return 'incorrect';
  return undefined;
}

function buildQuestionGroups(executions: LoadedExecution[], questionList: QuestionMeta[]): QuestionGroup[] {
  const knownIds = new Set(questionList.map((question) => question.id));
  const extras = executions.flatMap((execution) =>
    execution.runs
      .filter((run) => run.meta && !knownIds.has(run.questionId))
      .map((run) => run.meta as QuestionMeta),
  );

  const mergedQuestions = [...questionList, ...extras].sort((left, right) => left.order - right.order);

  return mergedQuestions.map((meta) => {
    const answers = executions.map((execution) => ({
      execution,
      run: execution.runsByQuestionId[meta.id] ?? null,
    }));

    const scoredAnswers = answers
      .map((item) => item.run?.grade?.score)
      .filter((score): score is number => typeof score === 'number');

    const judgeAnswers = answers
      .map(({ run }) => run)
      .filter((run): run is EnrichedRun =>
        Boolean(
          run?.judge &&
            (run.judge.verdict !== undefined ||
              run.judge.correctness !== undefined ||
              run.judge.completeness !== undefined),
        ),
      );
    const judgeRuns = judgeAnswers.length;
    const judgeCorrectCount = judgeAnswers.reduce((count, run) => {
      if (run.judge?.verdict === 'correct' || run.judge?.correctness === 1) return count + 1;
      return count;
    }, 0);
    const completenessScores = judgeAnswers
      .map((run) => run.judge?.completeness)
      .filter((value): value is number => typeof value === 'number');
    const referenceVerifiedRuns = judgeAnswers.filter(
      (run) => typeof run.judge?.referenceVerified === 'boolean',
    ).length;
    const referenceVerifiedCount = judgeAnswers.reduce(
      (count, run) => (run.judge?.referenceVerified === true ? count + 1 : count),
      0,
    );

    const averageScore =
      scoredAnswers.length > 0
        ? scoredAnswers.reduce((sum, score) => sum + score, 0) / scoredAnswers.length
        : null;
    const meanCompleteness =
      completenessScores.length > 0
        ? completenessScores.reduce((sum, score) => sum + score, 0) / completenessScores.length
        : null;
    const judgeCorrectRate = judgeRuns > 0 ? judgeCorrectCount / judgeRuns : null;
    const referenceVerifiedRate =
      referenceVerifiedRuns > 0 ? referenceVerifiedCount / referenceVerifiedRuns : null;
    const judgeCoverageRate = answers.length > 0 ? judgeRuns / answers.length : null;
    const judgeCorrectnessScore =
      answers.length > 0
        ? answers.reduce((sum, { run }) => sum + getRunCorrectnessScore(run), 0) / answers.length
        : null;

    const disagreementTokens = new Set<string>();
    answers.forEach(({ run }) => {
      if (!run) {
        disagreementTokens.add('missing');
        return;
      }
      disagreementTokens.add(`score:${run.grade?.score ?? 'na'}`);
      disagreementTokens.add(`judge:${run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'na'}`);
      disagreementTokens.add(`agreement:${run.grade?.agreement ?? 'na'}`);
    });

    return {
      meta,
      answers,
      averageScore,
      judgeCorrectRate,
      judgeCorrectnessScore,
      meanCompleteness,
      referenceVerifiedRate,
      judgeCoverageRate,
      judgeCoverageCount: judgeRuns,
      disagreementCount: disagreementTokens.size,
      hasErrors: answers.some(
        ({ run }) => Boolean(run?.errors?.collectHadError || run?.errors?.judgeHadError),
      ),
      hasIncorrect: answers.some(
        ({ run }) => run?.grade?.correct === false || run?.judge?.correctness === -1 || run?.judge?.verdict === 'incorrect',
      ),
    };
  });
}

function sortAnswerRows(
  answers: QuestionGroup['answers'],
  mode: AnswerSortMode,
): QuestionGroup['answers'] {
  if (mode === 'execution-order') return answers;
  if (mode === 'score-desc') return answers.sort((left, right) => compareNullableNumbers(right.run?.grade?.score, left.run?.grade?.score));
  if (mode === 'judge-best') return answers.sort((left, right) => compareJudgePriority(right.run, left.run));
  if (mode === 'cost-low') return answers.sort((left, right) => compareNullableNumbers(left.run?.cost?.totalUsd, right.run?.cost?.totalUsd));
  return answers;
}

function compareQuestionGroups(left: QuestionGroup, right: QuestionGroup, sortMode: SortMode): number {
  if (sortMode === 'judge-risk') {
    return (
      compareNullableNumbers(left.judgeCorrectnessScore ?? undefined, right.judgeCorrectnessScore ?? undefined) ||
      compareNullableNumbers(left.judgeCorrectRate ?? undefined, right.judgeCorrectRate ?? undefined) ||
      compareNullableNumbers(left.meanCompleteness ?? undefined, right.meanCompleteness ?? undefined) ||
      compareNullableNumbers(left.judgeCoverageRate ?? undefined, right.judgeCoverageRate ?? undefined) ||
      Number(right.hasErrors) - Number(left.hasErrors) ||
      left.meta.order - right.meta.order
    );
  }
  if (sortMode === 'most-disagreement') {
    return right.disagreementCount - left.disagreementCount || left.meta.order - right.meta.order;
  }
  return left.meta.order - right.meta.order;
}

function compareNullableNumbers(left: number | undefined, right: number | undefined): number {
  if (left == null || right == null) return left == null ? 1 : -1;
  return left - right;
}

function verdictRank(verdict: string | undefined): number {
  if (verdict === 'correct') return 3;
  if (verdict === 'partially_correct') return 2;
  if (verdict === 'incorrect') return 1;
  return 0;
}

function hasJudgeSignal(run: EnrichedRun | null | undefined): run is EnrichedRun {
  return Boolean(
    run?.judge &&
      (run.judge.verdict !== undefined ||
        run.judge.correctness !== undefined ||
        run.judge.completeness !== undefined ||
        run.judge.referenceVerified !== undefined),
  );
}

function compareJudgePriority(
  left: EnrichedRun | null | undefined,
  right: EnrichedRun | null | undefined,
): number {
  const leftVerdict = verdictRank(left?.judge?.verdict ?? judgeVerdictFromCorrectness(left?.judge?.correctness));
  const rightVerdict = verdictRank(right?.judge?.verdict ?? judgeVerdictFromCorrectness(right?.judge?.correctness));
  if (leftVerdict !== rightVerdict) return leftVerdict - rightVerdict;

  const leftCompleteness = left?.judge?.completeness ?? Number.NEGATIVE_INFINITY;
  const rightCompleteness = right?.judge?.completeness ?? Number.NEGATIVE_INFINITY;
  if (leftCompleteness !== rightCompleteness) return leftCompleteness - rightCompleteness;

  const leftReferenceVerified = left?.judge?.referenceVerified === true ? 1 : left?.judge?.referenceVerified === false ? 0 : -1;
  const rightReferenceVerified = right?.judge?.referenceVerified === true ? 1 : right?.judge?.referenceVerified === false ? 0 : -1;
  if (leftReferenceVerified !== rightReferenceVerified) return leftReferenceVerified - rightReferenceVerified;
  return 0;
}

function makeAnswerRowKey(questionId: string, executionId: string): string {
  return `${questionId}::${executionId}`;
}

function getJudgeCorrectnessScore(summary: LoadedExecution['summary']): number | undefined {
  const runs = summary.runs;
  if (runs == null || runs === 0) return undefined;
  const judge = summary.judge;
  if (!judge) return undefined;
  const positiveCount = judge.correctnessPositiveCount ?? judge.judgeCorrectCount ?? 0;
  const negativeCount = judge.correctnessNegativeCount ?? judge.judgeIncorrectCount ?? 0;
  const errorCount = summary.errors?.runsWithAnyError ?? 0;
  const points = positiveCount - negativeCount - errorCount;
  return points / runs;
}

function getRunCorrectnessScore(run: EnrichedRun | null | undefined): number {
  if (!run) return 0;
  if (typeof run.judge?.correctness === 'number') return run.judge.correctness;
  if (run.judge?.verdict === 'correct') return 1;
  if (run.judge?.verdict === 'incorrect') return -1;
  if (run.judge?.verdict === 'partially_correct') return 0;
  if (run.errors?.collectHadError || run.errors?.judgeHadError) return -1;
  return 0;
}

function getExecutionErrorRate(summary: LoadedExecution['summary']): number | undefined {
  return ratio(summary.errors?.runsWithAnyError, summary.runs);
}

function ratio(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator == null || denominator == null || denominator === 0) return undefined;
  return numerator / denominator;
}

function formatNumber(value: number | undefined | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function formatPercent(value: number | undefined | null, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatUsd(value: number | undefined | null, digits = 4): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatDuration(ms: number | undefined | null): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  const totalSeconds = Math.round(ms / 1000);
  return `${totalSeconds.toLocaleString('en-US')}s`;
}

function formatBoolean(value: boolean | undefined): string {
  if (value == null) return '—';
  return value ? 'yes' : 'no';
}

function formatJudgeAxis(value: number | undefined): string {
  if (value == null) return '—';
  if (value === 1) return '+1';
  if (value === 0) return '0';
  if (value === -1) return '−1';
  return formatNumber(value, 2);
}

function formatJudgeScore(value: number | undefined): string {
  if (value == null) return '—';
  return `${value}/2`;
}

function formatCount(value: number | undefined, total: number | undefined): string {
  if (value == null) return '—';
  if (total == null) return String(value);
  return `${value}/${total}`;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function verdictTone(verdict: string): Tone {
  if (verdict === 'correct') return 'success';
  if (verdict === 'partially_correct') return 'warn';
  if (verdict === 'incorrect') return 'danger';
  return 'neutral';
}

function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return 'neutral';
  if (score >= 0.25) return 'success';
  if (score < 0) return 'danger';
  return 'warn';
}

function humanizeToken(token: string | undefined): string {
  if (!token) return '—';
  return token.replace(/_/g, ' ');
}

function formatPlatformScopeLabel(platformScope: string | undefined): string {
  if (!platformScope) return '—';
  if (platformScope === 'all') return 'Cross-platform';
  return humanizeToken(platformScope);
}

function matchesPlatformScopeFilter(filterValue: QuestionMetadataFilterValue, platformScope: string | undefined): boolean {
  if (filterValue === ALL_METADATA_FILTER_VALUE) return true;
  if (filterValue === OTHER_PLATFORM_FILTER_VALUE) return platformScope !== 'macos';
  return platformScope === filterValue;
}

function padQuestionOrder(order: number): string {
  return `Q${String(order).padStart(2, '0')}`;
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export default App;
