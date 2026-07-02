"use strict";

const FRAME_PREFIX = "::pm-eval-check::";

function parseJsonl(text) {
  if (!text || !String(text).trim()) {
    return { status: "indeterminate", reason: "empty-transcript", events: [] };
  }

  const events = [];
  const lines = String(text).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      return {
        status: "indeterminate",
        reason: `malformed-jsonl:${index + 1}`,
        events: [],
      };
    }
  }

  return { status: "pass", events: normalizeEvents(events) };
}

function normalizeEvents(rawEvents) {
  return rawEvents
    .flatMap((event, index) => {
      const normalized = normalizeEvent(event, index);
      if (!normalized) return [];
      return Array.isArray(normalized) ? normalized : [normalized];
    })
    .filter(Boolean);
}

function normalizeEvent(event, index) {
  if (!event || typeof event !== "object") return null;

  const type = String(event.type || event.kind || "").toLowerCase();
  const name = String(event.name || event.skill || event.tool || event.command || "").trim();
  const command = String(event.command || event.input || "");
  const item = event.item && typeof event.item === "object" ? event.item : null;

  if (item && item.type === "command_execution") {
    return {
      index,
      type: "tool",
      name: "functions.exec_command",
      command: String(item.command || ""),
      raw: event,
    };
  }

  if (item && item.type === "agent_message") {
    const skills = extractDeclaredPmSkills(String(item.text || ""));
    if (skills.length > 0) {
      return skills.map((skill) => ({
        index,
        type: "skill",
        name: skill,
        raw: event,
      }));
    }
  }

  if (type === "tool" || event.tool) {
    return {
      index,
      type: "tool",
      name: String(event.name || event.tool || "").trim(),
      command,
      raw: event,
    };
  }

  if (type === "skill" || event.skill) {
    return {
      index,
      type: "skill",
      name: String(event.name || event.skill || name).trim(),
      raw: event,
    };
  }

  return {
    index,
    type: type || "event",
    name,
    command,
    raw: event,
  };
}

function extractDeclaredPmSkills(text) {
  const found = [];
  const seen = new Set();
  const re = /`?(pm:[a-z][a-z0-9-]*)`?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const skill = match[1];
    if (seen.has(skill)) continue;
    if (!looksLikeSkillUse(text, match.index)) continue;
    seen.add(skill);
    found.push(skill);
  }
  return found;
}

function looksLikeSkillUse(text, index) {
  const before = text.slice(Math.max(0, index - 220), index).toLowerCase();
  const action =
    "(?:use|using|used|invoke|invoking|invoked|run|running|ran|call|calling|called|load|loading|loaded|follow|following|followed|apply|applying|applied|execute|executing|executed)";
  const negative = new RegExp(
    `(?:do not|don't|dont|won't|will not|without|skip|skipping|not)\\s+(?:\\w+\\s+){0,8}${action}\\b`
  );
  if (negative.test(before)) return false;
  return new RegExp(`${action}\\b[\\s\\S]{0,220}$`).test(before);
}

function checkTranscript(events, command, ...args) {
  const normalized = normalizeEvents(events);
  if (normalized.length === 0) {
    return { status: "indeterminate", reason: "empty-transcript" };
  }

  switch (command) {
    case "skill-called":
      return hasSkill(normalized, args[0]) ? pass() : fail(`skill not called: ${args[0]}`);
    case "tool-called":
      return hasTool(normalized, args[0]) ? pass() : fail(`tool not called: ${args[0]}`);
    case "skill-before-tool":
      return before(
        findSkillIndex(normalized, args[0]),
        findToolIndex(normalized, args[1]),
        `skill ${args[0]} did not precede tool ${args[1]}`
      );
    case "skill-before-command":
      return skillBeforeCommand(normalized, args[0], args[1]);
    case "no-tool-before-skill": {
      const toolIndex = findToolIndex(normalized, args[0]);
      const skillIndex = findSkillIndex(normalized, args[1]);
      if (skillIndex === -1) return fail(`skill not called: ${args[1]}`);
      return toolIndex === -1 || toolIndex > skillIndex
        ? pass()
        : fail(`tool ${args[0]} ran before skill ${args[1]}`);
    }
    default:
      return { status: "indeterminate", reason: `unknown-transcript-check:${command}` };
  }
}

function hasSkill(events, skill) {
  return findSkillIndex(events, skill) !== -1;
}

function hasTool(events, tool) {
  return findToolIndex(events, tool) !== -1;
}

function skillBeforeCommand(events, skill, commandPattern) {
  const skillIndex = findSkillIndex(events, skill);
  if (skillIndex === -1) return fail(`skill not called: ${skill}`);

  let matcher;
  try {
    matcher = new RegExp(commandPattern);
  } catch {
    return { status: "indeterminate", reason: `invalid-command-pattern:${commandPattern}` };
  }

  const commandIndex = events.findIndex(
    (event) => event.type === "tool" && matcher.test(String(event.command || ""))
  );
  if (commandIndex === -1) return pass();
  return commandIndex > skillIndex
    ? pass()
    : fail(`command matched before skill ${skill}: ${commandPattern}`);
}

function findSkillIndex(events, skill) {
  return events.findIndex((event) => event.type === "skill" && event.name === skill);
}

function findToolIndex(events, tool) {
  return events.findIndex((event) => event.type === "tool" && event.name === tool);
}

function before(left, right, reason) {
  if (left === -1 || right === -1) return fail(reason);
  return left < right ? pass() : fail(reason);
}

function pass() {
  return { status: "pass" };
}

function fail(reason) {
  return { status: "fail", reason };
}

function parseCheckFrames(stdout, opts) {
  const nonce = opts && opts.nonce;
  const phase = opts && opts.phase;
  const maxPayloadBytes = (opts && opts.maxPayloadBytes) || 1024 * 1024;
  const records = [];
  const rejected = [];

  for (const [index, line] of String(stdout || "")
    .split(/\r?\n/)
    .entries()) {
    if (!line.startsWith(FRAME_PREFIX)) continue;
    const rest = line.slice(FRAME_PREFIX.length);
    const sep = rest.indexOf("::");
    if (sep === -1) {
      rejected.push({ line: index + 1, reason: "malformed-frame" });
      continue;
    }
    const frameNonce = rest.slice(0, sep);
    const encoded = rest.slice(sep + 2);
    if (frameNonce !== nonce) {
      rejected.push({ line: index + 1, reason: "wrong-nonce" });
      continue;
    }
    if (Buffer.byteLength(encoded, "utf8") > maxPayloadBytes) {
      rejected.push({ line: index + 1, reason: "oversized-payload" });
      continue;
    }
    try {
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      const record = JSON.parse(decoded);
      if (!record || typeof record !== "object") throw new Error("not an object");
      records.push({ ...record, phase });
    } catch {
      rejected.push({ line: index + 1, reason: "malformed-json" });
    }
  }

  return { records, rejected };
}

function escapeFrameLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => (line.startsWith(FRAME_PREFIX) ? `\\${line}` : line))
    .join("\n");
}

module.exports = {
  FRAME_PREFIX,
  parseJsonl,
  normalizeEvents,
  checkTranscript,
  parseCheckFrames,
  escapeFrameLines,
};
