import type { Change, OpenAPIDocument, SchemaObject } from "./types.js";
import { resolveSchema } from "./parse.js";

/**
 * Which side of an operation a schema belongs to. This changes the polarity
 * of a couple of rules:
 *  - request bodies: a field newly added to `required[]` is BREAKING
 *    (existing clients that don't send it will now fail validation).
 *  - response bodies: a field newly added to `required[]` is a NON-BREAKING
 *    (strictly stronger) guarantee; conversely a field *removed* from
 *    `required[]` is BREAKING for a response (clients depending on it being
 *    present may break) but is NON-BREAKING for a request (the server is
 *    simply accepting a wider range of valid requests than before).
 */
export type SchemaContext = "request" | "response";

export interface DiffCtx {
  beforeDoc: OpenAPIDocument;
  afterDoc: OpenAPIDocument;
  mode: SchemaContext;
}

/**
 * Merge `allOf` branches into a shallow "effective" schema so that
 * comparisons see the combined set of `properties`/`required` regardless of
 * whether a document expresses them directly or via `allOf` composition.
 *
 * This is intentionally best-effort: `oneOf`/`anyOf` are NOT expanded or
 * merged (there is no single "effective" shape for a union), so changes that
 * live purely inside a `oneOf`/`anyOf` branch are not detected. See the
 * README "Limitations" section.
 */
function effectiveSchema(schema: SchemaObject, doc: OpenAPIDocument): SchemaObject {
  const allOf = schema.allOf;
  if (!allOf || allOf.length === 0) {
    return schema;
  }

  const mergedProperties: Record<string, SchemaObject> = { ...(schema.properties ?? {}) };
  const mergedRequired = new Set(schema.required ?? []);
  let mergedType = schema.type;

  for (const member of allOf) {
    const resolvedMember = resolveSchema(doc, member);
    if (!resolvedMember) {
      continue;
    }
    const flattenedMember = effectiveSchema(resolvedMember, doc);

    for (const [key, value] of Object.entries(flattenedMember.properties ?? {})) {
      mergedProperties[key] = value;
    }
    for (const requiredKey of flattenedMember.required ?? []) {
      mergedRequired.add(requiredKey);
    }
    if (mergedType === undefined && flattenedMember.type !== undefined) {
      mergedType = flattenedMember.type;
    }
  }

  const merged: SchemaObject = { ...schema, type: mergedType, properties: mergedProperties, required: Array.from(mergedRequired) };
  delete merged.allOf;
  return merged;
}

function isExtraPropertiesAllowed(additionalProperties: boolean | SchemaObject | undefined): boolean {
  return additionalProperties === undefined || additionalProperties === true || typeof additionalProperties === "object";
}

/** Diff a numeric upper-bound constraint (e.g. `maxLength`, `maximum`). A lower value, or one newly introduced, is a tightening (breaking). */
function diffUpperBound(before: number | undefined, after: number | undefined, name: string, path: string): Change | undefined {
  if (before === after) {
    return undefined;
  }
  if (after === undefined) {
    return {
      severity: "safe",
      category: `${name}-loosened`,
      path,
      message: `${name} constraint removed (was ${String(before)})`,
      before,
    };
  }
  if (before === undefined || after < before) {
    return {
      severity: "breaking",
      category: `${name}-tightened`,
      path,
      message: `${name} ${before === undefined ? "constraint added:" : "decreased from " + String(before) + " to"} ${after}`,
      before,
      after,
    };
  }
  return {
    severity: "safe",
    category: `${name}-loosened`,
    path,
    message: `${name} increased from ${String(before)} to ${after}`,
    before,
    after,
  };
}

