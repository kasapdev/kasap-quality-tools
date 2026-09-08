# @kasap/flaky-test-detector

A CLI (and library) that parses CI test-result history and finds genuinely
flaky tests — tests whose outcome is inconsistent across runs, as opposed to
tests that are simply broken (always fail) or healthy (always pass).

## What it does

Given a set of test-result files from multiple CI runs (JUnit XML or a
simple JSON format), it groups results by test identity
(`classname` + `name`), and reports every test that has **both** at least
one passing result **and** at least one failing result across the observed
runs. A test that only ever fails is reported as "consistently failing",
not flaky, and is excluded from the report. A test that only ever passes is
stable and also excluded.

For every flaky test it reports:

- `classname`, `name`
- **flip-rate**: the percentage of adjacent observed-run transitions that
  changed status (pass→fail or fail→pass)
- number of runs the test was observed in (passed or failed; skipped
  results don't count as "observed")
- pass count / fail count
- the run IDs at which the status flipped

## Install / build

This package lives inside the `kasap-quality-tools` pnpm workspace. From the
workspace root:

```sh
pnpm install
pnpm --filter @kasap/flaky-test-detector build
```

This compiles `src/` to `dist/` via `tsc`. Run the test suite with:

```sh
pnpm --filter @kasap/flaky-test-detector test
```

## Usage

Exactly one of `--junit-dir` or `--json-file` must be given.

### JUnit XML directory

```sh
flaky-test-detector --junit-dir ./ci-results/junit
```

`--junit-dir` points at a directory containing one JUnit XML file per CI
run (e.g. `run-1.xml`, `run-2.xml`, ...). The run ID used in the report is
the filename without its `.xml` extension.

Expected JUnit XML shape (both a bare `<testsuite>` root and a
`<testsuites>` root wrapping one or more `<testsuite>` elements are
supported):

```xml
<testsuite name="..." tests="3" failures="1">
  <testcase classname="com.example.FooTest" name="testBar" time="0.12">
    <failure message="...">stack trace text</failure>
  </testcase>
  <testcase classname="com.example.FooTest" name="testBaz" time="0.01"/>
</testsuite>
```

A `<testcase>` is treated as:

- **failed** if it has a child `<failure>` or `<error>` element,
- **skipped** if it has a child `<skipped>` element (excluded from
  pass/fail counting and from flip-rate computation entirely),
- **passed** otherwise.

Example human-readable output:

```
Test: flaky
  Classname: com.example.FooTest
  Flip rate: 100.00%
  Runs observed: 3
  Passed: 2
  Failed: 1
  Flipped at runs: run-2, run-3

1 flaky tests found out of 4 total tests across 3 runs.
```

### Simple JSON file

```sh
flaky-test-detector --json-file ./ci-results/results.json
```

`--json-file` points at a single JSON file containing an array of run
entries:

```json
[
  {
    "runId": "run-1",
    "tests": [
      { "name": "testBar", "classname": "com.example.FooTest", "status": "passed" },
      { "name": "testBaz", "classname": "com.example.FooTest", "status": "failed" }
    ]
  },
  { "runId": "run-2", "tests": [ ] }
]
```

`status` is one of `"passed" | "failed" | "skipped"`. `classname` is
optional and defaults to `""`.

### Machine-readable output

Add `--json` to either mode to get a machine-readable report on stdout
instead of the human-readable text report:

```sh
flaky-test-detector --json-file ./ci-results/results.json --json
```

```json
{
  "flakyTests": [
    {
      "classname": "com.example.FooTest",
      "name": "flaky",
      "flipRatePercent": 100,
      "runsObserved": 3,
      "passCount": 2,
      "failCount": 1,
      "flippedAtRunIds": ["run-2", "run-3"]
    }
  ],
  "summary": { "flakyCount": 1, "totalTests": 4, "totalRuns": 3 }
}
```

### Exit codes

The CLI exits `0` for a successful analysis, even when flaky tests are
found — flaky tests are a normal report, not an error. It exits non-zero
(with a clear message on stderr) for usage errors (missing/conflicting
flags) or I/O errors (missing directory/file, malformed input).

## Flip-rate definition

Runs are ordered by run ID (a natural sort: numeric substrings are compared
numerically, so `run-2` sorts before `run-10`). For a given test, only the
runs in which it produced a `passed` or `failed` result are considered
("observed" runs) — `skipped` results are dropped from the sequence
entirely before flip transitions are computed. The flip-rate is:

```
flip-rate = (number of adjacent observed-run transitions where the status changed) / (observed runs - 1) * 100
```

A test observed in fewer than 2 runs (after removing skips) can never be
flaky, since flakiness requires at least one pass and one fail.

## Quarantine list generation

Once you know which tests are flaky, the next question is "which of these
are bad enough to skip in CI until someone fixes them?" `--quarantine`
answers that: it filters the flaky-test report down to tests that exceed a
flakiness threshold and prints the result in a format you can feed
straight into a test runner's skip-list or `--grep`/`-t` filter.

```sh
flaky-test-detector --json-file ./ci-results/results.json --quarantine
```

By default every flaky test qualifies (min flip-rate 0%, min fail count
1). Narrow the list with `--min-flip-rate <percent>` and/or
`--min-fail-count <n>` to only quarantine the most disruptive tests:

```sh
flaky-test-detector --junit-dir ./ci-results/junit --quarantine --min-flip-rate 50 --min-fail-count 3
```

`--quarantine-format` selects the output shape (default `text`):

- `text` — one `classname.name` identity per line (or bare `name` when
  `classname` is `""`), sorted by descending flip-rate:

  ```
  com.example.FooTest.flaky
  com.example.BarTest.sometimesSkipped
  ```

- `json` — the full candidate objects (`classname`, `name`, `testId`,
  `flipRatePercent`, `runsObserved`, `failCount`), useful for feeding into
  another tool or dashboard:

  ```json
  [
    {
      "classname": "com.example.FooTest",
      "name": "flaky",
      "testId": "com.example.FooTest.flaky",
      "flipRatePercent": 100,
      "runsObserved": 3,
      "failCount": 1
    }
  ]
  ```

- `grep` — a single regex alternation of the (escaped, de-duplicated) test
  *names*, ready to pass to the `--grep`/`-t`/`--testNamePattern`-style
  flag most JS test runners accept for excluding tests by title:

  ```
  (flaky|sometimesSkipped)
  ```

  ```sh
  # example: rerun only the quarantined tests, e.g. to confirm they're
  # still flaky before deciding whether to unquarantine them
  vitest run --testNamePattern "$(flaky-test-detector --json-file results.json --quarantine --quarantine-format grep)"
  ```

  When nothing qualifies for quarantine, this format prints the empty
  string — an empty pattern is not a safe stand-in for "match nothing" in
  most regex engines, so treat an empty result as "skip nothing" and don't
  pass it to the runner's filter flag at all.

## Library usage

The parsing and detection functions are also exported for programmatic use:

```ts
import { parseJUnitDirectory, detectFlakiness } from "@kasap/flaky-test-detector";

const runs = await parseJUnitDirectory("./ci-results/junit");
const report = detectFlakiness(runs);
```

The quarantine-list functions are exported too, for building custom CI
integrations without shelling out to the CLI:

```ts
import {
  detectFlakiness,
  selectQuarantineCandidates,
  formatQuarantineTextList,
} from "@kasap/flaky-test-detector";

const reports = detectFlakiness(runs);
const candidates = selectQuarantineCandidates(reports, { minFlipRatePercent: 50 });
console.log(formatQuarantineTextList(candidates));
```
