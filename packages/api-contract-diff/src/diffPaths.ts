import { HTTP_METHODS } from "./types.js";
import type { Change, OpenAPIDocument, OperationObject, ParameterObject, PathItemObject } from "./types.js";
import { diffSchema } from "./diffSchema.js";

const JSON_MEDIA_TYPE = "application/json";

function paramKey(p: ParameterObject): string {
  return `${p.in}:${p.name}`;
}

/**
 * Merge path-level and operation-level parameter lists into one map keyed by
 * `in:name`, with operation-level parameters overriding path-level ones of
 * the same name/location (per the OpenAPI spec).
 */
function mergeParams(pathParams: ParameterObject[], opParams: ParameterObject[]): Map<string, ParameterObject> {
  const map = new Map<string, ParameterObject>();
  for (const p of pathParams) {
    map.set(paramKey(p), p);
  }
  for (const p of opParams) {
    map.set(paramKey(p), p);
  }
  return map;
}

function diffOperationParameters(
  beforeOp: OperationObject,
  afterOp: OperationObject,
  beforePathParams: ParameterObject[],
  afterPathParams: ParameterObject[],
  opLabel: string,
): Change[] {
  const changes: Change[] = [];

  const beforeParams = mergeParams(beforePathParams, beforeOp.parameters ?? []);
  const afterParams = mergeParams(afterPathParams, afterOp.parameters ?? []);
  const allKeys = new Set([...beforeParams.keys(), ...afterParams.keys()]);

  for (const key of allKeys) {
    const before = beforeParams.get(key);
    const after = afterParams.get(key);
    const paramPath = `${opLabel} parameters.${key}`;

    if (before && !after) {
      // Conservative rule: removing ANY declared parameter (required or
      // not) is treated as breaking. See README "Limitations".
      changes.push({
        severity: "breaking",
        category: "parameter-removed",
        path: paramPath,
        message: `Parameter '${before.name}' (in ${before.in}) was removed`,
        before,
      });
      continue;
    }

    if (!before && after) {
      if (after.required === true) {
        changes.push({
          severity: "breaking",
          category: "required-parameter-added",
          path: paramPath,
          message: `New required parameter '${after.name}' (in ${after.in}) was added; existing clients that don't send it will now fail`,
          after,
        });
      } else {
        changes.push({
          severity: "safe",
          category: "parameter-added",
          path: paramPath,
          message: `New optional parameter '${after.name}' (in ${after.in}) was added`,
          after,
        });
      }
      continue;
    }

    if (before && after) {
      const wasRequired = before.required === true;
      const isRequired = after.required === true;
      if (!wasRequired && isRequired) {
        changes.push({
          severity: "breaking",
          category: "parameter-now-required",
          path: paramPath,
          message: `Parameter '${after.name}' is now required; existing clients that don't send it will now fail`,
          before,
          after,
        });
      } else if (wasRequired && !isRequired) {
        changes.push({
          severity: "safe",
          category: "parameter-now-optional",
          path: paramPath,
          message: `Parameter '${after.name}' is no longer required`,
          before,
          after,
        });
      }

      const beforeType = before.schema?.type;
      const afterType = after.schema?.type;
      if (beforeType !== undefined && afterType !== undefined && beforeType !== afterType) {
        changes.push({
          severity: "breaking",
          category: "parameter-type-changed",
          path: paramPath,
          message: `Parameter '${after.name}' type changed from '${beforeType}' to '${afterType}'`,
          before: beforeType,
          after: afterType,
        });
      }
    }
  }

  return changes;
}

