import { readFile } from "node:fs/promises";
import { createFindTool, createGrepTool, createLsTool, createReadTool } from "@mariozechner/pi-coding-agent";
import type { SwiftDocsToolConfig, ToolSetDefinition, ToolSetName } from "../../core/contracts.js";
import { resolvePathWithinCorpus } from "../../core/corpus-paths.js";
import { createSwiftDocsSearchHybridTool, createSwiftDocsSearchTool } from "./swift-docs-tool.js";

interface ToolSetCatalogFile {
  version: string;
  toolSets: ToolSetDefinition[];
}

export async function loadToolSetCatalog(catalogPath: string): Promise<Map<ToolSetName, ToolSetDefinition>> {
  const parsed = JSON.parse(await readFile(catalogPath, "utf8")) as ToolSetCatalogFile;
  return new Map(parsed.toolSets.map((toolSet) => [toolSet.name, toolSet]));
}

export async function loadToolSetDefinition(catalogPath: string, name: ToolSetName): Promise<ToolSetDefinition> {
  const catalog = await loadToolSetCatalog(catalogPath);
  const toolSet = catalog.get(name);
  if (!toolSet) {
    throw new Error(`Unknown tool set: ${name}`);
  }
  return toolSet;
}

type CollectTool =
  | ReturnType<typeof createReadTool>
  | ReturnType<typeof createGrepTool>
  | ReturnType<typeof createFindTool>
  | ReturnType<typeof createLsTool>
  | ReturnType<typeof createSwiftDocsSearchHybridTool>
  | ReturnType<typeof createSwiftDocsSearchTool>;

type ToolLike = {
  name: string;
  description: string;
  parameters: unknown;
  prepareArguments?: (args: unknown) => unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (partialResult: unknown) => void) => Promise<{ content: Array<{ type: string; text?: string }> }>;
};

function sandboxPathArgs(args: unknown, corpusRoot: string, toolName: string): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const candidate = args as Record<string, unknown>;
  if (!("path" in candidate)) return args;
  const rawPath = typeof candidate.path === "string" ? candidate.path : undefined;
  if (!rawPath && toolName === "read") return args;
  return {
    ...candidate,
    path: resolvePathWithinCorpus(rawPath, corpusRoot),
  };
}

function sandboxTool<T extends CollectTool>(tool: T, corpusRoot: string): T {
  const wrapped = tool as T & ToolLike;
  return {
    ...wrapped,
    prepareArguments: (args: unknown) => {
      const prepared = wrapped.prepareArguments ? wrapped.prepareArguments(args) : args;
      return sandboxPathArgs(prepared, corpusRoot, wrapped.name);
    },
    execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (partialResult: unknown) => void) => {
      const sandboxedParams = sandboxPathArgs(params, corpusRoot, wrapped.name);
      return wrapped.execute(toolCallId, sandboxedParams, signal, onUpdate);
    },
  } as T;
}

export function createToolsForToolSet(toolSet: ToolSetDefinition, cwd: string, options?: { swiftDocs?: SwiftDocsToolConfig }): CollectTool[] {
  const tools = [] as CollectTool[];
  for (const toolName of toolSet.toolNames) {
    switch (toolName) {
      case "read":
        tools.push(sandboxTool(createReadTool(cwd), cwd));
        break;
      case "grep":
        tools.push(sandboxTool(createGrepTool(cwd), cwd));
        break;
      case "find":
        tools.push(sandboxTool(createFindTool(cwd), cwd));
        break;
      case "ls":
        tools.push(sandboxTool(createLsTool(cwd), cwd));
        break;
      case "swift_docs_search_hybrid":
        if (!options?.swiftDocs) {
          throw new Error("Tool set requires swiftDocs config, but benchmark config.swiftDocs is missing.");
        }
        tools.push(createSwiftDocsSearchHybridTool(options.swiftDocs));
        break;
      case "swift_docs_search":
        if (!options?.swiftDocs) {
          throw new Error("Tool set requires swiftDocs config, but benchmark config.swiftDocs is missing.");
        }
        tools.push(createSwiftDocsSearchTool(options.swiftDocs));
        break;
      default:
        throw new Error(`Unsupported tool in catalog: ${toolName}`);
    }
  }
  return tools;
}
