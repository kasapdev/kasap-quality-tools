import type { Change, OpenAPIDocument } from "./types.js";
import { diffComponentSchemas, diffPaths } from "./diffPaths.js";

export interface DiffResult {
  breaking: Change[];
  safe: Change[];
}

/**
 * Structurally compare two OpenAPI documents and partition every detected
 * change into `breaking` and `safe` buckets.
 */
export function diffSpecs(before: OpenAPIDocument, after: OpenAPIDocument): DiffResult {
  const changes: Change[] = [...diffPaths(before, after), ...diffComponentSchemas(before, after)];

  const breaking: Change[] = [];
  const safe: Change[] = [];
  for (const change of changes) {
    if (change.severity === "breaking") {
      breaking.push(change);
    } else {
      safe.push(change);
    }
  }

  return { breaking, safe };
}
