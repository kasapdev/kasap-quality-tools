import type { EnumDef, FieldAttributes, FieldDef, ModelDef, ParsedSchema, RelationInfo } from "./schema.js";

/**
 * A careful line-based parser for a reasonable subset of Prisma schema
 * syntax. Not a full grammar/AST parser — it assumes one field per line and
 * that model/enum blocks are not nested (true for standard Prisma schemas).
 *
 * Supported:
 *  - `enum Name { VALUE1 VALUE2 }` blocks (one value per line, or several
 *    per line separated by whitespace).
 *  - `model Name { ...fields... }` blocks.
 *  - Field lines: `name Type[]? @attr @attr(args) ...`
 *  - `@id`, `@unique`, `@default(...)`, `@relation(fields: [...], references: [...])`.
 *  - `//` line comments (stripped before parsing, best-effort outside of
 *    quoted strings).
 *
 * Explicitly NOT supported (documented limitation, see README):
 *  - `@@` block-level attributes (e.g. `@@map(...)`, `@@unique([...])`) —
 *    these lines are simply skipped rather than parsed.
 *  - `datasource` / `generator` blocks are ignored (not scanned for fields).
 *  - Composite types, multi-line field attribute lists spanning >1 line.
 */
export function parsePrismaSchema(source: string): ParsedSchema {
  const lines = stripComments(source).split(/\r?\n/);

  const enums: EnumDef[] = [];
  const models: ModelDef[] = [];

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();

    const enumMatch = /^enum\s+(\w+)\s*\{/.exec(line);
    const modelMatch = /^model\s+(\w+)\s*\{/.exec(line);

    if (enumMatch) {
      const name = enumMatch[1] ?? "";
      const { body, nextIndex } = collectBlockBody(lines, i);
      enums.push({ name, values: parseEnumBody(body) });
      i = nextIndex;
      continue;
    }

    if (modelMatch) {
      const name = modelMatch[1] ?? "";
      const { body, nextIndex } = collectBlockBody(lines, i);
      models.push({ name, fields: parseModelBody(body) });
      i = nextIndex;
      continue;
    }

    i++;
  }

  return { enums, models };
}

/** Strip `//` line comments, best-effort respecting simple single/double-quoted strings. */
function stripComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let idx = 0; idx < line.length; idx++) {
        const ch = line[idx];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === "/" && line[idx + 1] === "/" && !inSingle && !inDouble) {
          return line.slice(0, idx);
        }
      }
      return line;
    })
    .join("\n");
}

/**
 * Given lines[] and the index of a line containing the opening `{` of a
 * block, collect the body lines up to (not including) the matching closing
 * `}` line. Assumes no nested `{ }` blocks within (true for enum/model
 * bodies in this subset — `@relation(...)`/`@default(...)` use parens, not
 * braces).
 */
function collectBlockBody(lines: string[], openIndex: number): { body: string[]; nextIndex: number } {
  const body: string[] = [];
  let i = openIndex + 1;
  while (i < lines.length) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "}" || trimmed.startsWith("}")) {
      return { body, nextIndex: i + 1 };
    }
    body.push(lines[i] ?? "");
    i++;
  }
  return { body, nextIndex: i };
}

function parseEnumBody(body: string[]): string[] {
  const values: string[] = [];
  for (const rawLine of body) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("@@")) continue;
    for (const token of line.split(/\s+/)) {
      const cleaned = token.replace(/,$/, "").trim();
      if (cleaned) values.push(cleaned);
    }
  }
  return values;
}

function parseModelBody(body: string[]): FieldDef[] {
  const fields: FieldDef[] = [];
  for (const rawLine of body) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("@@")) continue; // block-level attributes: out of scope, skip

    const field = parseFieldLine(line);
    if (field) fields.push(field);
  }
  return fields;
}

/** Matches: `<name> <Type>[]? <rest of line: attributes>` */
const FIELD_LINE_RE = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/;

function parseFieldLine(line: string): FieldDef | null {
  const match = FIELD_LINE_RE.exec(line);
  if (!match) return null;

  const name = match[1] ?? "";
  const type = match[2] ?? "";
  const isArray = match[3] === "[]";
  const isOptional = match[4] === "?";
  const rest = match[5] ?? "";

  const attributes = parseAttributes(rest);

  return { name, type, isArray, isOptional, attributes };
}

/**
 * Extracts the text between a `(` at `openIndex` and its matching `)`,
 * tracking paren depth so a nested call like `autoincrement()` inside
 * `@default(...)` doesn't prematurely close the outer attribute's args.
 * Returns the parsed args text and the index just past the matching `)`.
 */
function readBalancedParens(text: string, openIndex: number): { args: string; nextIndex: number } {
  let depth = 0;
  let j = openIndex;
  for (; j < text.length; j++) {
    if (text[j] === "(") depth++;
    else if (text[j] === ")") {
      depth--;
      if (depth === 0) {
        return { args: text.slice(openIndex + 1, j), nextIndex: j + 1 };
      }
    }
  }
  // Unbalanced input (shouldn't happen for valid Prisma schemas): take the
  // rest of the text rather than looping forever.
  return { args: text.slice(openIndex + 1), nextIndex: text.length };
}

/** Parses `@id @unique @default(autoincrement()) @relation(fields: [x], references: [y])` style attribute text. */
function parseAttributes(text: string): FieldAttributes {
  const attributes: FieldAttributes = {};
  const nameRe = /@(\w+)/g;
  let m: RegExpExecArray | null;

  while ((m = nameRe.exec(text)) !== null) {
    const attrName = m[1] ?? "";
    let argsRaw: string | undefined;

    if (text[nameRe.lastIndex] === "(") {
      const { args, nextIndex } = readBalancedParens(text, nameRe.lastIndex);
      argsRaw = args;
      nameRe.lastIndex = nextIndex; // resume scanning after the balanced `)`, not mid-args
    }

    if (attrName === "id") {
      attributes.id = true;
    } else if (attrName === "unique") {
      attributes.unique = true;
    } else if (attrName === "default") {
      attributes.default = (argsRaw ?? "").trim();
    } else if (attrName === "relation") {
      attributes.relation = parseRelationArgs(argsRaw ?? "");
    }
    // Unknown attributes (e.g. @map, @db.VarChar(255)) are ignored.
  }
  return attributes;
}

function parseRelationArgs(argsText: string): RelationInfo {
  const fieldsMatch = /fields\s*:\s*\[([^\]]*)\]/.exec(argsText);
  const referencesMatch = /references\s*:\s*\[([^\]]*)\]/.exec(argsText);

  const fields = fieldsMatch ? splitCommaList(fieldsMatch[1] ?? "") : [];
  const references = referencesMatch ? splitCommaList(referencesMatch[1] ?? "") : [];

  return { fields, references };
}

function splitCommaList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
