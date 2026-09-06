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
const {
  MAX_SECTION_BYTES,
  MAX_PROMPT_BYTES,
  resolvePromptBudget,
  sectionMetrics,
  countWords,
} = require("./dev-prompt");

function buildGroomPromptPacket(packet, options = {}) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet))
    throw new Error("Groom prompt packet is required");
  for (const [, field] of SECTIONS) {
    if (packet[field] === undefined || packet[field] === null || packet[field] === "") {
      throw new Error(`Groom prompt packet requires ${field}`);
    }
  }
  const budget = resolvePromptBudget(packet.prompt_budget, options);
  const sections = SECTIONS.map(([title, key]) => ({ title, key, value: packet[key] }));
  const renderOptions = { ...budget, finalNewline: true, label: "Groom prompt", renderValue };
  const prompt = renderSections(sections, renderOptions);
  return {
    prompt,
    metrics: {
      bytes: Buffer.byteLength(prompt, "utf8"),
      words: countWords(prompt),
      sections: sectionMetrics(sections, renderOptions),
      budget,
    },
  };
}

function buildGroomPrompt(packet, options = {}) {
  return buildGroomPromptPacket(packet, options).prompt;
}

function main(argv = process.argv.slice(2)) {
  const inputIndex = argv.indexOf("--input");
  const outputIndex = argv.indexOf("--output");
  const jsonMetrics = argv.includes("--metrics");
  if (inputIndex < 0 || !argv[inputIndex + 1]) {
    process.stderr.write(
      "Usage: groom-prompt.js --input packet.json [--output prompt.md] [--metrics]\n"
    );
    return 2;
  }
  try {
    const result = buildGroomPromptPacket(
      JSON.parse(fs.readFileSync(argv[inputIndex + 1], "utf8"))
    );
    const { prompt } = result;
    if (outputIndex >= 0 && argv[outputIndex + 1])
      publishPrompt(path.resolve(argv[outputIndex + 1]), prompt);
    else process.stdout.write(prompt);
    if (jsonMetrics) process.stderr.write(`${JSON.stringify(result.metrics)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = {
  MAX_PROMPT_BYTES,
  MAX_SECTION_BYTES,
  buildGroomPrompt,
  buildGroomPromptPacket,
  main,
};
