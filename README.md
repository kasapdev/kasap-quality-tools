# kasap-quality-tools

A small portfolio of standalone, genuinely working test/quality tooling CLIs. Each package is
independent, has real logic (not stubs), and ships with unit tests covering that logic.

pnpm workspace monorepo, TypeScript + ESM throughout, Node >= 22.5.0.

## Packages

| Package | Description |
| --- | --- |
| [`flaky-test-detector`](packages/flaky-test-detector) | Parses JUnit XML (or a simple JSON format) test-result history across CI runs and flags tests that both passed and failed — real flakiness, not just failures. |
| [`api-contract-diff`](packages/api-contract-diff) | Structurally diffs two OpenAPI 3.x specs (YAML/JSON) and reports real breaking changes (removed paths, newly-required fields, type changes, tightened constraints, ...) separately from safe additions. |
| [`seed-data-generator`](packages/seed-data-generator) | Parses a Prisma schema (or a Drizzle JSON export) and generates realistic fake seed data as JSON/SQL, respecting types, uniqueness, and foreign-key ordering. Includes a built-in Turkish name/address generator. |
| [`load-test-lite`](packages/load-test-lite) | A minimal, near-zero-dependency HTTP load-testing CLI with a real concurrency limiter and real latency percentile (p50/p90/p99) reporting. Educational use on your own endpoints only. |

## Getting started

```bash
pnpm install
pnpm -r build
pnpm -r test
```

Each package can also be run directly with `pnpm --filter <package-name> dev -- <args>` during
development, or via its `bin` entry point once built.

## Conventions

- TypeScript, ESM (`NodeNext` module resolution), strict mode.
- Each package: `src/` (implementation), `tests/` (vitest, no real network calls), its own
  `package.json` and `tsconfig.json` extending the root `tsconfig.base.json`.
- No package makes real network calls in its test suite.

## License

MIT © Kayra Kasapoğlu
