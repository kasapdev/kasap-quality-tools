import { describe, expect, it } from "vitest";
import { computeLatencyStats } from "../src/stats.js";

describe("computeLatencyStats", () => {
  it("returns all-zero stats for an empty array (count 0), does not throw", () => {
    const stats = computeLatencyStats([]);
    expect(stats).toEqual({
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      p50: 0,
      p90: 0,
      p99: 0,
    });
  });

  it("returns the single value for every stat on a single-element array", () => {
    const stats = computeLatencyStats([42]);
    expect(stats).toEqual({
      count: 1,
      min: 42,
      max: 42,
      mean: 42,
      p50: 42,
      p90: 42,
      p99: 42,
    });
  });

  it("computes exact hand-checkable stats for 100 values [10, 20, ..., 1000]", () => {
    // n = 100 values: 10, 20, 30, ..., 1000 (sorted[i] = (i+1) * 10).
    const values: number[] = [];
    for (let i = 1; i <= 100; i++) {
      values.push(i * 10);
    }

    const stats = computeLatencyStats(values);

    // Nearest-rank: index = ceil((p/100) * n) - 1, sorted[index].
    // p50: ceil(0.50 * 100) - 1 = 49 -> sorted[49] = 50th value = 500.
    // p90: ceil(0.90 * 100) - 1 = 89 -> sorted[89] = 90th value = 900.
    // p99: ceil(0.99 * 100) - 1 = 98 -> sorted[98] = 99th value = 990.
    expect(stats.count).toBe(100);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(1000);
    expect(stats.mean).toBeCloseTo(505, 10); // (10+1000)/2 average of arithmetic series
    expect(stats.p50).toBe(500);
    expect(stats.p90).toBe(900);
    expect(stats.p99).toBe(990);
  });

  it("produces identical stats regardless of input order, and does not mutate the input", () => {
    const sortedInput = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
    const shuffledInput = [65, 5, 95, 25, 75, 15, 55, 35, 85, 45];

    const sortedInputCopy = [...sortedInput];
    const shuffledInputCopy = [...shuffledInput];

    const statsFromSorted = computeLatencyStats(sortedInput);
    const statsFromShuffled = computeLatencyStats(shuffledInput);

    expect(statsFromSorted).toEqual(statsFromShuffled);

    // Original arrays must be untouched (same order as before the call).
    expect(sortedInput).toEqual(sortedInputCopy);
    expect(shuffledInput).toEqual(shuffledInputCopy);
  });

  it("computes correct min/max/mean for a small hand-picked array", () => {
    // [1, 2, 3, 4, 5] -> min 1, max 5, mean 3.
    // n = 5. p50: ceil(0.5*5)-1 = ceil(2.5)-1 = 3-1 = 2 -> sorted[2] = 3.
    // p90: ceil(0.9*5)-1 = ceil(4.5)-1 = 5-1 = 4 -> sorted[4] = 5.
    // p99: ceil(0.99*5)-1 = ceil(4.95)-1 = 5-1 = 4 -> sorted[4] = 5.
    const stats = computeLatencyStats([3, 1, 5, 2, 4]);
    expect(stats.count).toBe(5);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(stats.mean).toBe(3);
    expect(stats.p50).toBe(3);
    expect(stats.p90).toBe(5);
    expect(stats.p99).toBe(5);
  });
});
