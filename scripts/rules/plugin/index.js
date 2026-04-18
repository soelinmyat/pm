"use strict";

// Plugin-contract rule pack entry point.
//
// Exports:
//   loadRules() — discover rule modules in this directory.
//   runPack(rootDir, options) — walk plugin source and apply every rule.
//
// Each rule module exports:
//   { id, severity, description, check(context) -> Issue[] }
//
// A rule's `check` is pure: it receives a frozen context snapshot of the
// plugin source and returns an array of issues. The pack collects and sorts.

const fs = require("fs");
const path = require("path");

const { parseFrontmatter } = require("../../kb-frontmatter.js");

const PACK_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

function listDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true });
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function buildContext(rootDir) {
  const skills = [];
  const skillsDir = path.join(rootDir, "skills");
  for (const entry of listDir(skillsDir)) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    const skillFilePath = path.join(skillDir, "SKILL.md");
    let skillFm = null;
    let skillBody = "";
    if (fs.existsSync(skillFilePath)) {
      const content = readFile(skillFilePath);
      const parsed = parseFrontmatter(content);
      skillFm = parsed.data || {};
      skillBody = parsed.body || "";
    }

    const stepsDir = path.join(skillDir, "steps");
    const steps = [];
    for (const stepEntry of listDir(stepsDir)) {
      if (!stepEntry.isFile()) continue;
      if (!stepEntry.name.endsWith(".md")) continue;
      const stepPath = path.join(stepsDir, stepEntry.name);
      const content = readFile(stepPath);
      const parsed = parseFrontmatter(content);
      steps.push({
        fileName: stepEntry.name,
        absPath: stepPath,
        relPath: path.posix.join("skills", entry.name, "steps", stepEntry.name),
        frontmatter: parsed.data || {},
        hasFrontmatter: parsed.hasFrontmatter,
        body: parsed.body || "",
      });
    }
    steps.sort((a, b) => a.fileName.localeCompare(b.fileName));

    skills.push({
      name: entry.name,
      absPath: skillDir,
      skillFilePath,
      skillFmExists: fs.existsSync(skillFilePath),
      skillFm: skillFm || {},
      skillBody,
      steps,
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  // Personas
  const personas = [];
  const personasDir = path.join(rootDir, "personas");
  for (const entry of listDir(personasDir)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    personas.push(entry.name.replace(/\.md$/, ""));
  }

  // Commands
  const commands = [];
  const commandsDir = path.join(rootDir, "commands");
  for (const entry of listDir(commandsDir)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const name = entry.name.replace(/\.md$/, "");
    const body = readFile(path.join(commandsDir, entry.name));
    commands.push({ name, absPath: path.join(commandsDir, entry.name), body });
  }

  // Manifests
  const manifests = {};
  const manifestPaths = [
    ".claude-plugin/plugin.json",
    "plugin.config.json",
    ".claude-plugin/marketplace.json",
    ".codex-plugin/plugin.json",
  ];
  for (const rel of manifestPaths) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) {
      manifests[rel] = { exists: false };
      continue;
    }
    const raw = readFile(abs);
    let json = null;
    let parseError = null;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      parseError = e.message;
    }
    manifests[rel] = { exists: true, raw, json, parseError };
  }

  return {
    rootDir,
    skills,
    personas,
    commands,
    manifests,
  };
}

// ---------------------------------------------------------------------------
// Rule loader
// ---------------------------------------------------------------------------

function loadRules() {
  const dir = __dirname;
  const rules = [];
  for (const entry of listDir(dir)) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".js")) continue;
    if (entry.name === "index.js") continue;
    const mod = require(path.join(dir, entry.name));
    if (!mod || !mod.id || typeof mod.check !== "function") {
      throw new Error(`Invalid rule module ${entry.name}: must export { id, severity, check }`);
    }
    rules.push(mod);
  }
  rules.sort((a, b) => a.id.localeCompare(b.id));
  return rules;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function runPack(rootDir, options = {}) {
  const ctx = options.context || buildContext(rootDir);
  const rules = options.rules || loadRules();

  const issues = [];
  for (const rule of rules) {
    let ruleIssues = [];
    try {
      ruleIssues = rule.check(ctx) || [];
    } catch (e) {
      ruleIssues = [
        {
          ruleId: rule.id,
          severity: "error",
          file: "(rule)",
          message: `Rule ${rule.id} threw: ${e.message}`,
        },
      ];
    }
    for (const issue of ruleIssues) {
      issues.push({
        ruleId: rule.id,
        severity: issue.severity || rule.severity || "error",
        file: issue.file || "",
        message: issue.message || "",
      });
    }
  }

  issues.sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.message.localeCompare(b.message);
  });

  // Count files we actually scanned (skills + steps + personas + commands + manifests)
  let filesScanned = 0;
  for (const s of ctx.skills) {
    if (s.skillFmExists) filesScanned += 1;
    filesScanned += s.steps.length;
  }
  filesScanned += ctx.personas.length + ctx.commands.length;
  for (const m of Object.values(ctx.manifests)) {
    if (m.exists) filesScanned += 1;
  }

  return {
    packVersion: PACK_VERSION,
    rulesRun: rules.length,
    filesScanned,
    issues,
  };
}

module.exports = {
  PACK_VERSION,
  buildContext,
  loadRules,
  runPack,
};
