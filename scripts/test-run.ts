import { resolve } from "node:path";
import { runCollect } from "../src/collect/run.js";
import { judgeRun } from "../src/judge/run.js";
import { gradeRun } from "../src/grade/run.js";
import { aggregateRuns } from "../src/aggregate/run.js";
import { readJsonFile } from "../src/shared/io.js";
import type { DatasetQuestion, JudgeProfileCatalog, ToolSetDefinition, ModelRef } from "../src/shared/contracts.js";

async function main() {
  const modelArg = process.argv.find((arg) => arg.startsWith("--model="))?.split("=")[1] ?? "openrouter/openai/gpt-oss-120b:nitro";
  const judgeModelArg = process.argv.find((arg) => arg.startsWith("--judge-model="))?.split("=")[1];

  const [provider, ...rest] = modelArg.split("/");
  const modelId = rest.join("/");

  if (!provider || !modelId) {
    throw new Error("Invalid model format. Use --model=provider/model-id (e.g. --model=openrouter/openai/gpt-oss-120b:nitro)");
  }

  const modelRef: ModelRef = { provider, modelId };

  const judgeModelRef = (() => {
    if (!judgeModelArg) return undefined;
    const [judgeProvider, ...judgeRest] = judgeModelArg.split("/");
    const judgeModelId = judgeRest.join("/");
    if (!judgeProvider || !judgeModelId) {
      throw new Error("Invalid judge model format. Use --judge-model=provider/model-id");
    }
    return { provider: judgeProvider, modelId: judgeModelId } satisfies ModelRef;
  })();

  const datasetPath = resolve("dataset/swiftui-docs-chatbot-benchmark.v1.json");
  const dataset = await readJsonFile<{ questions: DatasetQuestion[] }>(datasetPath);
  const question = dataset.questions[0]; // q01-tab-definition

  const toolSetsPath = resolve("tool-sets/tool-sets.v1.json");
  const catalog = await readJsonFile<{ toolSets: ToolSetDefinition[] }>(toolSetsPath);
  const judgeProfilesPath = resolve("judges/judge-profiles.v1.json");
  const judgeProfiles = await readJsonFile<JudgeProfileCatalog>(judgeProfilesPath);
  const judgeProfile = judgeProfiles.profiles.find((profile) => profile.id === "semantic-judge-v1");

  if (!judgeProfile) {
    throw new Error("Missing judge profile semantic-judge-v1 in judges/judge-profiles.v1.json");
  }
  
  const runMode = async (mode: "open_book" | "closed_book") => {
    const toolSetName = mode === "open_book" ? "read_grep" : "none";
    const toolSet = catalog.toolSets.find((ts) => ts.name === toolSetName)!;

    console.log(`\n==> [${mode.toUpperCase()}] Running collect stage...`);
    const collectOutput = await runCollect({
      contractVersion: "benchmark-contract.v1",
      runId: `test-run-${mode}-${Date.now()}`,
      benchmarkName: "test-benchmark-comparison",
      model: modelRef,
      mode,
      toolSet,
      promptTemplateId: "benchmark-answer-v1",
      promptTemplateVersion: "v1",
      responseSchemaVersion: "answer-response.v1",
      rubricVersion: "rubric.v1",
      corpus: {
        snapshotId: "swift-docs-2026-04-10",
        rootDir: "corpus/swift-docs-2026-04-10/swiftui-macos-corpus",
        manifestPath: "corpus/swift-docs-2026-04-10/manifest.json",
        manifestSha256: "d71285e0", 
      },
      question,
      sampling: {},
    });

    console.log(`==> [${mode.toUpperCase()}] Running judge stage...`);
    await judgeRun({
      runDirectory: collectOutput.runDirectory,
      datasetPath,
      judgeProfilePath: judgeProfilesPath,
      judgeProfileId: judgeProfile.id,
      ...(judgeModelRef ? { judgeModelOverride: judgeModelRef } : {}),
    });

    console.log(`==> [${mode.toUpperCase()}] Running grade stage...`);
    await gradeRun({
      runDirectory: collectOutput.runDirectory,
      rubricPath: resolve("rubric/rubric.v1.json"),
      datasetPath,
    });
    return collectOutput.runDirectory;
  };

  const openRunDir = await runMode("open_book");
  const closedRunDir = await runMode("closed_book");

  console.log("\n==> Running aggregate stage...");
  const aggregateOutput = await aggregateRuns({
    runDirectories: [openRunDir, closedRunDir],
    benchmarkName: "test-benchmark-comparison",
    rubricVersion: "rubric.v1",
  });

  console.log("\n==> RESULTS COMPARISON:");
  for (const summary of aggregateOutput.summaries) {
    console.log(`- Mode: ${summary.mode} | Score: ${summary.meanAnswerScore.toFixed(2)} ${summary.meanRetrievalMrr ? `| MRR: ${summary.meanRetrievalMrr.toFixed(2)}` : ""}`);
  }
}

main().catch(console.error);
