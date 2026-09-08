/** Public library API for @kasap/flaky-test-detector. */
export type {
  TestStatus,
  NormalizedTestCase,
  RunResult,
  FlakyTestReport,
} from "./flakiness.js";
export { detectFlakiness, countDistinctTests, compareRunIds } from "./flakiness.js";

export { parseJUnitXml, parseJUnitDirectory } from "./junit.js";

export { parseJsonString, parseJsonFile } from "./jsonFormat.js";

export type { QuarantineOptions, QuarantinedTest } from "./quarantine.js";
export {
  selectQuarantineCandidates,
  formatQuarantineJson,
  formatQuarantineTextList,
  formatQuarantineGrepPattern,
} from "./quarantine.js";
