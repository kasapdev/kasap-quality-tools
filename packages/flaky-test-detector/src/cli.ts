#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { detectFlakiness, countDistinctTests } from "./flakiness.js";
import type { FlakyTestReport, RunResult } from "./flakiness.js";
import { parseJUnitDirectory } from "./junit.js";
import { parseJsonFile } from "./jsonFormat.js";
import {
  selectQuarantineCandidates,
  formatQuarantineJson,
  formatQuarantineTextList,
  formatQuarantineGrepPattern,
} from "./quarantine.js";

const QUARANTINE_FORMATS = ["text", "json", "grep"] as const;
type QuarantineFormat = (typeof QUARANTINE_FORMATS)[number];

function isQuarantineFormat(value: string): value is QuarantineFormat {
  return (QUARANTINE_FORMATS as readonly string[]).includes(value);
}

interface CliOptions {
  junitDir?: string;
  jsonFile?: string;
  json?: boolean;
  quarantine?: boolean;
  quarantineFormat: string;
  minFlipRate: string;
  minFailCount: string;
}

async function loadRuns(options: CliOptions): Promise<RunResult[]> {
  if (options.junitDir && options.jsonFile) {
    throw new Error("Specify exactly one of --junit-dir or --json-file, not both.");
  }
  if (options.junitDir) {
    return parseJUnitDirectory(options.junitDir);
  }
  if (options.jsonFile) {
    return parseJsonFile(options.jsonFile);
  }
  throw new Error("You must specify exactly one of --junit-dir <dir> or --json-file <file>.");
}

function parseNonNegativeNumber(raw: string, flagName: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flagName} must be a non-negative number, got: ${raw}`);
  }
  return value;
}

function parsePositiveInt(raw: string, flagName: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${flagName} must be a positive integer, got: ${raw}`);
  }
  return value;
}

function printHumanReadable(reports: FlakyTestReport[], totalTests: number, totalRuns: number): void {
  for (const report of reports) {
    console.log(`Test: ${report.name}`);
    console.log(`  Classname: ${report.classname.length > 0 ? report.classname : "(none)"}`);
    console.log(`  Flip rate: ${report.flipRatePercent.toFixed(2)}%`);
    console.log(`  Runs observed: ${report.runsObserved}`);
    console.log(`  Passed: ${report.passCount}`);
    console.log(`  Failed: ${report.failCount}`);
    console.log(
      `  Flipped at runs: ${
        report.flippedAtRunIds.length > 0 ? report.flippedAtRunIds.join(", ") : "(none)"
      }`,
    );
    console.log("");
  }
  console.log(`${reports.length} flaky tests found out of ${totalTests} total tests across ${totalRuns} runs.`);
}

/** Builds and runs the CLI. Returns the intended process exit code. */
export async function run(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name("flaky-test-detector")
    .description("Detect flaky tests from CI test-result history (JUnit XML or simple JSON).")
    .option("--junit-dir <dir>", "Directory of JUnit XML files, one per CI run")
    .option("--json-file <file>", "Path to a file in the simple JSON run-result format")
    .option("--json", "Output machine-readable JSON instead of a human-readable report")
    .option(
      "--quarantine",
      "Output a quarantine list of the flakiest tests instead of the normal report",
    )
    .option(
      "--quarantine-format <format>",
      `Quarantine list output format: ${QUARANTINE_FORMATS.join(" | ")}`,
      "text",
    )
    .option(
      "--min-flip-rate <percent>",
      "Only quarantine tests with a flip-rate percentage at or above this threshold",
      "0",
    )
    .option(
      "--min-fail-count <n>",
      "Only quarantine tests that failed at least this many times",
      "1",
    )
    .exitOverride()
    .configureOutput({
      writeErr: (str) => process.stderr.write(str),
    });

  try {
    program.parse(argv);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code?: string }).code;
      if (code === "commander.helpDisplayed" || code === "commander.version") {
        return 0;
      }
    }
    return 1;
  }

  const options = program.opts<CliOptions>();

  let runs: RunResult[];
  try {
    runs = await loadRuns(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }

  const reports = detectFlakiness(runs);
  const totalTests = countDistinctTests(runs);
  const totalRuns = runs.length;

  if (options.quarantine) {
    if (!isQuarantineFormat(options.quarantineFormat)) {
      process.stderr.write(
        `Error: --quarantine-format must be one of ${QUARANTINE_FORMATS.join(", ")}, got: ${options.quarantineFormat}\n`,
      );
      return 1;
    }

    let minFlipRatePercent: number;
    let minFailCount: number;
    try {
      minFlipRatePercent = parseNonNegativeNumber(options.minFlipRate, "--min-flip-rate");
      minFailCount = parsePositiveInt(options.minFailCount, "--min-fail-count");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      return 1;
    }

    let candidates;
    try {
      candidates = selectQuarantineCandidates(reports, { minFlipRatePercent, minFailCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      return 1;
    }

    if (options.quarantineFormat === "json") {
      console.log(formatQuarantineJson(candidates));
    } else if (options.quarantineFormat === "grep") {
      console.log(formatQuarantineGrepPattern(candidates));
    } else {
      console.log(formatQuarantineTextList(candidates));
    }
    return 0;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          flakyTests: reports,
          summary: {
            flakyCount: reports.length,
            totalTests,
            totalRuns,
          },
        },
        null,
        2,
      ),
    );
  } else {
    printHumanReadable(reports, totalTests, totalRuns);
  }

  return 0;
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  run(process.argv).then((code) => {
    process.exitCode = code;
  });
}
