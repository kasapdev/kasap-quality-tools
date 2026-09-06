# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
