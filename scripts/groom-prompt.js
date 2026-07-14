#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  publishPrompt,
  renderSections,
  renderValue,
} = require("./lib/workflow-runtime/prompt-packet");

const SECTIONS = [
  ["Objective", "objective"],
  ["Decision Context", "decision_context"],
  ["Active Phase", "phase"],
  ["Repository", "repository"],
  ["Inputs", "inputs"],
  ["Proposal Contract", "proposal_contract"],
  ["Questions", "questions"],
  ["Constraints", "constraints"],
  ["Authority", "authority"],
  ["Required Evidence", "required_evidence"],
  ["Result Contract", "result_contract"],
];
const MAX_SECTION_BYTES = 16 * 1024;
const MAX_PROMPT_BYTES = 64 * 1024;

function buildGroomPrompt(packet) {
  if (!packet || typeof packet !== "object") throw new Error("Groom prompt packet is required");
  for (const [, field] of SECTIONS) {
    if (packet[field] === undefined || packet[field] === null || packet[field] === "") {
      throw new Error(`Groom prompt packet requires ${field}`);
    }
  }
  return renderSections(
    SECTIONS.map(([title, key]) => ({ title, key, value: packet[key] })),
    {
      finalNewline: true,
      label: "Groom prompt",
      maxSectionBytes: MAX_SECTION_BYTES,
      maxPromptBytes: MAX_PROMPT_BYTES,
      renderValue,
    }
  );
}

function main(argv = process.argv.slice(2)) {
  const inputIndex = argv.indexOf("--input");
  const outputIndex = argv.indexOf("--output");
  if (inputIndex < 0 || !argv[inputIndex + 1]) {
    process.stderr.write("Usage: groom-prompt.js --input packet.json [--output prompt.md]\n");
    return 2;
  }
  try {
    const prompt = buildGroomPrompt(JSON.parse(fs.readFileSync(argv[inputIndex + 1], "utf8")));
    if (outputIndex >= 0 && argv[outputIndex + 1])
      publishPrompt(path.resolve(argv[outputIndex + 1]), prompt);
    else process.stdout.write(prompt);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { MAX_PROMPT_BYTES, MAX_SECTION_BYTES, buildGroomPrompt, main };
