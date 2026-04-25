import type { AggregateSummary, ExecutionDisplayProfile } from '../types';

const MODEL_NAME_OVERRIDES: Record<string, string> = {
  'openai/gpt-oss-120b': 'GPT OSS 120B',
  'openai/gpt-oss-safeguard-20b': 'GPT OSS Safeguard 20B',
  'inception/mercury': 'Mercury',
  'nvidia/nemotron-3-super-120b': 'Nemotron 3 Super 120B',
  'qwen/qwen3-next-80b-a3b-thinking': 'Qwen3 Next 80B Thinking',
  'mistralai/devstral-small': 'Devstral Small',
  'z-ai/glm-4.7-flash': 'GLM 4.7 Flash',
};

const TOOLSET_LABELS: Record<string, string> = {
  none: 'Closed book',
  read_only: 'Read only',
  read_grep: 'Read + grep',
  read_grep_glob: 'Read + grep + glob',
  swift_docs_hybrid: 'RAG v1',
  swift_docs_search_read: 'RAG v2',
};

export function buildExecutionDisplayProfile(summary: AggregateSummary, sourceName: string): ExecutionDisplayProfile {
  const provider = summary.model?.provider ?? 'unknown-provider';
  const modelId = summary.model?.modelId ?? 'unknown-model';
  const toolSetKey = summary.toolSet?.name ?? (summary.mode === 'closed_book' ? 'none' : 'unknown-tools');
  const modeKey = summary.mode ?? 'unknown';
  const route = deriveRoute(summary, sourceName);
  const answerMode = summary.answerCollectionMode;
  const variants = deriveVariants(summary, sourceName);
  const chips = [
    toolSetLabel(toolSetKey),
    modeLabel(modeKey),
    route ? `via ${humanizeLoose(route)}` : null,
    answerMode ? answerModeLabel(answerMode) : null,
    ...variants,
  ].filter((chip): chip is string => Boolean(chip));

  return {
    provider,
    modelId,
    modelLabel: modelLabel(modelId),
    modelFamily: modelFamily(modelId),
    toolSetKey,
    toolSetLabel: toolSetLabel(toolSetKey),
    modeKey,
    modeLabel: modeLabel(modeKey),
    route,
    routeLabel: route ? humanizeLoose(route) : undefined,
    answerMode,
    answerModeLabel: answerMode ? answerModeLabel(answerMode) : undefined,
    variants,
    primaryLabel: modelLabel(modelId),
    secondaryLabel: chips.join(' · '),
    compactLabel: [modelLabel(modelId), toolSetLabel(toolSetKey)].join(' · '),
    fullLabel: [provider, modelId, toolSetKey, modeKey, route, answerMode, ...variants]
      .filter((part): part is string => Boolean(part))
      .join(' / '),
  };
}

function modelLabel(modelId: string): string {
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

function modelFamily(modelId: string): string {
  const leaf = modelId.split('/').pop() ?? modelId;
  return leaf.split(/[-_]/).slice(0, 2).join(' ') || leaf;
}

function toolSetLabel(toolSetKey: string): string {
  return TOOLSET_LABELS[toolSetKey] ?? humanizeLoose(toolSetKey);
}

function modeLabel(modeKey: string): string {
  if (modeKey === 'open_book') return 'Open book';
  if (modeKey === 'closed_book') return 'Closed book';
  return humanizeLoose(modeKey);
}

function answerModeLabel(answerMode: string): string {
  if (answerMode === 'lazy_text') return 'lazy answers';
  if (answerMode === 'structured_json') return 'structured answers';
  return humanizeLoose(answerMode);
}

function deriveRoute(summary: AggregateSummary, sourceName: string): string | undefined {
  const routing = summary.transport?.openRouterRouting;
  const routedProvider = routing?.only?.[0] ?? routing?.order?.[0];
  if (typeof routedProvider === 'string' && routedProvider.length > 0) return routedProvider;

  const normalizedSourceName = sourceName.toLowerCase();
  if (normalizedSourceName.includes('cerebras')) return 'cerebras';
  if (normalizedSourceName.includes('baseten')) return 'baseten';
  if (normalizedSourceName.includes('deepinfra')) return 'deepinfra';
  if (normalizedSourceName.includes('groq')) return 'groq';
  return undefined;
}

function deriveVariants(summary: AggregateSummary, sourceName: string): string[] {
  const variants: string[] = [];
  const source = `${sourceName} ${summary.model?.modelId ?? ''}`.toLowerCase();
  if (source.includes('thinking') || source.includes('think-hard')) variants.push('thinking');
  if (source.includes('search-corpus')) variants.push('search corpus');
  if (source.includes('multiquery') || source.includes('multi-query')) variants.push('multi-query');
  if (source.includes('structured-probe')) variants.push('probe');
  if (source.includes('lazy-pilot')) variants.push('pilot');
  return Array.from(new Set(variants));
}

function humanizeLoose(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bJson\b/g, 'JSON')
    .replace(/\bDocs\b/g, 'Docs');
}