function diffOperation(
  beforeOp: OperationObject,
  afterOp: OperationObject,
  beforePathParams: ParameterObject[],
  afterPathParams: ParameterObject[],
  opLabel: string,
  beforeDoc: OpenAPIDocument,
  afterDoc: OpenAPIDocument,
): Change[] {
  const changes: Change[] = [];

  changes.push(...diffOperationParameters(beforeOp, afterOp, beforePathParams, afterPathParams, opLabel));

  const beforeRequestSchema = beforeOp.requestBody?.content?.[JSON_MEDIA_TYPE]?.schema;
  const afterRequestSchema = afterOp.requestBody?.content?.[JSON_MEDIA_TYPE]?.schema;
  if (beforeRequestSchema && afterRequestSchema) {
    changes.push(
      ...diffSchema(beforeRequestSchema, afterRequestSchema, `${opLabel} requestBody`, {
        beforeDoc,
        afterDoc,
        mode: "request",
      }),
    );
  }
  // A request body added/removed entirely (present on only one side) is out
  // of scope — see README "Limitations".

  const beforeResponses = beforeOp.responses ?? {};
  const afterResponses = afterOp.responses ?? {};
  const allStatusCodes = new Set([...Object.keys(beforeResponses), ...Object.keys(afterResponses)]);

  for (const code of allStatusCodes) {
    const beforeResponse = beforeResponses[code];
    const afterResponse = afterResponses[code];
    if (!beforeResponse || !afterResponse) {
      // A status code added/removed entirely is out of scope — see README
      // "Limitations".
      continue;
    }

    const beforeSchema = beforeResponse.content?.[JSON_MEDIA_TYPE]?.schema;
    const afterSchema = afterResponse.content?.[JSON_MEDIA_TYPE]?.schema;
    if (beforeSchema && afterSchema) {
      changes.push(
        ...diffSchema(beforeSchema, afterSchema, `${opLabel} responses.${code}`, {
          beforeDoc,
          afterDoc,
          mode: "response",
        }),
      );
    }
  }

  return changes;
}

function diffPathItem(
  beforeItem: PathItemObject,
  afterItem: PathItemObject,
  pathKey: string,
  beforeDoc: OpenAPIDocument,
  afterDoc: OpenAPIDocument,
): Change[] {
  const changes: Change[] = [];

  for (const method of HTTP_METHODS) {
    const beforeOp = beforeItem[method];
    const afterOp = afterItem[method];
    const opLabel = `${method.toUpperCase()} ${pathKey}`;

    if (beforeOp && !afterOp) {
      changes.push({
        severity: "breaking",
        category: "operation-removed",
        path: opLabel,
        message: `Operation '${opLabel}' was removed`,
      });
      continue;
    }

    if (!beforeOp && afterOp) {
      changes.push({
        severity: "safe",
        category: "operation-added",
        path: opLabel,
        message: `Operation '${opLabel}' was added`,
      });
      continue;
    }

    if (beforeOp && afterOp) {
      changes.push(
        ...diffOperation(
          beforeOp,
          afterOp,
          beforeItem.parameters ?? [],
          afterItem.parameters ?? [],
          opLabel,
          beforeDoc,
          afterDoc,
        ),
      );
    }
  }

  return changes;
}

/** Diff `paths` (and everything nested under each path/operation) between two OpenAPI documents. */
export function diffPaths(before: OpenAPIDocument, after: OpenAPIDocument): Change[] {
  const changes: Change[] = [];
  const beforePaths = before.paths ?? {};
  const afterPaths = after.paths ?? {};
  const allPaths = new Set([...Object.keys(beforePaths), ...Object.keys(afterPaths)]);

  for (const p of allPaths) {
    const beforeItem = beforePaths[p];
    const afterItem = afterPaths[p];

    if (beforeItem && !afterItem) {
      changes.push({
        severity: "breaking",
        category: "path-removed",
        path: p,
        message: `Path '${p}' was removed`,
      });
      continue;
    }

    if (!beforeItem && afterItem) {
      changes.push({
        severity: "safe",
        category: "path-added",
        path: p,
        message: `Path '${p}' was added`,
      });
      continue;
    }

    if (beforeItem && afterItem) {
      changes.push(...diffPathItem(beforeItem, afterItem, p, before, after));
    }
  }

  return changes;
}

/**
 * Diff `components.schemas` for whole-schema removals. Only an
 * existence check is performed (a schema present in `before` and absent in
 * `after` is reported) — full reference-graph analysis of who still points
 * at a removed schema is out of scope.
 */
export function diffComponentSchemas(before: OpenAPIDocument, after: OpenAPIDocument): Change[] {
  const changes: Change[] = [];
  const beforeSchemas = before.components?.schemas ?? {};
  const afterSchemas = after.components?.schemas ?? {};

  for (const name of Object.keys(beforeSchemas)) {
    if (!(name in afterSchemas)) {
      changes.push({
        severity: "breaking",
        category: "schema-removed",
        path: `components.schemas.${name}`,
        message: `Schema '${name}' was removed from components.schemas`,
      });
    }
  }

  return changes;
}
