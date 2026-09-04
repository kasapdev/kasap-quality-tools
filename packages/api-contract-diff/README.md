# @kasap/api-contract-diff

A CLI (and library) that structurally compares two OpenAPI 3.x specs — YAML
or JSON — and reports **breaking changes**, separated from safe/non-breaking
additions. Designed to be dropped into CI as a contract-compatibility gate
between an API's "before" and "after" spec.

## Install / build

Inside the monorepo:

```sh
pnpm --filter @kasap/api-contract-diff build
```

This compiles `src/` to `dist/` via `tsc`. `pnpm --filter @kasap/api-contract-diff test`
runs the test suite (vitest), and `pnpm --filter @kasap/api-contract-diff dev -- <args>`
runs the CLI directly from source with `tsx`.

## Usage

```sh
api-contract-diff <before-spec> <after-spec> [--json]
```

- `<before-spec>` / `<after-spec>` — paths to OpenAPI 3.x documents. `.json`
  files are parsed as JSON; anything else is parsed as YAML.
- `--json` — print `{ "breaking": Change[], "safe": Change[] }` instead of
  the human-readable report.

**Exit code:** `1` if any breaking change was found, `0` otherwise — so it
can gate a CI pipeline directly:

```sh
api-contract-diff openapi-before.yaml openapi-after.yaml || exit 1
```

### Example output

```
Breaking changes
================
- [operation-removed] DELETE /users/{id}
  Operation 'DELETE /users/{id}' was removed
- [required-parameter-added] GET /users parameters.query:tenant
  New required parameter 'tenant' (in query) was added; existing clients that don't send it will now fail
- [property-removed] GET /users responses.200[].properties.nickname
  Property 'nickname' was removed
- [field-now-required] POST /users requestBody.properties.password
  Property 'password' is now required; existing clients that don't send it will now fail validation
- [maxLength-tightened] POST /users requestBody.properties.email
  maxLength decreased from 255 to 100

Safe changes
============
- [path-added] /users/{id}/avatar
  Path '/users/{id}/avatar' was added
- [operation-added] PATCH /users/{id}
  Operation 'PATCH /users/{id}' was added
- [parameter-added] GET /users parameters.query:search
  New optional parameter 'search' (in query) was added
- [property-added] GET /users responses.200[].properties.avatarUrl
  New optional property 'avatarUrl' was added
- [enum-value-added] GET /users responses.200[].properties.status
  Enum value "pending" was added

Summary: 5 breaking change(s), 5 safe change(s)
```

(`--json` output is the same data as structured JSON: `{ breaking: [...], safe: [...] }`.)

## Breaking-change categories detected

- **Removed path** — a path present in `before` is gone in `after`.
- **Removed operation** — an HTTP method present under a shared path in
  `before` is gone in `after`.
- **Removed parameter** — a path- or operation-level parameter present in
  `before` is gone in `after` (regardless of whether it was required — see
  "Limitations" below).
- **Newly-required parameter** — a parameter added in `after`, or a
  previously-optional parameter now marked `required: true`.
- **Parameter type change** — `schema.type` of a parameter changed.
- **Request body: newly-required field** — a property added to
  `required[]` that wasn't required before.
- **Request/response body: removed property** — a property present in
  `before`'s `properties` is gone in `after` (see "Limitations").
- **Request/response body: type change** — a schema/property's `type`
  changed.
- **Request/response body: enum value removed** — a value present in
  `before`'s `enum` is gone in `after`.
- **Request/response body: tightened constraints** — `maxLength` decreased,
  `minLength` increased, `maximum` decreased, `minimum` increased, or a
  `pattern` added/changed.
- **Request body: `additionalProperties` disallowed** — changed from
  `true`/unset to `false`.
- **Response body: field no longer guaranteed** — a property removed from
  `required[]` in a response schema (still present in `properties`, but no
  longer guaranteed to be sent).
- **Removed component schema** — a schema present in `before.components.schemas`
  is gone in `after` (simple existence check, not a full reference-graph
  analysis of who still points at it).

Everything else — new paths, new operations, new optional parameters, new
optional properties, added enum values, loosened constraints, a response
field newly added to `required[]` — is classified as a **safe** change and
reported separately.

## What it walks

The tool defines its own minimal OpenAPI 3.x subset (`src/types.ts`) — it is
not a full OpenAPI validator. It walks: `paths` → path items (`get` / `put`
/ `post` / `delete` / `options` / `head` / `patch` / `trace`) → operation
`parameters`, `requestBody`, and `responses` → JSON Schema-ish
`SchemaObject`s (`type`, `properties`, `required`, `items`, `enum`,
`additionalProperties`, `minLength`/`maxLength`, `minimum`/`maximum`,
`pattern`, `$ref`, `allOf`/`oneOf`/`anyOf`).

## Limitations

- **`$ref` resolution is local-only.** Only `#/components/schemas/<Name>`
  refs are resolved (against the same document each side belongs to).
  External file refs (`other.yaml#/...`) and other local ref shapes (e.g.
  `#/components/parameters/...`) are not resolved — a schema that can't be
  resolved on either side is treated as having no detectable changes for
  that subtree.
- **Only `application/json` content is inspected.** Other media types
  (`multipart/form-data`, `application/xml`, etc.) are ignored entirely.
- **`allOf` is merged best-effort** (a shallow merge of each branch's
  `properties`/`required`/`type` into one "effective" schema before
  comparing). **`oneOf`/`anyOf` are not expanded or merged** — there's no
  single "effective" shape for a union of alternatives, so changes that live
  purely inside a `oneOf`/`anyOf` branch are not detected.
- **Any property removal counts as breaking**, whether or not the property
  was in `required[]`. A spec diff alone can't know whether existing clients
  depend on an optional field being processed, so removing it — request or
  response side — is conservatively flagged as breaking. If
  `additionalProperties: false` is also newly set, that's reported as a
  *separate*, additional breaking change on the same schema.
- **Any parameter removal counts as breaking**, whether or not it was
  required. A client relying on documented (even optional) parameter
  behavior may be surprised if the parameter is silently no longer
  recognized.
- **Whole-body presence changes are not classified.** If a `requestBody` (or
  a given response status code's body) exists on only one side — e.g. a
  brand-new request body added where none existed before — that's out of
  scope; only the internal structure of a JSON body schema present on
  *both* sides is diffed.
- **Response status codes added/removed entirely are not classified** as
  breaking or safe — only status codes present in both `before` and `after`
  have their response schemas diffed.
- **Array `items` schema added/removed entirely** (e.g. `type` stops or
  starts being `"array"`) is not diffed — only `items` present on both sides
  are recursed into.
- **Enum value equality** is compared with JS `Set` (`SameValueZero`)
  semantics — fine for the typical case of primitive enum values, but two
  structurally-equal object enum values would be treated as different.
- This is **not** a full OpenAPI validator: malformed documents may produce
  incomplete or misleading diffs rather than a validation error.
