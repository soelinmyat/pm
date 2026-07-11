const fs = require("node:fs");
const { parseJsonLines } = require("./codex");

function buildClaudeLaunch({ profile, sessionId, resumeId, schemaPath }) {
  if (!schemaPath) throw new Error("schemaPath is required");
  if (!resumeId && !sessionId) throw new Error("sessionId is required for a new Claude session");
  const schema = JSON.stringify(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
  const args = ["-p"];
  if (resumeId) args.push("--resume", resumeId);
  args.push(
    "--model",
    profile.model,
    "--effort",
    profile.effort,
    "--permission-mode",
    profile.permissionMode
  );
  if (!resumeId) args.push("--session-id", sessionId);
  args.push("--output-format", "stream-json", "--json-schema", schema, "--verbose");
  return { command: "claude", args, input: "stdin", eventFormat: "stream-json" };
}

function extractClaudeResult({ events }) {
  const parsedEvents = parseJsonLines(events);
  const finalEvent = [...parsedEvents]
    .reverse()
    .find((event) => event.type === "result" && event.structured_output);
  if (!finalEvent) throw new Error("missing Claude structured result");
  const identity = parsedEvents.find((event) => event.session_id)?.session_id;
  return {
    resumeId: finalEvent.session_id ?? identity ?? null,
    result: finalEvent.structured_output,
    events: parsedEvents,
  };
}

module.exports = { buildClaudeLaunch, extractClaudeResult };
