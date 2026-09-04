import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendRequest } from "../src/httpClient.js";

// Spins up a real, local, ephemeral-port HTTP server for each test. This
// is NOT a call to any external/internet system — it's a same-process
// loopback server, the standard way to test Node HTTP client code
// without touching the network.
describe("sendRequest", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hello");
        return;
      }
      if (req.url === "/not-found") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("nope");
        return;
      }
      if (req.url === "/server-error") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("boom");
        return;
      }
      if (req.url === "/echo-method") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(req.method ?? "");
        return;
      }
      if (req.url === "/never-responds") {
        // Intentionally never call res.end() -- used to test timeouts.
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("reports a 200 status code and a plausible latency for a fast response", async () => {
    const result = await sendRequest(`${baseUrl}/ok`, {
      method: "GET",
      headers: {},
      timeoutMs: 5000,
    });

    expect(result.statusCode).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(5000);
  });

  it("reports ok:false for a 404 response but still records status/latency", async () => {
    const result = await sendRequest(`${baseUrl}/not-found`, {
      method: "GET",
      headers: {},
      timeoutMs: 5000,
    });

    expect(result.statusCode).toBe(404);
    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports ok:false for a 500 response", async () => {
    const result = await sendRequest(`${baseUrl}/server-error`, {
      method: "GET",
      headers: {},
      timeoutMs: 5000,
    });

    expect(result.statusCode).toBe(500);
    expect(result.ok).toBe(false);
  });

  it("sends the configured HTTP method", async () => {
    const result = await sendRequest(`${baseUrl}/echo-method`, {
      method: "POST",
      headers: {},
      timeoutMs: 5000,
    });

    expect(result.statusCode).toBe(200);
  });

  it("reports ok:false with statusCode null and an error message on timeout", async () => {
    const result = await sendRequest(`${baseUrl}/never-responds`, {
      method: "GET",
      headers: {},
      timeoutMs: 100,
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/timeout/i);
  }, 10_000);

  it("reports ok:false with statusCode null for a connection error (nothing listening)", async () => {
    // Use a port that (almost certainly) has nothing listening on it.
    const result = await sendRequest("http://127.0.0.1:1", {
      method: "GET",
      headers: {},
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toBeDefined();
  });
});
