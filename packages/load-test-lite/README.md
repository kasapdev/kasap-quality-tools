# @kasap/load-test-lite

A minimal, near-zero-dependency HTTP load-testing CLI for exercising your
own endpoints during development.

## ⚠️ Responsible use — read this first

**Only point this tool at systems you own or have explicit, written
permission to load-test.** `load-test-lite` sends a configurable burst of
concurrent HTTP requests as fast as it can. Running it against a
third-party service without authorization can degrade or take down that
service for other users, may constitute a denial-of-service attack, and
may be **illegal** under computer-misuse laws in your jurisdiction (e.g.
the U.S. Computer Fraud and Abuse Act, the UK Computer Misuse Act, and
equivalents elsewhere) — regardless of whether you intended harm. You are
solely responsible for how you use this tool. When in doubt, don't run it
against anything you don't control.

## Install / build

This package lives inside a pnpm workspace. From the workspace root:

```sh
pnpm install
pnpm --filter @kasap/load-test-lite build
```

Run it directly during development without building:

```sh
pnpm --filter @kasap/load-test-lite dev -- http://localhost:3000/health --requests 200 --concurrency 20
```

Or, after building, via the `load-test-lite` bin (e.g. `pnpm --filter @kasap/load-test-lite exec load-test-lite ...`, or link it globally).

## Usage

```
load-test-lite <url> [options]

Arguments:
  url                    target URL (required)

Options:
  --requests <n>         total number of requests to send (default: 100)
  --concurrency <n>      max in-flight requests at once (default: 10)
  --method <method>      HTTP method (default: GET)
  --headers <json>       JSON object string of extra headers, e.g. '{"Authorization":"Bearer x"}'
  --body <string>        raw request body string
  --timeout <ms>         per-request timeout in milliseconds (default: 10000)
```

### Example

```sh
load-test-lite http://localhost:3000/api/ping \
  --requests 500 \
  --concurrency 25 \
  --method GET \
  --timeout 5000
```

Example output:

```
Load test report
=================
Total requests:     500
Successful:         497
Failed:             3
Wall clock time:    4123 ms
Requests/sec:       121.27

Status code breakdown:
  200: 497
  500: 2
  error: 1

Latency (ms), over requests that received an HTTP response:
  count: 499
  min:   4.00
  mean:  48.21
  p50:   42.00
  p90:   88.00
  p99:   155.00
  max:   210.00
```

### POST with a JSON body

```sh
load-test-lite http://localhost:3000/api/orders \
  --method POST \
  --body '{"item":"widget","qty":3}' \
  --requests 100 \
  --concurrency 10
```

If `--body` is provided and no `Content-Type` header is set via
`--headers`, `load-test-lite` inspects the body: if it parses as JSON, it
defaults `Content-Type` to `application/json`; otherwise it defaults to
`text/plain`. Set `--headers '{"Content-Type":"..."}'` to override this.

Exit code is `0` once the run itself completes, no matter how many
individual requests failed (failures are data, not a CLI error). A
non-zero exit code means the CLI couldn't even start the run — invalid
`--headers`/`--body` JSON, a non-numeric `--requests`/`--concurrency`/
`--timeout`, etc. — and an explanatory message is printed to stderr.

## Concurrency model

`load-test-lite` implements its own worker-pool concurrency limiter (see
`src/concurrency.ts`, `runWithConcurrencyLimit`) instead of using a
library like `p-limit` or firing an unbounded `Promise.all`. It spawns
`min(concurrency, requests)` "lanes"; each lane is an async loop that
pulls the next task index off a single shared counter and runs one
request, repeating until all requests have been claimed. This guarantees
at most `--concurrency` requests are in flight at any moment, while all
`--requests` requests eventually run, in an order-preserving results
array (task index order, not completion order).

A single request that throws unexpectedly is caught inside the limiter
and recorded rather than aborting the whole run — though in practice this
is a safety net, since `sendRequest` itself never throws: network errors
and timeouts are turned into `{ ok: false, statusCode: null, error }`
result objects instead of thrown exceptions.

## Percentile method

Latency percentiles (`p50`, `p90`, `p99`) are computed using the
**nearest-rank method**: for a set of `n` latencies sorted ascending and
a percentile `p`, the index used is

```
index = ceil((p / 100) * n) - 1        (clamped to [0, n - 1])
```

and the percentile value is `sorted[index]` — i.e. an actual observed
latency, never an interpolated value between two observations. See
`src/stats.ts` for the implementation. A run with zero requests that
received a response reports all-zero latency stats rather than throwing,
so a report can always be printed.

Latency stats are computed over every request that received a **real
HTTP response**, whether 2xx/3xx or 4xx/5xx — the server did respond, so
the timing is meaningful. Requests that never got a response at all
(connection error or timeout) are excluded from latency stats (their
"latency" is just how long the CLI waited before giving up) but are still
counted in the failure count and appear under the `error` bucket in the
status code breakdown.

A request counts as `ok` (success) when a response was received with
`statusCode < 400`; timeouts and connection errors are always failures.

## Limitations

- Uses Node's built-in `node:http` / `node:https` modules directly — no
  HTTP/2, no HTTP/3.
- No custom TLS certificate/CA configuration; it relies on Node's default
  TLS trust store, so self-signed certs on an `https://` target will fail
  unless you've configured trust at the Node/OS level.
- Single-process, single-machine: throughput is bounded by what one
  Node.js process and one machine's network stack can generate. This is
  a lightweight development tool, not a distributed load-generation
  platform.
- No connection pooling/keep-alive tuning beyond Node's defaults; no
  request-body streaming (bodies are passed as a single string).
- No warm-up phase, ramp-up, or think-time between requests — it fires
  requests as fast as the concurrency limiter allows for the whole run.