/** Diff a numeric lower-bound constraint (e.g. `minLength`, `minimum`). A higher value, or one newly introduced, is a tightening (breaking). */
function diffLowerBound(before: number | undefined, after: number | undefined, name: string, path: string): Change | undefined {
  if (before === after) {
    return undefined;
  }
  if (after === undefined) {
    return {
      severity: "safe",
      category: `${name}-loosened`,
      path,
      message: `${name} constraint removed (was ${String(before)})`,
      before,
    };
  }
  if (before === undefined || after > before) {
    return {
      severity: "breaking",
      category: `${name}-tightened`,
      path,
      message: `${name} ${before === undefined ? "constraint added:" : "increased from " + String(before) + " to"} ${after}`,
      before,
      after,
    };
  }
  return {
    severity: "safe",
    category: `${name}-loosened`,
    path,
    message: `${name} decreased from ${String(before)} to ${after}`,
    before,
    after,
  };
}

function diffConstraints(before: SchemaObject, after: SchemaObject, path: string): Change[] {
  const changes: Change[] = [];

  const maxLength = diffUpperBound(before.maxLength, after.maxLength, "maxLength", path);
  if (maxLength) changes.push(maxLength);

  const minLength = diffLowerBound(before.minLength, after.minLength, "minLength", path);
  if (minLength) changes.push(minLength);

  const maximum = diffUpperBound(before.maximum, after.maximum, "maximum", path);
  if (maximum) changes.push(maximum);

  const minimum = diffLowerBound(before.minimum, after.minimum, "minimum", path);
  if (minimum) changes.push(minimum);

  if (before.pattern !== after.pattern) {
    if (after.pattern === undefined) {
      changes.push({
        severity: "safe",
        category: "pattern-loosened",
        path,
        message: `pattern constraint removed (was ${String(before.pattern)})`,
        before: before.pattern,
      });
    } else {
      changes.push({
        severity: "breaking",
        category: "pattern-changed",
        path,
        message: `pattern ${before.pattern === undefined ? "added" : "changed"}: ${String(before.pattern)} -> ${after.pattern}`,
        before: before.pattern,
        after: after.pattern,
      });
    }
  }

  return changes;
}

function diffEnum(before: SchemaObject, after: SchemaObject, path: string): Change[] {
  if (!before.enum && !after.enum) {
    return [];
  }
  const changes: Change[] = [];
  const beforeEnum = new Set(before.enum ?? []);
  const afterEnum = new Set(after.enum ?? []);

  for (const value of beforeEnum) {
    if (!afterEnum.has(value)) {
      changes.push({
        severity: "breaking",
        category: "enum-value-removed",
        path,
        message: `Enum value ${JSON.stringify(value)} was removed; clients sending it will now be rejected`,
        before: value,
      });
    }
  }
  for (const value of afterEnum) {
    if (!beforeEnum.has(value)) {
      changes.push({
        severity: "safe",
        category: "enum-value-added",
        path,
        message: `Enum value ${JSON.stringify(value)} was added`,
        after: value,
      });
    }
  }

  return changes;
}

/**
 * Diff the `properties`/`required` of two schemas (both already resolved and
 * `allOf`-flattened). Handles added/removed properties and required-ness
 * flips; recurses into `diffSchema` for properties present on both sides.
 */
