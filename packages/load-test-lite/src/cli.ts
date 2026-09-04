#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { runLoadTest, type LoadTestReport } from "./runner.js";

interface CliOptions {
  requests: string;
  concurrency: string;
  method: string;
  headers?: string;
  body?: string;
  timeout: string;
}

/**
 * Decides the Content-Type header to attach to `--body` when the user
 * did not already supply one via `--headers`. Heuristic: if the body
 * parses as JSON (via `JSON.parse`), default to `application/json`;
 * otherwise default to `text/plain`. This is a best-effort convenience,
 * not a strict content-type sniffer.
 */
function inferContentType(body: string): string {
  try {
    JSON.parse(body);
    return "application/json";
  } catch {
    return "text/plain";
  }
}

function parseHeadersJson(raw: string | undefined): Record<string, string> {
  if (raw === undefined) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `--headers must be a valid JSON object string: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("--headers must be a JSON object, e.g. '{\"X-Foo\":\"bar\"}'");
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    headers[key] = String(value);
  }
  return headers;
}

function parsePositiveInt(raw: string, flagName: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${flagName} must be a positive integer, got: ${raw}`);
  }
  return value;
}

function formatReport(report: LoadTestReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("Load test report");
  lines.push("=================");
  lines.push(`Total requests:     ${report.totalRequests}`);
  lines.push(`Successful:         ${report.successCount}`);
  lines.push(`Failed:             ${report.failCount}`);
  lines.push(`Wall clock time:    ${report.wallClockMs} ms`);
  lines.push(`Requests/sec:       ${report.requestsPerSecond.toFixed(2)}`);
  lines.push("");
  lines.push("Status code breakdown:");
  const breakdownKeys = Object.keys(report.statusCodeBreakdown).sort();
  if (breakdownKeys.length === 0) {
    lines.push("  (none)");
  } else {
    for (const key of breakdownKeys) {
      lines.push(`  ${key}: ${report.statusCodeBreakdown[key]}`);
    }
  }
  lines.push("");
  lines.push("Latency (ms), over requests that received an HTTP response:");
  lines.push(`  count: ${report.latencyStats.count}`);
  lines.push(`  min:   ${report.latencyStats.min.toFixed(2)}`);
  lines.push(`  mean:  ${report.latencyStats.mean.toFixed(2)}`);
  lines.push(`  p50:   ${report.latencyStats.p50.toFixed(2)}`);
  lines.push(`  p90:   ${report.latencyStats.p90.toFixed(2)}`);
  lines.push(`  p99:   ${report.latencyStats.p99.toFixed(2)}`);
  lines.push(`  max:   ${report.latencyStats.max.toFixed(2)}`);
  lines.push("");
  return lines.join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const program = new Command();

  program
    .name("load-test-lite")
    .description(
      "Minimal HTTP load-testing CLI. Only use against systems you own or have explicit permission to test.",
    )
    .argument("<url>", "target URL")
    .option("--requests <n>", "total number of requests to send", "100")
    .option("--concurrency <n>", "max in-flight requests at once", "10")
    .option("--method <method>", "HTTP method", "GET")
    .option("--headers <json>", "JSON object string of extra headers")
    .option("--body <string>", "raw request body string")
    .option("--timeout <ms>", "per-request timeout in milliseconds", "10000")
    .exitOverride()
    .configureOutput({
      writeErr: (str) => process.stderr.write(str),
    });

  let parsedUrl: string;
  let opts: CliOptions;
  try {
    program.parse(argv);
    // `program.args` holds the positional arguments in declaration
    // order; we declared exactly one (`<url>`).
    const urlArg = program.args[0];
    if (urlArg === undefined) {
      throw new Error("missing required <url> argument");
    }
    parsedUrl = urlArg;
    opts = program.opts() as CliOptions;
  } catch (error) {
    // commander's exitOverride throws a CommanderError (with a `.code`
    // like "commander.missingArgument") on --help/bad args; commander
    // itself already printed the relevant usage/error message via our
    // configured writeErr, so we don't print it again here.
    const isCommanderError =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string" &&
      (error as { code: string }).code.startsWith("commander.");
    if (!isCommanderError) {
      process.stderr.write(
        `Argument error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return 1;
  }

  let requests: number;
  let concurrency: number;
  let timeoutMs: number;
  let headers: Record<string, string>;

  try {
    requests = parsePositiveInt(opts.requests, "--requests");
    concurrency = parsePositiveInt(opts.concurrency, "--concurrency");
    timeoutMs = parsePositiveInt(opts.timeout, "--timeout");
    headers = parseHeadersJson(opts.headers);
  } catch (error) {
    process.stderr.write(
      `Validation error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }

  if (
    opts.body !== undefined &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")
  ) {
    headers["Content-Type"] = inferContentType(opts.body);
  }

  const report = await runLoadTest({
    url: parsedUrl,
    requests,
    concurrency,
    method: opts.method,
    headers,
    body: opts.body,
    timeoutMs,
  });

  process.stdout.write(formatReport(report));
  return 0;
}

const invokedScriptPath = process.argv[1];
const isMainModule =
  invokedScriptPath !== undefined &&
  import.meta.url === pathToFileURL(invokedScriptPath).href;

if (isMainModule) {
  main(process.argv).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      process.stderr.write(
        `Unexpected error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
