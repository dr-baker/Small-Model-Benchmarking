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

interface QuestionGroup {
  meta: QuestionMeta;
  answers: Array<{
    execution: LoadedExecution;
    run: EnrichedRun | null;
  }>;
  averageScore: number | null;
  judgeCorrectRate: number | null;
  meanCompleteness: number | null;
  referenceVerifiedRate: number | null;
  judgeCoverageRate: number | null;
  judgeCoverageCount: number;
  disagreementCount: number;
  hasErrors: boolean;
  hasIncorrect: boolean;
}

interface MetricDefinition {
  label: string;
  higherIsBetter: boolean;
  value: (execution: LoadedExecution) => number | undefined;
  format: (value: number | undefined) => string;
}

const THEME_STORAGE_KEY = 'benchmark-visualizer-theme';
const LazyMarkdownBlock = lazy(() => import('./components/MarkdownBlock'));

const summaryMetrics: MetricDefinition[] = [
  {
    label: 'Judge correct rate',
    higherIsBetter: true,
    value: (execution) =>
      ratio(
        execution.summary.judge?.judgeCorrectCount,
        execution.summary.judge?.judgeRuns,
      ),
    format: (value) => formatPercent(value),
  },
  {
    label: 'Completeness',
    higherIsBetter: true,
    value: (execution) => execution.summary.judge?.meanCompleteness,
    format: (value) => formatNumber(value, 2),
  },
  {
    label: 'Reference verified rate',
    higherIsBetter: true,
    value: (execution) => execution.summary.judge?.referenceVerifiedRate,
    format: (value) => formatPercent(value),
  },
  {
    label: 'Judge coverage',
    higherIsBetter: true,
    value: (execution) => ratio(execution.summary.judge?.judgeRuns, execution.summary.runs),
    format: (value) => formatPercent(value),
  },
  {
    label: 'Answer score (debug)',
    higherIsBetter: true,
    value: (execution) => execution.summary.meanAnswerScore,
    format: (value) => formatNumber(value, 2),
  },
  {
    label: 'Grounded rate',
    higherIsBetter: true,
    value: (execution) => execution.summary.groundedRate,
    format: (value) => formatPercent(value),
  },
  {
    label: 'Retrieval MRR',
    higherIsBetter: true,
    value: (execution) => execution.summary.meanRetrievalMrr,
    format: (value) => formatNumber(value, 2),
  },
  {
    label: 'Code example',
    higherIsBetter: true,
    value: (execution) => execution.summary.judge?.meanCodeExample,
    format: (value) => formatNumber(value, 2),
  },
  {
    label: 'Explanation',
    higherIsBetter: true,
    value: (execution) => execution.summary.judge?.meanExplanation,
    format: (value) => formatNumber(value, 2),
  },
  {
    label: 'Retrieval quality',
    higherIsBetter: true,
    value: (execution) => execution.summary.judge?.meanRetrievalQuality,
    format: (value) => formatNumber(value, 2),
  },
  {
    label: 'Correct-pattern rate',
    higherIsBetter: true,
    value: (execution) => execution.summary.judge?.recommendsCorrectPatternRate,
    format: (value) => formatPercent(value),
  },
  {
    label: 'Deprecated-pattern rate',
    higherIsBetter: false,
    value: (execution) => execution.summary.judge?.recommendsDeprecatedPatternRate,
    format: (value) => formatPercent(value),
  },
  {
    label: 'Supportive retrieval rate',
    higherIsBetter: true,
    value: (execution) => execution.summary.judge?.retrievalSupportsReferenceAnswerRate,
    format: (value) => formatPercent(value),
  },
  {
    label: 'Cost / run',
    higherIsBetter: false,
    value: (execution) => execution.summary.cost?.meanTotalCostUsdPerRun,
    format: (value) => formatUsd(value, 4),
  },
  {
    label: 'Runs with any error',
    higherIsBetter: false,
    value: (execution) =>
      ratio(
        execution.summary.errors?.runsWithAnyError,
        execution.summary.runs,
      ),
    format: (value) => formatPercent(value),
  },
];

