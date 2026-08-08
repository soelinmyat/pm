#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const {
  closeHostSession,
  currentEngagement,
  startEngagement,
} = require("./lib/analytics-engagements.js");
const { detectProjectRoot } = require("./pm-log.js");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const next = rest[index + 1];
    options[token.slice(2)] = next && !next.startsWith("--") ? next : true;
    if (options[token.slice(2)] !== true) index += 1;
  }
  return { command, options };
}

function readHookInput() {
  try {
    const text = fs.readFileSync(0, "utf8");
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function hostSessionId(input, options) {
  return options["session-id"] || input.session_id || input.transcript_path || "legacy";
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const input = readHookInput();
  const projectRoot = detectProjectRoot(options["project-dir"]);
  const sessionId = hostSessionId(input, options);
  if (command === "start") {
    const toolInput = input.tool_input || {};
    const rawSkill = options.skill || toolInput.skill || "";
    if (!rawSkill.startsWith("pm:")) return;
    const result = startEngagement({
      projectRoot,
      hostSessionId: sessionId,
      skill: rawSkill.slice(3),
      detail: typeof toolInput.args === "string" ? toolInput.args : options.args,
    });
    if (result) process.stdout.write(result.run_id);
    return;
  }
  if (command === "close") {
    closeHostSession({
      projectRoot,
      hostSessionId: sessionId,
      status: options.status || "abandoned",
      detail: options.detail,
    });
    return;
  }
  if (command === "current") {
    const current = currentEngagement(projectRoot, sessionId);
    if (current) process.stdout.write(JSON.stringify(current));
    return;
  }
  throw new Error(`Unknown command: ${command || "(missing)"}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[analytics-session] ${error.message}\n`);
  process.exitCode = 1;
}
