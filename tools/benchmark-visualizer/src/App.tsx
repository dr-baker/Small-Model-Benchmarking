import { useEffect, useMemo, useState } from 'react';
import ClaudeVisualizerApp from './ClaudeVisualizerApp';
import Gpt55VisualizerApp from './Gpt55VisualizerApp';

type VisualizerVersionKey = 'claude' | 'gpt-5-5';

interface VisualizerVersion {
  key: VisualizerVersionKey;
  label: string;
  shortLabel: string;
  description: string;
}

const VISUALIZER_VERSION_STORAGE_KEY = 'benchmark-visualizer-version';

const VISUALIZER_VERSIONS: VisualizerVersion[] = [
  {
    key: 'claude',
    label: 'Claude layout',
    shortLabel: 'Claude',
    description: 'Main branch visualizer with the model ledger and metric desk layout.',
  },
  {
    key: 'gpt-5-5',
    label: '5.5 KPI layout',
    shortLabel: '5.5',
    description: 'KPI-first visualizer focused on toolset deltas, winners, and tradeoffs.',
  },
];

function App() {
  const [activeVersionKey, setActiveVersionKey] = useState<VisualizerVersionKey>(getInitialVisualizerVersion);
  const activeVersion = useMemo(
    () => VISUALIZER_VERSIONS.find((version) => version.key === activeVersionKey) ?? VISUALIZER_VERSIONS[0],
    [activeVersionKey],
  );

  useEffect(() => {
    window.localStorage.setItem(VISUALIZER_VERSION_STORAGE_KEY, activeVersion.key);
    document.documentElement.dataset.visualizerVersion = activeVersion.key;
  }, [activeVersion.key]);

  return (
    <>
      {activeVersion.key === 'claude' ? <ClaudeVisualizerApp /> : <Gpt55VisualizerApp />}
      <VersionPicker activeVersion={activeVersion} onChange={setActiveVersionKey} />
    </>
  );
}

function VersionPicker({
  activeVersion,
  onChange,
}: {
  activeVersion: VisualizerVersion;
  onChange: (version: VisualizerVersionKey) => void;
}) {
  return (
    <aside className="version-picker" aria-label="Visualizer version picker">
      <div className="version-picker-current">
        <span>Site version</span>
        <strong>{activeVersion.shortLabel}</strong>
      </div>
      <div className="version-picker-menu">
        {VISUALIZER_VERSIONS.map((version) => {
          const isActive = version.key === activeVersion.key;
          return (
            <button
              key={version.key}
              type="button"
              className={`version-picker-option ${isActive ? 'is-active' : ''}`}
              onClick={() => onChange(version.key)}
              aria-pressed={isActive}
            >
              <span>{version.label}</span>
              <em>{version.description}</em>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function getInitialVisualizerVersion(): VisualizerVersionKey {
  if (typeof window === 'undefined') return 'claude';
  const params = new URLSearchParams(window.location.search);
  const queryVersion = normalizeVisualizerVersion(params.get('viz'));
  if (queryVersion) return queryVersion;
  const storedVersion = normalizeVisualizerVersion(window.localStorage.getItem(VISUALIZER_VERSION_STORAGE_KEY));
  return storedVersion ?? 'claude';
}

function normalizeVisualizerVersion(value: string | null): VisualizerVersionKey | null {
  if (value === 'claude') return 'claude';
  if (value === 'gpt-5-5' || value === '5.5' || value === 'gpt55') return 'gpt-5-5';
  return null;
}

export default App;