function App() {
  const [bundledSnapshot, setBundledSnapshot] = useState<BundledSnapshot | null>(null);
  const [bundleLoadError, setBundleLoadError] = useState<string | null>(null);
  const [executions, setExecutions] = useState<LoadedExecution[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('interesting');
  const [sortMode, setSortMode] = useState<SortMode>('dataset');
  const [answerSortMode, setAnswerSortMode] = useState<AnswerSortMode>('execution-order');
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [executionOrder, setExecutionOrder] = useState<string[]>([]);
  const [hiddenExecutionIds, setHiddenExecutionIds] = useState<string[]>([]);
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
        if (cancelled) {
          return;
        }
        const bundledExecutions = [...snapshot.bundledExecutions].sort((left, right) =>
          left.label.localeCompare(right.label),
        );
        setBundledSnapshot(snapshot);
        setExecutions(bundledExecutions);
        setExecutionOrder(bundledExecutions.map((execution) => execution.id));
        setMessages([`Loaded ${bundledExecutions.length} recent run(s) bundled from repo snapshot.`]);
        setBundleLoadError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
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
      const missing = executions
        .map((execution) => execution.id)
        .filter((id) => !kept.includes(id));
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

  const visibleExecutions = useMemo(() => {
    const hidden = new Set(hiddenExecutionIds);
    return orderedExecutions.filter((execution) => !hidden.has(execution.id));
  }, [hiddenExecutionIds, orderedExecutions]);

  const questionGroups = useMemo(
    () => buildQuestionGroups(visibleExecutions, questionList),
    [questionList, visibleExecutions],
  );

  const visibleQuestionGroups = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = questionGroups.filter((group) => {
      const textMatches =
        normalizedSearch.length === 0 ||
        group.meta.id.toLowerCase().includes(normalizedSearch) ||
        group.meta.title.toLowerCase().includes(normalizedSearch) ||
        group.meta.question.toLowerCase().includes(normalizedSearch) ||
        group.meta.referenceAnswer.toLowerCase().includes(normalizedSearch);

      if (!textMatches) {
        return false;
      }

      if (filterMode === 'all') {
        return true;
      }
      if (filterMode === 'interesting') {
        return group.hasIncorrect || group.hasErrors || group.disagreementCount > 1;
      }
      if (filterMode === 'errors') {
        return group.hasErrors;
      }
      if (filterMode === 'disagreement') {
        return group.disagreementCount > 1;
      }

      return true;
    });

    return filtered.sort((left, right) => compareQuestionGroups(left, right, sortMode));
  }, [filterMode, questionGroups, search, sortMode]);

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
    if (!selectedGroup) {
      return [];
    }
    return sortAnswerRows(selectedGroup.answers, answerSortMode);
  }, [answerSortMode, selectedGroup]);

  const selectedBestJudgeRun = useMemo(() => {
    return selectedAnswerRows
      .map(({ run }) => run)
      .filter((run): run is EnrichedRun => hasJudgeSignal(run))
      .reduce<EnrichedRun | null>((best, run) => {
        if (!best || compareJudgePriority(run, best) > 0) {
          return run;
        }
        return best;
      }, null);
  }, [selectedAnswerRows]);

  const totals = useMemo(() => {
    const interestingCount = questionGroups.filter(
      (group) => group.hasIncorrect || group.hasErrors || group.disagreementCount > 1,
    ).length;

    const judgeCoverageNumerator = visibleExecutions.reduce(
      (sum, execution) => sum + (execution.summary.judge?.judgeRuns ?? 0),
      0,
    );
    const judgeCoverageDenominator = visibleExecutions.reduce(
      (sum, execution) => sum + (execution.summary.runs ?? 0),
      0,
    );
    const runsWithErrors = visibleExecutions.reduce(
      (sum, execution) => sum + (execution.summary.errors?.runsWithAnyError ?? 0),
      0,
    );

    return {
      interestingCount,
      judgeCoverageRate: ratio(judgeCoverageNumerator, judgeCoverageDenominator),
      questionCount: questionGroups.length,
      visibleExecutions: visibleExecutions.length,
      loadedExecutions: executions.length,
      visibleQuestions: visibleQuestionGroups.length,
      runsWithErrors,
    };
  }, [executions.length, questionGroups, visibleExecutions, visibleQuestionGroups.length]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) {
      return;
    }

    if (!bundledSnapshot) {
      setMessages((current) => ['Bundled question metadata is still loading. Try again in a moment.', ...current].slice(0, 8));
      return;
    }

    const pickedFiles = pickAggregateFiles(Array.from(fileList));

    if (pickedFiles.length === 0) {
      setMessages((current) => ['No aggregate.json files found in selection.', ...current].slice(0, 8));
      return;
    }

    const { executions: loaded, errors } = await loadExecutionsFromFiles(pickedFiles, bundledSnapshot.questionBank);

    setExecutions((current) => {
      const merged = dedupeExecutions([...current, ...loaded]);
      return merged.sort((left, right) => left.label.localeCompare(right.label));
    });

    if (loaded.length > 0) {
      setMessages((current) => [`Added ${loaded.length} execution(s).`, ...errors, ...current].slice(0, 8));
    } else {
      setMessages((current) => [...errors, ...current].slice(0, 8));
    }
  }

  function removeExecution(executionId: string) {
    setExecutions((current) => current.filter((execution) => execution.id !== executionId));
    setMessages((current) => ['Removed 1 execution.', ...current].slice(0, 8));
  }

  function clearAll() {
    setExecutions([]);
    setMessages([]);
    setExecutionOrder([]);
    setHiddenExecutionIds([]);
    setOpenAnswerRows({});
  }

  function restoreRecentRuns() {
    if (!bundledSnapshot) {
      setMessages((current) => ['Bundled recent runs are still loading.', ...current].slice(0, 8));
      return;
    }

    const bundledExecutions = [...bundledSnapshot.bundledExecutions].sort((left, right) =>
      left.label.localeCompare(right.label),
    );
    setExecutions(bundledExecutions);
    setExecutionOrder(bundledExecutions.map((execution) => execution.id));
    setHiddenExecutionIds([]);
    setOpenAnswerRows({});
    setMessages((current) => {
      const note = `Loaded ${bundledExecutions.length} recent run(s) bundled from repo snapshot.`;
      return [note, ...current.filter((message) => message !== note)].slice(0, 8);
    });
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
      if (index < 0) {
        return current;
      }

      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

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
    if (!selectedGroup) {
      return;
    }

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
    if (selectedQuestionIndex < 0) {
      return;
    }

    const nextIndex = selectedQuestionIndex + direction;
    const nextGroup = visibleQuestionGroups[nextIndex];
    if (nextGroup) {
      setSelectedQuestionId(nextGroup.meta.id);
    }
  }

  return (
    <div className="workspace-shell">
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setSidebarOpen((current) => !current)}
      >
        {sidebarOpen ? 'Hide desk' : 'Show desk'}
      </button>

      <div className={`workspace ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <aside className="desk-sidebar">
          <div className="desk-sidebar-inner">
            <div className="sidebar-masthead">
              <div className="eyebrow">Analysis desk</div>
              <h1>Benchmark Visualizer</h1>
              <p>
                Pick question. Compare model scores. Open only answers that need reading.
              </p>
            </div>

            <SidebarSection title="Library" defaultOpen>
              <div className="sidebar-stack">
                <div className="mini-note">
                  Snapshot {formatTimestamp(recentRunsBundle.generatedAt)} · {recentRunsBundle.count} recent runs bundled
                </div>
                <div className="button-stack">
                  <button type="button" className="button button-solid" onClick={() => fileInputRef.current?.click()}>
                    Add aggregate files
                  </button>
                  <button type="button" className="button" onClick={() => folderInputRef.current?.click()}>
                    Add run folders
                  </button>
                  <button type="button" className="button" onClick={restoreRecentRuns}>
                    Restore recent set
                  </button>
                  <button type="button" className="button button-ghost" onClick={clearAll}>
                    Clear desk
                  </button>
                </div>
              </div>
            </SidebarSection>

            <SidebarSection title="Sections" defaultOpen>
              <nav className="section-nav">
                <a href="#scoring-model">Scoring model</a>
                <a href="#overview">Overview</a>
                <a href="#question-review">Question review</a>
                <a href="#metric-desk">Metric desk</a>
              </nav>
            </SidebarSection>

            <SidebarSection title="Models" defaultOpen>
              <div className="sidebar-stack">
                <div className="toolbar-inline">
                  <button type="button" className="button button-tiny" onClick={showAllExecutions}>
                    Show all
                  </button>
                  <button type="button" className="button button-tiny" onClick={hideAllExecutions}>
                    Hide all
                  </button>
                </div>
                <div className="mini-note">
                  Reorder comparison rows here. Question table inherits same order unless you sort per-question.
                </div>
                <div className="model-manager-list">
                  {orderedExecutions.map((execution, index) => {
                    const isHidden = hiddenExecutionIds.includes(execution.id);
                    return (
                      <div key={execution.id} className={`model-manager-row ${isHidden ? 'is-hidden' : ''}`}>
                        <label className="model-visibility-toggle">
                          <input
                            type="checkbox"
                            checked={!isHidden}
                            onChange={() => toggleExecutionVisibility(execution.id)}
                          />
                          <span>{execution.shortLabel}</span>
                        </label>
                        <div className="model-manager-meta">
                          <span>{formatPercent(ratio(execution.summary.judge?.judgeCorrectCount, execution.summary.judge?.judgeRuns))} judge</span>
                          <span>{formatCount(execution.summary.judge?.judgeRuns, execution.summary.runs)} covered</span>
                          <span>{formatUsd(execution.summary.cost?.meanTotalCostUsdPerRun, 4)}</span>
                        </div>
                        <div className="model-manager-actions">
                          <button
                            type="button"
                            className="icon-button"
                            disabled={index === 0}
                            onClick={() => moveExecution(execution.id, -1)}
                            aria-label={`Move ${execution.shortLabel} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            disabled={index === orderedExecutions.length - 1}
                            onClick={() => moveExecution(execution.id, 1)}
                            aria-label={`Move ${execution.shortLabel} down`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => removeExecution(execution.id)}
                            aria-label={`Remove ${execution.shortLabel}`}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </SidebarSection>

            <SidebarSection title="Appearance" defaultOpen>
              <div className="sidebar-stack">
                <div className="theme-toggle" role="tablist" aria-label="Theme">
                  <button
                    type="button"
                    className={`theme-option ${theme === 'light' ? 'is-active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    Day paper
                  </button>
                  <button
                    type="button"
                    className={`theme-option ${theme === 'dark' ? 'is-active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    Night desk
                  </button>
                </div>
              </div>
            </SidebarSection>

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
          <header className="masthead panel">
            <div className="masthead-rule" />
            <div className="eyebrow">{formatTimestamp(new Date().toISOString())}</div>
            <div className="masthead-grid">
              <div>
                <h2>Comparative benchmark report</h2>
                <p className="masthead-copy">
                  Optimized for one workflow: question first, scores second, answer text third.
                </p>
              </div>
              <div
                className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  void handleFiles(event.dataTransfer.files);
                }}
              >
                <div className="dropzone-label">Drop `aggregate.json` here</div>
                <p>Local only. Trim noise with model controls in sidebar.</p>
              </div>
            </div>
            <div className="stat-strip">
              <StatPill label="Models visible" value={`${totals.visibleExecutions}/${totals.loadedExecutions}`} />
              <StatPill label="Judge coverage" value={formatPercent(totals.judgeCoverageRate)} />
              <StatPill label="Questions in filter" value={String(totals.visibleQuestions)} />
              <StatPill label="Runs with errors" value={String(totals.runsWithErrors)} />
            </div>
          </header>

          {bundleLoadError ? (
            <section className="panel empty-panel">
              <SectionHeader title="Bundled snapshot failed to load" subtitle="The app can still open uploaded aggregates once the benchmark metadata is available locally." />
              <p>{bundleLoadError}</p>
            </section>
          ) : null}

          {messages.length > 0 ? (
            <section className="panel note-panel">
              <SectionHeader title="Desk notes" subtitle="Recent parser and desk actions." compact />
              <ul className="note-list">
                {messages.map((message, index) => (
                  <li key={`${message}-${index}`}>{message}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {executions.length === 0 ? (
            <section className="panel empty-panel">
              <SectionHeader
                title={bundledSnapshot ? 'No benchmark runs loaded' : 'Loading benchmark snapshot'}
                subtitle={bundledSnapshot ? 'Restore recent runs from sidebar or upload fresh aggregates.' : 'Fetching bundled benchmark metadata and recent run summaries.'}
              />
              <p>
                Bundled benchmark metadata: {questionBank.benchmarkName} · dataset {questionBank.datasetVersion} · rubric {questionBank.rubricVersion}
              </p>
            </section>
          ) : visibleExecutions.length === 0 ? (
            <section className="panel empty-panel">
              <SectionHeader title="All models hidden" subtitle="Re-enable at least one model in sidebar to continue comparison." />
              <div className="button-stack inline-stack">
                <button type="button" className="button button-solid" onClick={showAllExecutions}>
                  Show all models
                </button>
              </div>
            </section>
          ) : (
            <>
              <section id="scoring-model" className="panel section-panel">
                <SectionHeader
                  title="How to read this benchmark now"
                  subtitle="The visualizer follows the new judge-first structure: correctness and completeness are authoritative, reference verification is supporting context, and deterministic grading is a comparison tool."
                />
                <div className="scoring-guide-grid">
                  <article className="guide-card">
                    <div className="panel-topline">1. Judge correctness is the top call</div>
                    <h4>Use the judge to answer “was the answer right?”</h4>
                    <p>
                      The primary axis is centered on <strong>-1 / 0 / 1</strong>, with legacy verdict labels only kept as a compatibility view.
                    </p>
                  </article>
                  <article className="guide-card">
                    <div className="panel-topline">2. Completeness depends on question shape</div>
                    <h4>Targeted and synthesis questions are judged differently</h4>
                    <p>
                      Targeted questions need actionable implementation detail. Synthesis questions need the main buckets, tradeoffs, and organization.
                    </p>
                  </article>
                  <article className="guide-card">
                    <div className="panel-topline">3. Deterministic grading is secondary</div>
                    <h4>Keep it for comparison and debugging</h4>
                    <p>
                      Answer score, rubric hits, grounding, and agreement stay visible, but they no longer lead the reading of the benchmark.
                    </p>
                  </article>
                </div>
              </section>

              <section id="overview" className="panel section-panel">
                <SectionHeader
                  title="Overview"
                  subtitle="Read this left to right as judge outcome, judge coverage, and run health. Debug metrics still appear inside each expanded row."
                />
                <div className="ledger-table-head">
                  <span>Model</span>
                  <span>Judge correct</span>
                  <span>Completeness</span>
                  <span>Reference verified</span>
                  <span>Judge coverage</span>
                  <span>Cost / run</span>
                  <span>Run health</span>
                </div>
                <div className="ledger-stack">
                  {visibleExecutions.map((execution) => (
                    <details key={execution.id} className="ledger-row panel-shell">
                      <summary className="ledger-row-summary with-indicator">
                        <div className="ledger-model-cell">
                          <div className="run-overline">{execution.sourceName}</div>
                          <strong>{execution.shortLabel}</strong>
                          <span>{execution.label}</span>
                        </div>
                        <span>{formatPercent(ratio(execution.summary.judge?.judgeCorrectCount, execution.summary.judge?.judgeRuns))}</span>
                        <span>{formatNumber(execution.summary.judge?.meanCompleteness, 2)}</span>
                        <span>{formatPercent(execution.summary.judge?.referenceVerifiedRate)}</span>
                        <span>{formatCount(execution.summary.judge?.judgeRuns, execution.summary.runs)}</span>
                        <span>{formatUsd(execution.summary.cost?.meanTotalCostUsdPerRun, 4)}</span>
                        <span>{formatCount(execution.summary.errors?.runsWithAnyError, execution.summary.runs)}</span>
                      </summary>
                      <div className="ledger-row-body">
                        <div className="metric-pair-grid compact-grid">
                          <MetricPair label="Runs" value={String(execution.summary.runs ?? '—')} />
                          <MetricPair label="Judge correct rate" value={formatPercent(ratio(execution.summary.judge?.judgeCorrectCount, execution.summary.judge?.judgeRuns))} />
                          <MetricPair label="Judge coverage" value={formatCount(execution.summary.judge?.judgeRuns, execution.summary.runs)} />
                          <MetricPair label="Completeness" value={formatNumber(execution.summary.judge?.meanCompleteness, 2)} />
                          <MetricPair label="Reference verified rate" value={formatPercent(execution.summary.judge?.referenceVerifiedRate)} />
                          <MetricPair label="Answer score (debug)" value={formatNumber(execution.summary.meanAnswerScore, 2)} />
                          <MetricPair label="MRR" value={formatNumber(execution.summary.meanRetrievalMrr, 2)} />
                          <MetricPair label="Runs with errors" value={formatCount(execution.summary.errors?.runsWithAnyError, execution.summary.runs)} />
                        </div>
                        <div className="breakdown-ledger">
                          {getSummaryBreakdownEntries(execution.summary).map((entry) => (
                            <div
                              key={`${execution.id}-${entry.evidenceBasis ?? entry.questionType ?? 'breakdown'}`}
                              className="breakdown-ledger-row"
                            >
                              <strong>{humanizeToken(entry.evidenceBasis ?? entry.questionType ?? 'unknown')}</strong>
                              <span>{entry.runs ?? 0} runs</span>
                              <span>{formatPercent(ratio(entry.judge?.judgeCorrectCount, entry.judge?.judgeRuns))} correct</span>
                              <span>{formatNumber(entry.judge?.meanCompleteness, 2)} completeness</span>
                              <span>{formatPercent(entry.judge?.referenceVerifiedRate)} ref verified</span>
                              <span>{formatNumber(entry.meanAnswerScore, 2)} score</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </section>

              <section id="question-review" className="panel section-panel question-review-section">
                <SectionHeader
                  title="Question review"
                  subtitle="Start with the judge call on each question, then use deterministic grading and retrieval signals to explain disagreements or failures."
                />

                <div className="review-layout">
                  <aside className="question-list-pane">
                    <div className="question-list-toolbar">
                      <label className="control-field search-field">
                        <span>Search</span>
                        <input
                          type="search"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="q04, toolbar, deprecated, NavigationStack..."
                        />
                      </label>
                      <div className="question-filter-row">
                        <label className="control-field">
                          <span>Filter</span>
                          <select value={filterMode} onChange={(event) => setFilterMode(event.target.value as FilterMode)}>
                            <option value="interesting">Interesting only</option>
                            <option value="all">All questions</option>
                            <option value="errors">Errors only</option>
                            <option value="disagreement">Disagreement only</option>
                          </select>
                        </label>
                        <label className="control-field">
                          <span>Sort</span>
                          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                            <option value="dataset">Dataset order</option>
                            <option value="judge-risk">Weakest judge outcomes first</option>
                            <option value="most-disagreement">Most disagreement first</option>
                          </select>
                        </label>
                      </div>
                    </div>
                    <div className="question-list-meta">{visibleQuestionGroups.length} questions in current view</div>
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
                              <span>{padQuestionOrder(group.meta.order)}</span>
                              <div className="question-list-badges">
                                <Badge
                                  tone={
                                    group.judgeCorrectRate == null
                                      ? 'neutral'
                                      : group.judgeCorrectRate >= 0.5
                                        ? 'success'
                                        : 'warn'
                                  }
                                >
                                  judge {formatPercent(group.judgeCorrectRate)}
                                </Badge>
                                <Badge
                                  tone={
                                    group.referenceVerifiedRate == null
                                      ? 'neutral'
                                      : group.referenceVerifiedRate >= 0.5
                                        ? 'accent'
                                        : 'warn'
                                  }
                                >
                                  ref {formatPercent(group.referenceVerifiedRate)}
                                </Badge>
                                {group.hasErrors ? <Badge tone="danger">err</Badge> : null}
                              </div>
                            </div>
                            <strong>{group.meta.title}</strong>
                            <div className="question-list-item-foot">
                              <span>{humanizeToken(group.meta.evidenceBasis)}</span>
                              <span>{humanizeToken(group.meta.questionShape)}</span>
                              <span>{formatCount(group.judgeCoverageCount, visibleExecutions.length)} judged</span>
                              <span>{formatNumber(group.meanCompleteness, 2)} comp</span>
                              <span>{group.disagreementCount} disagreement</span>
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
                          >
                            ← Prev
                          </button>
                          <div className="focus-nav-meta">
                            <div className="eyebrow">Question focus</div>
                            <strong>{selectedQuestionIndex + 1} / {visibleQuestionGroups.length}</strong>
                          </div>
                          <button
                            type="button"
                            className="button button-tiny"
                            disabled={selectedQuestionIndex < 0 || selectedQuestionIndex >= visibleQuestionGroups.length - 1}
                            onClick={() => moveQuestionSelection(1)}
                          >
                            Next →
                          </button>
                        </div>

                        <header className="focus-question-header">
                          <div className="question-index large">{padQuestionOrder(selectedGroup.meta.order)}</div>
                          <div>
                            <h3>{selectedGroup.meta.title}</h3>
                            <p>{selectedGroup.meta.question}</p>
                            <div className="mini-note question-priority-note">
                              Judge correctness/completeness and reference verification are the primary signals here; answer score stays as debug context.
                            </div>
                            <div className="tag-wrap header-tags">
                              <Badge tone="neutral">{selectedGroup.meta.id}</Badge>
                              <Badge tone="neutral">{humanizeToken(selectedGroup.meta.evidenceBasis)}</Badge>
                              <Badge tone="neutral">{humanizeToken(selectedGroup.meta.questionShape)}</Badge>
                              <Badge tone="neutral">{humanizeToken(selectedGroup.meta.platformScope)}</Badge>
                              <Badge
                                tone={
                                  selectedGroup.judgeCorrectRate == null
                                    ? 'neutral'
                                    : selectedGroup.judgeCorrectRate >= 0.5
                                      ? 'success'
                                      : 'warn'
                                }
                              >
                                judge {formatPercent(selectedGroup.judgeCorrectRate)}
                              </Badge>
                              <Badge tone="neutral">
                                completeness {formatNumber(selectedGroup.meanCompleteness, 2)}
                              </Badge>
                              <Badge
                                tone={
                                  selectedGroup.referenceVerifiedRate == null
                                    ? 'neutral'
                                    : selectedGroup.referenceVerifiedRate >= 0.5
                                      ? 'accent'
                                      : 'warn'
                                }
                              >
                                ref verified {formatPercent(selectedGroup.referenceVerifiedRate)}
                              </Badge>
                              <Badge tone="neutral">
                                judged {formatCount(selectedGroup.judgeCoverageCount, visibleExecutions.length)}
                              </Badge>
                              <Badge tone={selectedGroup.disagreementCount > 1 ? 'warn' : 'neutral'}>
                                disagreement {selectedGroup.disagreementCount}
                              </Badge>
                              <Badge tone={selectedGroup.averageScore != null && selectedGroup.averageScore >= 1 ? 'success' : 'neutral'}>
                                debug score {selectedGroup.averageScore === null ? '—' : formatNumber(selectedGroup.averageScore, 2)}
                              </Badge>
                              {selectedGroup.hasErrors ? <Badge tone="danger">has errors</Badge> : null}
                            </div>
                          </div>
                        </header>

                        <div className="question-dossier-grid">
                          <section className="dossier-panel">
                            <div className="panel-topline">Reference answer</div>
                            <MarkdownBlock text={selectedGroup.meta.referenceAnswer} />
                          </section>
                          <section className="dossier-panel">
                            <div className="panel-topline">How this question is judged</div>
                            <p className="mini-copy">
                              {selectedGroup.meta.questionShape === 'synthesis'
                                ? 'Completeness here means covering the major buckets, tradeoffs, and organization a strong synthesis answer should include.'
                                : 'Completeness here means giving actionable implementation detail, caveats, or code-level guidance when the question calls for it.'}
                            </p>
                            <p className="mini-copy">
                              {selectedGroup.meta.evidenceBasis === 'corpus'
                                ? 'Reference verification is meaningful here because the benchmark expects the answer to line up with corpus-backed source material.'
                                : 'Reference verification is softer here because the benchmark treats this as curated guidance rather than a direct corpus lookup task.'}
                            </p>
                            <div className="metric-pair-grid compact-grid">
                              <MetricPair label="Judge coverage" value={formatCount(selectedGroup.judgeCoverageCount, visibleExecutions.length)} />
                              <MetricPair label="Judge correct rate" value={formatPercent(selectedGroup.judgeCorrectRate)} />
                              <MetricPair label="Mean completeness" value={formatNumber(selectedGroup.meanCompleteness, 2)} />
                              <MetricPair label="Reference verified" value={formatPercent(selectedGroup.referenceVerifiedRate)} />
                            </div>
                          </section>
                          <section className="dossier-panel">
                            <div className="panel-topline">Rubric and evidence</div>
                            <RubricList title="Must mention" items={selectedGroup.meta.rubric.mustMention} tone="success" />
                            <RubricGroupList title="Must mention one item from each group" groups={selectedGroup.meta.rubric.mustMentionAnyOf ?? []} tone="warn" />
                            <RubricList title="Must not mention" items={selectedGroup.meta.rubric.mustNotMention} tone="danger" />
                            {selectedGroup.meta.pitfall ? <p className="mini-copy">Pitfall: {selectedGroup.meta.pitfall}</p> : null}
                            <div className="tag-wrap dossier-tags">
                              {selectedGroup.meta.taxonomyTags.map((tag) => (
                                <Badge key={`${selectedGroup.meta.id}-${tag}`} tone="neutral">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                            {selectedGroup.meta.goldEvidence.length > 0 ? (
                              <div>
                                <div className="subtle-label">Gold evidence</div>
                                <ul className="path-list compact">
                                  {selectedGroup.meta.goldEvidence.map((evidence) => (
                                    <li key={`${selectedGroup.meta.id}-${evidence.filePath}`}>{evidence.filePath}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </section>
                        </div>

                        <section className="focus-scoreboard panel-shell">
                          <div className="focus-scoreboard-head">
                            <div>
                              <div className="run-overline">Comparison</div>
                              <h4>Judge-first comparison</h4>
                            </div>
                            <div className="scoreboard-controls">
                              <label className="control-field inline-control">
                                <span>Row order</span>
                                <select value={answerSortMode} onChange={(event) => setAnswerSortMode(event.target.value as AnswerSortMode)}>
                                  <option value="execution-order">Model order</option>
                                  <option value="score-desc">Best score first</option>
                                  <option value="judge-best">Best judge verdict first</option>
                                  <option value="cost-low">Lowest cost first</option>
                                </select>
                              </label>
                              <div className="toolbar-inline">
                                <button type="button" className="button button-tiny" onClick={() => setAllVisibleAnswerRows(true)}>
                                  Expand all
                                </button>
                                <button type="button" className="button button-tiny" onClick={() => setAllVisibleAnswerRows(false)}>
                                  Collapse all
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="scoreboard-wrap">
                            <table className="scoreboard-table">
                              <thead>
                                <tr>
                                  <th>Model</th>
                                  <th>Correctness</th>
                                  <th>Completeness</th>
                                  <th>Reference verified</th>
                                  <th>Judge status</th>
                                  <th>Deterministic</th>
                                  <th>Cost</th>
                                  <th>Error</th>
                                  <th aria-label="Expand" />
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
                                  const rowClassName = [
                                    'score-row',
                                    isBest ? 'is-best' : '',
                                    run?.errors?.collectHadError || run?.errors?.judgeHadError ? 'has-error' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ');

                                  return (
                                    <FragmentRow key={`${selectedGroup.meta.id}-${execution.id}`}>
                                      <tr className={rowClassName}>
                                        <th>
                                          <div className="table-model-cell">
                                            <strong>{execution.shortLabel}</strong>
                                            <span>{execution.sourceName}</span>
                                          </div>
                                        </th>
                                        <td>
                                          {run?.judge?.verdict || run?.judge?.correctness != null ? (
                                            <Badge tone={verdictTone(run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}>
                                              {run.judge?.verdict
                                                ? humanizeToken(run.judge.verdict)
                                                : humanizeToken(judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}
                                            </Badge>
                                          ) : '—'}
                                        </td>
                                        <td>{formatJudgeAxis(run?.judge?.completeness)}</td>
                                        <td>{formatBoolean(run?.judge?.referenceVerified)}</td>
                                        <td>{run?.judge?.status ?? '—'}</td>
                                        <td>{run?.grade?.agreement ? humanizeToken(run.grade.agreement) : run?.grade?.score == null ? '—' : String(run.grade.score)}</td>
                                        <td>{formatUsd(run?.cost?.totalUsd, 4)}</td>
                                        <td>{run ? (run.errors?.collectHadError || run.errors?.judgeHadError ? 'yes' : 'no') : '—'}</td>
                                        <td>
                                          <button
                                            type="button"
                                            className="row-toggle"
                                            onClick={() => toggleAnswerRow(selectedGroup.meta.id, execution.id)}
                                            aria-expanded={isOpen}
                                          >
                                            <span>{isOpen ? 'Hide' : 'Open'}</span>
                                            <span className={`chevron ${isOpen ? 'open' : ''}`}>▾</span>
                                          </button>
                                        </td>
                                      </tr>
                                      {isOpen ? (
                                        <tr className="score-detail-row">
                                          <td colSpan={9}>
                                            {run ? (
                                              <div className="score-detail-grid">
                                                <section className="detail-answer-column">
                                                  <div className="panel-topline">Answer</div>
                                                  <MarkdownBlock text={run.answer?.finalAnswer ?? 'No answer captured.'} />
                                                  {run.answer?.evidenceSummary ? (
                                                    <div className="detail-inline-note">
                                                      <div className="subtle-label">Evidence summary</div>
                                                      <p>{run.answer.evidenceSummary}</p>
                                                    </div>
                                                  ) : null}
                                                </section>
                                                <aside className="detail-meta-column">
                                                  <div className="tag-wrap top-tags compact-tags">
                                                    {run.judge?.verdict || run.judge?.correctness != null ? (
                                                      <Badge tone={verdictTone(run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}>
                                                        judge {humanizeToken(run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}
                                                      </Badge>
                                                    ) : null}
                                                    <Badge tone="neutral">
                                                      completeness {formatJudgeAxis(run.judge?.completeness)}
                                                    </Badge>
                                                    <Badge
                                                      tone={
                                                        run.judge?.referenceVerified == null
                                                          ? 'neutral'
                                                          : run.judge.referenceVerified
                                                            ? 'accent'
                                                            : 'warn'
                                                      }
                                                    >
                                                      reference verified {formatBoolean(run.judge?.referenceVerified)}
                                                    </Badge>
                                                    {run.errors?.collectHadError ? <Badge tone="danger">collect error</Badge> : null}
                                                    {run.errors?.judgeHadError ? <Badge tone="danger">judge error</Badge> : null}
                                                  </div>

                                                  <div className="detail-sections">
                                                    <section className="detail-section">
                                                      <div className="panel-topline">Authoritative judge call</div>
                                                      <p className="mini-copy">Start here. This is the benchmark's main read of correctness and completeness for this answer.</p>
                                                      <div className="judge-block">
                                                        <div className="judge-summary-row">
                                                          <Badge tone={verdictTone(run.judge?.verdict ?? judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}>
                                                            {run.judge?.verdict
                                                              ? humanizeToken(run.judge.verdict)
                                                              : humanizeToken(judgeVerdictFromCorrectness(run.judge?.correctness) ?? 'unknown')}
                                                          </Badge>
                                                          <Badge tone="neutral">
                                                            status {run.judge?.status ?? '—'}
                                                          </Badge>
                                                          <Badge
                                                            tone={
                                                              run.judge?.referenceVerified == null
                                                                ? 'neutral'
                                                                : run.judge.referenceVerified
                                                                  ? 'accent'
                                                                  : 'warn'
                                                            }
                                                          >
                                                            reference verified {formatBoolean(run.judge?.referenceVerified)}
                                                          </Badge>
                                                          <Badge tone={run.judge?.recommendsCorrectPattern ? 'success' : 'neutral'}>
                                                            correct pattern {formatBoolean(run.judge?.recommendsCorrectPattern)}
                                                          </Badge>
                                                          <Badge tone={run.judge?.recommendsDeprecatedPattern ? 'danger' : 'neutral'}>
                                                            deprecated pattern {formatBoolean(run.judge?.recommendsDeprecatedPattern)}
                                                          </Badge>
                                                        </div>

                                                        <div className="judge-metric-grid">
                                                          <MetricPair
                                                            label="Correctness"
                                                            value={
                                                              run.judge?.verdict
                                                                ? humanizeToken(run.judge.verdict)
                                                                : humanizeToken(judgeVerdictFromCorrectness(run.judge?.correctness) ?? '—')
                                                            }
                                                          />
                                                          <MetricPair label="Completeness" value={formatJudgeAxis(run.judge?.completeness)} />
                                                          <MetricPair label="Code example" value={formatJudgeScore(run.judge?.codeExample)} />
                                                          <MetricPair label="Explanation" value={formatJudgeScore(run.judge?.explanation)} />
                                                          <MetricPair label="Retrieval quality" value={formatJudgeScore(run.judge?.retrievalQuality)} />
                                                        </div>

                                                        {run.judge?.reasoning ? (
                                                          <div className="judge-reasoning">
                                                            <div className="subtle-label">Judge reasoning</div>
                                                            <p>{run.judge.reasoning}</p>
                                                          </div>
                                                        ) : null}
                                                      </div>
                                                    </section>

                                                    <section className="detail-section">
                                                      <div className="panel-topline">Support and caveats</div>
                                                      <div className="judge-summary-row">
                                                        <Badge tone={run.judge?.retrievalSupportsReferenceAnswer ? 'accent' : 'warn'}>
                                                          retrieval supports ref {formatBoolean(run.judge?.retrievalSupportsReferenceAnswer)}
                                                        </Badge>
                                                        {run.grade?.agreement ? <Badge tone="neutral">agreement {humanizeToken(run.grade.agreement)}</Badge> : null}
                                                        {run.grade?.rubricStrength ? <Badge tone="neutral">rubric {humanizeToken(run.grade.rubricStrength)}</Badge> : null}
                                                        {run.errors?.collectHadError ? <Badge tone="danger">collect error</Badge> : null}
                                                        {run.errors?.judgeHadError ? <Badge tone="danger">judge error</Badge> : null}
                                                      </div>
                                                      <div className="metric-pair-grid compact-grid detail-metrics-grid">
                                                        <MetricPair label="Debug score" value={run.grade?.score == null ? '—' : String(run.grade.score)} />
                                                        <MetricPair label="Grounded" value={run.grade?.grounded ? 'yes' : run ? 'no' : '—'} />
                                                        <MetricPair label="Citations" value={String(run.answer?.citationCount ?? 0)} />
                                                        <MetricPair label="Total cost" value={formatUsd(run.cost?.totalUsd, 4)} />
                                                      </div>
                                                    </section>

                                                    <details className="detail-section detail-debug-panel">
                                                      <summary className="with-indicator">Deterministic grade (comparison/debug)</summary>
                                                      <p className="mini-copy">Use this section to explain disagreement or inspect rubric misses. It is no longer the authoritative score.</p>
                                                      <RubricList title="Passed" items={run.grade?.mustMentionPassed ?? []} tone="success" />
                                                      <RubricList title="Missing" items={run.grade?.mustMentionFailed ?? []} tone="warn" />
                                                      <RubricList title="Violated" items={run.grade?.mustNotMentionViolated ?? []} tone="danger" />
                                                      <RubricList title="Failures" items={run.grade?.failures ?? []} tone="neutral" />
                                                      <div className="metric-pair-grid compact-grid detail-metrics-grid">
                                                        <MetricPair label="Bytes read" value={formatWholeNumber(run.grade?.retrieval?.bytesRead)} />
                                                        <MetricPair label="Files before relevant" value={formatWholeNumber(run.grade?.retrieval?.filesReadBeforeFirstRelevantDoc)} />
                                                        <MetricPair
                                                          label="Time to relevant"
                                                          value={run.grade?.retrieval?.timeToFirstRelevantDocMs == null ? '—' : `${run.grade.retrieval.timeToFirstRelevantDocMs} ms`}
                                                        />
                                                        <MetricPair label="Confidence" value={formatNumber(run.answer?.confidence, 2)} />
                                                      </div>
                                                    </details>

                                                    {run.answer?.citationFilePaths?.length ? (
                                                      <section className="detail-section">
                                                        <div className="panel-topline">Citations</div>
                                                        <ul className="path-list compact">
                                                          {run.answer.citationFilePaths.map((filePath) => (
                                                            <li key={`${run.runId}-${filePath}`}>{filePath}</li>
                                                          ))}
                                                        </ul>
                                                      </section>
                                                    ) : null}
                                                  </div>
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
                      <section className="panel empty-panel focus-empty">
                        <SectionHeader title="No question in current filter" subtitle="Relax search or filter to resume review." />
                      </section>
                    )}
                  </div>
                </div>
              </section>

              <section id="metric-desk" className="panel section-panel">
                <SectionHeader
                  title="Metric desk"
                  subtitle="Secondary scan view. Ranked ledgers stay available when you want one metric across all visible models."
                />
                <div className="metric-desk-grid">
                  {summaryMetrics.map((metric, index) => (
                    <MetricDeskCard
                      key={metric.label}
                      metric={metric}
                      executions={visibleExecutions}
                      defaultOpen={index < 4}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function MetricDeskCard({
  metric,
  executions,
  defaultOpen,
}: {
  metric: MetricDefinition;
  executions: LoadedExecution[];
  defaultOpen: boolean;
}) {
  const sortedRows = useMemo(() => {
    return executions
      .map((execution) => ({ execution, value: metric.value(execution) }))
      .filter((row) => row.value != null)
      .sort((left, right) => compareMetricValues(left.value, right.value, metric.higherIsBetter));
  }, [executions, metric]);

  const maxValue = sortedRows.reduce((max, row) => Math.max(max, row.value ?? 0), 0);
  const minValue = sortedRows.reduce(
    (min, row) => Math.min(min, row.value ?? Number.POSITIVE_INFINITY),
    Number.POSITIVE_INFINITY,
  );

  return (
    <details className="metric-card panel-shell" open={defaultOpen}>
      <summary className="metric-card-summary with-indicator">
        <div>
          <div className="run-overline">Metric</div>
          <strong>{metric.label}</strong>
        </div>
        <span>{metric.higherIsBetter ? 'higher wins' : 'lower wins'}</span>
      </summary>
      <div className="metric-card-body">
        {sortedRows.length === 0 ? (
          <div className="mini-note">No values available.</div>
        ) : (
          <div className="metric-ranking-list">
            {sortedRows.map((row, index) => (
              <div key={`${metric.label}-${row.execution.id}`} className="metric-ranking-row">
                <span className="metric-rank">{index + 1}</span>
                <div className="metric-ranking-main">
                  <div className="metric-ranking-label">{row.execution.shortLabel}</div>
                  <div className="metric-bar-track">
                    <div
                      className="metric-bar-fill"
                      style={{
                        width: `${metricWidth(row.value, minValue, maxValue, metric.higherIsBetter)}%`,
                      }}
                    />
                  </div>
                </div>
                <strong>{metric.format(row.value)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function SidebarSection({
  children,
  defaultOpen,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  title: string;
}) {
  return (
    <details className="sidebar-section" open={defaultOpen}>
      <summary className="with-indicator">{title}</summary>
      <div className="sidebar-section-body">{children}</div>
    </details>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function SectionHeader({
  title,
  subtitle,
  compact,
}: {
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  return (
    <div className={`section-heading ${compact ? 'compact' : ''}`}>
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'success' | 'warn' | 'danger' | 'accent' | 'neutral';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function RubricList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'success' | 'warn' | 'danger' | 'neutral';
}) {
  return (
    <div className="rubric-block">
      <div className="subtle-label">{title}</div>
      {items.length === 0 ? (
        <div className="empty-inline">none</div>
      ) : (
        <div className="tag-wrap">
          {items.map((item) => (
            <Badge key={`${title}-${item}`} tone={tone}>
              {item}
            </Badge>
          ))}
        </div>
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
  return (
    <div className="rubric-block">
      <div className="subtle-label">{title}</div>
      {groups.length === 0 ? (
        <div className="empty-inline">none</div>
      ) : (
        <div className="stack-sm">
          {groups.map((group, index) => (
            <div key={`${title}-${index}`} className="tag-wrap">
              {group.map((item) => (
                <Badge key={`${title}-${index}-${item}`} tone={tone}>
                  {item}
                </Badge>
              ))}
            </div>
          ))}
        </div>
      )}
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
  if (correctness === 1) {
    return 'correct';
  }
  if (correctness === 0) {
    return 'partially_correct';
  }
  if (correctness === -1) {
    return 'incorrect';
  }
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
      .filter(
        (run): run is EnrichedRun =>
          Boolean(
            run?.judge &&
              (run.judge.verdict !== undefined ||
                run.judge.correctness !== undefined ||
                run.judge.completeness !== undefined),
          ),
      );
    const judgeRuns = judgeAnswers.length;
    const judgeCorrectCount = judgeAnswers.reduce((count, run) => {
      if (run.judge?.verdict === 'correct' || run.judge?.correctness === 1) {
        return count + 1;
      }
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
  const rows = [...answers];

  if (mode === 'execution-order') {
    return rows;
  }

  if (mode === 'score-desc') {
    return rows.sort((left, right) => compareNullableNumbers(right.run?.grade?.score, left.run?.grade?.score));
  }

  if (mode === 'judge-best') {
    return rows.sort((left, right) => compareJudgePriority(right.run, left.run));
  }

  if (mode === 'cost-low') {
    return rows.sort((left, right) => compareNullableNumbers(left.run?.cost?.totalUsd, right.run?.cost?.totalUsd));
  }

  return rows;
}

function compareQuestionGroups(left: QuestionGroup, right: QuestionGroup, sortMode: SortMode): number {
  if (sortMode === 'judge-risk') {
    return (
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

function compareMetricValues(
  left: number | undefined,
  right: number | undefined,
  higherIsBetter: boolean,
): number {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return higherIsBetter ? right - left : left - right;
}

function compareNullableNumbers(left: number | undefined, right: number | undefined): number {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return left - right;
}

function metricWidth(
  value: number | undefined,
  minValue: number,
  maxValue: number,
  higherIsBetter: boolean,
): number {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }

  if (!Number.isFinite(minValue) || maxValue === minValue) {
    return 100;
  }

  const ratioValue = higherIsBetter
    ? (value - minValue) / (maxValue - minValue)
    : (maxValue - value) / (maxValue - minValue);

  return Math.max(16, Math.round(ratioValue * 100));
}

function verdictRank(verdict: string | undefined): number {
  if (verdict === 'correct') {
    return 3;
  }
  if (verdict === 'partially_correct') {
    return 2;
  }
  if (verdict === 'incorrect') {
    return 1;
  }
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
  const leftVerdict = verdictRank(
    left?.judge?.verdict ?? judgeVerdictFromCorrectness(left?.judge?.correctness),
  );
  const rightVerdict = verdictRank(
    right?.judge?.verdict ?? judgeVerdictFromCorrectness(right?.judge?.correctness),
  );
  if (leftVerdict !== rightVerdict) {
    return leftVerdict - rightVerdict;
  }

  const leftCompleteness = left?.judge?.completeness ?? Number.NEGATIVE_INFINITY;
  const rightCompleteness = right?.judge?.completeness ?? Number.NEGATIVE_INFINITY;
  if (leftCompleteness !== rightCompleteness) {
    return leftCompleteness - rightCompleteness;
  }

  const leftReferenceVerified =
    left?.judge?.referenceVerified === true
      ? 1
      : left?.judge?.referenceVerified === false
        ? 0
        : -1;
  const rightReferenceVerified =
    right?.judge?.referenceVerified === true
      ? 1
      : right?.judge?.referenceVerified === false
        ? 0
        : -1;
  if (leftReferenceVerified !== rightReferenceVerified) {
    return leftReferenceVerified - rightReferenceVerified;
  }

  return 0;
}

function makeAnswerRowKey(questionId: string, executionId: string): string {
  return `${questionId}::${executionId}`;
}

function ratio(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator == null || denominator == null || denominator === 0) {
    return undefined;
  }
  return numerator / denominator;
}

function formatNumber(value: number | undefined | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

function formatWholeNumber(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number | undefined | null, digits = 0): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function formatUsd(value: number | undefined | null, digits = 4): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatBoolean(value: boolean | undefined): string {
  if (value == null) {
    return '—';
  }
  return value ? 'yes' : 'no';
}

function formatJudgeAxis(value: number | undefined): string {
  if (value == null) {
    return '—';
  }
  if (value === 1) {
    return '+1';
  }
  if (value === 0) {
    return '0';
  }
  if (value === -1) {
    return '−1';
  }
  return formatNumber(value, 2);
}

function formatJudgeScore(value: number | undefined): string {
  if (value == null) {
    return '—';
  }
  return `${value}/2`;
}

function formatCount(value: number | undefined, total: number | undefined): string {
  if (value == null) {
    return '—';
  }
  if (total == null) {
    return String(value);
  }
  return `${value}/${total}`;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function verdictTone(verdict: string): 'success' | 'warn' | 'danger' | 'neutral' {
  if (verdict === 'correct') {
    return 'success';
  }
  if (verdict === 'partially_correct') {
    return 'warn';
  }
  if (verdict === 'incorrect') {
    return 'danger';
  }
  return 'neutral';
}

function humanizeToken(value: string): string {
  return value.replace(/_/g, ' ');
}

function padQuestionOrder(order: number): string {
  return `Q${String(order).padStart(2, '0')}`;
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default App;
