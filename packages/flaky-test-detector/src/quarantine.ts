/**
 * Quarantine-list generation.
 *
 * Turns `FlakyTestReport[]` (the output of `detectFlakiness`) into a
 * filtered, sorted list of tests disruptive enough to be worth
 * quarantining (skipping in CI until fixed), formatted for consumption by
 * common test runners and CI skip-lists.
 *
 * This module is pure: it operates only on `FlakyTestReport[]` and plain
 * strings, with no file-system or CLI concerns, so it can be unit tested
 * in isolation and reused as a library.
 */
import type { FlakyTestReport } from "./flakiness.js";

/** Threshold options controlling which flaky tests are selected for quarantine. */
export interface QuarantineOptions {
  /**
   * Minimum flip-rate percentage (inclusive) a test must have to be
   * quarantined. Defaults to 0, meaning any flaky test qualifies.
   */
  minFlipRatePercent?: number;
  /**
   * Minimum fail count (inclusive) a test must have to be quarantined.
   * Defaults to 1. Every report from `detectFlakiness` already has
   * failCount >= 1 by construction, so the default admits every flaky
   * test; raise it to only quarantine tests that have failed repeatedly.
   */
  minFailCount?: number;
}

/** One test selected for quarantine. */
export interface QuarantinedTest {
  classname: string;
  name: string;
  /** Composite identity for display/output: `"classname.name"`, or just `name` when `classname` is `""`. */
  testId: string;
  flipRatePercent: number;
  runsObserved: number;
  failCount: number;
}

const DEFAULT_MIN_FLIP_RATE_PERCENT = 0;
const DEFAULT_MIN_FAIL_COUNT = 1;

function formatTestId(classname: string, name: string): string {
  return classname.length > 0 ? `${classname}.${name}` : name;
}

/**
 * Selects the subset of `reports` whose flakiness meets or exceeds the
 * configured threshold(s), sorted by descending flip-rate (ties broken by
 * classname then name for determinism) so the most disruptive tests
 * appear first.
 *
 * Throws on an invalid threshold (out-of-range `minFlipRatePercent`, or a
 * non-positive/non-integer `minFailCount`) rather than silently producing
 * a nonsensical (e.g. always-empty or always-full) list.
 */
export function selectQuarantineCandidates(
  reports: FlakyTestReport[],
  options: QuarantineOptions = {},
): QuarantinedTest[] {
  const minFlipRatePercent = options.minFlipRatePercent ?? DEFAULT_MIN_FLIP_RATE_PERCENT;
  const minFailCount = options.minFailCount ?? DEFAULT_MIN_FAIL_COUNT;

  if (!Number.isFinite(minFlipRatePercent) || minFlipRatePercent < 0 || minFlipRatePercent > 100) {
    throw new Error(`minFlipRatePercent must be a number between 0 and 100, got ${minFlipRatePercent}`);
  }
  if (!Number.isInteger(minFailCount) || minFailCount < 1) {
    throw new Error(`minFailCount must be a positive integer, got ${minFailCount}`);
  }

  const candidates: QuarantinedTest[] = [];
  for (const report of reports) {
    if (report.flipRatePercent < minFlipRatePercent) continue;
    if (report.failCount < minFailCount) continue;
    candidates.push({
      classname: report.classname,
      name: report.name,
      testId: formatTestId(report.classname, report.name),
      flipRatePercent: report.flipRatePercent,
      runsObserved: report.runsObserved,
      failCount: report.failCount,
    });
  }

  candidates.sort((a, b) => {
    if (a.flipRatePercent !== b.flipRatePercent) return b.flipRatePercent - a.flipRatePercent;
    if (a.classname !== b.classname) return a.classname < b.classname ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return candidates;
}

/** Serializes quarantine candidates as a pretty-printed JSON array (machine-readable). */
export function formatQuarantineJson(tests: QuarantinedTest[]): string {
  return JSON.stringify(tests, null, 2);
}

/**
 * One `testId` per line — a plain-text quarantine list, suitable for
 * feeding into a CI skip-list file or reading with a simple line-based
 * tool. Returns the empty string when `tests` is empty.
 */
export function formatQuarantineTextList(tests: QuarantinedTest[]): string {
  return tests.map((t) => t.testId).join("\n");
}

/** Escapes a string for safe embedding into a regular expression's literal text. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a regex alternation of the (escaped, de-duplicated) test names,
 * suitable for the `--grep`/`-t`/`--testNamePattern`-style filters most
 * JS test runners (vitest, jest, mocha) accept to select or exclude
 * specific tests by name.
 *
 * Matches on `name` only (not `classname`): these runner flags filter
 * against the test title text, which does not include the suite/class
 * path.
 *
 * Returns the empty string when `tests` is empty. Callers must not feed
 * an empty string to a runner's `--grep`/`-t` flag as an *exclusion*
 * pattern — an empty pattern typically matches every test name, which is
 * the opposite of "nothing to quarantine". Check for the empty-string
 * case first and skip passing the flag at all.
 */
export function formatQuarantineGrepPattern(tests: QuarantinedTest[]): string {
  if (tests.length === 0) return "";
  const uniqueNames = [...new Set(tests.map((t) => escapeRegExp(t.name)))];
  return `(${uniqueNames.join("|")})`;
}
