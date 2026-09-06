#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { parseDrizzleJson } from "./drizzleJson.js";
import { generateSeedData, parseCountOption, type CountOption } from "./generate.js";
import { formatData, type OutputFormat } from "./output.js";
import { parsePrismaSchema } from "./prismaParser.js";
import type { ParsedSchema } from "./schema.js";

interface CliOptions {
  schema?: string;
  schemaJson?: string;
  count: string;
  format: string;
  out?: string;
}

const program = new Command();

program
  .name("seed-data-generator")
  .description(
    "Generate realistic fake seed data (JSON or SQL INSERT statements) from a Prisma schema file or a Drizzle JSON export.",
  )
  .option("--schema <file>", "Path to a Prisma schema (.prisma) file")
  .option("--schema-json <file>", "Path to a Drizzle-export JSON schema file")
  .option(
    "--count <spec>",
    'Rows to generate per model: a flat number ("10"), or comma-separated Model=count pairs ' +
      '("User=50,Post=200") -- models left unmentioned in the per-model form default to 10',
    "10",
  )
  .option("--format <format>", "Output format: json | sql", "json")
  .option("--out <file>", "Write output to a file instead of stdout")
  .action((options: CliOptions) => {
    run(options);
  });

program.parse(process.argv);

function run(options: CliOptions): void {
  if (!options.schema && !options.schemaJson) {
    console.error("Error: exactly one of --schema <file.prisma> or --schema-json <file.json> is required.");
    process.exitCode = 1;
    return;
  }
  if (options.schema && options.schemaJson) {
    console.error("Error: pass only one of --schema or --schema-json, not both.");
    process.exitCode = 1;
    return;
  }

  let format: OutputFormat;
  if (options.format === "sql") {
    format = "sql";
  } else if (options.format === "json") {
    format = "json";
  } else {
    console.error(`Error: --format must be "json" or "sql" (got "${options.format}").`);
    process.exitCode = 1;
    return;
  }

  let count: CountOption;
  try {
    count = parseCountOption(options.count);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  let schema: ParsedSchema;
  try {
    if (options.schema) {
      const source = readFileSync(options.schema, "utf8");
      schema = parsePrismaSchema(source);
    } else {
      const source = readFileSync(options.schemaJson as string, "utf8");
      schema = parseDrizzleJson(source);
    }
  } catch (err) {
    console.error(`Error reading/parsing schema: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (typeof count !== "number") {
    const modelNames = new Set(schema.models.map((m) => m.name));
    const unknownModels = Object.keys(count).filter((name) => !modelNames.has(name));
    if (unknownModels.length > 0) {
      console.error(`Error: --count references model(s) not found in the schema: ${unknownModels.join(", ")}.`);
      process.exitCode = 1;
      return;
    }
  }

  let output: string;
  try {
    const data = generateSeedData(schema, { count });
    output = formatData(data, format);
  } catch (err) {
    console.error(`Error generating seed data: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (options.out) {
    writeFileSync(options.out, output, "utf8");
  } else {
    console.log(output);
  }
}
