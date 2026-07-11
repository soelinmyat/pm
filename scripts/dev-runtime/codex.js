const fs = require("node:fs");
const { parseJson } = require("./result");

function buildCodexLaunch({ profile, worktree, resumeId, schemaPath, lastMessagePath }) {
  requirePath(schemaPath, "schemaPath");
  requirePath(lastMessagePath, "lastMessagePath");
  const args = ["exec"];

  if (resumeId) {
    args.push("resume", resumeId);
  }
  args.push(
    "--model",
    profile.model,
    "-c",
    `model_reasoning_effort=${JSON.stringify(profile.effort)}`,
    "-c",
    `approval_policy=${JSON.stringify(profile.approvalPolicy)}`,
    "--strict-config"
  );

  if (!resumeId) {
    requirePath(worktree, "worktree");
    args.push("--sandbox", profile.sandbox, "-C", worktree);
  }

  args.push("--json", "--output-schema", schemaPath, "--output-last-message", lastMessagePath, "-");
  return { command: "codex", args, input: "stdin", eventFormat: "jsonl" };
}

function extractCodexResult({ events, lastMessage, lastMessagePath }) {
  const parsedEvents = parseJsonLines(events);
  const started = parsedEvents.find((event) => event.type === "thread.started");
  const finalValue =
    lastMessage ??
    (lastMessagePath && fs.existsSync(lastMessagePath)
      ? fs.readFileSync(lastMessagePath, "utf8")
      : undefined);
  return {
    resumeId: started?.thread_id ?? started?.threadId ?? null,
    result: parseJson(finalValue, "Codex structured result"),
    events: parsedEvents,
  };
}

function parseJsonLines(value) {
  if (!value) return [];
  return String(value)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`malformed JSONL event at line ${index + 1}: ${error.message}`);
      }
    });
}

function requirePath(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
}

module.exports = { buildCodexLaunch, extractCodexResult, parseJsonLines };
