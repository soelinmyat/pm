#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { bulletValue, markdownTableValue } = require("./lib/session-scan");
const { getPrInfo, runGhWithRetry } = require("./pr-state");

function scanSessionDirectory(sessionDir) {
  if (!fs.existsSync(sessionDir)) return [];
  const records = [];
  for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
    if (entry.name === "completed") continue;
    const entryPath = path.join(sessionDir, entry.name);
    if (entry.isDirectory()) {
      const sessionPath = path.join(entryPath, "session.json");
      if (!fs.existsSync(sessionPath)) continue;
      try {
        const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
        if (["complete", "handoff"].includes(session.status)) continue;
        const issue = String(session.task?.reference || "").match(/[A-Z]+-[0-9]+/)?.[0] || "";
        const branch = String(session.source?.branch || "");
        if (issue && branch) records.push({ issue, branch, sessionPath });
      } catch {
        // Invalid sessions are surfaced by pm:list; reconciliation cannot infer their branch safely.
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const text = fs.readFileSync(entryPath, "utf8");
      const issue =
        (text.match(/[A-Z]+-[0-9]+/) || [""])[0] ||
        markdownTableValue(text, "Ticket") ||
        markdownTableValue(text, "Parent Issue");
      const branch =
        markdownTableValue(text, "Branch") ||
        bulletValue(text, "Branch").replace(/\*/g, "") ||
        plainFieldValue(text, "Branch");
      if (issue && branch) records.push({ issue, branch, sessionPath: entryPath });
    }
  }
  return records;
}

function plainFieldValue(text, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, "im"));
  return match ? match[1].replace(/[`*]/g, "").trim() : "";
}

function tsv(records) {
  return records
    .map(({ issue, branch, sessionPath }) =>
      [issue, branch, sessionPath]
        .map((value) => String(value).replace(/[\t\r\n]/g, " "))
        .join("\t")
    )
    .join("\n");
}

function recentMergedBranches(hours, options = {}) {
  const result = runGhWithRetry(
    ["pr", "list", "--state", "merged", "--limit", "100", "--json", "headRefName,mergedAt,state"],
    options
  );
  if (result.code !== 0) throw new Error(result.stderr || "GitHub PR list failed");
  let rows;
  try {
    rows = JSON.parse(result.stdout || "[]");
  } catch (error) {
    throw new Error(`GitHub PR list returned invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(rows)) throw new Error("GitHub PR list did not return an array");
  const cutoff = (options.now || Date.now()) - hours * 60 * 60 * 1000;
  const merged = new Set(
    rows
      .filter(
        (row) =>
          row &&
          row.state === "MERGED" &&
          typeof row.headRefName === "string" &&
          Date.parse(row.mergedAt || "") > cutoff
      )
      .map((row) => row.headRefName)
  );
  if (rows.length >= 100) {
    for (const branch of new Set(options.candidateBranches || [])) {
      if (merged.has(branch)) continue;
      const info = getPrInfo(branch, options);
      if (info.state === "MERGED" && Date.parse(info.mergedAt || "") > cutoff) {
        merged.add(branch);
      }
    }
  }
  return merged;
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 && argv.length !== 3) {
    process.stderr.write(
      "Usage: dev-reconcile-scan <session-dir> [--recent-merged-hours <hours>]\n"
    );
    return 2;
  }
  let records = scanSessionDirectory(path.resolve(argv[0]));
  if (argv.length === 3) {
    if (argv[1] !== "--recent-merged-hours") return 2;
    const hours = Number(argv[2]);
    if (!Number.isFinite(hours) || hours <= 0) return 2;
    try {
      const merged = recentMergedBranches(hours, {
        backoffMs: Number(process.env.PM_PR_STATE_BACKOFF_MS) || 1000,
        candidateBranches: records.map(({ branch }) => branch),
      });
      records = records.filter(({ branch }) => merged.has(branch));
    } catch {
      return 1;
    }
  }
  const output = tsv(records);
  if (output) process.stdout.write(`${output}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, plainFieldValue, recentMergedBranches, scanSessionDirectory, tsv };
