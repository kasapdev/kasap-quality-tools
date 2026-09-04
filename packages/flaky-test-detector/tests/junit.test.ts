import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseJUnitDirectory, parseJUnitXml } from "../src/junit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "junit");

describe("parseJUnitXml", () => {
  it("parses a <testsuite> root with multiple <testcase> children (array shape)", () => {
    const xml = `
      <testsuite name="Suite" tests="2" failures="1">
        <testcase classname="pkg.A" name="one" time="0.1"/>
        <testcase classname="pkg.A" name="two" time="0.1">
          <failure message="oops">trace</failure>
        </testcase>
      </testsuite>
    `;
    const tests = parseJUnitXml(xml);
    expect(tests).toEqual([
      { classname: "pkg.A", name: "one", status: "passed" },
      { classname: "pkg.A", name: "two", status: "failed" },
    ]);
  });

  it("parses a <testsuite> root with exactly one <testcase> child (single-object shape)", () => {
    const xml = `
      <testsuite name="Suite" tests="1" failures="0">
        <testcase classname="pkg.A" name="solo" time="0.1"/>
      </testsuite>
    `;
    const tests = parseJUnitXml(xml);
    expect(tests).toEqual([{ classname: "pkg.A", name: "solo", status: "passed" }]);
  });

  it("parses a <testsuites> root wrapping a single <testsuite> child (single-object shape)", () => {
    const xml = `
      <testsuites>
        <testsuite name="Suite" tests="1" failures="0">
          <testcase classname="pkg.A" name="solo" time="0.1"/>
        </testsuite>
      </testsuites>
    `;
    const tests = parseJUnitXml(xml);
    expect(tests).toEqual([{ classname: "pkg.A", name: "solo", status: "passed" }]);
  });

  it("parses a <testsuites> root wrapping multiple <testsuite> children (array shape)", () => {
    const xml = `
      <testsuites>
        <testsuite name="SuiteA" tests="1" failures="0">
          <testcase classname="pkg.A" name="one" time="0.1"/>
        </testsuite>
        <testsuite name="SuiteB" tests="1" failures="1">
          <testcase classname="pkg.B" name="two" time="0.1">
            <error message="boom">trace</error>
          </testcase>
        </testsuite>
      </testsuites>
    `;
    const tests = parseJUnitXml(xml);
    expect(tests).toEqual([
      { classname: "pkg.A", name: "one", status: "passed" },
      { classname: "pkg.B", name: "two", status: "failed" },
    ]);
  });

  it("treats a testcase with a <skipped> child as skipped, not pass or fail", () => {
    const xml = `
      <testsuite name="Suite" tests="1" failures="0">
        <testcase classname="pkg.A" name="skippedOne" time="0.0">
          <skipped/>
        </testcase>
      </testsuite>
    `;
    const tests = parseJUnitXml(xml);
    expect(tests).toEqual([{ classname: "pkg.A", name: "skippedOne", status: "skipped" }]);
  });

  it("treats a testcase with an <error> child as failed", () => {
    const xml = `
      <testsuite name="Suite" tests="1" failures="0">
        <testcase classname="pkg.A" name="errored" time="0.0">
          <error message="boom">trace</error>
        </testcase>
      </testsuite>
    `;
    const tests = parseJUnitXml(xml);
    expect(tests).toEqual([{ classname: "pkg.A", name: "errored", status: "failed" }]);
  });

  it("defaults classname to empty string when the attribute is absent", () => {
    const xml = `
      <testsuite name="Suite" tests="1" failures="0">
        <testcase name="noClassname" time="0.0"/>
      </testsuite>
    `;
    const tests = parseJUnitXml(xml);
    expect(tests).toEqual([{ classname: "", name: "noClassname", status: "passed" }]);
  });
});

describe("parseJUnitDirectory", () => {
  it("parses every .xml file in the directory into a normalized RunResult, using the filename as runId", async () => {
    const runs = await parseJUnitDirectory(fixturesDir);
    const runIds = runs.map((r) => r.runId).sort();
    expect(runIds).toEqual(["run-1", "run-2", "run-3"]);

    const run1 = runs.find((r) => r.runId === "run-1");
    expect(run1).toBeDefined();
    expect(run1?.tests).toEqual(
      expect.arrayContaining([
        { classname: "com.example.FooTest", name: "flaky", status: "passed" },
        { classname: "com.example.FooTest", name: "broken", status: "failed" },
        { classname: "com.example.BarTest", name: "stable", status: "passed" },
        { classname: "com.example.BarTest", name: "sometimesSkipped", status: "passed" },
      ]),
    );

    const run2 = runs.find((r) => r.runId === "run-2");
    expect(run2?.tests).toEqual(
      expect.arrayContaining([
        { classname: "com.example.FooTest", name: "flaky", status: "failed" },
        { classname: "com.example.FooTest", name: "broken", status: "failed" },
        { classname: "com.example.BarTest", name: "stable", status: "passed" },
        { classname: "com.example.BarTest", name: "sometimesSkipped", status: "skipped" },
      ]),
    );

    const run3 = runs.find((r) => r.runId === "run-3");
    expect(run3?.tests).toEqual(
      expect.arrayContaining([
        { classname: "com.example.FooTest", name: "flaky", status: "passed" },
        { classname: "com.example.FooTest", name: "broken", status: "failed" },
        { classname: "com.example.BarTest", name: "stable", status: "passed" },
        { classname: "com.example.BarTest", name: "sometimesSkipped", status: "failed" },
      ]),
    );
  });
});
