import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonFile, parseJsonString } from "../src/jsonFormat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "json", "sample.json");

describe("parseJsonString", () => {
  it("parses a well-formed run-result array", () => {
    const content = JSON.stringify([
      {
        runId: "run-1",
        tests: [
          { name: "testBar", classname: "com.example.FooTest", status: "passed" },
          { name: "testBaz", classname: "com.example.FooTest", status: "failed" },
        ],
      },
    ]);

    const runs = parseJsonString(content);
    expect(runs).toEqual([
      {
        runId: "run-1",
        tests: [
          { name: "testBar", classname: "com.example.FooTest", status: "passed" },
          { name: "testBaz", classname: "com.example.FooTest", status: "failed" },
        ],
      },
    ]);
  });

  it("defaults classname to an empty string when omitted", () => {
    const content = JSON.stringify([
      { runId: "run-1", tests: [{ name: "testBar", status: "passed" }] },
    ]);

    const runs = parseJsonString(content);
    expect(runs[0]?.tests[0]?.classname).toBe("");
  });

  it("accepts the skipped status", () => {
    const content = JSON.stringify([
      { runId: "run-1", tests: [{ name: "testBar", status: "skipped" }] },
    ]);

    const runs = parseJsonString(content);
    expect(runs[0]?.tests[0]?.status).toBe("skipped");
  });

  it("throws a clear error when the top-level value is not an array", () => {
    expect(() => parseJsonString(JSON.stringify({ not: "an array" }))).toThrow(
      /top-level JSON value to be an array/,
    );
  });

  it("throws a clear error on invalid JSON", () => {
    expect(() => parseJsonString("{not valid json")).toThrow(/Invalid JSON/);
  });

  it("throws a clear error when runId is missing", () => {
    const content = JSON.stringify([{ tests: [] }]);
    expect(() => parseJsonString(content)).toThrow(/"runId"/);
  });

  it("throws a clear error when a test status is invalid", () => {
    const content = JSON.stringify([
      { runId: "run-1", tests: [{ name: "testBar", status: "banana" }] },
    ]);
    expect(() => parseJsonString(content)).toThrow(/"status"/);
  });

  it("throws a clear error when a test name is missing", () => {
    const content = JSON.stringify([{ runId: "run-1", tests: [{ status: "passed" }] }]);
    expect(() => parseJsonString(content)).toThrow(/"name"/);
  });
});

describe("parseJsonFile", () => {
  it("reads and parses a run-result JSON fixture file from disk", async () => {
    const runs = await parseJsonFile(fixturePath);
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.runId)).toEqual(["run-1", "run-2", "run-3"]);
    expect(runs[0]?.tests).toHaveLength(4);
  });
});
