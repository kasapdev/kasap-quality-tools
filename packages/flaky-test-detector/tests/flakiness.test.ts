import { describe, expect, it } from "vitest";
import { compareRunIds, countDistinctTests, detectFlakiness } from "../src/flakiness.js";
import type { RunResult } from "../src/flakiness.js";

describe("detectFlakiness", () => {
  it("does not report a test that only ever passes", () => {
    const runs: RunResult[] = [
      { runId: "run-1", tests: [{ classname: "pkg.Foo", name: "alwaysPasses", status: "passed" }] },
      { runId: "run-2", tests: [{ classname: "pkg.Foo", name: "alwaysPasses", status: "passed" }] },
      { runId: "run-3", tests: [{ classname: "pkg.Foo", name: "alwaysPasses", status: "passed" }] },
    ];

    const reports = detectFlakiness(runs);
    expect(reports).toEqual([]);
  });

  it("does not report a test that only ever fails (consistently failing, not flaky)", () => {
    const runs: RunResult[] = [
      { runId: "run-1", tests: [{ classname: "pkg.Foo", name: "alwaysFails", status: "failed" }] },
      { runId: "run-2", tests: [{ classname: "pkg.Foo", name: "alwaysFails", status: "failed" }] },
      { runId: "run-3", tests: [{ classname: "pkg.Foo", name: "alwaysFails", status: "failed" }] },
    ];

    const reports = detectFlakiness(runs);
    expect(reports).toEqual([]);
  });

  it("reports a test that flips pass/fail/pass with correct flip-rate and flip run ids", () => {
    const runs: RunResult[] = [
      { runId: "run-1", tests: [{ classname: "pkg.Foo", name: "flaky", status: "passed" }] },
      { runId: "run-2", tests: [{ classname: "pkg.Foo", name: "flaky", status: "failed" }] },
      { runId: "run-3", tests: [{ classname: "pkg.Foo", name: "flaky", status: "passed" }] },
    ];

    const reports = detectFlakiness(runs);
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report).toBeDefined();
    expect(report?.classname).toBe("pkg.Foo");
    expect(report?.name).toBe("flaky");
    expect(report?.passCount).toBe(2);
    expect(report?.failCount).toBe(1);
    expect(report?.runsObserved).toBe(3);
    // 2 transitions (pass->fail at run-2, fail->pass at run-3) / (3 - 1) runs = 100%
    expect(report?.flipRatePercent).toBe(100);
    expect(report?.flippedAtRunIds).toEqual(["run-2", "run-3"]);
  });

  it("does not report a test appearing in only a single run", () => {
    const runs: RunResult[] = [
      { runId: "run-1", tests: [{ classname: "pkg.Foo", name: "onceOnly", status: "passed" }] },
    ];

    const reports = detectFlakiness(runs);
    expect(reports).toEqual([]);
  });

  it("excludes skipped results from pass/fail counting and flip computation", () => {
    const runs: RunResult[] = [
      { runId: "run-1", tests: [{ classname: "pkg.Foo", name: "sometimesSkipped", status: "passed" }] },
      { runId: "run-2", tests: [{ classname: "pkg.Foo", name: "sometimesSkipped", status: "skipped" }] },
      { runId: "run-3", tests: [{ classname: "pkg.Foo", name: "sometimesSkipped", status: "failed" }] },
    ];

    const reports = detectFlakiness(runs);
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report).toBeDefined();
    // Only run-1 (passed) and run-3 (failed) count as observed; the skip in
    // run-2 is excluded entirely, so there is exactly one transition
    // between the two observed runs.
    expect(report?.runsObserved).toBe(2);
    expect(report?.passCount).toBe(1);
    expect(report?.failCount).toBe(1);
    expect(report?.flippedAtRunIds).toEqual(["run-3"]);
    expect(report?.flipRatePercent).toBe(100);
  });

  it("a test that is only ever skipped is neither flaky nor reported", () => {
    const runs: RunResult[] = [
      { runId: "run-1", tests: [{ classname: "pkg.Foo", name: "neverRun", status: "skipped" }] },
      { runId: "run-2", tests: [{ classname: "pkg.Foo", name: "neverRun", status: "skipped" }] },
    ];

    const reports = detectFlakiness(runs);
    expect(reports).toEqual([]);
  });

  it("does not conflate distinct tests whose classname/name would collide under a naive join", () => {
    // "pkg.A" + "b c" and "pkg.A b" + "c" would join to the same string
    // "pkg.A b c" if classname/name were concatenated with a plain space.
    // They must still be tracked as two distinct test identities.
    const runs: RunResult[] = [
      {
        runId: "run-1",
        tests: [
          { classname: "pkg.A", name: "b c", status: "passed" },
          { classname: "pkg.A b", name: "c", status: "passed" },
        ],
      },
      {
        runId: "run-2",
        tests: [
          { classname: "pkg.A", name: "b c", status: "passed" },
          { classname: "pkg.A b", name: "c", status: "failed" },
        ],
      },
    ];

    expect(countDistinctTests(runs)).toBe(2);

    const reports = detectFlakiness(runs);
    // Only "pkg.A b" / "c" actually flipped; "pkg.A" / "b c" never failed.
    expect(reports).toHaveLength(1);
    expect(reports[0]?.classname).toBe("pkg.A b");
    expect(reports[0]?.name).toBe("c");
  });

  it("handles multiple distinct tests independently", () => {
    const runs: RunResult[] = [
      {
        runId: "run-1",
        tests: [
          { classname: "pkg.A", name: "stable", status: "passed" },
          { classname: "pkg.B", name: "broken", status: "failed" },
          { classname: "pkg.C", name: "flappy", status: "passed" },
        ],
      },
      {
        runId: "run-2",
        tests: [
          { classname: "pkg.A", name: "stable", status: "passed" },
          { classname: "pkg.B", name: "broken", status: "failed" },
          { classname: "pkg.C", name: "flappy", status: "failed" },
        ],
      },
    ];

    const reports = detectFlakiness(runs);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.name).toBe("flappy");
  });

  it("orders runs using natural sort of run ids before computing flips", () => {
    const runs: RunResult[] = [
      { runId: "run-10", tests: [{ classname: "", name: "t", status: "passed" }] },
      { runId: "run-2", tests: [{ classname: "", name: "t", status: "failed" }] },
      { runId: "run-1", tests: [{ classname: "", name: "t", status: "passed" }] },
    ];

    const reports = detectFlakiness(runs);
    expect(reports).toHaveLength(1);
    // Natural-sorted order: run-1 (passed), run-2 (failed), run-10 (passed)
    expect(reports[0]?.flippedAtRunIds).toEqual(["run-2", "run-10"]);
  });
});

describe("compareRunIds", () => {
  it("sorts numeric suffixes naturally", () => {
    const ids = ["run-10", "run-2", "run-1"];
    ids.sort(compareRunIds);
    expect(ids).toEqual(["run-1", "run-2", "run-10"]);
  });

  it("falls back to lexicographic comparison for non-numeric ids", () => {
    const ids = ["b", "a", "c"];
    ids.sort(compareRunIds);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("countDistinctTests", () => {
  it("counts distinct (classname, name) identities across all runs", () => {
    const runs: RunResult[] = [
      {
        runId: "run-1",
        tests: [
          { classname: "pkg.A", name: "t1", status: "passed" },
          { classname: "pkg.A", name: "t2", status: "failed" },
        ],
      },
      {
        runId: "run-2",
        tests: [
          { classname: "pkg.A", name: "t1", status: "passed" },
          { classname: "pkg.B", name: "t3", status: "skipped" },
        ],
      },
    ];

    expect(countDistinctTests(runs)).toBe(3);
  });
});
