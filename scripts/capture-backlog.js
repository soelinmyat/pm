#!/usr/bin/env node
"use strict";

// capture-backlog — write a lightweight backlog item for pm:task / pm:bug.
// CLI: node scripts/capture-backlog.js --pm-dir pm --kind task --title "..."
//                                      [--outcome "..."] [--priority medium]
//                                      [--labels chore,bug] [--body-file path]

const fs = require("fs");
const path = require("path");
const { writeMarkdown, todayIso } = require("./kb-utils.js");
const { nextBacklogId } = require("./note-helpers.js");

const PREFERRED_KEYS = [
  "type",
  "id",
  "title",
  "outcome",
  "kind",
  "status",
  "priority",
  "labels",
  "created",
  "updated",
];

function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function captureBacklogItem(pmDir, opts) {
  if (!opts || !opts.kind) {
    throw new Error("captureBacklogItem: kind is required");
  }
  if (!opts.title) {
    throw new Error("captureBacklogItem: title is required");
  }
  const kind = opts.kind;
  const title = opts.title;
  const outcome = opts.outcome || title;
  const slug = opts.slug || slugify(title);
  const id = opts.id || nextBacklogId(pmDir);
  const today = todayIso();
  const labels = Array.isArray(opts.labels) && opts.labels.length ? opts.labels : ["chore"];
  const frontmatter = {
    type: "backlog",
    id,
    title,
    outcome,
    kind,
    status: "proposed",
    priority: opts.priority || "medium",
    labels,
    created: today,
    updated: today,
  };
  const body = opts.body || "";
  const filePath = path.join(pmDir, "backlog", `${slug}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`captureBacklogItem: refusing to overwrite ${filePath}`);
  }
  writeMarkdown(filePath, frontmatter, body, PREFERRED_KEYS);
  return { filePath, id, slug };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    i++;
    opts[key] = value;
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pmDir = args["pm-dir"] || "pm";
  const labels = args.labels
    ? args.labels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const body = args["body-file"] ? fs.readFileSync(args["body-file"], "utf8") : args.body || "";
  const result = captureBacklogItem(pmDir, {
    kind: args.kind,
    title: args.title,
    outcome: args.outcome,
    priority: args.priority,
    labels,
    body,
    slug: args.slug,
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (require.main === module) {
  main();
}

module.exports = { captureBacklogItem, nextBacklogId, slugify };
