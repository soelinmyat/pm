"use strict";

const FRAME_PREFIX = "::pm-eval-check::";

// Adapter-neutral tool taxonomy. Checks reference logical classes
// (run-command, edit-file, ...) so scenarios stay valid across Codex,
// Claude Code, and future adapters; exact raw names still match too.
const TOOL_CLASSES = {
  "run-command": ["functions.exec_command", "exec_command", "local_shell", "shell", "bash"],
  "edit-file": [
    "functions.apply_patch",
    "apply_patch",
    "str_replace_editor",
    "edit",
    "multiedit",
    "notebookedit",
  ],
  "write-file": ["write", "functions.write_file", "create_file"],
  "read-file": ["read", "functions.read_file", "open_file"],
};

function classifyTool(name) {
  const lower = String(name || "").toLowerCase();
  for (const [toolClass, names] of Object.entries(TOOL_CLASSES)) {
    if (names.includes(lower)) return toolClass;
  }
  return null;
}

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
    const normalized = {
      index,
      type: "tool",
      name: "functions.exec_command",
      tool_class: "run-command",
      command: String(item.command || ""),
      raw: event,
    };
    const exitCode = firstDefined(item.exit_code, item.exitCode);
    if (exitCode !== undefined && exitCode !== null && exitCode !== "") {
      normalized.exit_code = Number(exitCode);
    }
    return normalized;
  }

  if (item && (item.type === "file_change" || item.type === "patch_apply")) {
    return {
      index,
      type: "tool",
      name: "functions.apply_patch",
      tool_class: "edit-file",
      command: String(item.path || item.file || ""),
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
    const toolName = String(event.name || event.tool || "").trim();
    const normalized = {
      index,
      type: "tool",
      name: toolName,
      tool_class: event.tool_class || classifyTool(toolName),
      command,
      raw: event.raw || event,
    };
    const exitCode = firstDefined(
      event.exit_code,
      event.exitCode,
      normalized.raw && normalized.raw.exit_code,
      normalized.raw && normalized.raw.exitCode
    );
    if (exitCode !== undefined && exitCode !== null && exitCode !== "") {
      normalized.exit_code = Number(exitCode);
    }
    return normalized;
  }

  if (type === "skill" || event.skill) {
    return {
      index,
      type: "skill",
      name: String(event.name || event.skill || name).trim(),
      raw: event.raw || event,
    };
  }

  return {
    index,
    type: type || "event",
    name,
    command,
    raw: event.raw || event,
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
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
    case "tool-not-called":
      return hasTool(normalized, args[0]) ? fail(`tool called: ${args[0]}`) : pass();
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
    case "test-red-green":
      return testRedGreen(normalized, args[0] || "test");
    case "command-succeeded":
      return commandSucceeded(normalized, args[0]);
    case "quality-revalidation":
      return qualityRevalidationCommand(normalized, args[0]);
    case "gate-evidence": {
      // A discipline gate is satisfied by ANY observed form of the work:
      // the skill invoked, a matching agent dispatched, or matching command
      // activity in the transcript. All three are observed behavior; an
      // engine that skips the discipline produces none of them.
      if (hasSkill(normalized, args[0])) return pass();
      let agentRe, activityRe;
      try {
        agentRe = new RegExp(args[1], "i");
        activityRe = new RegExp(args[2], "i");
      } catch {
        return { status: "indeterminate", reason: "invalid-gate-evidence-pattern" };
      }
      const agentHit = normalized.some(
        (event) =>
          event.type === "tool" &&
          (event.name === "Task" || event.name === "Agent") &&
          agentRe.test(String(event.command || ""))
      );
      if (agentHit) return pass();
      const activityHit = normalized.some(
        (event) =>
          event.type === "tool" &&
          (event.tool_class === "run-command" || event.name === "Bash") &&
          activityRe.test(String(event.command || ""))
      );
      return activityHit
        ? pass()
        : fail(
            `no observed evidence for gate ${args[0]}: no skill invocation, agent dispatch, or matching activity`
          );
    }
    case "skill-or-agent": {
      // A gate can be satisfied by invoking the skill OR by dispatching an
      // agent with the same intent — both are observable evidence of the
      // discipline; only the calling convention differs.
      if (hasSkill(normalized, args[0])) return pass();
      let matcher;
      try {
        matcher = new RegExp(args[1], "i");
      } catch {
        return { status: "indeterminate", reason: `invalid-agent-pattern:${args[1]}` };
      }
      const dispatched = normalized.some(
        (event) =>
          event.type === "tool" &&
          (event.name === "Task" || event.name === "Agent") &&
          matcher.test(String(event.command || ""))
      );
      return dispatched
        ? pass()
        : fail(`neither skill ${args[0]} invoked nor matching agent dispatched`);
    }
    default:
      return { status: "indeterminate", reason: `unknown-transcript-check:${command}` };
  }
}

// Observed TDD evidence: a test command fails, a source edit follows,
// then the same class of test command passes. Replaces trusting an
// agent-written attestation artifact.
function testRedGreen(events, needle) {
  const selector = `run-command~${needle}`;
  const runs = events.filter((event) => matchesToolSelector(event, selector));
  if (runs.length === 0) {
    return fail(`no test commands matching "${needle}" were run`);
  }
  if (
    !runs.some((event) => typeof event.exit_code === "number" && !Number.isNaN(event.exit_code))
  ) {
    return { status: "indeterminate", reason: "test-runs-missing-exit-codes" };
  }
  const red = runs.find((event) => isRedRun(event));
  if (!red) return fail("no failing test run observed before implementation");
  const edit = events.find(
    (event) =>
      event.index > red.index &&
      event.type === "tool" &&
      (event.tool_class === "edit-file" || event.tool_class === "write-file")
  );
  if (!edit) return fail("no source edit observed after the failing test run");
  const green = runs.find(
    (event) => event.index > edit.index && event.exit_code === 0 && !isRedRun(event)
  );
  if (!green) return fail("no passing test run observed after the implementation edit");
  return pass();
}

