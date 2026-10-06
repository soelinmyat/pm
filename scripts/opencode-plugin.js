"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { isDeepStrictEqual } = require("node:util");
const { parseFrontmatter } = require("./kb-frontmatter");
const { writeJsonAtomic } = require("./lib/atomic-file");
const { acquireOwnedLock } = require("./lib/owned-lock");
const { readProjectInput } = require("./lib/project-file");

const ROOT = path.resolve(__dirname, "..");
const MIN_VERSION = "2.0.24";

function validateNodeExecutable(value) {
  if (value === "node") return;
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error("nodeExecutable must be node or an absolute Node executable path");
  if (!fs.statSync(value).isFile())
    throw new Error("nodeExecutable must name a regular executable file");
  fs.accessSync(value, fs.constants.X_OK);
}

function readDefinitions(root, directory) {
  return fs
    .readdirSync(path.join(root, directory))
    .sort()
    .flatMap((name) => {
      const file =
        directory === "skills"
          ? path.join(root, directory, name, "SKILL.md")
          : path.join(root, directory, name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !file.endsWith(".md")) return [];
      const { data, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
      return [
        {
          id: directory === "skills" ? name : name.slice(0, -3),
          path: file,
          description: data.description,
          content: body.trim(),
        },
      ];
    });
}

function requireV2(ctx) {
  const version = String(ctx.app?.version || "").replace(/^v/, "");
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts || Number(parts[1]) !== 2 || (Number(parts[2]) === 0 && Number(parts[3]) < 24)) {
    throw new Error(`PM requires OpenCode ${MIN_VERSION} or a later stable V2 release`);
  }
  for (const [domain, method] of [
    ["skill", "transform"],
    ["command", "transform"],
    ["session", "hook"],
    ["session", "prompt"],
    ["shell", "hook"],
  ]) {
    if (typeof ctx[domain]?.[method] !== "function")
      throw new Error(`PM requires OpenCode V2 ${domain}.${method}`);
  }
}

function checkPush(event, { root = ROOT, nodeExecutable = "node", run = spawnSync } = {}) {
  if (!event.command.includes("push")) return;
  const result = run(nodeExecutable, [path.join(root, "hooks/push-gate")], {
    cwd: event.cwd,
    env: { ...process.env, ...event.env, PM_PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: root },
    input: JSON.stringify({ cwd: event.cwd, tool_input: { command: event.command } }),
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "PM push gate could not verify this command; restore Node and gate dependencies before retrying"
    );
  if (!result.stdout?.trim()) return;
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    throw new Error("PM push gate could not verify its output");
  }
  const decision = output?.hookSpecificOutput;
  if (
    decision?.permissionDecision !== "deny" ||
    typeof decision.permissionDecisionReason !== "string"
  ) {
    throw new Error("PM push gate could not verify its decision");
  }
  throw new Error(decision.permissionDecisionReason);
}

async function setup(ctx) {
  requireV2(ctx);
  const nodeExecutable = ctx.options?.nodeExecutable || "node";
  validateNodeExecutable(nodeExecutable);
  const skills = readDefinitions(ROOT, "skills");
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, "plugin.config.json"), "utf8"));
  const commands = readDefinitions(ROOT, "commands");
  if (
    commands.length !== inventory.commands.length ||
    commands.some((c) => !inventory.commands.includes(c.id) || !skills.some((s) => s.id === c.id))
  ) {
    throw new Error("PM command/skill inventory is inconsistent");
  }
  await ctx.skill.transform((editor) => {
    for (const skill of skills)
      editor.add({ ...skill, id: `pm-${skill.id}`, name: `pm:${skill.id}`, autoinvoke: true });
  });
  await ctx.command.transform((editor) => {
    for (const command of commands)
      editor.add({
        name: `pm:${command.id}`,
        description: command.description,
        execute: ({ sessionID, prompt, delivery }) =>
          ctx.session.prompt({
            ...prompt,
            sessionID,
            delivery,
            skills: [
              ...(prompt.skills || []).filter((s) => s.id !== `pm-${command.id}`),
              { id: `pm-${command.id}` },
            ],
          }),
      });
  });
  await ctx.session.hook("context", (event) => {
    event.system.push({
      type: "text",
      text: `PM plugin root: ${JSON.stringify(ROOT)}. Shell commands receive PM_PLUGIN_ROOT and CLAUDE_PLUGIN_ROOT for this exact installation. Use pm-* skill IDs and /pm:* commands. OpenCode interactive work uses PM's inline-current profile; native subagent calls provide fresh contexts and may inherit the host model. Named PM personas are installed explicitly with scripts/opencode-install.js. Do not imitate a fresh-eyes review in this conversation. Headless OpenCode Dev workers and unattended OpenCode Loop are unsupported and must fail closed. Retain canonical PM review, QA, evidence, permission and release gates. Loading PM does not authorize publication or automatically sync the knowledge base.`,
    });
  });
  await ctx.shell.hook("create.before", (event) => {
    event.env.PM_PLUGIN_ROOT = ROOT;
    event.env.CLAUDE_PLUGIN_ROOT = ROOT;
    if (path.isAbsolute(nodeExecutable))
      event.env.PATH = `${path.dirname(nodeExecutable)}${path.delimiter}${event.env.PATH || process.env.PATH || ""}`;
    checkPush(event, { nodeExecutable });
  });
}

