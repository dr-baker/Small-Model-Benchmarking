# Local setup

Short guide for getting a machine ready to run the benchmark.

## 1. Install and auth

- Run `npm install`
- Copy `.env.example` to `.env`
- Add the API keys you want to use for candidate and judge models

## 2. Shared config lives in `benchmark.yaml`

Keep repo-wide defaults here:

- candidate model list
- judge model and transport
- corpus paths
- modes, batching, and question selection

## 3. Local-only overrides live in `benchmark.local.yaml`

Use this gitignored file for machine-specific Swift Docs paths.

```yaml
swiftDocs:
  repoRoot: /absolute/path/to/swift-docs
  dbPath: /absolute/path/to/swift-docs-search.db
  # optional
  configPath: /absolute/path/to/swift-docs-config.yaml
```

This is only needed when running with `--tool-set=swift_docs_hybrid`.
If you need a completely different config file, set `BENCHMARK_CONFIG=/path/to/config.yaml` before running.

## 4. Smoke test

```bash
npm run test:run -- --run-id=smoke --batch-size=3 --batch-number=1
```

Results land in `benchmark-results/`.
