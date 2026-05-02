import { loadBenchmarkConfig } from "../../src/core/config.js";
import { createSwiftDocsSearchTool } from "../../src/pipeline/collect/swift-docs-tool.js";

interface CliArgs {
  query?: string;
  queries?: string[];
  symbols: string[];
  caseName?: string;
}

function parseCsv(raw: string): string[] {
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { symbols: [] };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--query=")) result.query = arg.split("=")[1];
    else if (arg.startsWith("--queries=")) result.queries = (arg.split("=")[1] ?? "").split("||").map((item) => item.trim()).filter(Boolean);
    else if (arg.startsWith("--symbols=")) result.symbols = parseCsv(arg.split("=")[1] ?? "");
    else if (arg.startsWith("--case=")) result.caseName = arg.split("=")[1];
    else if (arg === "--help") {
      console.log("Usage: npm run test:tools:swift-docs-search -- --query='...' [--queries='q1||q2'] [--symbols=A,B] [--case=name]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

const CASES = {
  q07: {
    query: "modern swiftui way to round corners on a container",
    symbols: ["clipShape(_:style:)", "cornerRadius"],
  },
  q45: {
    query: "how to add a delay in an async context",
    symbols: ["Task.sleep"],
  },
  q51: {
    query: "display a web page in swiftui",
    symbols: ["WebView", "WKWebView", "UIViewRepresentable"],
  },
  q64: {
    query: "are colored circles alone enough for status indicators in swiftui",
    symbols: ["accessibilityDifferentiateWithoutColor"],
  },
} satisfies Record<string, { query: string; symbols: string[] }>;

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadBenchmarkConfig();
  if (!config.swiftDocs) {
    throw new Error("benchmark config is missing swiftDocs; add benchmark.local.yaml first");
  }

  const selected = args.caseName ? CASES[args.caseName as keyof typeof CASES] : undefined;
  const query = args.query ?? selected?.query;
  const queries = args.queries && args.queries.length > 0 ? args.queries : undefined;
  const symbols = args.symbols.length > 0 ? args.symbols : (selected?.symbols ?? []);
  if (!query && !queries) {
    throw new Error("Provide --query=..., --queries='q1||q2', or --case=<q07|q45|q51|q64>");
  }

  const tool = createSwiftDocsSearchTool(config.swiftDocs);
  const prepared = tool.prepareArguments ? tool.prepareArguments({ ...(query ? { query } : {}), ...(queries ? { queries } : {}), symbols }) : { ...(query ? { query } : {}), ...(queries ? { queries } : {}), symbols };
  const result = await tool.execute("test-call", prepared);
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("Tool returned no text content");
  }

  console.log(text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
