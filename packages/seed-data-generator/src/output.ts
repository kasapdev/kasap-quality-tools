import type { GeneratedData } from "./generate.js";

export type OutputFormat = "json" | "sql";

/** Pretty-printed JSON: `{ "ModelName": [ {...row}, ... ], ... }` in the given key order. */
export function formatAsJson(data: GeneratedData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Formats generated data as batched `INSERT INTO "Model" (...) VALUES (...), (...);`
 * statements, one block per model, in the order the models appear in `data`
 * (i.e. dependency order, as produced by generateSeedData).
 */
export function formatAsSql(data: GeneratedData): string {
  const blocks: string[] = [];

  for (const [modelName, rows] of Object.entries(data)) {
    const firstRow = rows[0];
    if (!firstRow) {
      blocks.push(`-- No rows generated for "${modelName}"`);
      continue;
    }

    const columns = Object.keys(firstRow);
    const columnList = columns.map((c) => `"${c}"`).join(", ");
    const valueTuples = rows.map((row) => `(${columns.map((c) => sqlLiteral(row[c])).join(", ")})`);

    blocks.push(`INSERT INTO "${modelName}" (${columnList}) VALUES\n  ${valueTuples.join(",\n  ")};`);
  }

  return blocks.join("\n\n");
}

export function formatData(data: GeneratedData, format: OutputFormat): string {
  return format === "sql" ? formatAsSql(data) : formatAsJson(data);
}

/** Doubles single quotes for safe SQL string embedding, e.g. `O'Brien` -> `O''Brien`. */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return `'${escapeSqlString(value)}'`;
  if (value instanceof Date) return `'${escapeSqlString(value.toISOString())}'`;
  // Objects/arrays (e.g. Json fields) -> JSON-encode, then quote/escape as a string literal.
  return `'${escapeSqlString(JSON.stringify(value))}'`;
}
