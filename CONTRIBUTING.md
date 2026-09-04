# Contributing

This is a personal portfolio monorepo, but contributions/issues are welcome.

## Setup

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Adding a package

1. Create `packages/<name>/` with `src/`, `tests/`, `package.json`, `tsconfig.json` (extending
   `../../tsconfig.base.json`), and a `README.md`.
2. Keep dependencies minimal. Do not make real network calls in tests.
3. Run `pnpm -r build && pnpm -r typecheck && pnpm -r test` before opening a PR.
