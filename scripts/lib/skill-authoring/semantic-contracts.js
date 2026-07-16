"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SURFACE_PATHS = ["skills", "commands", "references"];
const SURFACE_FILES = ["README.md", "ARCHITECTURE.md", ".codex/INSTALL.md"];
const PATH_CONTRACT_FILES = new Set([
  "ARCHITECTURE.md",
  "references/skill-runtime.md",
  "skills/start/SKILL.md",
  "skills/start/steps/01-detect-situation.md",
  "skills/start/steps/03-resume.md",
  "skills/using-pm/SKILL.md",
]);
const INTERNAL_PM_LANES = new Set(["qa"]);
const SEMANTIC_RULE_IDS = Object.freeze([
  "D3-AUTH-001",
  "D3-AUTH-002",
  "D3-DOC-001",
  "D3-PATH-001",
  "D3-REF-001",
  "D3-ROUTE-001",
]);
const OBSOLETE_PATHS = [
  {
    pattern: /\.pm\/(?:groom|rfc|dev)-sessions\/\{[^}\n]+\}\.md/g,
    replacement: "the canonical session.json beneath the session slug directory",
  },
  {
    pattern: /\.pm\/(?:groom|rfc|dev)-sessions\/\*\.md/g,
    replacement: "session slug directories containing canonical session.json files",
  },
  {
    pattern: /\.pm\/\{skill\}-sessions\/\{session\}\/steps\//g,
    replacement: ".pm/workflows/{skill}/",
  },
];
const ROUTING_SENTINELS = [
  { phrase: "Should we", expected: "pm:think" },
  { phrase: "Enable Linear", expected: "pm:setup" },
  { phrase: "Initialize PM", expected: "pm:start" },
];

function validateSemanticContracts(rootDir) {
  const issues = [];
  const files = collectSurfaceFiles(rootDir);
  const knownLanes = collectPmLanes(rootDir);

  for (const file of files) {
    const relative = toPosix(path.relative(rootDir, file));
    const body = fs.readFileSync(file, "utf8");
    validatePmReferences(relative, body, knownLanes, issues);
    if (PATH_CONTRACT_FILES.has(relative)) validateCanonicalPaths(relative, body, issues);
  }

  const usingPm = readOptional(rootDir, "skills/using-pm/SKILL.md");
  if (usingPm !== null) {
    validateAuthorityClaims("skills/using-pm/SKILL.md", usingPm, issues);
    validateRoutingSentinels("skills/using-pm/SKILL.md", usingPm, issues);
  }
  const board = readOptional(rootDir, "skills/board/SKILL.md");
  if (board !== null) validateBoardWording("skills/board/SKILL.md", board, issues);
  validateGeneratedPrompt(rootDir, issues);

  return issues.sort((left, right) =>
    [left.ruleId, left.file, left.message]
      .join("\0")
      .localeCompare([right.ruleId, right.file, right.message].join("\0"))
  );
}

function collectSurfaceFiles(rootDir) {
  const files = [];
  for (const relative of SURFACE_PATHS) walkMarkdown(path.join(rootDir, relative), files);
  for (const relative of SURFACE_FILES) {
    const target = path.join(rootDir, relative);
    if (isRegularFile(target)) files.push(target);
  }
  return files.sort();
}

function walkMarkdown(directory, files) {
  if (!isDirectory(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walkMarkdown(target, files);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
}

function collectPmLanes(rootDir) {
  const lanes = new Set(INTERNAL_PM_LANES);
  for (const [relative, extension] of [
    ["skills", null],
    ["commands", ".md"],
    ["agents", ".md"],
  ]) {
    const directory = path.join(rootDir, relative);
    if (!isDirectory(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (extension && entry.isFile() && entry.name.endsWith(extension)) {
        lanes.add(entry.name.slice(0, -extension.length));
      } else if (!extension && entry.isDirectory()) lanes.add(entry.name);
    }
  }
  return lanes;
}

function validatePmReferences(file, body, knownLanes, issues) {
  const seen = new Set();
  for (const match of body.matchAll(/\bpm:([a-z][a-z0-9-]*)\b/g)) {
    const lane = match[1];
    if (knownLanes.has(lane) || seen.has(lane)) continue;
    seen.add(lane);
    issues.push(issue("D3-REF-001", file, `unresolved PM lane pm:${lane}`));
  }
}

function validateCanonicalPaths(file, body, issues) {
  for (const contract of OBSOLETE_PATHS) {
    for (const match of body.matchAll(
      new RegExp(contract.pattern.source, contract.pattern.flags)
    )) {
      issues.push(
        issue("D3-PATH-001", file, `obsolete path ${match[0]}; use ${contract.replacement}`)
      );
    }
  }
}

function validateAuthorityClaims(file, body, issues) {
  if (
    /user instructions always take precedence|user['’]s explicit instructions[^\n]*highest priority/i.test(
      body
    )
  ) {
    issues.push(
      issue(
        "D3-AUTH-001",
        file,
        "router must defer to the host instruction hierarchy instead of declaring its own precedence"
      )
    );
  }
}

function validateBoardWording(file, body, issues) {
  if (
    /read-only/i.test(body) &&
    /(?:POST\s+\/api\/loop\/toggle|pause\/resume|kill switch)/i.test(body)
  ) {
    issues.push(
      issue(
        "D3-AUTH-002",
        file,
        "board describes itself as read-only while exposing a loop-control mutation"
      )
    );
  }
}

function validateRoutingSentinels(file, body, issues) {
  for (const sentinel of ROUTING_SENTINELS) {
    const lines = body.split(/\r?\n/).filter((line) => line.includes(sentinel.phrase));
    for (const line of lines) {
      const route = line.match(/`(pm:[a-z][a-z0-9-]*)`/i)?.[1];
      if (route && route !== sentinel.expected) {
        issues.push(
          issue(
            "D3-ROUTE-001",
            file,
            `${sentinel.phrase} routes to ${route}; expected ${sentinel.expected}`
          )
        );
      }
    }
  }
}

function validateGeneratedPrompt(rootDir, issues) {
  const relative = "plugin.config.json";
  const raw = readOptional(rootDir, relative);
  if (raw === null) return;
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return;
  }
  const prompts = config?.codex?.interface?.defaultPrompt;
  if (!Array.isArray(prompts)) return;
  if (prompts.some((prompt) => /sprint-ready issues/i.test(String(prompt)))) {
    issues.push(
      issue(
        "D3-DOC-001",
        relative,
        "default prompt bypasses the proposal and RFC boundaries by promising sprint-ready issues"
      )
    );
  }
}

function readOptional(rootDir, relative) {
  const target = path.join(rootDir, relative);
  return isRegularFile(target) ? fs.readFileSync(target, "utf8") : null;
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function issue(ruleId, file, message) {
  return { ruleId, severity: "error", file, message };
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

module.exports = {
  INTERNAL_PM_LANES,
  ROUTING_SENTINELS,
  SEMANTIC_RULE_IDS,
  validateSemanticContracts,
};
