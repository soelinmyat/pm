#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parseFrontmatter } = require("../kb-frontmatter.js");

const REQUIRED_SCENARIO_FILES = ["story.md", "setup.sh", "checks.sh"];
const ALLOWED_SCENARIO_FILES = new Set(REQUIRED_SCENARIO_FILES);
const STORY_KEYS = ["id", "title", "status", "tier"];
const LEDGER_TOP_KEYS = new Set(["$schema", "schema_version", "updated", "scenarios"]);
const LEDGER_ROW_KEYS = new Set([
  "id",
  "tier",
  "agent",
  "status",
  "reason",
  "artifact_ref",
  "recorded_at",
]);
const VALID_STATUSES = new Set(["pass", "fail", "skip", "indeterminate"]);
const VALID_TIERS = new Set(["sentinel", "full", "adhoc"]);
const REQUIRED_SENTINEL_IDS = [
  "dev-ui-design-critique-required",
  "dev-review-before-push",
  "dev-tdd-before-implementation",
  "skill-description-body-read",
  "review-catches-planted-bug",
];
const ARTIFACT_REF_PATTERN =
  /^runs\/[0-9]{8}T[0-9]{6}Z--[a-z0-9][a-z0-9-]{0,80}--[a-z0-9][a-z0-9-]{0,40}$/;

