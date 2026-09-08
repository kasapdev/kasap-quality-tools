# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 2026-09-08: `@kasap/flaky-test-detector` (`0.1.0` → `0.2.0`) — added quarantine-list
  generation: `selectQuarantineCandidates` filters a `detectFlakiness` report down
  to tests exceeding a configurable flip-rate/fail-count threshold, and
  `formatQuarantineJson`/`formatQuarantineTextList`/`formatQuarantineGrepPattern`
  render the result as JSON, a plain-text list of `classname.name` identities, or
  a regex alternation of test names suitable for a test runner's
  `--grep`/`-t`/`--testNamePattern` filter. Wired into the CLI as `--quarantine`
  (with `--quarantine-format`, `--min-flip-rate`, `--min-fail-count`). Also added
  a `parseJUnitXml` test pinning the (previously untested but already correct)
  precedence of `<skipped>` over a co-occurring `<failure>`/`<error>` child —
  not a bug fix, a regression guard documenting the intended behavior.
- 2026-09-06: `@kasap/flaky-test-detector` — added a `detectFlakiness`/`countDistinctTests`
  test case verifying that two distinct tests whose `classname`/`name` would
  collide under a naive string join (e.g. `classname: "pkg.A", name: "b c"` vs.
  `classname: "pkg.A b", name: "c"`) are still tracked as separate test
  identities. This was previously untested; the existing internal `\0`-joined
  key already handled it correctly, so this is a regression guard against the
  key-separator logic ever being changed to something ambiguous (e.g. a plain
  space), not a bug fix.
- 2026-09-06: `@kasap/load-test-lite` — added test cases for `runWithConcurrencyLimit`
  covering previously-untested invalid-input edge cases: a negative
  `totalTasks` (returns an empty array, same as `0`) and a zero or negative
  `concurrency` (rejects with "concurrency must be a positive integer"). Both
  confirm existing, correct behavior.
