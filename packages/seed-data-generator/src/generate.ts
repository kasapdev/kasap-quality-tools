import {
  buildForeignKeyMap,
  classifyField,
  findEnum,
  orderModelsByDependency,
  type FieldDef,
  type ParsedSchema,
} from "./schema.js";
import {
  UniqueValueTracker,
  generateNumberByHeuristic,
  generateStringByHeuristic,
  nowIso,
  randomBoolean,
  randomDateIso,
  randomUuid,
  type RandomFn,
} from "./generators/generic.js";
import { pickFrom } from "./generators/turkish.js";

/**
 * Either a flat row count applied to every model, or a per-model map (model
 * name -> count) for fine-grained control. Produced from a CLI `--count`
 * value by `parseCountOption`.
 */
export type CountOption = number | Record<string, number>;

export interface GenerateOptions {
  /** Rows to generate per model. Defaults to 10. See `CountOption`. */
  count?: CountOption;
  /**
   * Fallback row count for a model not named in a per-model `count` map.
   * Ignored when `count` is a flat number. Defaults to 10.
   */
  defaultCount?: number;
  /** Injectable PRNG (defaults to Math.random). Useful for deterministic tests. */
  random?: RandomFn;
}

export type GeneratedData = Record<string, Record<string, unknown>[]>;

/**
 * Parses a CLI `--count` value into a `CountOption`: a bare non-negative
 * integer ("25") is a flat count applied to every model; a comma-separated
 * list of `Model=count` pairs ("User=50,Post=200") sets a specific count
 * per model — any model left unmentioned falls back to `defaultCount` in
 * `GenerateOptions` (default 10) when the data is actually generated.
 */
export function parseCountOption(raw: string): CountOption {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const segments = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error(
      `Invalid --count value "${raw}". Use a non-negative integer ("10") or comma-separated ` +
        'Model=count pairs ("User=50,Post=200").',
    );
  }

  const perModel: Record<string, number> = {};
  for (const segment of segments) {
    const eqIndex = segment.indexOf("=");
    const modelName = eqIndex === -1 ? "" : segment.slice(0, eqIndex).trim();
    const countText = eqIndex === -1 ? "" : segment.slice(eqIndex + 1).trim();
    if (!modelName || !/^\d+$/.test(countText)) {
      throw new Error(`Invalid --count segment "${segment}". Expected "ModelName=<non-negative integer>".`);
    }
    perModel[modelName] = Number.parseInt(countText, 10);
  }
  return perModel;
}

function resolveCountForModel(count: CountOption, defaultCount: number, modelName: string): number {
  return typeof count === "number" ? count : (count[modelName] ?? defaultCount);
}

/**
 * Generates seed data for every model in `schema`, in dependency order
 * (parents before children), so foreign-key fields can be populated from
 * already-generated parent rows.
 */
export function generateSeedData(schema: ParsedSchema, options: GenerateOptions = {}): GeneratedData {
  const rand = options.random ?? Math.random;
  const countOption = options.count ?? 10;
  const defaultCount = options.defaultCount ?? 10;

  const order = orderModelsByDependency(schema);
  const generated: GeneratedData = {};

  for (const model of order) {
    const count = resolveCountForModel(countOption, defaultCount, model.name);
    const fkMap = buildForeignKeyMap(schema, model);
    const uniqueTrackers = new Map<string, UniqueValueTracker>();
    let autoIncCounter = 1;
    const rows: Record<string, unknown>[] = [];

    for (let rowIndex = 0; rowIndex < count; rowIndex++) {
      const row: Record<string, unknown> = {};

      for (const field of model.fields) {
        const kind = classifyField(schema, field);
        // "has-many" list fields and the belongs-to relation *object* field
        // itself never produce a data column (see src/schema.ts docs).
        if (kind === "has-many" || kind === "belongs-to") continue;

        const fk = fkMap.get(field.name);
        if (fk) {
          const parentRows = generated[fk.parentModel];
          if (!parentRows || parentRows.length === 0) {
            throw new Error(
              `Cannot generate FK value for "${model.name}.${field.name}": parent model "${fk.parentModel}" ` +
                `has no generated rows (count is 0, or the parent model was not found in the schema).`,
            );
          }
          const parentRow = pickFrom(parentRows, rand);
          row[field.name] = parentRow[fk.referencedField];
          continue;
        }

        if (field.attributes.id) {
          row[field.name] = generateIdValue(field, () => autoIncCounter++);
          continue;
        }

        if (kind === "enum") {
          const enumDef = findEnum(schema, field.type);
          row[field.name] = enumDef ? pickFrom(enumDef.values, rand) : null;
          continue;
        }

        row[field.name] = generateScalarValue(field, rand, uniqueTrackers);
      }

      rows.push(row);
    }

    generated[model.name] = rows;
  }

  return generated;
}

/**
 * `@id` field: `String` type -> UUID (no autoincrement concept for strings).
 * Anything else (Int/BigInt/etc, with or without an explicit
 * `@default(autoincrement())`) -> a sequential integer starting at 1, per
 * the documented simplification in the task spec.
 */
function generateIdValue(field: FieldDef, nextSequence: () => number): unknown {
  if (field.type === "String") {
    return randomUuid();
  }
  return nextSequence();
}

function generateScalarValue(
  field: FieldDef,
  rand: RandomFn,
  uniqueTrackers: Map<string, UniqueValueTracker>,
): unknown {
  switch (field.type) {
    case "Boolean":
      return randomBoolean(rand);
    case "Int":
    case "Float":
    case "Decimal":
    case "BigInt":
      return generateNumberByHeuristic(field.name, field.type, rand);
    case "DateTime":
      if (field.attributes.default === "now()") return nowIso();
      return randomDateIso(rand);
    case "Json":
      return {};
    case "String":
    default:
      return generateStringField(field, rand, uniqueTrackers);
  }
}

function generateStringField(
  field: FieldDef,
  rand: RandomFn,
  uniqueTrackers: Map<string, UniqueValueTracker>,
): string {
  if (!field.attributes.unique) {
    return generateStringByHeuristic(field.name, rand);
  }

  let tracker = uniqueTrackers.get(field.name);
  if (!tracker) {
    tracker = new UniqueValueTracker();
    uniqueTrackers.set(field.name, tracker);
  }
  return tracker.take(() => generateStringByHeuristic(field.name, rand));
}
