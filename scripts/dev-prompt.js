"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeTextAtomic } = require("./lib/atomic-file");
const { parseCliArgs } = require("./loop-args");

const SECTION_NAMES = Object.freeze([
  "Outcome",
  "Scope and exclusions",
  "Inputs and context",
  "Acceptance criteria",
  "Applicable repository rules",
  "Authorized actions",
  "Required evidence",
  "Stop conditions",
  "Result schema",
]);

function countWords(text) {
  const normalized = String(text || "").trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

function buildWorkerPrompt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("worker prompt input must be an object");
  }

  const outcome = requiredText(input.outcome, "outcome");
  const scope = requiredItems(input.scope, "scope");
  const exclusions = items(input.exclusions);
  const inputs = requiredItems(input.inputs, "inputs");
  const context = requiredText(input.context, "context");
  const phaseContract = requiredText(input.phaseContract, "phaseContract");
  const acceptanceCriteria = requiredItems(input.acceptanceCriteria, "acceptanceCriteria");
  const repositoryRules = requiredItems(input.repositoryRules, "repositoryRules");
  const authority = authorityLines(input.authority);
  const evidence = requiredItems(input.evidence, "evidence");
  const stopConditions = requiredItems(input.stopConditions, "stopConditions");
  const resultSchema = normalizeResultSchema(input.resultSchema);

  const sections = [
    section("Outcome", outcome),
    section(
      "Scope and exclusions",
      [
        "In scope:",
        bulletList(scope),
        "",
        "Excluded:",
        bulletList(exclusions, "None specified."),
      ].join("\n")
    ),
    section(
      "Inputs and context",
      [
        bulletList(inputs),
        "",
        `Context: ${context}`,
        "",
        "Active phase contract:",
        phaseContract,
      ].join("\n")
    ),
    section("Acceptance criteria", bulletList(acceptanceCriteria)),
    section("Applicable repository rules", bulletList(repositoryRules)),
    section("Authorized actions", bulletList(authority)),
    section("Required evidence", bulletList(evidence)),
    section("Stop conditions", bulletList(stopConditions)),
    section(
      "Result schema",
      `Return JSON matching this schema:\n\n\`\`\`json\n${resultSchema}\n\`\`\``
    ),
  ];

  const prompt = sections.join("\n\n");
  return {
    prompt,
    sections: [...SECTION_NAMES],
    metrics: {
      words: countWords(prompt),
      bytes: Buffer.byteLength(prompt, "utf8"),
    },
  };
}

function section(name, body) {
  return `## ${name}\n\n${demoteEmbeddedHeadings(body)}`;
}

function demoteEmbeddedHeadings(value) {
  return String(value).replace(/^#{1,2}(?=\s)/gmu, "###");
}

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function items(value) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function requiredItems(value, name) {
  const normalized = items(value);
  if (normalized.length === 0) throw new TypeError(`${name} must contain at least one item`);
  return normalized;
}

function bulletList(values, emptyText) {
  if (values.length === 0) return emptyText || "- None";
  return values.map((value) => `- ${value}`).join("\n");
}

function authorityLines(authority) {
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
    throw new TypeError("authority must be an object");
  }
  const entries = Object.entries(authority);
  if (entries.length === 0) throw new TypeError("authority must declare at least one action");
  return entries.map(([action, allowed]) => {
    if (typeof allowed !== "boolean") throw new TypeError(`authority.${action} must be boolean`);
    return `${action}: ${allowed ? "allowed" : "denied"}`;
  });
}

function normalizeResultSchema(value) {
  if (typeof value === "string") return requiredText(value, "resultSchema");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("resultSchema must be an object or non-empty string");
  }
  return JSON.stringify(value, null, 2);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const input = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
  const result = buildWorkerPrompt(input);
  const outputPath = path.resolve(options.output);
  writeTextAtomic(outputPath, `${result.prompt}\n`, {
    directoryMode: 0o700,
    fileMode: 0o600,
  });
  process.stdout.write(`${JSON.stringify({ output: outputPath, ...result.metrics })}\n`);
  return 0;
}

function parseArgs(argv) {
  const { args: options, positionals } = parseCliArgs(argv, {
    "--input": { key: "input", type: "string" },
    "--output": { key: "output", type: "string" },
  });
  if (positionals.length > 0) throw new Error(`unexpected argument: ${positionals[0]}`);
  if (!options.input || !options.output) throw new Error("--input and --output are required");
  return options;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`dev-prompt: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  SECTION_NAMES,
  buildWorkerPrompt,
  countWords,
  main,
  parseArgs,
};
