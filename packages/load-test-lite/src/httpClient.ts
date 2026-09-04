import * as http from "node:http";
import * as https from "node:https";

/**
 * Result of a single HTTP request attempt. `sendRequest` always
 * RESOLVES with one of these (never rejects), so callers (and the
 * concurrency limiter) never need to special-case a thrown error for
 * ordinary request-level failures.
 */
export interface RequestResult {
  /** Real HTTP status code, or `null` if no response was ever received
   * (network error, DNS failure, timeout, aborted connection, etc). */
  statusCode: number | null;
  /** Wall-clock time from just before the request was sent to either
   * response-end, or to the point of error/timeout, in milliseconds. */
  latencyMs: number;
  /**
   * Whether this request counts as a "success" in the load-test sense.
   * Definition used here: `ok = statusCode !== null && statusCode < 400`.
   * That means 2xx and 3xx responses are successes, 4xx/5xx responses
   * are failures (but still carry a real statusCode and latency), and
   * network errors/timeouts (`statusCode: null`) are always failures.
   */
  ok: boolean;
  /** Present when the request could not complete (network error or
   * timeout); absent when a real HTTP response was received. */
  error?: string;
}

export interface SendRequestOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

/**
 * Sends a single HTTP(S) request using Node's built-in `node:http` /
 * `node:https` modules directly (no HTTP client dependency). Picks the
 * module based on the URL's protocol (`http:` vs `https:`).
 *
 * Timeout handling: an `AbortController` is created and its `signal` is
 * passed to `http(s).request`. If the timeout fires first, the request
 * is aborted so it never hangs forever, and the result resolves with
 * `ok: false, statusCode: null, error: "Timeout after <ms>ms"`.
 */
export function sendRequest(
  url: string,
  options: SendRequestOptions,
): Promise<RequestResult> {
  return new Promise((resolve) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      resolve({
        statusCode: null,
        latencyMs: 0,
        ok: false,
        error: `Invalid URL: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    // `http.request` and `https.request` are both overloaded functions;
    // TypeScript cannot call a plain union of two differently-overloaded
    // functions, so pick the concrete function and cast to one common
    // shape. The options object below (method/headers/signal) only uses
    // fields present on both http.RequestOptions and https.RequestOptions,
    // so this is safe for both protocols at runtime.
    const requestFn = (
      parsedUrl.protocol === "https:" ? https.request : http.request
    ) as typeof http.request;

    const controller = new AbortController();
    const startedAt = Date.now();
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      controller.abort();
    }, options.timeoutMs);

    const finish = (result: RequestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const req = requestFn(
      parsedUrl,
      {
        method: options.method,
        headers: options.headers,
        signal: controller.signal,
      },
      (res) => {
        // Drain the response body so the socket can be reused/closed
        // cleanly; we don't need the body content for load testing.
        res.on("data", () => {
          // discard
        });
        res.on("end", () => {
          finish({
            statusCode: res.statusCode ?? null,
            latencyMs: Date.now() - startedAt,
            ok: typeof res.statusCode === "number" && res.statusCode < 400,
          });
        });
        res.on("error", (error) => {
          finish({
            statusCode: res.statusCode ?? null,
            latencyMs: Date.now() - startedAt,
            ok: false,
            error: error.message,
          });
        });
      },
    );

    req.on("error", (error) => {
      const latencyMs = Date.now() - startedAt;
      const isAbort =
        controller.signal.aborted ||
        (error as NodeJS.ErrnoException).name === "AbortError";
      finish({
        statusCode: null,
        latencyMs,
        ok: false,
        error: isAbort
          ? `Timeout after ${options.timeoutMs}ms`
          : error.message,
      });
    });

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}
