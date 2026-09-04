import { describe, expect, it } from "vitest";
import { buildReport } from "../src/runner.js";
import type { RequestResult } from "../src/httpClient.js";

function result(fields: {
  statusCode: number | null;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}): RequestResult {
  return {
    statusCode: fields.statusCode,
    ok: fields.ok,
    latencyMs: fields.latencyMs ?? 10,
    ...(fields.error !== undefined ? { error: fields.error } : {}),
  };
}

describe("buildReport", () => {
  it("aggregates success/fail counts and status code breakdown from synthetic results", () => {
    const results: RequestResult[] = [
      result({ statusCode: 200, ok: true, latencyMs: 10 }),
      result({ statusCode: 200, ok: true, latencyMs: 20 }),
      result({ statusCode: 200, ok: true, latencyMs: 30 }),
      result({ statusCode: 404, ok: false, latencyMs: 15 }),
      result({ statusCode: 500, ok: false, latencyMs: 25 }),
      result({
        statusCode: null,
        ok: false,
        latencyMs: 0,
        error: "Timeout after 1000ms",
      }),
    ];

    const report = buildReport(results, 2000, results.length);

    expect(report.totalRequests).toBe(6);
    expect(report.successCount).toBe(3);
    expect(report.failCount).toBe(3);
    expect(report.statusCodeBreakdown).toEqual({
      "200": 3,
      "404": 1,
      "500": 1,
      error: 1,
    });
  });

  it("computes requests/sec from wall clock time", () => {
    const results: RequestResult[] = Array.from({ length: 10 }, () =>
      result({ statusCode: 200, ok: true, latencyMs: 5 }),
    );

    // 10 requests in 2000ms wall clock -> 5 req/sec.
    const report = buildReport(results, 2000, 10);

    expect(report.requestsPerSecond).toBeCloseTo(5, 10);
  });

  it("includes latencies from both successful and failed-but-responded requests, excludes no-response entries", () => {
    const results: RequestResult[] = [
      result({ statusCode: 200, ok: true, latencyMs: 100 }),
      result({ statusCode: 500, ok: false, latencyMs: 200 }),
      // No real response -- should be excluded from latency stats.
      result({ statusCode: null, ok: false, latencyMs: 9999, error: "timeout" }),
    ];

    const report = buildReport(results, 1000, 3);

    // Only the two responded requests should feed into latency stats.
    expect(report.latencyStats.count).toBe(2);
    expect(report.latencyStats.min).toBe(100);
    expect(report.latencyStats.max).toBe(200);
  });

  it("treats undefined slots (concurrency-limiter safety net) as failures under the 'error' bucket", () => {
    const results: Array<RequestResult | undefined> = [
      result({ statusCode: 200, ok: true, latencyMs: 10 }),
      undefined,
    ];

    const report = buildReport(results, 500, 2);

    expect(report.successCount).toBe(1);
    expect(report.failCount).toBe(1);
    expect(report.statusCodeBreakdown["error"]).toBe(1);
    expect(report.latencyStats.count).toBe(1);
  });

  it("handles a wall clock time of 0 without dividing by zero", () => {
    const report = buildReport([], 0, 0);
    expect(report.requestsPerSecond).toBe(0);
    expect(report.latencyStats.count).toBe(0);
  });
});
