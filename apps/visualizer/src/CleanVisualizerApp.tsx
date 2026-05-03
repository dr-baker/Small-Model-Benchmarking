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
  buildQuestionList,
  dedupeExecutions,
  loadBundledSnapshot,
  loadExecutionsFromFiles,
  pickAggregateFiles,
} from './lib/aggregate';
import type { BundledSnapshot, EnrichedRun, LoadedExecution, QuestionMeta } from './types';
import { ToolsetIcon, getToolsetColor } from './components/ToolsetIcon';

type FilterMode = 'all' | 'interesting' | 'errors' | 'disagreement';
type SortMode = 'dataset' | 'judge-risk' | 'most-disagreement';
type ThemeMode = 'light' | 'dark';
type AnswerSortMode = 'execution-order' | 'score-desc' | 'judge-best' | 'cost-low';
type Tone = 'success' | 'warn' | 'danger' | 'accent' | 'neutral';

const ALL_METADATA_FILTER_VALUE = '__all__';
const OTHER_PLATFORM_FILTER_VALUE = '__other__';

type QuestionMetadataFilterValue = typeof ALL_METADATA_FILTER_VALUE | string;

interface QuestionGroup {
  meta: QuestionMeta;
  answers: Array<{
    execution: LoadedExecution;
    run: EnrichedRun | null;
  }>;
  averageScore: number | null;
  judgeCorrectRate: number | null;
  judgeIncorrectRate: number | null;
  judgeCorrectnessScore: number | null;
  meanCompleteness: number | null;
  referenceVerifiedRate: number | null;
  judgeCoverageRate: number | null;
  judgeCoverageCount: number;
  disagreementCount: number;
  hasErrors: boolean;
  hasIncorrect: boolean;
}

const THEME_STORAGE_KEY = 'benchmark-visualizer-theme';
const LazyMarkdownBlock = lazy(() => import('./components/MarkdownBlock'));

interface ScatterAxis {
  label: string;
  value: (execution: LoadedExecution) => number | undefined;
  format: (value: number | undefined) => string;
  higherIsBetter: boolean;
  domainMax?: number;
}

interface LedgerColumn {
  label: string;
  higherIsBetter: boolean;
  value: (execution: LoadedExecution) => number | undefined;
  format: (value: number | undefined, execution?: LoadedExecution) => string;
  highlightBest?: boolean;
  highlightWorst?: boolean;
}

interface LedgerExtremes {
  min: number;
  max: number;
  distinctCount: number;
}

interface ToolsetSummary {
  key: string;
  label: string;
  executions: LoadedExecution[];
  runCount: number;
  judgedRuns: number;
  correctnessScore: number | null;
  medianCorrectnessScore: number | null;
  referenceVerifiedRate: number | null;
  retrievalQuality: number | null;
  costPerQuestion: number | null;
  timePerQuestionMs: number | null;
  errorRate: number | null;
}


function computeExtremes(executions: LoadedExecution[], column: LedgerColumn): LedgerExtremes | null {
  return computeExtremesFromValues(executions.map((execution) => column.value(execution)));
}

function computeExtremesFromValues(values: Array<number | undefined | null>): LedgerExtremes | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numbers.length === 0) return null;
  const distinct = new Set(numbers);
  return { min: Math.min(...numbers), max: Math.max(...numbers), distinctCount: distinct.size };
}