// A red run is a non-zero exit — or a RUNNER SUMMARY line reporting failures
// in the captured output, because pipelines (`npm test | tail`) report the
// tail's exit code, not the runner's. Patterns are anchored to summary
// formats (tap/node:test, mocha, jest, pytest) so incidental failure-ish
// text — a test NAMED "handles 3 failed retries", an error-path test's
// AssertionError output — can neither fake a red nor poison a green.
const RED_SUMMARY_PATTERNS = [
  /^not ok \d/m, // tap / node:test result line
  /^# fail [1-9]/m, // node:test summary
  /^\s*[1-9]\d* failing\b/m, // mocha summary line
  /Tests:\s+[^\n]*\b[1-9]\d* failed/, // jest summary
  /=+[^\n]*\b[1-9]\d* failed[^\n]*=+/, // pytest summary bar
];

function isRedRun(event) {
  if (typeof event.exit_code === "number" && event.exit_code !== 0) return true;
  const snippet = String(event.result_snippet || (event.raw && event.raw.result_snippet) || "");
  return RED_SUMMARY_PATTERNS.some((pattern) => pattern.test(snippet));
}

function hasSkill(events, skill) {
  return findSkillIndex(events, skill) !== -1;
}

function hasTool(events, selector) {
  return findToolIndex(events, selector) !== -1;
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

function commandSucceeded(events, commandPattern) {
  let pattern;
  try {
    pattern = new RegExp(commandPattern, "i");
  } catch {
    return { status: "indeterminate", reason: "invalid-command-pattern" };
  }
  return events.some(
    (event) =>
      event.type === "tool" &&
      event.tool_class === "run-command" &&
      pattern.test(String(event.command || "")) &&
      Number(event.exit_code) === 0
  )
    ? pass()
    : fail(`successful command not observed: ${commandPattern}`);
}

function qualityRevalidationCommand(events, workflow) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(workflow || ""))) {
    return { status: "indeterminate", reason: "invalid-workflow" };
  }
  const script = String.raw`(?:"[^"]*quality-resume\.js"|'[^']*quality-resume\.js'|\S*quality-resume\.js)`;
  const root = String.raw`(?:"[^"]+"|'[^']+'|\S+)`;
  const pattern = new RegExp(
    String.raw`(?:^|[;\n]\s*)(?:node|\S*[\\/]node)\s+${script}\s+revalidate\s+${workflow}\s+${root}\s*(?=$|[;\n])`
  );
  return events.some(
    (event) =>
      event.type === "tool" &&
      event.tool_class === "run-command" &&
      Number(event.exit_code) === 0 &&
      pattern.test(unwrapShellCommand(String(event.command || "")))
  )
    ? pass()
    : fail(`exact quality revalidation command not observed for ${workflow}`);
}

function unwrapShellCommand(command) {
  const match = command.match(
    /^\s*(?:\S*[\\/])?(?:bash|zsh|sh)\s+(?:-[A-Za-z]+\s+)*(["'])([\s\S]*)\1\s*$/
  );
  return match ? match[2] : command;
}

function findSkillIndex(events, skill) {
  return events.findIndex((event) => event.type === "skill" && event.name === skill);
}

function findToolIndex(events, selector) {
  return events.findIndex((event) => matchesToolSelector(event, selector));
}

// Selector grammar: "<name-or-class>" or "<name-or-class>~<command needle>".
// The name part matches the raw tool name or its logical class; "*" matches
// any. A needle wrapped in slashes (~/git\s+push/) is a case-insensitive
// regex — required for safety gates, where plain substrings both false-fail
// on benign phrasings and miss `-C`-style invocations.
function parseToolSelector(selector) {
  const text = String(selector || "");
  const sep = text.indexOf("~");
  if (sep === -1) return { name: text, needle: "" };
  const rawNeedle = text.slice(sep + 1);
  let regex = null;
  if (rawNeedle.length > 2 && rawNeedle.startsWith("/") && rawNeedle.endsWith("/")) {
    try {
      regex = new RegExp(rawNeedle.slice(1, -1), "i");
    } catch {
      regex = null; // malformed regex falls back to substring on the raw text
    }
  }
  return { name: text.slice(0, sep), needle: rawNeedle, regex };
}

function matchesToolSelector(event, selector) {
  if (!event || event.type !== "tool") return false;
  const { name, needle, regex } = parseToolSelector(selector);
  if (name && name !== "*" && event.name !== name && event.tool_class !== name) return false;
  if (regex) return regex.test(String(event.command || ""));
  if (needle) {
    const command = String(event.command || "").toLowerCase();
    if (!command.includes(needle.toLowerCase())) return false;
  }
  return true;
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
  TOOL_CLASSES,
  classifyTool,
  matchesToolSelector,
  parseJsonl,
  normalizeEvents,
  checkTranscript,
  parseCheckFrames,
  escapeFrameLines,
};