function validateEvalTree(rootDir = process.cwd()) {
  const issues = [];
  const scenariosDir = path.join(rootDir, "evals", "scenarios");
  const ledgerPath = path.join(rootDir, "evals", "baselines", "sentinel.json");
  const hasSentinelLedger = fs.existsSync(ledgerPath);
  if (!fs.existsSync(scenariosDir)) {
    issues.push(issue("evals/scenarios", "missing evals/scenarios directory"));
  } else {
    const scenarioIds = new Set();
    for (const entry of fs.readdirSync(scenariosDir).sort()) {
      const full = path.join(scenariosDir, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      scenarioIds.add(entry);
      issues.push(...validateScenario(full).issues);
    }
    if (hasSentinelLedger) {
      for (const id of REQUIRED_SENTINEL_IDS) {
        if (!scenarioIds.has(id)) {
          issues.push(
            issue(path.join(scenariosDir, id), `missing required sentinel scenario ${id}`)
          );
        }
      }
    }
  }

  if (hasSentinelLedger) {
    try {
      issues.push(
        ...validateBaselineLedger(JSON.parse(fs.readFileSync(ledgerPath, "utf8")), ledgerPath, {
          requiredScenarioIds: REQUIRED_SENTINEL_IDS,
        }).issues
      );
    } catch (err) {
      issues.push(issue(ledgerPath, `baseline ledger is invalid JSON: ${err.message}`));
    }
  }

  return { ok: issues.length === 0, issues };
}

function validateScenario(scenarioDir) {
  const issues = [];
  const rel = toRel(scenarioDir);

  for (const file of REQUIRED_SCENARIO_FILES) {
    if (!fs.existsSync(path.join(scenarioDir, file))) {
      issues.push(issue(rel, `missing required file ${file}`));
    }
  }

  if (fs.existsSync(scenarioDir)) {
    for (const entry of fs.readdirSync(scenarioDir)) {
      if (!ALLOWED_SCENARIO_FILES.has(entry)) {
        issues.push(issue(path.join(rel, entry), `extra v1 file ${entry}`));
      }
    }
  }

  const storyPath = path.join(scenarioDir, "story.md");
  if (fs.existsSync(storyPath)) issues.push(...validateStory(storyPath));

  const setupPath = path.join(scenarioDir, "setup.sh");
  if (fs.existsSync(setupPath)) {
    if (!isExecutable(setupPath))
      issues.push(issue(toRel(setupPath), "setup.sh must be executable"));
    issues.push(...validateShell(setupPath, { allowTopLevel: true, requiredFunctions: [] }));
  }

  const checksPath = path.join(scenarioDir, "checks.sh");
  if (fs.existsSync(checksPath)) {
    if (isExecutable(checksPath)) {
      issues.push(issue(toRel(checksPath), "checks.sh must not be executable"));
    }
    issues.push(
      ...validateShell(checksPath, { allowTopLevel: false, requiredFunctions: ["pre", "post"] })
    );
  }

  return { ok: issues.length === 0, issues };
}

function validateStory(storyPath) {
  const issues = [];
  const text = fs.readFileSync(storyPath, "utf8");
  const parsed = parseFrontmatter(text);
  if (!parsed.hasFrontmatter) {
    issues.push(issue(toRel(storyPath), "story.md missing YAML frontmatter"));
    return issues;
  }
  for (const key of STORY_KEYS) {
    if (!parsed.data[key]) issues.push(issue(toRel(storyPath), `missing frontmatter key ${key}`));
  }
  if (!/^## Acceptance Criteria\s*$/m.test(parsed.body)) {
    issues.push(issue(toRel(storyPath), "missing ## Acceptance Criteria"));
  }
  return issues;
}

function validateShell(filePath, opts) {
  const issues = [];
  try {
    execFileSync("bash", ["-n", filePath], { stdio: "pipe" });
  } catch (err) {
    issues.push(
      issue(toRel(filePath), `bash -n failed: ${String(err.stderr || err.message).trim()}`)
    );
  }

  const text = fs.readFileSync(filePath, "utf8");
  for (const banned of bannedPatternIssues(text)) {
    issues.push(issue(toRel(filePath), banned));
  }

  const analysis = analyzeShellFunctions(text);
  if (!opts.allowTopLevel && analysis.hasTopLevel) {
    issues.push(issue(toRel(filePath), "checks.sh has top-level statements"));
  }
  for (const fn of opts.requiredFunctions || []) {
    if (!analysis.functions.includes(fn)) {
      issues.push(issue(toRel(filePath), `checks.sh missing ${fn}() function`));
    }
  }
  for (const fn of analysis.functions) {
    if ((opts.requiredFunctions || []).length > 0 && !opts.requiredFunctions.includes(fn)) {
      issues.push(issue(toRel(filePath), `checks.sh defines unsupported function ${fn}()`));
    }
  }
  return issues;
}

function bannedPatternIssues(text) {
  const issues = [];
  if (/\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+/.test(text)) {
    issues.push("absolute user-home path is banned");
  }
  if (/\b(curl|wget)\b/.test(text)) issues.push("network commands are banned");
  if (/(api[_-]?key|secret|password|token)\s*=\s*['"][^'"]+['"]/i.test(text)) {
    issues.push("obvious secret literal is banned");
  }
  if (/::pm-eval-check::/.test(text)) issues.push("raw helper frame emission is banned");
  if (/\bPM_EVAL_[A-Z0-9_]*\b/.test(text))
    issues.push("direct PM_EVAL_ harness variable access is banned");
  if (/(^|[;&|]\s*)[A-Za-z0-9_./"'-]+[^#\n]*&\s*($|#)/m.test(text)) {
    issues.push("background jobs are banned");
  }
  return issues;
}

function analyzeShellFunctions(text) {
  const functions = [];
  let hasTopLevel = false;
  let depth = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line === "}") {
      if (line === "}" && depth > 0) depth -= 1;
      continue;
    }
    const fnMatch = line.match(/^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{/);
    if (fnMatch && depth === 0) {
      functions.push(fnMatch[1]);
      depth += braceDelta(line);
      continue;
    }
    if (depth === 0) hasTopLevel = true;
    depth += braceDelta(line);
    if (depth < 0) depth = 0;
  }
  return { functions, hasTopLevel };
}

function braceDelta(line) {
  let delta = 0;
  for (const char of line) {
    if (char === "{") delta += 1;
    if (char === "}") delta -= 1;
  }
  return delta;
}

function validateBaselineLedger(ledger, filePath = "evals/baselines/sentinel.json", opts = {}) {
  const issues = [];
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    return { ok: false, issues: [issue(filePath, "baseline ledger must be an object")] };
  }
  for (const key of Object.keys(ledger)) {
    if (!LEDGER_TOP_KEYS.has(key))
      issues.push(issue(filePath, `unexpected top-level field ${key}`));
  }
  for (const key of LEDGER_TOP_KEYS) {
    if (!(key in ledger)) issues.push(issue(filePath, `missing top-level field ${key}`));
  }
  if (ledger.schema_version !== 1) issues.push(issue(filePath, "schema_version must equal 1"));
  if (!Array.isArray(ledger.scenarios)) {
    issues.push(issue(filePath, "scenarios must be an array"));
  } else {
    ledger.scenarios.forEach((row, index) => validateLedgerRow(row, index, filePath, issues));
    const ids = new Set(ledger.scenarios.map((row) => row && row.id).filter(Boolean));
    for (const id of opts.requiredScenarioIds || []) {
      if (!ids.has(id)) {
        issues.push(issue(filePath, `missing baseline row for ${id}`));
      }
    }
    const determinate = ledger.scenarios.filter(
      (row) => row.status === "pass" || row.status === "fail"
    ).length;
    if (ledger.scenarios.length >= 5 && determinate < 3) {
      issues.push(issue(filePath, "at least three baseline rows must be pass or fail"));
    }
    if (ledger.scenarios.length >= 5 && !ledger.scenarios.some((row) => row.status === "fail")) {
      issues.push(issue(filePath, "at least one baseline row must be a current-behavior fail"));
    }
  }
  return { ok: issues.length === 0, issues };
}