function rankValue(
  value: number | undefined | null,
  extremes: LedgerExtremes | null,
  higherIsBetter: boolean,
  { highlightBest = true, highlightWorst = true }: { highlightBest?: boolean; highlightWorst?: boolean } = {},
): 'is-best' | 'is-worst' | '' {
  if (extremes == null || typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (extremes.distinctCount < 2) return '';
  if (higherIsBetter) {
    if (highlightBest && value === extremes.max) return 'is-best';
    if (highlightWorst && value === extremes.min) return 'is-worst';
  } else {
    if (highlightBest && value === extremes.min) return 'is-best';
    if (highlightWorst && value === extremes.max) return 'is-worst';
  }
  return '';
}

const CLEAN_SECTION_NAV: Array<{ id: string; label: string; sub?: string }> = [
  { id: 'summary', label: 'Summary', sub: 'Docs Retrieval (Swift) Benchmark' },
  { id: 'pareto-frontier', label: 'Results', sub: 'Pareto frontier' },
  { id: 'methodology', label: 'Methodology', sub: 'How we score' },
  { id: 'overview', label: 'Per-model overview', sub: 'Ledger' },
  { id: 'question-review', label: 'Question review', sub: 'Per-question dossier' },
];

function CleanVisualizerApp() {
  const [bundledSnapshot, setBundledSnapshot] = useState<BundledSnapshot | null>(null);
  const [bundleLoadError, setBundleLoadError] = useState<string | null>(null);
  const [executions, setExecutions] = useState<LoadedExecution[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('interesting');
  const [sortMode, setSortMode] = useState<SortMode>('dataset');
  const [answerSortMode, setAnswerSortMode] = useState<AnswerSortMode>('execution-order');
  const [overviewSubtotalsOnly, setOverviewSubtotalsOnly] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSectionId, setActiveSectionId] = useState<string>('summary');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [executionOrder, setExecutionOrder] = useState<string[]>([]);
  const [hiddenModelNames, setHiddenModelNames] = useState<string[]>(() => readUrlList('m'));
  const [hiddenRunTypes, setHiddenRunTypes] = useState<string[]>(() => readUrlList('t'));
  const [selectedTaxonomyTag, setSelectedTaxonomyTag] = useState<QuestionMetadataFilterValue>(ALL_METADATA_FILTER_VALUE);
  const [selectedPlatformScope, setSelectedPlatformScope] = useState<QuestionMetadataFilterValue>(ALL_METADATA_FILTER_VALUE);
  const [selectedQuestionShape, setSelectedQuestionShape] = useState<QuestionMetadataFilterValue>(ALL_METADATA_FILTER_VALUE);
  const [selectedEvidenceBasis, setSelectedEvidenceBasis] = useState<QuestionMetadataFilterValue>(ALL_METADATA_FILTER_VALUE);
  const [scatterPinnedId, setScatterPinnedId] = useState<string | null>(null);
  const [scatterHoveredId, setScatterHoveredId] = useState<string | null>(null);
  const [openAnswerRows, setOpenAnswerRows] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const questionBank = bundledSnapshot?.questionBank ?? EMPTY_QUESTION_BANK;
  const questionList = bundledSnapshot?.questionList ?? buildQuestionList(questionBank);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    writeUrlList(params, 'm', hiddenModelNames);
    writeUrlList(params, 't', hiddenRunTypes);
    params.delete('e');
    const next = params.toString();
    const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', url);
  }, [hiddenModelNames, hiddenRunTypes]);

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
    const modelNames = new Set(executions.map((execution) => execution.display.modelLabel));
    setHiddenModelNames((current) => current.filter((name) => modelNames.has(name)));
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

  const modelNameOptions = useMemo(() => {
    const seen = new Map<string, { name: string; count: number }>();
    for (const execution of orderedExecutions) {
      const name = execution.display.modelLabel;
      const entry = seen.get(name);
      if (entry) entry.count += 1;
      else seen.set(name, { name, count: 1 });
    }
    return Array.from(seen.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [orderedExecutions]);

  const baseVisibleExecutions = useMemo(() => {
    const hiddenNames = new Set(hiddenModelNames);
    const hiddenTypes = new Set(hiddenRunTypes);
    return orderedExecutions.filter((execution) => {
      if (hiddenNames.has(execution.display.modelLabel)) return false;
      if (hiddenTypes.has(getRunTypeInfo(execution).key)) return false;
      return true;
    });
  }, [hiddenModelNames, hiddenRunTypes, orderedExecutions]);

  const visibleExecutions = baseVisibleExecutions;

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


  const bestToolsetSummary = useMemo(() => {
    return toolsetSummaries.find((summary) => summary.key !== 'none' && summary.judgedRuns > 0) ?? null;
  }, [toolsetSummaries]);

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

  const chartScoreAxis = useMemo<ScatterAxis>(
    () => ({
      label: 'Correctness score',
      value: (execution) => getJudgeCorrectnessScore(execution.summary),
      format: (value) => formatNumber(value, 2),
      higherIsBetter: true,
    }),
    [],
  );

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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    const sectionIds = CLEAN_SECTION_NAV.map((entry) => entry.id);
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element != null);
    if (elements.length === 0) return;
    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibility.set(entry.target.id, entry.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = -1;
        for (const id of sectionIds) {
          const ratio = visibility.get(id) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId && bestRatio > 0) {
          setActiveSectionId(bestId);
        }
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [executions.length, visibleExecutions.length]);

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

  function toggleModelVisibility(modelName: string) {
    setHiddenModelNames((current) =>
      current.includes(modelName)
        ? current.filter((name) => name !== modelName)
        : [...current, modelName],
    );
  }

  function showAllModels() {
    setHiddenModelNames([]);
  }

  function hideAllModels() {
    setHiddenModelNames(modelNameOptions.map((entry) => entry.name));
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

      <aside className="desk-sidebar clean-sidebar">
        <div className="desk-sidebar-inner">
          <div className="sidebar-masthead">
            <div className="sidebar-masthead-top">
              <h1>Benchmark Visualizer</h1>
              <div className="sidebar-theme-toggle" role="group" aria-label="Theme">
                <button
                  type="button"
                  className={`sidebar-theme-option ${theme === 'light' ? 'is-active' : ''}`}
                  onClick={() => setTheme('light')}
                  aria-label="Light theme"
                  aria-pressed={theme === 'light'}
                >☀</button>
                <button
                  type="button"
                  className={`sidebar-theme-option ${theme === 'dark' ? 'is-active' : ''}`}
                  onClick={() => setTheme('dark')}
                  aria-label="Dark theme"
                  aria-pressed={theme === 'dark'}
                >☾</button>
              </div>
            </div>
            <span className="sidebar-version-tag">Clean layout</span>
            <p className="sidebar-tagline">
              Which models search docs well, which toolsets help most, and what quality/cost/time tradeoffs each run makes.
            </p>
          </div>

          <nav className="clean-section-nav" aria-label="Page sections">
            <div className="clean-section-nav-heading">On this page</div>
            <ol>
              {CLEAN_SECTION_NAV.map((entry, index) => {
                const isActive = entry.id === activeSectionId;
                return (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      className={`clean-section-nav-link ${isActive ? 'is-active' : ''}`}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <span className="clean-section-nav-step">{String(index + 1).padStart(2, '0')}</span>
                      <span className="clean-section-nav-text">
                        <strong>{entry.label}</strong>
                        {entry.sub ? <em>{entry.sub}</em> : null}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>

          {runTypeOptions.length > 1 ? (
            <details className="sidebar-section">
              <summary><span className="disclosure">Tools ({runTypeOptions.length})</span></summary>
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
                        <ToolsetIcon toolSetKey={option.key} label={option.label} />
                        <span className="run-type-label">{option.label}</span>
                        <span className="run-type-count">{option.count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </details>
          ) : null}

          <details className="sidebar-section">
            <summary><span className="disclosure">Models ({modelNameOptions.length})</span></summary>
            <div className="sidebar-section-body">
              <div className="button-row">
                <button type="button" className="button button-tiny" onClick={showAllModels}>Show all</button>
                <button type="button" className="button button-tiny" onClick={hideAllModels}>Hide all</button>
              </div>
              <div className="model-manager-list">
                {modelNameOptions.map((option) => {
                  const isHidden = hiddenModelNames.includes(option.name);
                  return (
                    <label
                      key={option.name}
                      className={`model-name-row ${isHidden ? 'is-hidden' : ''}`}
                      title={option.name}
                    >
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleModelVisibility(option.name)}
                      />
                      <span className="model-name-label">{option.name}</span>
                      <span className="model-name-count">{option.count}</span>
                    </label>
                  );
                })}
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

      <main className="report-main report-main-clean">
        <header id="summary" className="panel masthead">
          <div className="masthead-top">
            <div>
              <h2>Efficient Models for Docs Search</h2>

            </div>
          </div>
          <section className="summary-card decision-summary">
            <div className="summary-card-copy">
              <p>
                Most models struggle to write modern, performant Swift — largely a function of stale training cutoffs and
                the relative scarcity of high-quality Swift in their training data. Paul Hudson has{' '}
                <a
                  href="https://www.hackingwithswift.com/articles/281/what-to-fix-in-ai-generated-swift-code"
                  target="_blank"
                  rel="noreferrer"
                >
                  several great articles
                </a>{' '}
                cataloging the pitfalls frontier models fall into when writing Swift. His agent skill puts those notes into a couple of Markdown
                files, and is probably the easiest fix for most devs. That said, this information also makes a great model comparison target.
              </p>
              <p>
                <b>This benchmark sets out to test search tools, but equally evaluates Swift knowledge.</b>
              </p>


              <aside className="summary-card-callout">
                <span className="summary-card-callout-tag">Finding 1</span>
                <p>
                  <strong>Grok 4.1 Fast + vector search</strong> hit a really nice spot on quality, cost, and time. Grok with simple read + grep was top of the line. Giving it a semantic search tool preserved accuracy while significantly improving speed.
                </p>
              </aside>

              <aside className="summary-card-callout">
                <span className="summary-card-callout-tag">Finding 2</span>
                <p>
                  <strong>Then Gemma 4 matched it from closed book.</strong> Adding any of the retrieval tools barely moves its
                  score. As far as cheap models go, Gemma 4 is great with modern Swift.
                </p>
              </aside>

              <p>
                See below for results, methodology, or to take a look at the questions.
              </p>
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
                ? 'No benchmark runs are currently loaded.'
                : 'Fetching bundled benchmark metadata and recent run summaries.'}
            </p>
          </section>
        ) : visibleExecutions.length === 0 ? (
          <section className="panel empty-panel">
            <h3>All models hidden</h3>
            <p>Re-enable at least one model in the sidebar to compare.</p>
            <div className="button-row">
              <button type="button" className="button button-solid" onClick={showAllModels}>Show all</button>
            </div>
          </section>
        ) : (
          <>
            <section id="pareto-frontier" className="panel section-panel">
              <div className="section-heading metric-desk-heading">
                <div>
                  <h3>Results</h3>
                  <p>
                    Each dot is one execution. Models on the frontier line are best at their cost/time point. Anything inside the curve is dominated by another run that wins on both axes.
                  </p>
                </div>
              </div>
              <div className="decision-kpi-grid">
                <div className={`decision-kpi-card tone-${scoreTone(bestToolsetSummary?.correctnessScore)}`}>
                  <span className="decision-kpi-label">
                    Best toolset
                    <KpiTip text="Toolset with the highest mean correctness score across all visible runs. Closed-book is excluded so this answers &ldquo;which set of tools helps most?&rdquo;" />
                  </span>
                  <strong>{bestToolsetSummary?.label ?? '—'}</strong>
                  <em>{formatNumber(bestToolsetSummary?.correctnessScore, 2)} score</em>
                </div>
                <div className={`decision-kpi-card tone-${scoreTone(strongestExecution ? getJudgeCorrectnessScore(strongestExecution.summary) : undefined)}`}>
                  <span className="decision-kpi-label">
                    Strongest run
                    <KpiTip text="Run with the highest correctness score among visible runs, across any toolset." />
                  </span>
                  <strong>{strongestExecution?.display.primaryLabel ?? '—'}</strong>
                  <em className="decision-kpi-em-with-icon">
                    {strongestExecution ? (
                      <>
                        <span>{formatNumber(getJudgeCorrectnessScore(strongestExecution.summary), 2)} score ·</span>
                        <span>{strongestExecution.display.toolSetLabel}</span>
                      </>
                    ) : (
                      'no visible run'
                    )}
                  </em>
                </div>
                <div className="decision-kpi-card">
                  <span className="decision-kpi-label">
                    Cheapest reliable
                    <KpiTip text="Cheapest run (mean USD per question) among runs that clear the reliability bar — correctness score &ge; 0." />
                  </span>
                  <strong>{cheapestReliableExecution?.display.primaryLabel ?? '—'}</strong>
                  <em className="decision-kpi-em-with-icon">
                    {cheapestReliableExecution ? (
                      <>
                        <span>{formatUsd(cheapestReliableExecution.summary.cost?.meanTotalCostUsdPerRun, 4)} / q ·</span>
                        <span>{cheapestReliableExecution.display.toolSetLabel}</span>
                      </>
                    ) : (
                      'no run cleared the reliability bar'
                    )}
                  </em>
                </div>
                <div className="decision-kpi-card">
                  <span className="decision-kpi-label">
                    Fastest reliable
                    <KpiTip text="Fastest run (mean wall-clock per question) among runs that clear the reliability bar — correctness score &ge; 0." />
                  </span>
                  <strong>{fastestReliableExecution?.display.primaryLabel ?? '—'}</strong>
                  <em className="decision-kpi-em-with-icon">
                    {fastestReliableExecution ? (
                      <>
                        <span>{formatDuration(fastestReliableExecution.summary.timing?.meanCollectMsPerRun)} / q ·</span>
                        <span>{fastestReliableExecution.display.toolSetLabel}</span>
                      </>
                    ) : (
                      'no run cleared the reliability bar'
                    )}
                  </em>
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
                  activeId={scatterHoveredId ?? scatterPinnedId}
                  pinnedId={scatterPinnedId}
                  onHover={setScatterHoveredId}
                  onTogglePin={(id) => setScatterPinnedId((current) => (current === id ? null : id))}
                />
                <MetricDeskScatter
                  executions={visibleExecutions}
                  xAxis={{
                    label: 'Time / question',
                    value: (execution) => execution.summary.timing?.meanCollectMsPerRun,
                    format: (value) => formatDuration(value),
                    higherIsBetter: false,
                    domainMax: 40_000,
                  }}
                  yAxis={chartScoreAxis}
                  activeId={scatterHoveredId ?? scatterPinnedId}
                  pinnedId={scatterPinnedId}
                  onHover={setScatterHoveredId}
                  onTogglePin={(id) => setScatterPinnedId((current) => (current === id ? null : id))}
                />
              </div>
              <details className="scatter-legend-details">
                <summary className="scatter-legend-summary">Model legend</summary>
                <SharedScatterLegend
                  executions={visibleExecutions}
                  activeId={scatterHoveredId ?? scatterPinnedId}
                  pinnedId={scatterPinnedId}
                  onHover={setScatterHoveredId}
                  onTogglePin={(id) => setScatterPinnedId((current) => (current === id ? null : id))}
                />
              </details>
            </section>

            <section id="methodology" className="panel section-panel">
              <div className="section-heading">
                <h3>Methodology</h3>
                <p>How the benchmark is administered and how we arrive at the final scores.</p>
              </div>
              <dl className="summary-card-method">
                <div className="summary-card-method-row">
                  <dt>Model selection</dt>
                  <dd>High-throughput, relatively cheap models available on OpenRouter.</dd>
                </div>
                <div className="summary-card-method-row">
                  <dt>Administration</dt>
                  <dd>
                    Each model answers the same fixed question bank under every tool set, then a separate judge model scores
                    each answer for correctness, completeness, and whether the cited evidence holds up.
                  </dd>
                </div>
                <div className="summary-card-method-row">
                  <dt>Questions</dt>
                  <dd>Generated based on Paul&rsquo;s research and cross-reviewed against available SwiftUI docs.</dd>
                </div>
                <div className="summary-card-method-row">
                  <dt>Metrics</dt>
                  <dd>
                    <ul className="summary-card-toolsets-list">
                      <li><span>Correctness score</span><em>mean signed score: +1 for a correct answer, -1 for falling into a pitfall, and 0 for partial/unclear answers; &ge; 0 is the &ldquo;reliable&rdquo; cutoff</em></li>
                      <li><span>Completeness</span><em>judge score for how fully the answer covers the reference requirements, on a 0–1 scale</em></li>
                      <li><span>Cost / time per question</span><em>mean spend and wall-clock to collect a single answer (judge cost reported separately)</em></li>
                    </ul>
                  </dd>
                </div>
                <div className="summary-card-method-row summary-card-method-row-toolsets">
                  <dt>Retrieval toolsets</dt>
                  <dd>
                    <ul className="summary-card-toolsets-list">
                      <li><span>No tools</span><em>closed book — training data only, no retrieval</em></li>
                      <li><span>Read</span><em>model can open files in the docs corpus by path</em></li>
                      <li><span>Read + grep</span><em>plus regex search across the corpus</em></li>
                      <li><span>Read + grep + glob</span><em>plus file-pattern enumeration</em></li>
                      <li>
                        <span>Vector search</span>
                        <em>model emits several related queries; semantic search returns matching chunks; model collates the answer</em>
                      </li>
                      <li>
                        <span>Vector search + read</span>
                        <em>same as vector search, but the model also gets a read tool to follow up on retrieved chunks</em>
                      </li>
                      <li>
                        <span>No-tools vector search</span>
                        <em>the pipeline runs vector search first and feeds the chunks into the prompt without exposing tool calls</em>
                      </li>
                    </ul>
                  </dd>
                </div>
              </dl>
            </section>

            <section id="overview" className="panel section-panel">
              <div className="section-heading overview-heading">
                <div>
                  <h3>Per-model overview</h3>
                  <p>
                    Models are grouped as subtotal blocks with each toolset run nested underneath. Best/worst values per column are highlighted so
                    the leaders pop without scanning the whole table; click a run row to expand the full per-question metric set.
                  </p>
                </div>
                <div className="button-row overview-heading-actions">
                  <button
                    type="button"
                    className="button button-tiny"
                    onClick={() => setOverviewSubtotalsOnly((current) => !current)}
                  >
                    {overviewSubtotalsOnly ? 'Show runs' : 'Subtotals only'}
                  </button>
                  <button
                    type="button"
                    className="button button-tiny"
                    onClick={() => copyLedgerAsTsv(visibleExecutions)}
                    title="Copy the ledger to the clipboard as TSV — paste into a spreadsheet or markdown table."
                  >
                    Copy as TSV
                  </button>
                </div>
              </div>
              {(() => {
                const ledgerColumns: LedgerColumn[] = [
                  { label: 'Score', higherIsBetter: true, value: (ex) => getJudgeCorrectnessScore(ex.summary), format: (v) => formatNumber(v, 2) },
                  { label: 'Complete', higherIsBetter: true, value: (ex) => ex.summary.judge?.meanCompleteness, format: (v) => formatNumber(v, 2) },
                  { label: 'Avg cost', higherIsBetter: false, value: (ex) => ex.summary.cost?.totalCostUsd, format: (v) => formatUsd(v, 2) },
                  { label: 'Avg judge cost', higherIsBetter: false, value: (ex) => ex.summary.cost?.totalJudgeCostUsd, format: (v) => formatUsd(v, 2) },
                  { label: 'Avg time', higherIsBetter: false, value: (ex) => ex.summary.timing?.totalCollectMs, format: (v) => formatDuration(v) },
                  { label: 'Avg coverage', higherIsBetter: true, value: (ex) => ratio(ex.summary.judge?.judgeRuns, ex.summary.runs), format: (_v, ex) => formatCount(ex?.summary.judge?.judgeRuns, ex?.summary.runs), highlightBest: false },
                  { label: 'Avg errors', higherIsBetter: false, value: (ex) => ratio(ex.summary.errors?.runsWithAnyError, ex.summary.runs), format: (_v, ex) => formatCount(ex?.summary.errors?.runsWithAnyError, ex?.summary.runs), highlightBest: false },
                ];
                const subtotalColumns = [
                  { value: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => subtotal.correctnessScore, format: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => formatNumber(subtotal.correctnessScore, 2) },
                  { value: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => subtotal.meanCompleteness, format: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => formatNumber(subtotal.meanCompleteness, 2) },
                  { value: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => subtotal.meanTotalCostUsd, format: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => formatUsd(subtotal.meanTotalCostUsd, 2) },
                  { value: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => subtotal.meanJudgeCostUsd, format: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => formatUsd(subtotal.meanJudgeCostUsd, 2) },
                  { value: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => subtotal.meanCollectMs, format: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => formatDuration(subtotal.meanCollectMs) },
                  { value: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => ratio(subtotal.meanJudgeRuns ?? undefined, subtotal.meanRuns ?? undefined), format: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => formatAverageCount(subtotal.meanJudgeRuns, subtotal.meanRuns) },
                  { value: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => ratio(subtotal.meanErrorRuns ?? undefined, subtotal.meanRuns ?? undefined), format: (subtotal: ReturnType<typeof summarizeLedgerSubtotal>) => formatAverageCount(subtotal.meanErrorRuns, subtotal.meanRuns) },
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
                      {(() => {
                        const seenModels = new Set<string>();
                        const executionsByModel = new Map<string, LoadedExecution[]>();
                        for (const execution of visibleExecutions) {
                          const entries = executionsByModel.get(execution.display.modelLabel) ?? [];
                          entries.push(execution);
                          executionsByModel.set(execution.display.modelLabel, entries);
                        }
                        const subtotalsByModel = new Map(
                          Array.from(executionsByModel.entries()).map(([modelName, modelExecutions]) => [
                            modelName,
                            summarizeLedgerSubtotal(modelExecutions),
                          ] as const),
                        );
                        const subtotalExtremes = subtotalColumns.map((column) =>
                          computeExtremesFromValues(Array.from(subtotalsByModel.values()).map((subtotal) => column.value(subtotal))),
                        );
                        return visibleExecutions.flatMap((execution) => {
                          const modelName = execution.display.modelLabel;
                          const isFirstOfModel = !seenModels.has(modelName);
                          seenModels.add(modelName);
                          const modelExecutions = executionsByModel.get(modelName) ?? [execution];
                          const subtotal = subtotalsByModel.get(modelName) ?? summarizeLedgerSubtotal(modelExecutions);
                          const subtotalRow = isFirstOfModel ? (
                            <div key={`${modelName}-subtotal`} className="ledger-subtotal-row ledger-row-summary">
                              <div className="ledger-model-cell">
                                <strong>{modelName}</strong>
                                <span className="ledger-model-subtotal-meta">
                                  <span>{modelExecutions.length} run average</span>
                                  {getModelLevelChips(modelExecutions).map((chip) => (
                                    <span key={`${modelName}-${chip}`} className="execution-chip">{chip}</span>
                                  ))}
                                </span>
                              </div>
                              {subtotalColumns.map((column, index) => {
                                const ledgerColumn = ledgerColumns[index];
                                const value = column.value(subtotal);
                                const rank = overviewSubtotalsOnly
                                  ? rankValue(value, subtotalExtremes[index], ledgerColumn.higherIsBetter, {
                                    highlightBest: ledgerColumn.highlightBest,
                                    highlightWorst: ledgerColumn.highlightWorst,
                                  })
                                  : '';
                                return (
                                  <span key={ledgerColumn.label} className={`ledger-metric-cell ${rank}`}>
                                    {column.format(subtotal)}
                                  </span>
                                );
                              })}
                              <span aria-hidden />
                            </div>
                          ) : null;
                          const detailRow = (
                            <details
                              key={execution.id}
                              className="ledger-row is-model-sub"
                              data-execution-id={execution.id}
                            >
                              <summary className="ledger-row-summary">
                                <div className="ledger-model-cell">
                                  <ExecutionLabel execution={execution} showModelName={false} />
                                </div>
                                {ledgerColumns.map((column, index) => {
                                  const value = column.value(execution);
                                  const extreme = extremes[index];
                                  const rank = rankValue(value, extreme, column.higherIsBetter, {
                                    highlightBest: column.highlightBest,
                                    highlightWorst: column.highlightWorst,
                                  });
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
                                  <MetricPair label="Correctness score" value={formatNumber(getJudgeCorrectnessScore(execution.summary), 2)} />
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
                                        <span>{formatNumber(getBreakdownCorrectnessScore(entry), 2)} score</span>
                                        <span>{formatNumber(entry.judge?.meanCompleteness, 2)} complete</span>
                                        <span>{formatPercent(entry.judge?.referenceVerifiedRate)} ref</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          );
                          if (overviewSubtotalsOnly) return subtotalRow ? [subtotalRow] : [];
                          return subtotalRow ? [subtotalRow, detailRow] : [detailRow];
                        });
                      })()}
                    </div>
                  </>
                );
              })()}
            </section>

            <section id="question-review" className="panel section-panel">
              <div className="section-heading">
                <h3>Question review</h3>
                <p>
                  Drill into a single question to see every model&rsquo;s answer, the judge&rsquo;s verdict, and the cited
                  evidence side by side. Use the filter to narrow to disagreements or errors when you&rsquo;re hunting for
                  failure modes.
                </p>
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
                    <div className="question-filter-row">
                      <label className="control-field">
                        <span>Taxonomy</span>
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
                    </div>
                    <div className="question-filter-row">
                      <label className="control-field">
                        <span>Shape</span>
                        <select value={selectedQuestionShape} onChange={(event) => setSelectedQuestionShape(event.target.value)}>
                          <option value={ALL_METADATA_FILTER_VALUE}>All shapes</option>
                          {questionMetadataOptions.questionShapes.map((shape) => (
                            <option key={shape} value={shape}>{humanizeToken(shape)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="control-field">
                        <span>Evidence</span>
                        <select value={selectedEvidenceBasis} onChange={(event) => setSelectedEvidenceBasis(event.target.value)}>
                          <option value={ALL_METADATA_FILTER_VALUE}>All evidence</option>
                          {questionMetadataOptions.evidenceBases.map((basis) => (
                            <option key={basis} value={basis}>{humanizeToken(basis)}</option>
                          ))}
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
                          style={getQuestionListItemStyle(group)}
                          onClick={() => setSelectedQuestionId(group.meta.id)}
                        >
                          <div className="question-list-item-text">
                            {group.meta.question}
                          </div>
                          <aside className="question-list-item-stats" aria-label={`Question ${padQuestionOrder(group.meta.order)} scores`}>
                            <strong>{padQuestionOrder(group.meta.order)}</strong>
                            <span className="question-rate is-correct">{formatPercent(group.judgeCorrectRate)}</span>
                            <span className="question-rate is-incorrect">{formatPercent(group.judgeIncorrectRate)}</span>
                          </aside>
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
                                const hasError = Boolean(run?.errors?.collectHadError || run?.errors?.judgeHadError);
                                const rowClassName = [
                                  'score-row',
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
                                      <td>
                                        {run?.judge?.completeness != null ? (
                                          <Badge tone={judgeAxisTone(run.judge.completeness)}>
                                            {formatJudgeAxis(run.judge.completeness)}
                                          </Badge>
                                        ) : '—'}
                                      </td>
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

            {executions.length > 0 ? (
              <ActiveFiltersBar
                totalRuns={orderedExecutions.length}
                visibleRuns={baseVisibleExecutions.length}
                modelNameOptions={modelNameOptions}
                runTypeOptions={runTypeOptions}
                hiddenModelNames={hiddenModelNames}
                hiddenRunTypes={hiddenRunTypes}
                onClearModels={showAllModels}
                onClearTools={() => setHiddenRunTypes([])}
                onResetAll={() => {
                  showAllModels();
                  setHiddenRunTypes([]);
                }}
              />
            ) : null}
          </>
        )}
      </main>

      <BackToTopButton />
    </div>
  );
}

function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      type="button"
      className={`back-to-top ${visible ? 'is-visible' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
    >
      ↑ Top
    </button>
  );
}


function ExecutionLabel({
  execution,
  compact = false,
  showModelName = true,
}: {
  execution: LoadedExecution;
  compact?: boolean;
  showModelName?: boolean;
}) {
  const extraChips = execution.display.variants.filter((chip) => chip !== 'search corpus');
  const isClosedBook = execution.display.modeKey === 'closed_book';
  const toolsetIconKey = isClosedBook ? 'closed_book' : execution.display.toolSetKey;
  const toolsetLabel = isClosedBook ? 'Closed book' : execution.display.toolSetLabel;

  if (compact) {
    return (
      <span className="execution-label-inline">
        {showModelName ? <strong>{execution.display.primaryLabel}</strong> : null}
        <span className={`execution-chip-line ${showModelName ? '' : 'is-grouped'}`}>
          <span className="execution-chip execution-chip-tool">
            <ToolsetIcon toolSetKey={toolsetIconKey} label={toolsetLabel} />
            <span>{toolsetLabel}</span>
          </span>
          {extraChips.map((chip) => (
            <span key={`${execution.id}-${chip}`} className="execution-chip">{chip}</span>
          ))}
        </span>
      </span>
    );
  }

  return (
    <>
      {showModelName ? <strong>{execution.display.primaryLabel}</strong> : null}
      <span className={`execution-chip-line ${showModelName ? '' : 'is-grouped'}`}>
        <span className="execution-chip execution-chip-tool">
          <ToolsetIcon toolSetKey={toolsetIconKey} label={toolsetLabel} />
          <span>{toolsetLabel}</span>
        </span>
        {extraChips.map((chip) => (
          <span key={`${execution.id}-${chip}`} className="execution-chip">{chip}</span>
        ))}
      </span>
    </>
  );
}

function ActiveFiltersBar({
  totalRuns,
  visibleRuns,
  modelNameOptions,
  runTypeOptions,
  hiddenModelNames,
  hiddenRunTypes,
  onClearModels,
  onClearTools,
  onResetAll,
}: {
  totalRuns: number;
  visibleRuns: number;
  modelNameOptions: { name: string; count: number }[];
  runTypeOptions: { key: string; label: string; count: number }[];
  hiddenModelNames: string[];
  hiddenRunTypes: string[];
  onClearModels: () => void;
  onClearTools: () => void;
  onResetAll: () => void;
}) {
  const visibleModelCount = modelNameOptions.length - hiddenModelNames.length;
  const visibleToolCount = runTypeOptions.length - hiddenRunTypes.length;
  const hasModelFilter = hiddenModelNames.length > 0;
  const hasToolFilter = hiddenRunTypes.length > 0;
  const anyFilter = hasModelFilter || hasToolFilter;

  return (
    <div className="active-filters-bar">
      <div className="active-filters-summary">
        <strong>{visibleRuns}</strong>
        <span>of {totalRuns} run{totalRuns === 1 ? '' : 's'} visible</span>
      </div>
      <div className="active-filters-chips">
        <span className={`filter-chip ${hasModelFilter ? 'is-active' : ''}`}>
          Models {visibleModelCount}/{modelNameOptions.length}
          {hasModelFilter ? (
            <button type="button" onClick={onClearModels} aria-label="Show all models">×</button>
          ) : null}
        </span>
        <span className={`filter-chip ${hasToolFilter ? 'is-active' : ''}`}>
          Tools {visibleToolCount}/{runTypeOptions.length}
          {hasToolFilter ? (
            <button type="button" onClick={onClearTools} aria-label="Show all tools">×</button>
          ) : null}
        </span>
      </div>
      {anyFilter ? (
        <button type="button" className="active-filters-reset" onClick={onResetAll}>
          Reset all
        </button>
      ) : null}
    </div>
  );
}

function getModelLevelChips(executions: LoadedExecution[]): string[] {
  const chips = executions.flatMap((execution) => [
    execution.display.routeLabel ? `via ${execution.display.routeLabel}` : null,
    ...execution.display.variants.filter((variant) => variant !== 'search corpus'),
  ]);
  return Array.from(new Set(chips.filter((chip): chip is string => Boolean(chip))));
}

function summarizeLedgerSubtotal(executions: LoadedExecution[]) {
  const runs = executions.reduce((sum, execution) => sum + (execution.summary.runs ?? 0), 0);
  const judgeRuns = executions.reduce((sum, execution) => sum + (execution.summary.judge?.judgeRuns ?? 0), 0);
  const positiveCount = executions.reduce(
    (sum, execution) => sum + (execution.summary.judge?.correctnessPositiveCount ?? execution.summary.judge?.judgeCorrectCount ?? 0),
    0,
  );
  const negativeCount = executions.reduce(
    (sum, execution) => sum + (execution.summary.judge?.correctnessNegativeCount ?? execution.summary.judge?.judgeIncorrectCount ?? 0),
    0,
  );
  const completenessWeightedSum = executions.reduce((sum, execution) => {
    const count = execution.summary.judge?.judgeRuns ?? 0;
    return sum + (execution.summary.judge?.meanCompleteness ?? 0) * count;
  }, 0);
  const errorRuns = executions.reduce((sum, execution) => sum + (execution.summary.errors?.runsWithAnyError ?? 0), 0);
  return {
    runs,
    judgeRuns,
    correctnessScore: runs > 0 ? (positiveCount - negativeCount - errorRuns) / runs : undefined,
    meanCompleteness: judgeRuns > 0 ? completenessWeightedSum / judgeRuns : undefined,
    meanTotalCostUsd: averageNumbers(executions.map((execution) => execution.summary.cost?.totalCostUsd)),
    meanJudgeCostUsd: averageNumbers(executions.map((execution) => execution.summary.cost?.totalJudgeCostUsd)),
    meanCollectMs: averageNumbers(executions.map((execution) => execution.summary.timing?.totalCollectMs)),
    meanRuns: averageNumbers(executions.map((execution) => execution.summary.runs)),
    meanJudgeRuns: averageNumbers(executions.map((execution) => execution.summary.judge?.judgeRuns)),
    meanErrorRuns: averageNumbers(executions.map((execution) => execution.summary.errors?.runsWithAnyError)),
    errorRuns,
  };
}

function getQuestionListItemStyle(group: QuestionGroup) {
  const correctRate = group.judgeCorrectRate ?? 0;
  const incorrectRate = group.judgeIncorrectRate ?? 0;
  if (correctRate === 0 && incorrectRate === 0) return undefined;

  const correctWins = correctRate >= incorrectRate;
  const hue = correctWins ? 150 : 4;
  const saturation = correctWins ? 48 : 58;
  const lightness = correctWins ? 42 : 46;
  const strength = Math.max(correctRate, incorrectRate);
  return {
    backgroundColor: `hsl(${hue} ${saturation}% ${lightness}% / ${0.05 + strength * 0.13})`,
    borderColor: `hsl(${hue} ${saturation}% ${lightness}% / ${0.16 + strength * 0.24})`,
  };
}

function KpiTip({ text }: { text: string }) {
  return (
    <span className="kpi-tip-wrap" tabIndex={0} aria-label={`Definition: ${text.replace(/&[a-z]+;/g, '')}`}>
      <span className="kpi-tip-icon" aria-hidden="true">?</span>
      <span className="kpi-tip-content" role="tooltip" dangerouslySetInnerHTML={{ __html: text }} />
    </span>
  );
}

export function ResultsMatrix({
  executions,
  questionGroups,
  onCellSelect,
}: {
  executions: LoadedExecution[];
  questionGroups: QuestionGroup[];
  onCellSelect: (questionId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (executions.length === 0 || questionGroups.length === 0) {
    return <div className="empty-inline">No visible models or questions to plot.</div>;
  }

  const questionCorrectnessScores = questionGroups.map((group) => {
    const runs = executions
      .map((execution) => execution.runsByQuestionId[group.meta.id] ?? null)
      .filter((run): run is EnrichedRun => run != null);
    const score = averageNumbers(runs.map((run) => getRunCorrectnessScore(run)));
    return { group, score, runCount: runs.length };
  });

  return (
    <div className="results-matrix-wrap">
      <div className="results-matrix-toolbar">
        <button type="button" className="button button-tiny" onClick={() => setIsExpanded((current) => !current)}>
          {isExpanded ? 'Collapse to question %' : 'Expand model matrix'}
        </button>
        {isExpanded ? (
          <div className="results-matrix-legend">
            <span><span className="results-matrix-swatch tone-success" aria-hidden />Correct</span>
            <span><span className="results-matrix-swatch tone-warn" aria-hidden />Partial</span>
            <span><span className="results-matrix-swatch tone-danger" aria-hidden />Incorrect</span>
            <span><span className="results-matrix-swatch has-error" aria-hidden />Error</span>
            <span><span className="results-matrix-swatch is-empty" aria-hidden />No run</span>
          </div>
        ) : (
          <span className="results-matrix-collapsed-note">Collapsed: correctness score by question across visible runs.</span>
        )}
      </div>
      <div
        className={`results-matrix ${isExpanded ? '' : 'is-collapsed'}`}
        style={{ gridTemplateColumns: `minmax(160px, 1.4fr) repeat(${questionGroups.length}, ${isExpanded ? '12px' : '42px'})` }}
        role="table"
      >
        <div className="results-matrix-corner" role="columnheader">{isExpanded ? 'Model' : 'Question'}</div>
        {questionGroups.map((group) => (
          <button
            key={`head-${group.meta.id}`}
            type="button"
            className="results-matrix-question-head"
            title={`${padQuestionOrder(group.meta.order)} · ${group.meta.title}`}
            onClick={() => onCellSelect(group.meta.id)}
          >
            {padQuestionOrder(group.meta.order)}
          </button>
        ))}
        {!isExpanded ? (
          <>
            <div className="results-matrix-row-head results-matrix-summary-head">Score</div>
            {questionCorrectnessScores.map(({ group, score, runCount }) => (
              <button
                key={`summary-${group.meta.id}`}
                type="button"
                className={`results-matrix-percent-cell tone-${scoreTone(score)}`}
                onClick={() => onCellSelect(group.meta.id)}
                title={`${padQuestionOrder(group.meta.order)} · ${group.meta.title}\n${formatNumber(score, 2)} correctness score across ${runCount} visible run${runCount === 1 ? '' : 's'}`}
              >
                {formatNumber(score, 2)}
              </button>
            ))}
          </>
        ) : executions.flatMap((execution) => {
          const isClosedBook = execution.display.modeKey === 'closed_book';
          const toolKey = isClosedBook ? 'closed_book' : execution.display.toolSetKey;
          const toolLabel = isClosedBook ? 'Closed book' : execution.display.toolSetLabel;
          const toolColor = getToolsetColor(toolKey);
          return [
            <div
              key={`row-${execution.id}`}
              className="results-matrix-row-head"
              title={execution.display.fullLabel}
              style={{ ['--tool-color' as string]: toolColor } as Record<string, string>}
            >
              <span className="results-matrix-row-model">{execution.display.primaryLabel}</span>
              <span className="results-matrix-row-tool" title={toolLabel}>
                <span className="results-matrix-row-tool-dot" aria-hidden />
                <span className="results-matrix-row-tool-label">{toolLabel}</span>
              </span>
            </div>,
            ...questionGroups.map((group) => {
              const run = execution.runsByQuestionId[group.meta.id] ?? null;
              const verdict =
                run?.judge?.verdict ?? judgeVerdictFromCorrectness(run?.judge?.correctness);
              const hasError = Boolean(run?.errors?.collectHadError || run?.errors?.judgeHadError);
              const tone = verdict ? verdictTone(verdict) : 'neutral';
              const cellClass = [
                'results-matrix-cell',
                run ? '' : 'is-empty',
                `tone-${tone}`,
                hasError ? 'has-error' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const titleParts = [
                `${execution.display.primaryLabel} · ${execution.display.toolSetLabel}`,
                `${padQuestionOrder(group.meta.order)} · ${group.meta.title}`,
                run
                  ? `Verdict: ${humanizeToken(verdict ?? 'unjudged')}`
                  : 'No run for this question',
                hasError ? 'Errored' : null,
              ].filter((part): part is string => Boolean(part));
              return (
                <button
                  key={`${execution.id}-${group.meta.id}`}
                  type="button"
                  className={cellClass}
                  onClick={() => onCellSelect(group.meta.id)}
                  title={titleParts.join('\n')}
                  aria-label={titleParts.join(' — ')}
                >
                  <span className="results-matrix-cell-glyph" aria-hidden>
                    {hasError
                      ? '/'
                      : verdict === 'correct'
                        ? '✓'
                        : verdict === 'incorrect'
                          ? '✕'
                          : verdict === 'partially_correct'
                            ? '~'
                            : ''}
                  </span>
                </button>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}


const SCATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
  '#0d9488', '#be185d',
];

function getModelColor(execution: LoadedExecution, allExecutions: LoadedExecution[]): string {
  const modelOrder: string[] = [];
  const seen = new Set<string>();
  for (const candidate of allExecutions) {
    const key = candidate.display.modelLabel;
    if (!seen.has(key)) {
      seen.add(key);
      modelOrder.push(key);
    }
  }
  const index = modelOrder.indexOf(execution.display.modelLabel);
  const safeIndex = index < 0 ? 0 : index;
  return SCATTER_PALETTE[safeIndex % SCATTER_PALETTE.length];
}

function SharedScatterLegend({
  executions,
  activeId,
  pinnedId,
  onHover,
  onTogglePin,
}: {
  executions: LoadedExecution[];
  activeId: string | null;
  pinnedId: string | null;
  onHover: (id: string | null) => void;
  onTogglePin: (id: string) => void;
}) {
  const hasActive = activeId != null;
  return (
    <div className="scatter-legend scatter-legend-shared" aria-label="Model legend">
      {executions.map((execution) => {
        const isActive = activeId === execution.id;
        const isPinned = pinnedId === execution.id;
        const isDimmed = hasActive && !isActive;
        return (
          <button
            key={execution.id}
            type="button"
            className={`scatter-legend-item ${isActive ? 'is-active' : ''} ${isPinned ? 'is-pinned' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
            title={execution.display.fullLabel}
            onMouseEnter={() => onHover(execution.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onTogglePin(execution.id)}
          >
            <span className="scatter-legend-swatch" style={{ background: getModelColor(execution, executions) }} />
            <span className="scatter-legend-label">{execution.display.primaryLabel}</span>
            <span className="scatter-legend-value">{execution.display.toolSetLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

function MetricDeskScatter({
  executions,
  xAxis,
  yAxis,
  activeId,
  pinnedId,
  onHover,
  onTogglePin,
}: {
  executions: LoadedExecution[];
  xAxis: ScatterAxis;
  yAxis: ScatterAxis;
  activeId: string | null;
  pinnedId: string | null;
  onHover: (id: string | null) => void;
  onTogglePin: (id: string) => void;
}) {
  const points = useMemo(() => {
    return executions
      .map((execution) => ({
        execution,
        x: xAxis.value(execution),
        y: yAxis.value(execution),
        color: getModelColor(execution, executions),
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

  const chartPoints = xAxis.domainMax == null
    ? points
    : points.filter((point) => point.x <= xAxis.domainMax!);
  const plottedPoints = chartPoints.length > 0 ? chartPoints : points;
  const outlierCount = points.length - chartPoints.length;

  const xValues = plottedPoints.map((point) => point.x);
  const yValues = plottedPoints.map((point) => point.y);
  const xDataMin = Math.min(...xValues);
  const xDataMax = Math.max(...xValues);
  const yDataMin = Math.min(...yValues);
  const yDataMax = Math.max(...yValues);

  const xDomain = xAxis.domainMax == null
    ? niceDomain(xDataMin, xDataMax, xAxis.higherIsBetter)
    : { min: 0, max: xAxis.domainMax };
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

  const frontier = computeParetoFrontier(plottedPoints, xAxis.higherIsBetter, yAxis.higherIsBetter);
  const activePoint = activeId ? plottedPoints.find((point) => point.execution.id === activeId) : undefined;
  const hasActive = activePoint != null;

  return (
    <div className="metric-card scatter-card">
      <div className="metric-card-head">
        <strong>{yAxis.label} vs {xAxis.label}</strong>
        <span>
          {paretoCornerLabel(xAxis.higherIsBetter, yAxis.higherIsBetter)} is best
          {outlierCount > 0 ? ` · ${outlierCount} over ${xAxis.format(xAxis.domainMax)} hidden` : ''}
        </span>
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
        {plottedPoints.map((point) => {
          const isFrontier = frontier.some((frontierPoint) => frontierPoint.execution.id === point.execution.id);
          const isActive = activeId === point.execution.id;
          const isPinned = pinnedId === point.execution.id;
          const isDimmed = hasActive && !isActive;
          const radius = isActive ? 8 : isFrontier ? 7 : 5.5;
          return (
            <g
              key={point.execution.id}
              className={`scatter-point ${isDimmed ? 'is-dimmed' : ''} ${isActive ? 'is-active' : ''}`}
              onMouseEnter={() => onHover(point.execution.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onTogglePin(point.execution.id)}
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
    .sort((left, right) => compareNullableMetric(right.correctnessScore, left.correctnessScore)
      || compareNullableMetric(right.medianCorrectnessScore, left.medianCorrectnessScore)
      || compareNullableMetric(left.errorRate, right.errorRate)
      || left.label.localeCompare(right.label));
}

function summarizeToolset(key: string, executions: LoadedExecution[]): ToolsetSummary {
  const searchRuns = executions.flatMap((execution) => execution.runs.filter(isSearchBackedRun));
  const runs = searchRuns.length > 0 ? searchRuns : executions.flatMap((execution) => execution.runs);
  const judgedRuns = runs.filter(hasJudgeSignal);
  const referenceRuns = judgedRuns.filter((run) => typeof run.judge?.referenceVerified === 'boolean');
  const retrievalScores = judgedRuns
    .map((run) => run.judge?.retrievalQuality)
    .filter((value): value is number => typeof value === 'number');
  const correctnessScores = runs.map((run) => getRunCorrectnessScore(run));
  const totalRuns = executions.reduce((sum, execution) => sum + (execution.summary.runs ?? 0), 0);
  const totalErrors = executions.reduce((sum, execution) => sum + (execution.summary.errors?.runsWithAnyError ?? 0), 0);

  return {
    key,
    label: executions[0]?.display.toolSetLabel ?? humanizeToken(key),
    executions,
    runCount: runs.length,
    judgedRuns: judgedRuns.length,
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
  if (execution.display.modeKey === 'closed_book') {
    return { key: 'closed_book', label: 'Closed book' };
  }
  return { key: execution.display.toolSetKey, label: execution.display.toolSetLabel };
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

function getBreakdownCorrectnessScore(entry: SummaryBreakdownEntry): number | undefined {
  const runs = entry.runs ?? 0;
  if (runs === 0) return undefined;
  const positiveCount = entry.judge?.correctnessPositiveCount ?? entry.judge?.judgeCorrectCount ?? 0;
  const negativeCount = entry.judge?.correctnessNegativeCount ?? entry.judge?.judgeIncorrectCount ?? 0;
  return (positiveCount - negativeCount) / runs;
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
    const judgeIncorrectCount = judgeAnswers.reduce((count, run) => {
      if (run.judge?.verdict === 'incorrect' || run.judge?.correctness === -1) return count + 1;
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
    const judgeIncorrectRate = judgeRuns > 0 ? judgeIncorrectCount / judgeRuns : null;
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
      judgeIncorrectRate,
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

function formatAverageCount(value: number | undefined | null, total: number | undefined | null): string {
  if (value == null) return '—';
  const formattedValue = formatCompactCount(value);
  if (total == null) return formattedValue;
  return `${formattedValue}/${formatCompactCount(total)}`;
}

function formatCompactCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function copyLedgerAsTsv(executions: LoadedExecution[]): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  const header = ['Model', 'Tools', 'Correctness score', 'Completeness', 'Total cost', 'Judge cost', 'Total time', 'Coverage', 'Errors'];
  const rows = executions.map((execution) => {
    return [
      execution.display.primaryLabel,
      execution.display.toolSetLabel,
      formatNumber(getJudgeCorrectnessScore(execution.summary), 2),
      formatNumber(execution.summary.judge?.meanCompleteness, 2),
      formatUsd(execution.summary.cost?.totalCostUsd, 2),
      formatUsd(execution.summary.cost?.totalJudgeCostUsd, 2),
      formatDuration(execution.summary.timing?.totalCollectMs),
      formatCount(execution.summary.judge?.judgeRuns, execution.summary.runs),
      formatCount(execution.summary.errors?.runsWithAnyError, execution.summary.runs),
    ].join('\t');
  });
  const text = [header.join('\t'), ...rows].join('\n');
  void navigator.clipboard.writeText(text);
}

function readUrlList(key: string): string[] {
  if (typeof window === 'undefined') return [];
  const value = new URLSearchParams(window.location.search).get(key);
  if (!value) return [];
  return value.split(',').map((entry) => decodeURIComponent(entry)).filter((entry) => entry.length > 0);
}

function writeUrlList(params: URLSearchParams, key: string, values: string[]): void {
  if (values.length === 0) {
    params.delete(key);
    return;
  }
  params.set(key, values.map((value) => encodeURIComponent(value)).join(','));
}

function verdictTone(verdict: string): Tone {
  if (verdict === 'correct') return 'success';
  if (verdict === 'partially_correct') return 'warn';
  if (verdict === 'incorrect') return 'danger';
  return 'neutral';
}

function judgeAxisTone(value: number): Tone {
  if (value > 0) return 'success';
  if (value < 0) return 'danger';
  return 'warn';
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

export default CleanVisualizerApp;
