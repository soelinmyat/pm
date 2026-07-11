#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { bulletValue, markdownTableValue } = require("./lib/session-scan");

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
        if (session.status === "complete") continue;
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
        markdownTableValue(text, "Branch") || bulletValue(text, "Branch").replace(/\*/g, "");
      if (issue && branch) records.push({ issue, branch, sessionPath: entryPath });
    }
  }
  return records;
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

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    process.stderr.write("Usage: dev-reconcile-scan <session-dir>\n");
    return 2;
  }
  const output = tsv(scanSessionDirectory(path.resolve(argv[0])));
  if (output) process.stdout.write(`${output}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, scanSessionDirectory, tsv };