function validateLedgerRow(row, index, filePath, issues) {
  const where = `${filePath}#scenarios[${index}]`;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    issues.push(issue(where, "scenario row must be an object"));
    return;
  }
  for (const key of Object.keys(row)) {
    if (!LEDGER_ROW_KEYS.has(key)) issues.push(issue(where, `unexpected scenario field ${key}`));
  }
  for (const key of LEDGER_ROW_KEYS) {
    if (!(key in row)) issues.push(issue(where, `missing scenario field ${key}`));
  }
  if (!VALID_STATUSES.has(row.status)) issues.push(issue(where, `invalid status ${row.status}`));
  if (!VALID_TIERS.has(row.tier)) issues.push(issue(where, `invalid tier ${row.tier}`));
  if (["fail", "skip", "indeterminate"].includes(row.status) && !row.reason) {
    issues.push(issue(where, "reason is required for fail, skip, and indeterminate"));
  }
  if (!ARTIFACT_REF_PATTERN.test(String(row.artifact_ref || ""))) {
    issues.push(issue(where, `invalid artifact_ref ${row.artifact_ref}`));
  }
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== "string") continue;
    if (value.length > 500) issues.push(issue(where, `${key} exceeds 500 characters`));
    if (/\/Users\/|\/home\//.test(value)) {
      issues.push(issue(where, `${key} contains absolute path or username`));
    }
    if (/raw transcript|transcript text/i.test(value)) {
      issues.push(issue(where, `${key} appears to contain raw transcript text`));
    }
    if (/(api[_-]?key|secret|password|token)/i.test(value)) {
      issues.push(issue(where, `${key} appears to contain a credential`));
    }
  }
}

function isExecutable(filePath) {
  return (fs.statSync(filePath).mode & 0o111) !== 0;
}

function issue(file, message) {
  return { file: toRel(file), message };
}

function toRel(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/") || file;
}

function main(argv) {
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex === -1 ? process.cwd() : path.resolve(argv[rootIndex + 1]);
  const result = validateEvalTree(root);
  if (result.ok) {
    process.stdout.write(JSON.stringify({ ok: true, issues: [] }, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(JSON.stringify({ ok: false, issues: result.issues }, null, 2) + "\n");
  return 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  validateEvalTree,
  validateScenario,
  validateBaselineLedger,
  analyzeShellFunctions,
};
