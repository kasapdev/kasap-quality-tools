/**
 * Parsing of JUnit XML test-result files into the normalized `RunResult`
 * shape used by the flakiness-detection algorithm.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { NormalizedTestCase, RunResult, TestStatus } from "./flakiness.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/**
 * Normalizes a fast-xml-parser child value that may be absent, a single
 * object (when there was exactly one matching child element), or an array
 * (when there were multiple) into a plain array.
 */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

interface RawTestCase {
  "@_classname"?: string;
  "@_name"?: string;
  failure?: unknown;
  error?: unknown;
  skipped?: unknown;
}

interface RawTestSuite {
  testcase?: RawTestCase | RawTestCase[];
}

interface RawRoot {
  testsuite?: RawTestSuite | RawTestSuite[];
  testsuites?: {
    testsuite?: RawTestSuite | RawTestSuite[];
  };
}

function statusOf(testcase: RawTestCase): TestStatus {
  if (testcase.skipped !== undefined) return "skipped";
  if (testcase.failure !== undefined || testcase.error !== undefined) return "failed";
  return "passed";
}

function extractTestCases(root: RawRoot): NormalizedTestCase[] {
  // Root can be either a single/array <testsuite> directly, or a
  // <testsuites> wrapper containing one or more <testsuite> children.
  const suites: RawTestSuite[] = root.testsuites
    ? asArray(root.testsuites.testsuite)
    : asArray(root.testsuite);

  const tests: NormalizedTestCase[] = [];
  for (const suite of suites) {
    const testcases = asArray(suite.testcase);
    for (const testcase of testcases) {
      tests.push({
        classname: testcase["@_classname"] ?? "",
        name: testcase["@_name"] ?? "",
        status: statusOf(testcase),
      });
    }
  }
  return tests;
}

/** Parses a single JUnit XML file's contents into a list of normalized test cases. */
export function parseJUnitXml(xmlContent: string): NormalizedTestCase[] {
  const parsed = parser.parse(xmlContent) as RawRoot;
  return extractTestCases(parsed);
}

/**
 * Parses a directory containing one JUnit XML file per CI run into a
 * normalized `RunResult[]`. The run ID for each file is its filename
 * without the `.xml` extension. Files are read in directory-listing order;
 * callers that care about run ordering should rely on `compareRunIds`
 * (used internally by `detectFlakiness`) rather than this function's
 * return order.
 */
export async function parseJUnitDirectory(dir: string): Promise<RunResult[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const xmlFiles = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".xml")
    .map((entry) => entry.name);

  const runs: RunResult[] = [];
  for (const fileName of xmlFiles) {
    const filePath = join(dir, fileName);
    const content = await readFile(filePath, "utf-8");
    const runId = fileName.slice(0, -extname(fileName).length);
    runs.push({
      runId,
      tests: parseJUnitXml(content),
    });
  }
  return runs;
}
