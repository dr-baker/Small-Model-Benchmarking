const TOOLSET_DISPLAY: Record<string, { label: string; description: string }> = {
  none: {
    label: 'No tools',
    description: 'Closed book — model answers from training data only, no retrieval.',
  },
  closed_book: {
    label: 'Closed book',
    description: 'No tools — model answers from training data only, no retrieval.',
  },
  read_only: {
    label: 'Read',
    description: 'Model can open files in the docs corpus by path. No search.',
  },
  read_grep: {
    label: 'Read + grep',
    description: 'Model can search the corpus with regex (grep) and open matches with read.',
  },
  read_grep_glob: {
    label: 'Read + grep + glob',
    description: 'Read + grep plus glob — model can also enumerate files by path pattern.',
  },
  swift_docs_hybrid: {
    label: 'Vector search',
    description: 'Model emits several related queries; semantic search returns matching chunks; model collates the answer.',
  },
  swift_docs_search_read: {
    label: 'Vector search + read',
    description: 'Like vector search, but the model is also given a read tool to follow up on retrieved chunks.',
  },
  spoonfed_rag: {
    label: 'No-tools vector search',
    description: 'No tool calls — the pipeline runs vector search first and feeds the chunks in as part of the prompt.',
  },
};

const FALLBACK = {
  label: 'Unknown toolset',
  description: 'No description available for this toolset.',
};

const TOOLSET_COLORS: Record<string, string> = {
  none: '#9ca3af',
  closed_book: '#9ca3af',
  read_only: '#2563eb',
  read_grep: '#0891b2',
  read_grep_glob: '#7c3aed',
  swift_docs_hybrid: '#ea580c',
  swift_docs_search_read: '#dc2626',
  spoonfed_rag: '#059669',
};

export function getToolsetColor(toolSetKey: string | undefined): string {
  if (!toolSetKey) return '#6b7280';
  return TOOLSET_COLORS[toolSetKey] ?? '#6b7280';
}

export function getToolsetDisplay(key: string | undefined): { label: string; description: string } {
  if (!key) return FALLBACK;
  return TOOLSET_DISPLAY[key] ?? FALLBACK;
}

export function ToolsetIcon({
  toolSetKey,
  label,
  size,
  showLabel = false,
  className,
}: {
  toolSetKey: string | undefined;
  label?: string;
  size?: number;
  showLabel?: boolean;
  className?: string;
}) {
  const entry = (toolSetKey ? TOOLSET_DISPLAY[toolSetKey] : undefined) ?? FALLBACK;
  const displayLabel = label ?? entry.label;
  const color = getToolsetColor(toolSetKey);
  const sizeStyle = typeof size === 'number' ? { width: size, height: size } : undefined;

  return (
    <span className={`tool-icon-wrap ${className ?? ''}`}>
      <span
        className="tool-icon"
        aria-hidden="true"
        style={{ ...sizeStyle, background: color }}
      />
      {showLabel ? <span className="tool-icon-label">{displayLabel}</span> : null}
      <span className="tool-icon-tip" role="tooltip">
        <strong>{displayLabel}</strong>
        <span>{entry.description}</span>
      </span>
      <span className="sr-only">{displayLabel} — {entry.description}</span>
    </span>
  );
}
