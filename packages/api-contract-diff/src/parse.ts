import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { OpenAPIDocument, SchemaObject } from "./types.js";

/**
 * Load an OpenAPI document from disk. `.json` files are parsed with
 * `JSON.parse`; anything else (`.yaml`, `.yml`, or an unrecognized
 * extension) is parsed as YAML, which is a practical superset of JSON for
 * the `yaml` package.
 */
export function loadSpec(filePath: string): OpenAPIDocument {
  const raw = readFileSync(filePath, "utf-8");
  const ext = filePath.toLowerCase().split(".").pop();

  const parsed: unknown = ext === "json" ? JSON.parse(raw) : parseYaml(raw);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Failed to parse OpenAPI document at '${filePath}': expected an object at the document root`);
  }

  return parsed as OpenAPIDocument;
}

const LOCAL_SCHEMA_REF_PREFIX = "#/components/schemas/";

/**
 * Resolve a (possibly `$ref`-pointing) SchemaObject to a concrete
 * SchemaObject, using `doc` as the source of `components.schemas`.
 *
 * Only local refs of the shape `#/components/schemas/<Name>` are supported.
 * Any other `$ref` shape (external files, `#/components/parameters/...`,
 * etc.) is out of scope and resolves to `undefined` — see the README
 * "Limitations" section.
 */
export function resolveSchema(
  doc: OpenAPIDocument,
  schema: SchemaObject | undefined,
  seen: Set<string> = new Set(),
): SchemaObject | undefined {
  if (!schema) {
    return undefined;
  }

  if (schema.$ref === undefined) {
    return schema;
  }

  if (!schema.$ref.startsWith(LOCAL_SCHEMA_REF_PREFIX)) {
    return undefined;
  }

  if (seen.has(schema.$ref)) {
    // Circular $ref chain — bail out rather than recursing forever.
    return undefined;
  }
  seen.add(schema.$ref);

  const name = schema.$ref.slice(LOCAL_SCHEMA_REF_PREFIX.length);
  const resolved = doc.components?.schemas?.[name];
  if (!resolved) {
    return undefined;
  }

  return resolveSchema(doc, resolved, seen);
}
