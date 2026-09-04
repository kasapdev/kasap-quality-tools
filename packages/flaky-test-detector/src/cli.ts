#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { detectFlakiness, countDistinctTests } from "./flakiness.js";
import type { FlakyTestReport, RunResult } from "./flakiness.js";
import { parseJUnitDirectory } from "./junit.js";
import { parseJsonFile } from "./jsonFormat.js";

interface CliOptions {
  junitDir?: string;
  jsonFile?: string;
  json?: boolean;
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
