import { runWithConcurrencyLimit } from "./concurrency.js";
import { computeLatencyStats, type LatencyStats } from "./stats.js";
import { sendRequest, type RequestResult } from "./httpClient.js";

export interface LoadTestOptions {
  url: string;
  requests: number;
  concurrency: number;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export type StatusBreakdown = Record<string, number>;

export interface LoadTestReport {
  totalRequests: number;
  successCount: number;
  failCount: number;
  /** Keys are stringified HTTP status codes (e.g. "200", "404"), plus
   * the special key `"error"` for requests that never got a real HTTP
   * response (network error / timeout). */
  statusCodeBreakdown: StatusBreakdown;
  requestsPerSecond: number;
  latencyStats: LatencyStats;
  wallClockMs: number;
}

/**
 * Runs the full load test: fires `options.requests` total requests at
 * `options.concurrency` using the worker-pool limiter, then aggregates
 * the results into a report.
 *
 * Latency-stats inclusion policy: `computeLatencyStats` is computed over
 * the latencies of ALL requests that completed with a real HTTP
 * response, whether 2xx/3xx (success) or 4xx/5xx (failure) — because
 * the server did respond, so the latency number is meaningful. Requests
 * that never got a response at all (`statusCode: null` — network error
 * or timeout) are EXCLUDED from latency stats, since their "latency" is
 * really just however long we waited before giving up, not a
 * meaningful measurement of server responsiveness. They are still
 * counted in `failCount` and in the `"error"` status breakdown bucket.
 */
export async function runLoadTest(
  options: LoadTestOptions,
): Promise<LoadTestReport> {
  const wallClockStart = Date.now();

  const results = await runWithConcurrencyLimit(
    options.requests,
    options.concurrency,
    (): Promise<RequestResult> =>
      sendRequest(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        timeoutMs: options.timeoutMs,
      }),
  );

  const wallClockMs = Date.now() - wallClockStart;

  return buildReport(results, wallClockMs, options.requests);
}

/**
 * Pure aggregation step, split out from `runLoadTest` so it can be unit
 * tested against fully synthetic `RequestResult[]` fixtures with no
 * network or timing involved.
 */
export function buildReport(
  results: Array<RequestResult | undefined>,
  wallClockMs: number,
  totalRequests: number,
): LoadTestReport {
  let successCount = 0;
  let failCount = 0;
  const statusCodeBreakdown: StatusBreakdown = {};
  const latenciesWithResponse: number[] = [];

  for (const result of results) {
    if (result === undefined) {
      // Safety-net slot from runWithConcurrencyLimit's catch path;
      // should not occur in normal operation (see concurrency.ts).
      failCount += 1;
      statusCodeBreakdown["error"] = (statusCodeBreakdown["error"] ?? 0) + 1;
      continue;
    }

    if (result.ok) {
      successCount += 1;
    } else {
      failCount += 1;
    }

    if (result.statusCode === null) {
      statusCodeBreakdown["error"] = (statusCodeBreakdown["error"] ?? 0) + 1;
    } else {
      const key = String(result.statusCode);
      statusCodeBreakdown[key] = (statusCodeBreakdown[key] ?? 0) + 1;
      latenciesWithResponse.push(result.latencyMs);
    }
  }

  const wallClockSeconds = wallClockMs / 1000;
  const requestsPerSecond =
    wallClockSeconds > 0 ? totalRequests / wallClockSeconds : 0;

  return {
    totalRequests,
    successCount,
    failCount,
    statusCodeBreakdown,
    requestsPerSecond,
    latencyStats: computeLatencyStats(latenciesWithResponse),
    wallClockMs,
  };
}
