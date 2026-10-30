"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gitExec } = require("./git-env");
const { readProjectInput } = require("./project-file");

const POLICY_MARKER = "<!-- mcp-feature-coverage: required -->";
const MAX_BYTES = 1024 * 1024;
const hasPolicy = (content) => content.split(/\r?\n/).some((line) => line.trim() === POLICY_MARKER);
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const text = (value) => typeof value === "string" && value.trim().length > 0;
const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

// Inspect both committed policies so deleting the marker in the delivery diff
// cannot silently waive coverage. The working copy also activates a new policy.
function requiresMcpCoverage(root, refs = []) {
  const local = path.join(root, "AGENTS.md");
  if (
    fs.existsSync(local) &&
    fs.lstatSync(local).isFile() &&
    hasPolicy(readProjectInput(root, "AGENTS.md", MAX_BYTES).bytes.toString())
  )
    return true;
  if (!fs.existsSync(path.join(root, ".git"))) return false;
  for (const ref of refs.filter(Boolean)) {
    // In-memory gate callers may omit Git identity. The delivery checker owns
    // validating the authoritative base/head before calling this policy check.
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref)) continue;
    const files = gitExec(root, ["ls-tree", "--name-only", ref, "--", "AGENTS.md"]).trim();
    if (files && hasPolicy(gitExec(root, ["show", `${ref}:AGENTS.md`]))) return true;
  }
  return false;
}

function checkMcpCoverage({ root, session, commit, baseCommit, reportDirectory }) {
  const issues = [];
  const fail = (message) => issues.push(`MCP coverage: ${message}`);
  try {
    if (!requiresMcpCoverage(root, [baseCommit, commit]))
      return { ok: true, required: false, issues };
    if (!session || !baseCommit || !commit)
      throw new Error("canonical session and resolved base/head are required");
    const evidenceRoot = root; // Gate artifacts belong to source.worktree, not the originating session.
    const directory = path.relative(evidenceRoot, reportDirectory).split(path.sep).join("/");
    const report = JSON.parse(
      readProjectInput(evidenceRoot, `${directory}/mcp-coverage.json`, MAX_BYTES).bytes
    );
    if (
      !exactKeys(report, [
        "schema_version",
        "run_id",
        "commit",
        "base_commit",
        "entries",
        "checks",
      ]) ||
      report.schema_version !== 1
    )
      throw new Error("report must use the closed v1 schema");
    if (
      report.run_id !== session.run_id ||
      report.commit !== commit ||
      report.base_commit !== baseCommit
    )
      fail("report is stale or belongs to another run/base/head");
    const criteria = session.task?.acceptance_criteria;
    if (!Array.isArray(criteria) || criteria.length === 0)
      throw new Error("session acceptance criteria are required");
    if (
      !Array.isArray(report.entries) ||
      report.entries.length !== criteria.length ||
      report.entries.length > 128
    )
      throw new Error("one entry per acceptance criterion is required");
    if (!Array.isArray(report.checks) || report.checks.length > 128)
      throw new Error("checks must be a bounded array");
    const checks = new Set();
    for (const check of report.checks) {
      if (
        !exactKeys(check, ["id", "command", "exit_code", "artifact", "sha256"]) ||
        !text(check.id) ||
        !text(check.command) ||
        check.exit_code !== 0 ||
        !/^[a-f0-9]{64}$/.test(check.sha256)
      )
        throw new Error(
          "checks require unique IDs, executed commands, exit_code 0 and retained output hashes"
        );
      if (checks.has(check.id)) throw new Error("duplicate check ID");
      checks.add(check.id);
      if (!text(check.artifact) || !check.artifact.startsWith(`${directory}/mcp-evidence/`))
        throw new Error("check output must be retained in this session's mcp-evidence directory");
      const bytes = readProjectInput(evidenceRoot, check.artifact, MAX_BYTES).bytes;
      if (!bytes.length || digest(bytes) !== check.sha256)
        fail("retained check output is empty or its hash changed");
    }
    report.entries.forEach((entry, index) => {
      if (!exactKeys(entry, ["criterion", "status", "rationale", "tools", "check_ids"]))
        throw new Error("entries must use the closed coverage schema");
      if (entry.criterion !== criteria[index])
        fail(`entry ${index + 1} must match its current acceptance criterion`);
      if (!text(entry.rationale) || entry.rationale.trim().length < 40)
        fail(`entry ${index + 1} needs a concrete coverage or non-applicability rationale`);
      if (
        !Array.isArray(entry.tools) ||
        !entry.tools.every(text) ||
        new Set(entry.tools).size !== entry.tools.length ||
        !Array.isArray(entry.check_ids) ||
        !entry.check_ids.every((id) => checks.has(id))
      )
        throw new Error("tool names and check references are invalid");
      if (entry.status === "covered") {
        if (!entry.tools.length || !entry.check_ids.length)
          fail(`entry ${index + 1} needs MCP tools and passing checks`);
      } else if (entry.status === "not_applicable") {
        if (entry.tools.length || entry.check_ids.length)
          fail(`entry ${index + 1} cannot claim non-applicability and MCP coverage together`);
      } else
        fail(`entry ${index + 1} is incomplete; only covered or justified not_applicable can pass`);
    });
  } catch (error) {
    fail(error.message);
  }
  return { ok: issues.length === 0, required: true, issues };
}

module.exports = { POLICY_MARKER, requiresMcpCoverage, checkMcpCoverage };
