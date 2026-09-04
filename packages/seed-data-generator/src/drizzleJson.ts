import type { EnumDef, FieldAttributes, FieldDef, ModelDef, ParsedSchema, RelationInfo } from "./schema.js";

/**
 * Parses the Drizzle-export JSON convention (see README.md for the full
 * documented shape) into the same `ParsedSchema` representation the Prisma
 * parser produces, so the generator logic is fully shared.
 *
 * This does NOT parse Drizzle TypeScript schema files directly — it expects
 * a small JSON export you write yourself (or generate with a tiny script)
 * that serializes your Drizzle table definitions to this shape.
 */
export function parseDrizzleJson(jsonText: string): ParsedSchema {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Invalid JSON in Drizzle schema export: ${(err as Error).message}`);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("Drizzle schema export must be a JSON object with \"enums\" and \"models\" keys.");
  }

  const obj = raw as Record<string, unknown>;

  const enums = parseEnums(obj["enums"]);
  const models = parseModels(obj["models"]);

  return { enums, models };
}

function parseEnums(value: unknown): EnumDef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('Drizzle schema export "enums" must be an array.');
  }
  return value.map((entry, idx) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Drizzle schema export enums[${idx}] must be an object.`);
    }
    const e = entry as Record<string, unknown>;
    const name = e["name"];
    const values = e["values"];
    if (typeof name !== "string") {
      throw new Error(`Drizzle schema export enums[${idx}].name must be a string.`);
    }
    if (!Array.isArray(values) || !values.every((v) => typeof v === "string")) {
      throw new Error(`Drizzle schema export enums[${idx}].values must be an array of strings.`);
    }
    return { name, values: values as string[] };
  });
}

function parseModels(value: unknown): ModelDef[] {
  if (!Array.isArray(value)) {
    throw new Error('Drizzle schema export "models" must be an array.');
  }
  return value.map((entry, idx) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Drizzle schema export models[${idx}] must be an object.`);
    }
    const m = entry as Record<string, unknown>;
    const name = m["name"];
    const fieldsRaw = m["fields"];
    if (typeof name !== "string") {
      throw new Error(`Drizzle schema export models[${idx}].name must be a string.`);
    }
    if (!Array.isArray(fieldsRaw)) {
      throw new Error(`Drizzle schema export models[${idx}].fields must be an array.`);
    }
    const fields = fieldsRaw.map((f, fIdx) => parseField(f, name, fIdx));
    return { name, fields };
  });
}

function parseField(value: unknown, modelName: string, fieldIdx: number): FieldDef {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Drizzle schema export model "${modelName}" field[${fieldIdx}] must be an object.`);
  }
  const f = value as Record<string, unknown>;
  const name = f["name"];
  const type = f["type"];
  if (typeof name !== "string") {
    throw new Error(`Drizzle schema export model "${modelName}" field[${fieldIdx}].name must be a string.`);
  }
  if (typeof type !== "string") {
    throw new Error(`Drizzle schema export model "${modelName}" field "${name}".type must be a string.`);
  }

  const isArray = typeof f["isArray"] === "boolean" ? f["isArray"] : false;
  const isOptional = typeof f["isOptional"] === "boolean" ? f["isOptional"] : false;
  const attributes = parseAttributes(f["attributes"], modelName, name);

  return { name, type, isArray, isOptional, attributes };
}

function parseAttributes(value: unknown, modelName: string, fieldName: string): FieldAttributes {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null) {
    throw new Error(`Drizzle schema export model "${modelName}" field "${fieldName}".attributes must be an object.`);
  }
  const a = value as Record<string, unknown>;
  const attributes: FieldAttributes = {};

  if (typeof a["id"] === "boolean") attributes.id = a["id"];
  if (typeof a["unique"] === "boolean") attributes.unique = a["unique"];
  if (typeof a["default"] === "string") attributes.default = a["default"];
  if (a["relation"] !== undefined) {
    attributes.relation = parseRelation(a["relation"], modelName, fieldName);
  }

  return attributes;
}

function parseRelation(value: unknown, modelName: string, fieldName: string): RelationInfo {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Drizzle schema export model "${modelName}" field "${fieldName}".attributes.relation must be an object.`);
  }
  const r = value as Record<string, unknown>;
  const fields = r["fields"];
  const references = r["references"];
  if (!Array.isArray(fields) || !fields.every((v) => typeof v === "string")) {
    throw new Error(
      `Drizzle schema export model "${modelName}" field "${fieldName}".attributes.relation.fields must be an array of strings.`,
    );
  }
  if (!Array.isArray(references) || !references.every((v) => typeof v === "string")) {
    throw new Error(
      `Drizzle schema export model "${modelName}" field "${fieldName}".attributes.relation.references must be an array of strings.`,
    );
  }
  return { fields: fields as string[], references: references as string[] };
}
