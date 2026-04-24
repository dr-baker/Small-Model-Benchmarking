export interface SwiftDocsHybridPageResult {
  doc_id?: string;
  normalized_md_path?: string | null;
}

export interface SwiftDocsHybridChunkResult {
  chunk_id?: string;
  doc_id?: string;
  normalized_md_path?: string | null;
}

export interface SwiftDocsHybridToolResult {
  pages: SwiftDocsHybridPageResult[];
  chunks: SwiftDocsHybridChunkResult[];
}

export function isSwiftDocsSearchToolName(toolName: string): boolean {
  return toolName === "swift_docs_search_hybrid" || toolName === "swift_docs_search";
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function parseSwiftDocsHybridToolResult(value: unknown): SwiftDocsHybridToolResult | undefined {
  const parsed = typeof value === "string" ? parseJsonString(value) : value;
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const pagesInput = Array.isArray(record.pages) ? record.pages : [];
  const chunksInput = Array.isArray(record.chunks) ? record.chunks : [];

  const pages = pagesInput.map((page) => {
    const item = page && typeof page === "object" ? page as Record<string, unknown> : {};
    return {
      ...(typeof item.doc_id === "string" ? { doc_id: item.doc_id } : {}),
      ...(typeof item.normalized_md_path === "string" || item.normalized_md_path === null
        ? { normalized_md_path: item.normalized_md_path as string | null }
        : {}),
    };
  });

  const chunks = chunksInput.map((chunk) => {
    const item = chunk && typeof chunk === "object" ? chunk as Record<string, unknown> : {};
    return {
      ...(typeof item.chunk_id === "string" ? { chunk_id: item.chunk_id } : {}),
      ...(typeof item.doc_id === "string" ? { doc_id: item.doc_id } : {}),
      ...(typeof item.normalized_md_path === "string" || item.normalized_md_path === null
        ? { normalized_md_path: item.normalized_md_path as string | null }
        : {}),
    };
  });

  if (!Array.isArray(record.pages) && !Array.isArray(record.chunks)) return undefined;
  return { pages, chunks };
}

export function collectSwiftDocsRetrievedPaths(result: SwiftDocsHybridToolResult): Set<string> {
  const paths = new Set<string>();
  for (const page of result.pages) {
    if (typeof page.normalized_md_path === "string" && page.normalized_md_path.length > 0) {
      paths.add(page.normalized_md_path);
    }
  }
  for (const chunk of result.chunks) {
    if (typeof chunk.normalized_md_path === "string" && chunk.normalized_md_path.length > 0) {
      paths.add(chunk.normalized_md_path);
    }
  }
  return paths;
}
