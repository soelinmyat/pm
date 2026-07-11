#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const SECTIONS = [
  ["Objective", "objective"],
  ["Acceptance Criteria", "acceptance_criteria"],
  ["Active Phase", "phase"],
  ["Repository", "repository"],
  ["Inputs", "inputs"],
  ["Artifact Contract", "artifact_contract"],
  ["Constraints", "constraints"],
  ["Authority", "authority"],
  ["Required Evidence", "required_evidence"],
  ["Result Contract", "result_contract"],
];
const MAX_SECTION_BYTES = 16 * 1024;
const MAX_PROMPT_BYTES = 64 * 1024;

function buildRfcPrompt(packet) {
  if (!packet || typeof packet !== "object") throw new Error("RFC prompt packet is required");
  for (const field of [
    "objective",
    "acceptance_criteria",
    "phase",
    "repository",
    "inputs",
    "artifact_contract",
    "constraints",
    "authority",
    "required_evidence",
    "result_contract",
  ]) {
    if (packet[field] === undefined || packet[field] === null || packet[field] === "") {
      throw new Error(`RFC prompt packet requires ${field}`);
    }
  }
  const sections = SECTIONS.map(([title, field]) => {
    const rendered = render(packet[field]);
    const bytes = Buffer.byteLength(rendered, "utf8");
    if (bytes > MAX_SECTION_BYTES) {
      throw new Error(
        `RFC prompt section ${field} is ${bytes} bytes; limit is ${MAX_SECTION_BYTES}`
      );
    }
    return `## ${title}\n\n${rendered}`;
  });
  const prompt = `${sections.join("\n\n")}\n`;
  const totalBytes = Buffer.byteLength(prompt, "utf8");
  if (totalBytes > MAX_PROMPT_BYTES) {
    throw new Error(`RFC prompt is ${totalBytes} bytes; limit is ${MAX_PROMPT_BYTES}`);
  }
  return prompt;
}

function render(value) {
  if (Array.isArray(value)) return value.map((item) => `- ${renderScalar(item)}`).join("\n");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `- ${key}: ${renderScalar(item)}`)
      .join("\n");
  }
  return String(value);
}

function renderScalar(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function main(argv = process.argv.slice(2)) {
  const inputIndex = argv.indexOf("--input");
  const outputIndex = argv.indexOf("--output");
  if (inputIndex < 0 || !argv[inputIndex + 1]) {
    process.stderr.write("Usage: rfc-prompt.js --input packet.json [--output prompt.md]\n");
    return 2;
  }
  try {
    const packet = JSON.parse(fs.readFileSync(argv[inputIndex + 1], "utf8"));
    const prompt = buildRfcPrompt(packet);
    if (outputIndex >= 0 && argv[outputIndex + 1])
      fs.writeFileSync(argv[outputIndex + 1], prompt, { mode: 0o600 });
    else process.stdout.write(prompt);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { MAX_PROMPT_BYTES, MAX_SECTION_BYTES, buildRfcPrompt, main };
