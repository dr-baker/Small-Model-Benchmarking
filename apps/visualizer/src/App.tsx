import { useEffect } from 'react';
import CleanVisualizerApp from './CleanVisualizerApp';
import ClaudeVisualizerApp from './ClaudeVisualizerApp';
import Gpt55VisualizerApp from './Gpt55VisualizerApp';

type VisualizerVersionKey = 'clean' | 'claude' | 'gpt-5-5';

function App() {
  const activeVersionKey = getPathVisualizerVersion();

  useEffect(() => {
    document.documentElement.dataset.visualizerVersion = activeVersionKey;
  }, [activeVersionKey]);

  if (activeVersionKey === 'claude') return <ClaudeVisualizerApp />;
  if (activeVersionKey === 'gpt-5-5') return <Gpt55VisualizerApp />;
  return <CleanVisualizerApp />;
}

function getPathVisualizerVersion(): VisualizerVersionKey {
  if (typeof window === 'undefined') return 'clean';
  const firstPathSegment = window.location.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  if (firstPathSegment === 'claude') return 'claude';
  if (firstPathSegment === 'gpt-5-5' || firstPathSegment === 'gpt55' || firstPathSegment === '5.5') return 'gpt-5-5';
  return 'clean';
}

export default App;