function buildInstallConfig(existing, { root = ROOT, nodeExecutable = "node" } = {}) {
  validateNodeExecutable(nodeExecutable);
  if (!existing || typeof existing !== "object" || Array.isArray(existing))
    throw new Error("OpenCode config must be a JSON object");
  const next = structuredClone(existing);
  if (next.plugins !== undefined && !Array.isArray(next.plugins))
    throw new Error("plugins must be an array");
  if (
    next.agents !== undefined &&
    (!next.agents || typeof next.agents !== "object" || Array.isArray(next.agents))
  )
    throw new Error("agents must be an object");
  // Use V2's conventional local index.ts directory, not a root tooling package
  // or an explicit .mjs file (neither activates this local plugin in V2).
  const entry = pathToFileURL(path.join(fs.realpathSync(root), ".opencode-plugin") + path.sep).href;
  const plugin = { package: entry, options: { nodeExecutable } };
  next.plugins ||= [];
  const matching = next.plugins.filter((p) => (typeof p === "string" ? p : p?.package) === entry);
  if (matching.some((p) => !isDeepStrictEqual(p, plugin)))
    throw new Error("PM plugin configuration conflict; merge options explicitly");
  if (!matching.length) next.plugins.push(plugin);
  next.agents ||= {};
  for (const persona of readDefinitions(root, "agents")) {
    const id = `pm:${persona.id}`;
    const agent = {
      description: persona.description,
      mode: "subagent",
      system: persona.content,
      permissions:
        persona.id === "developer"
          ? []
          : [
              { action: "edit", resource: "*", effect: "deny" },
              { action: "shell", resource: "*", effect: "ask" },
            ],
    };
    if (next.agents[id] && !isDeepStrictEqual(next.agents[id], agent))
      throw new Error(
        `PM persona configuration conflict: ${id}; preserve and reconcile the existing definition explicitly`
      );
    next.agents[id] = agent;
  }
  next.$schema ||= "https://opencode.ai/config.json";
  return next;
}

function installConfig(file, options = {}) {
  file = path.resolve(file);
  if (file.endsWith(".jsonc"))
    throw new Error("JSONC config must be merged manually; PM never rewrites comments");
  // Canonicalize the directory so aliases serialize on the same owned lock.
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  file = path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  const release = acquireOwnedLock(`${file}.pm-install.lock`, {
    attempts: 2,
    timeoutMessage:
      "PM installation is already in progress for this config; retry after it finishes",
  });
  try {
    const baseline = readConfigBytes(file);
    const existing = baseline ? JSON.parse(baseline.toString("utf8")) : {};
    const config = buildInstallConfig(existing, options);
    if (!isDeepStrictEqual(existing, config)) {
      // Test-only interleaving seam; CLI/config data never supplies callbacks.
      options.beforePublish?.();
      const current = readConfigBytes(file);
      if ((baseline === null) !== (current === null) || (baseline && !baseline.equals(current)))
        throw new Error(
          "OpenCode config changed during installation; nothing was overwritten, retry from current settings"
        );
      writeJsonAtomic(file, config, { directoryMode: 0o700, fileMode: 0o600 });
    }
    return {
      config_path: file,
      skills: readDefinitions(options.root || ROOT, "skills").length,
      personas: readDefinitions(options.root || ROOT, "agents").length,
    };
  } finally {
    release();
  }
}

function readConfigBytes(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Refusing non-regular or symlink OpenCode config");
  if (stat.size > 1024 * 1024) throw new Error("OpenCode config exceeds 1 MiB");
  return readProjectInput(path.dirname(file), path.basename(file), 1024 * 1024).bytes;
}

module.exports = { setup, checkPush, buildInstallConfig, installConfig };
