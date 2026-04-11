import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFindTool, createGrepTool, createLsTool, createReadTool } from "@mariozechner/pi-coding-agent";
import type { ToolSetDefinition, ToolSetName } from "../shared/contracts.js";

interface ToolSetCatalogFile {
  version: string;
  toolSets: ToolSetDefinition[];
}

const TOOL_SET_CATALOG_PATH = resolve("tool-sets/tool-sets.v1.json");

export async function loadToolSetCatalog(): Promise<Map<ToolSetName, ToolSetDefinition>> {
  const parsed = JSON.parse(await readFile(TOOL_SET_CATALOG_PATH, "utf8")) as ToolSetCatalogFile;
  return new Map(parsed.toolSets.map((toolSet) => [toolSet.name, toolSet]));
}

export async function loadToolSetDefinition(name: ToolSetName): Promise<ToolSetDefinition> {
  const catalog = await loadToolSetCatalog();
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
  | ReturnType<typeof createLsTool>;

export function createToolsForToolSet(toolSet: ToolSetDefinition, cwd: string): CollectTool[] {
  const tools = [] as CollectTool[];
  for (const toolName of toolSet.toolNames) {
    switch (toolName) {
      case "read":
        tools.push(createReadTool(cwd));
        break;
      case "grep":
        tools.push(createGrepTool(cwd));
        break;
      case "find":
        tools.push(createFindTool(cwd));
        break;
      case "ls":
        tools.push(createLsTool(cwd));
        break;
      default:
        throw new Error(`Unsupported tool in catalog: ${toolName}`);
    }
  }
  return tools;
}
