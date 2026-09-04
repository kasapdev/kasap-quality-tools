/**
 * Parsing of the simple JSON test-result format into the normalized
 * `RunResult` shape used by the flakiness-detection algorithm.
 *
 * Expected shape (an array of run entries):
 * ```json
 * [
 *   { "runId": "run-1", "tests": [ { "name": "testBar", "classname": "com.example.FooTest", "status": "passed" } ] }
 * ]
 * ```
 * `classname` is optional and defaults to `""`. `status` must be one of
 * "passed" | "failed" | "skipped".
 */
import { readFile } from "node:fs/promises";
import type { NormalizedTestCase, RunResult, TestStatus } from "./flakiness.js";

const VALID_STATUSES: ReadonlySet<string> = new Set(["passed", "failed", "skipped"]);

function isTestStatus(value: unknown): value is TestStatus {
  return typeof value === "string" && VALID_STATUSES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTestCase(raw: unknown, context: string): NormalizedTestCase {
  if (!isRecord(raw)) {
    throw new Error(`${context}: expected a test object, got ${JSON.stringify(raw)}`);
  }
  const { name, classname, status } = raw;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${context}: "name" must be a non-empty string`);
  }
  if (classname !== undefined && typeof classname !== "string") {
    throw new Error(`${context}: "classname" must be a string when present`);
  }
  if (!isTestStatus(status)) {
    throw new Error(
      `${context}: "status" must be one of "passed" | "failed" | "skipped", got ${JSON.stringify(status)}`,
    );
  }
  return {
    name,
    classname: classname ?? "",
    status,
  };
}

function parseRunEntry(raw: unknown, index: number): RunResult {
  const context = `run entry at index ${index}`;
  if (!isRecord(raw)) {
    throw new Error(`${context}: expected an object, got ${JSON.stringify(raw)}`);
  }
  const { runId, tests } = raw;
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error(`${context}: "runId" must be a non-empty string`);
  }
  if (!Array.isArray(tests)) {
    throw new Error(`${context}: "tests" must be an array`);
  }
  return {
    runId,
    tests: tests.map((testCase, testIndex) =>
      parseTestCase(testCase, `${context}, test at index ${testIndex}`),
    ),
  };
}

/** Parses a JSON string in the simple JSON format into a normalized `RunResult[]`. */
export function parseJsonString(content: string): RunResult[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON: ${message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error("Expected the top-level JSON value to be an array of run entries");
  }

  return data.map((entry, index) => parseRunEntry(entry, index));
}

/** Reads and parses a JSON file in the simple JSON format into a normalized `RunResult[]`. */
export async function parseJsonFile(filePath: string): Promise<RunResult[]> {
  const content = await readFile(filePath, "utf-8");
  return parseJsonString(content);
}
