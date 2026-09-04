import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFlakiness } from "../src/flakiness.js";
import { parseJUnitDirectory } from "../src/junit.js";
import { parseJsonFile } from "../src/jsonFormat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const junitFixturesDir = path.join(__dirname, "fixtures", "junit");
const jsonFixturePath = path.join(__dirname, "fixtures", "json", "sample.json");

// Both fixtures encode the same scenario across 3 runs:
//   - com.example.FooTest.flaky: passed, failed, passed -> flaky
//   - com.example.FooTest.broken: failed, failed, failed -> consistently failing, not flaky
//   - com.example.BarTest.stable: passed, passed, passed -> stable, not flaky
//   - com.example.BarTest.sometimesSkipped: passed, skipped, failed -> flaky (skip excluded)

describe("end-to-end: JUnit XML directory -> flakiness detection", () => {
  it("parses the fixture directory and reports exactly the two flaky tests", async () => {
    const runs = await parseJUnitDirectory(junitFixturesDir);
    const reports = detectFlakiness(runs);

    expect(reports).toHaveLength(2);

    const flaky = reports.find((r) => r.name === "flaky");
    expect(flaky).toBeDefined();
    expect(flaky?.classname).toBe("com.example.FooTest");
    expect(flaky?.passCount).toBe(2);
    expect(flaky?.failCount).toBe(1);
    expect(flaky?.runsObserved).toBe(3);
    expect(flaky?.flipRatePercent).toBe(100);
    expect(flaky?.flippedAtRunIds).toEqual(["run-2", "run-3"]);

    const sometimesSkipped = reports.find((r) => r.name === "sometimesSkipped");
    expect(sometimesSkipped).toBeDefined();
    expect(sometimesSkipped?.classname).toBe("com.example.BarTest");
    expect(sometimesSkipped?.passCount).toBe(1);
    expect(sometimesSkipped?.failCount).toBe(1);
    expect(sometimesSkipped?.runsObserved).toBe(2);
    expect(sometimesSkipped?.flippedAtRunIds).toEqual(["run-3"]);

    // broken (always fails) and stable (always passes) must not appear
    expect(reports.some((r) => r.name === "broken")).toBe(false);
    expect(reports.some((r) => r.name === "stable")).toBe(false);
  });
});

describe("end-to-end: simple JSON file -> flakiness detection", () => {
  it("parses the fixture JSON file and reports exactly the two flaky tests", async () => {
    const runs = await parseJsonFile(jsonFixturePath);
    const reports = detectFlakiness(runs);

    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.name).sort()).toEqual(["flaky", "sometimesSkipped"]);

    const flaky = reports.find((r) => r.name === "flaky");
    expect(flaky?.flipRatePercent).toBe(100);
    expect(flaky?.flippedAtRunIds).toEqual(["run-2", "run-3"]);
  });
});
