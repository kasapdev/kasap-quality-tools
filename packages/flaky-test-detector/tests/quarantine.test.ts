import { describe, expect, it } from "vitest";
import {
  formatQuarantineGrepPattern,
  formatQuarantineJson,
  formatQuarantineTextList,
  selectQuarantineCandidates,
} from "../src/quarantine.js";
import type { FlakyTestReport } from "../src/flakiness.js";

function report(overrides: Partial<FlakyTestReport>): FlakyTestReport {
  return {
    classname: "pkg.Foo",
    name: "test",
    flipRatePercent: 50,
    runsObserved: 4,
    passCount: 2,
    failCount: 2,
    flippedAtRunIds: ["run-2"],
    ...overrides,
  };
}

describe("selectQuarantineCandidates", () => {
  it("selects every report by default (threshold 0 flip-rate, 1 fail)", () => {
    const reports = [report({ name: "a", flipRatePercent: 10, failCount: 1 })];
    const candidates = selectQuarantineCandidates(reports);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.testId).toBe("pkg.Foo.a");
  });

  it("excludes tests below the minFlipRatePercent threshold", () => {
    const reports = [
      report({ name: "low", flipRatePercent: 20 }),
      report({ name: "high", flipRatePercent: 80 }),
    ];
    const candidates = selectQuarantineCandidates(reports, { minFlipRatePercent: 50 });
    expect(candidates.map((c) => c.name)).toEqual(["high"]);
  });

  it("includes a test exactly at the minFlipRatePercent threshold (inclusive)", () => {
    const reports = [report({ name: "exact", flipRatePercent: 50 })];
    const candidates = selectQuarantineCandidates(reports, { minFlipRatePercent: 50 });
    expect(candidates).toHaveLength(1);
  });

  it("excludes tests below the minFailCount threshold", () => {
    const reports = [
      report({ name: "rare", failCount: 1 }),
      report({ name: "frequent", failCount: 5 }),
    ];
    const candidates = selectQuarantineCandidates(reports, { minFailCount: 3 });
    expect(candidates.map((c) => c.name)).toEqual(["frequent"]);
  });

  it("sorts by descending flip-rate, then classname, then name", () => {
    const reports = [
      report({ classname: "pkg.B", name: "b", flipRatePercent: 40 }),
      report({ classname: "pkg.A", name: "z", flipRatePercent: 90 }),
      report({ classname: "pkg.A", name: "a", flipRatePercent: 90 }),
    ];
    const candidates = selectQuarantineCandidates(reports);
    expect(candidates.map((c) => c.testId)).toEqual(["pkg.A.a", "pkg.A.z", "pkg.B.b"]);
  });

  it('formats testId as bare "name" when classname is empty', () => {
    const reports = [report({ classname: "", name: "bare" })];
    const candidates = selectQuarantineCandidates(reports);
    expect(candidates[0]?.testId).toBe("bare");
  });

  it("returns an empty array when no report meets the threshold", () => {
    const reports = [report({ flipRatePercent: 10 })];
    const candidates = selectQuarantineCandidates(reports, { minFlipRatePercent: 90 });
    expect(candidates).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectQuarantineCandidates([])).toEqual([]);
  });

  it("throws on a minFlipRatePercent outside 0-100", () => {
    expect(() => selectQuarantineCandidates([], { minFlipRatePercent: -1 })).toThrow(
      /minFlipRatePercent/,
    );
    expect(() => selectQuarantineCandidates([], { minFlipRatePercent: 101 })).toThrow(
      /minFlipRatePercent/,
    );
  });

  it("throws on a non-positive or non-integer minFailCount", () => {
    expect(() => selectQuarantineCandidates([], { minFailCount: 0 })).toThrow(/minFailCount/);
    expect(() => selectQuarantineCandidates([], { minFailCount: 1.5 })).toThrow(/minFailCount/);
  });
});

describe("formatQuarantineJson", () => {
  it("serializes candidates as a pretty-printed JSON array", () => {
    const candidates = selectQuarantineCandidates([report({ name: "a" })]);
    const json = formatQuarantineJson(candidates);
    expect(JSON.parse(json)).toEqual(candidates);
    expect(json).toContain("\n");
  });

  it("serializes an empty list as an empty JSON array", () => {
    expect(formatQuarantineJson([])).toBe("[]");
  });
});

describe("formatQuarantineTextList", () => {
  it("prints one testId per line", () => {
    const candidates = selectQuarantineCandidates([
      report({ classname: "pkg.A", name: "a", flipRatePercent: 90 }),
      report({ classname: "pkg.B", name: "b", flipRatePercent: 10 }),
    ]);
    expect(formatQuarantineTextList(candidates)).toBe("pkg.A.a\npkg.B.b");
  });

  it("returns the empty string for an empty list", () => {
    expect(formatQuarantineTextList([])).toBe("");
  });
});

describe("formatQuarantineGrepPattern", () => {
  it("builds a regex alternation of the test names", () => {
    const candidates = selectQuarantineCandidates([
      report({ classname: "pkg.A", name: "alpha", flipRatePercent: 90 }),
      report({ classname: "pkg.B", name: "beta", flipRatePercent: 10 }),
    ]);
    const pattern = formatQuarantineGrepPattern(candidates);
    expect(pattern).toBe("(alpha|beta)");
    expect(new RegExp(pattern).test("test alpha case")).toBe(true);
    expect(new RegExp(pattern).test("unrelated")).toBe(false);
  });

  it("escapes regex-special characters in test names", () => {
    const candidates = selectQuarantineCandidates([
      report({ name: "handles (parens) and [brackets] + a.dot" }),
    ]);
    const pattern = formatQuarantineGrepPattern(candidates);
    // The pattern must match the literal name...
    expect(new RegExp(pattern).test("handles (parens) and [brackets] + a.dot")).toBe(true);
    // ...but not an unrelated string that would match if the special
    // characters had been left unescaped as regex metacharacters (e.g.
    // "." matching any character, "+" being a quantifier).
    expect(new RegExp(pattern).test("handles Xparens) and [brackets] + a.dot")).toBe(false);
  });

  it("de-duplicates identical test names across different classnames", () => {
    const candidates = selectQuarantineCandidates([
      report({ classname: "pkg.A", name: "shared", flipRatePercent: 90 }),
      report({ classname: "pkg.B", name: "shared", flipRatePercent: 80 }),
    ]);
    expect(formatQuarantineGrepPattern(candidates)).toBe("(shared)");
  });

  it("returns the empty string for an empty list rather than a pattern that matches everything", () => {
    expect(formatQuarantineGrepPattern([])).toBe("");
  });
});
