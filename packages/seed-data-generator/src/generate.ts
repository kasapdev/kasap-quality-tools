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

export interface GenerateOptions {
  /** Rows to generate per model. Defaults to 10. */
  count?: number;
  /** Injectable PRNG (defaults to Math.random). Useful for deterministic tests. */
  random?: RandomFn;
}

export type GeneratedData = Record<string, Record<string, unknown>[]>;

/**
 * Generates seed data for every model in `schema`, in dependency order
 * (parents before children), so foreign-key fields can be populated from
 * already-generated parent rows.
 */
export function generateSeedData(schema: ParsedSchema, options: GenerateOptions = {}): GeneratedData {
  const rand = options.random ?? Math.random;
  const count = options.count ?? 10;

  const order = orderModelsByDependency(schema);
  const generated: GeneratedData = {};

  for (const model of order) {
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