function diffProperties(before: SchemaObject, after: SchemaObject, path: string, ctx: DiffCtx): Change[] {
  const changes: Change[] = [];
  const beforeProps = before.properties ?? {};
  const afterProps = after.properties ?? {};
  const beforeRequired = new Set(before.required ?? []);
  const afterRequired = new Set(after.required ?? []);

  const allKeys = new Set([...Object.keys(beforeProps), ...Object.keys(afterProps)]);

  for (const key of allKeys) {
    const fieldPath = `${path}.properties.${key}`;
    const beforeField = beforeProps[key];
    const afterField = afterProps[key];

    if (beforeField && !afterField) {
      // Conservative rule: ANY property removal is treated as breaking,
      // whether or not it was required. See README "Limitations".
      changes.push({
        severity: "breaking",
        category: "property-removed",
        path: fieldPath,
        message: `Property '${key}' was removed`,
        before: beforeField,
      });
      continue;
    }

    if (!beforeField && afterField) {
      const isRequired = afterRequired.has(key);
      const breaking = ctx.mode === "request" && isRequired;
      changes.push({
        severity: breaking ? "breaking" : "safe",
        category: breaking ? "required-property-added" : "property-added",
        path: fieldPath,
        message: breaking
          ? `New required property '${key}' was added; existing clients that don't send it will now fail validation`
          : `New optional property '${key}' was added`,
        after: afterField,
      });
      continue;
    }

    if (beforeField && afterField) {
      changes.push(...diffSchema(beforeField, afterField, fieldPath, ctx));

      const wasRequired = beforeRequired.has(key);
      const isRequired = afterRequired.has(key);
      if (wasRequired !== isRequired) {
        if (ctx.mode === "request") {
          if (!wasRequired && isRequired) {
            changes.push({
              severity: "breaking",
              category: "field-now-required",
              path: fieldPath,
              message: `Property '${key}' is now required; existing clients that don't send it will now fail validation`,
            });
          } else {
            changes.push({
              severity: "safe",
              category: "field-now-optional",
              path: fieldPath,
              message: `Property '${key}' is no longer required`,
            });
          }
        } else {
          if (wasRequired && !isRequired) {
            changes.push({
              severity: "breaking",
              category: "field-no-longer-guaranteed",
              path: fieldPath,
              message: `Property '${key}' is no longer guaranteed to be present in the response`,
            });
          } else {
            changes.push({
              severity: "safe",
              category: "field-now-guaranteed",
              path: fieldPath,
              message: `Property '${key}' is now guaranteed to be present in the response (added to required)`,
            });
          }
        }
      }
    }
  }

  return changes;
}

/**
 * Recursively compare two schemas (each possibly a `$ref`) and return the
 * list of changes between them. `path` is a human-readable breadcrumb (e.g.
 * `POST /users requestBody.properties.email`) used to label each Change.
 *
 * Resolves `$ref` on both sides (against their own document) before
 * comparing, and merges `allOf` branches into an effective shape — see
 * `effectiveSchema`. If either side fails to resolve (missing/out-of-scope
 * ref), no changes are reported for that subtree.
 */
export function diffSchema(
  beforeRaw: SchemaObject | undefined,
  afterRaw: SchemaObject | undefined,
  path: string,
  ctx: DiffCtx,
): Change[] {
  const beforeResolved = resolveSchema(ctx.beforeDoc, beforeRaw);
  const afterResolved = resolveSchema(ctx.afterDoc, afterRaw);

  if (!beforeResolved || !afterResolved) {
    return [];
  }

  const before = effectiveSchema(beforeResolved, ctx.beforeDoc);
  const after = effectiveSchema(afterResolved, ctx.afterDoc);

  const changes: Change[] = [];

  if (before.type !== undefined && after.type !== undefined && before.type !== after.type) {
    changes.push({
      severity: "breaking",
      category: "type-changed",
      path,
      message: `Type changed from '${before.type}' to '${after.type}'`,
      before: before.type,
      after: after.type,
    });
  }

  changes.push(...diffEnum(before, after, path));
  changes.push(...diffConstraints(before, after, path));

  const beforeAllowsExtra = isExtraPropertiesAllowed(before.additionalProperties);
  const afterAllowsExtra = isExtraPropertiesAllowed(after.additionalProperties);
  if (beforeAllowsExtra && !afterAllowsExtra) {
    changes.push({
      severity: "breaking",
      category: "additional-properties-disallowed",
      path,
      message: "additionalProperties changed to false; previously-accepted extra fields will now be rejected",
    });
  }

  if (before.properties || after.properties) {
    changes.push(...diffProperties(before, after, path, ctx));
  }

  if (before.items && after.items) {
    changes.push(...diffSchema(before.items, after.items, `${path}[]`, ctx));
  }
  // Array `items` added or removed entirely (e.g. type stopped/started being
  // an array) is out of scope — see README "Limitations".

  return changes;
}
