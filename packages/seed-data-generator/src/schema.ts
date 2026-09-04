/**
 * Shared internal schema representation, produced identically by both the
 * Prisma parser (src/prismaParser.ts) and the Drizzle-JSON parser
 * (src/drizzleJson.ts), and consumed by the generator (src/generate.ts).
 */

/** `@relation(fields: [...], references: [...])` info on a belongs-to field. */
export interface RelationInfo {
  fields: string[];
  references: string[];
}

export interface FieldAttributes {
  /** `@id` */
  id?: boolean;
  /** `@unique` */
  unique?: boolean;
  /**
   * Raw default expression, e.g. "autoincrement()", "now()", "USER",
   * a quoted string literal, or a bare number literal as written in the
   * schema. Not evaluated/interpreted beyond a few special-cased tokens
   * ("autoincrement()", "now()") used by the generator.
   */
  default?: string;
  /** Present only on the "belongs-to" relation field itself (not on the FK scalar column). */
  relation?: RelationInfo;
}

export interface FieldDef {
  name: string;
  /** Raw type name as written in the schema, e.g. "String", "Int", "Post", "Role". */
  type: string;
  /** Whether the type had a trailing `[]` (has-many / list field). */
  isArray: boolean;
  /** Whether the type had a trailing `?` (optional field). */
  isOptional: boolean;
  attributes: FieldAttributes;
}

export interface ModelDef {
  name: string;
  fields: FieldDef[];
}

export interface EnumDef {
  name: string;
  values: string[];
}

export interface ParsedSchema {
  enums: EnumDef[];
  models: ModelDef[];
}

/** Prisma/Drizzle-JSON scalar type names recognized by this tool. */
export const SCALAR_TYPES = new Set([
  "String",
  "Int",
  "Float",
  "Boolean",
  "DateTime",
  "Json",
  "BigInt",
  "Decimal",
]);

export function isScalarType(typeName: string): boolean {
  return SCALAR_TYPES.has(typeName);
}

export function isEnumType(schema: ParsedSchema, typeName: string): boolean {
  return schema.enums.some((e) => e.name === typeName);
}

export function isModelType(schema: ParsedSchema, typeName: string): boolean {
  return schema.models.some((m) => m.name === typeName);
}

export function findEnum(schema: ParsedSchema, typeName: string): EnumDef | undefined {
  return schema.enums.find((e) => e.name === typeName);
}

export function findModel(schema: ParsedSchema, modelName: string): ModelDef | undefined {
  return schema.models.find((m) => m.name === modelName);
}

/**
 * Classification of a field, used by the generator to decide how (or
 * whether) to produce a value for it.
 *
 * - "scalar": a plain String/Int/Float/Boolean/DateTime/Json/BigInt/Decimal column.
 * - "enum": references an enum defined in the schema.
 * - "belongs-to": the relation *object* field itself (e.g. `author User @relation(...)`).
 *   This is not a data column — the actual FK scalar column (e.g. `authorId`)
 *   is a separate "scalar" field, looked up via relation.fields.
 * - "has-many": the inverse list side of a relation (e.g. `posts Post[]`).
 *   Never generates a column.
 */
export type FieldKind = "scalar" | "enum" | "belongs-to" | "has-many";

export function classifyField(schema: ParsedSchema, field: FieldDef): FieldKind {
  // Checked before `isModelType`: a field carrying an explicit `@relation`
  // attribute is always the belongs-to side, even if its referenced model
  // isn't present in this schema (e.g. a subset schema for testing, or a
  // model defined in another file) - `isModelType` alone would silently
  // misclassify it as a plain scalar and skip FK handling entirely.
  if (field.attributes.relation) return "belongs-to";
  if (isModelType(schema, field.type)) {
    if (field.isArray) return "has-many";
    // A non-array model-typed field with no @relation attribute is unusual
    // (Prisma requires @relation on one side of a 1:1 too) but treat it the
    // same as "belongs-to" so it's skipped rather than mis-generated as a scalar.
    return "belongs-to";
  }
  if (isEnumType(schema, field.type)) return "enum";
  return "scalar";
}

/**
 * Map of FK scalar field name -> { parentModel, referencedField } for a model,
 * derived from its fields' `@relation(fields: [...], references: [...])` attributes.
 */
export function buildForeignKeyMap(
  schema: ParsedSchema,
  model: ModelDef,
): Map<string, { parentModel: string; referencedField: string }> {
  const map = new Map<string, { parentModel: string; referencedField: string }>();
  for (const field of model.fields) {
    if (classifyField(schema, field) !== "belongs-to") continue;
    const relation = field.attributes.relation;
    if (!relation) continue;
    const parentModel = field.type;
    for (let i = 0; i < relation.fields.length; i++) {
      const fkFieldName = relation.fields[i];
      if (fkFieldName === undefined) continue;
      const referencedField = relation.references[i] ?? "id";
      map.set(fkFieldName, { parentModel, referencedField });
    }
  }
  return map;
}

/**
 * Topologically sort models so that a model referenced by another model's
 * `@relation` (the "parent") comes before the model holding the FK (the
 * "child"). Uses Kahn's algorithm.
 *
 * Cycle handling: if a cycle exists (e.g. two models each with a required FK
 * to the other), Kahn's algorithm will stall with nodes of non-zero in-degree
 * remaining. Rather than infinite-looping or throwing, we just append the
 * remaining nodes in their original declaration order — this arbitrarily
 * "breaks" the cycle at whatever point it stalls. This is a documented
 * simplification; robust cycle-breaking is out of scope for this tool.
 */
export function orderModelsByDependency(schema: ParsedSchema): ModelDef[] {
  const models = schema.models;
  const nameToModel = new Map(models.map((m) => [m.name, m] as const));

  // edge: parent -> child (parent must be generated first)
  const dependents = new Map<string, Set<string>>(); // parent -> set of children
  const inDegree = new Map<string, number>();
  for (const m of models) {
    dependents.set(m.name, new Set());
    inDegree.set(m.name, 0);
  }

  for (const model of models) {
    const fkMap = buildForeignKeyMap(schema, model);
    const parentsSeen = new Set<string>();
    for (const { parentModel } of fkMap.values()) {
      if (parentModel === model.name) continue; // self-relation: don't self-block
      if (!nameToModel.has(parentModel)) continue; // unresolved reference, ignore
      if (parentsSeen.has(parentModel)) continue; // avoid double-counting multiple FKs to same parent
      parentsSeen.add(parentModel);
      const set = dependents.get(parentModel);
      if (set) set.add(model.name);
      inDegree.set(model.name, (inDegree.get(model.name) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const m of models) {
    if ((inDegree.get(m.name) ?? 0) === 0) queue.push(m.name);
  }

  const orderedNames: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined) break;
    if (visited.has(name)) continue;
    visited.add(name);
    orderedNames.push(name);
    const children = dependents.get(name);
    if (!children) continue;
    for (const child of children) {
      const remaining = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, remaining);
      if (remaining <= 0 && !visited.has(child)) queue.push(child);
    }
  }

  // Cycle fallback: append any models not yet placed, in original order.
  if (orderedNames.length < models.length) {
    for (const m of models) {
      if (!visited.has(m.name)) {
        orderedNames.push(m.name);
        visited.add(m.name);
      }
    }
  }

  const result: ModelDef[] = [];
  for (const name of orderedNames) {
    const m = nameToModel.get(name);
    if (m) result.push(m);
  }
  return result;
}
