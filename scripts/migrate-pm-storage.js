#!/usr/bin/env node
"use strict";

// One-shot migration of legacy `.pm/analytics/` storage into the shared kb
// repo's per-host JSONL files.
//
// Why this exists:
//   Before resolvePmPaths was adopted by writers, pm-log composed analytics
//   paths from `process.cwd()`'s git toplevel. In worktree setups that grew a
//   `.pm/analytics/` tree per worktree, fragmenting telemetry across worktree
//   directories and the main repo. This script folds those fragments back
//   into the canonical storage repo (kb), assigning a host_id to rows that
//   pre-date the host-scoped layout.
//
// What it does:
//   For a given project (e.g., cleanlog-mono), find every legacy
//   `<src>/.pm/analytics/{activity,steps}.jsonl` file under:
//     - <projectDir>/.pm/analytics/
//     - <projectDir>/.claude/worktrees/*/.pm/analytics/
//   For each row, ensure `host_id` is set (default to `os.hostname()` or
//   --host-id), then append to <kb>/.pm/analytics/{activity,steps}-<host>.jsonl.
//   Write a `.migrated.json` marker into each source dir so re-runs are
//   no-ops (override with --force).
//
// What it does NOT do:
//   - Delete source files. That is a separate destructive step the user must
//     authorize after verifying the migration.
//   - Migrate `.current-*` ephemeral state. Those regenerate on next run.
//   - Migrate `.state-before/` snapshots. Those are short-lived and host-local.
//
// Usage:
//   node scripts/migrate-pm-storage.js --project-dir <dir> [--host-id <id>]
//                                       [--dry-run] [--force]

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { sanitizeHostId } = require("./lib/analytics-paths.js");

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: migrate-pm-storage.js --project-dir <dir> [--host-id <id>] [--dry-run] [--force]"
  );
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) usage(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines — they would have been ignored by readers anyway
    }
  }
  return rows;
}

function appendJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  fs.appendFileSync(filePath, text);
}

function findSourceDirs(projectDir) {
  const dirs = [];
  const main = path.join(projectDir, ".pm", "analytics");
  if (fs.existsSync(main)) dirs.push(main);

  const worktreesRoot = path.join(projectDir, ".claude", "worktrees");
  if (fs.existsSync(worktreesRoot)) {
    for (const entry of fs.readdirSync(worktreesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(worktreesRoot, entry.name, ".pm", "analytics");
      if (fs.existsSync(candidate)) dirs.push(candidate);
    }
  }
  return dirs;
}

function migrateOne(sourceDir, kbAnalyticsDir, hostId, options) {
  const markerPath = path.join(sourceDir, ".migrated.json");
  const already = fs.existsSync(markerPath);
  if (already && !options.force) {
    return { sourceDir, skipped: true, reason: "marker present", activity: 0, steps: 0 };
  }

  const activityRows = readJsonLines(path.join(sourceDir, "activity.jsonl"));
  const stepsRows = readJsonLines(path.join(sourceDir, "steps.jsonl"));

  // Ensure host_id is set on every row. Existing host_id (e.g., from a
  // partially-migrated source) is preserved.
  for (const row of activityRows) {
    if (!row.host_id) row.host_id = hostId;
  }
  for (const row of stepsRows) {
    if (!row.host_id) row.host_id = hostId;
  }

  const activityTarget = path.join(kbAnalyticsDir, `activity-${hostId}.jsonl`);
  const stepsTarget = path.join(kbAnalyticsDir, `steps-${hostId}.jsonl`);

  if (!options.dryRun) {
    if (activityRows.length) appendJsonLines(activityTarget, activityRows);
    if (stepsRows.length) appendJsonLines(stepsTarget, stepsRows);
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          migrated_at: new Date().toISOString(),
          host_id: hostId,
          activity_rows: activityRows.length,
          steps_rows: stepsRows.length,
          activity_target: activityTarget,
          steps_target: stepsTarget,
        },
        null,
        2
      ) + "\n"
    );
  }

  return {
    sourceDir,
    skipped: false,
    activity: activityRows.length,
    steps: stepsRows.length,
    activityTarget,
    stepsTarget,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectDir = options["project-dir"];
  if (!projectDir) usage("--project-dir is required");
  const absProject = path.resolve(projectDir);
  if (!fs.existsSync(absProject)) usage(`Project dir does not exist: ${absProject}`);

  const { pmStateDir } = resolvePmPaths(absProject);
  const kbAnalyticsDir = path.join(pmStateDir, "analytics");

  const rawHostId = options["host-id"] || process.env.PM_HOST_ID || os.hostname() || "unknown-host";
  const hostId = sanitizeHostId(rawHostId) || "unknown-host";

  const sourceDirs = findSourceDirs(absProject);

  const dryRun = Boolean(options["dry-run"]);
  const force = Boolean(options.force);

  console.error(`Project:     ${absProject}`);
  console.error(`Kb analytics: ${kbAnalyticsDir}`);
  console.error(`Host ID:     ${hostId}`);
  console.error(`Dry run:     ${dryRun}`);
  console.error(`Force:       ${force}`);
  console.error(`Sources:     ${sourceDirs.length}`);
  console.error("");

  if (sourceDirs.length === 0) {
    console.error("No legacy .pm/analytics/ directories found. Nothing to migrate.");
    return;
  }

  let totalActivity = 0;
  let totalSteps = 0;
  let skipped = 0;
  for (const sourceDir of sourceDirs) {
    const result = migrateOne(sourceDir, kbAnalyticsDir, hostId, { dryRun, force });
    if (result.skipped) {
      console.error(`SKIP  ${sourceDir} (${result.reason})`);
      skipped += 1;
      continue;
    }
    totalActivity += result.activity;
    totalSteps += result.steps;
    console.error(
      `${dryRun ? "DRY" : "OK "}    ${sourceDir} → activity:${result.activity} steps:${result.steps}`
    );
  }

  console.error("");
  console.error(
    `Done. ${dryRun ? "Would write" : "Wrote"} ${totalActivity} activity + ${totalSteps} step rows ` +
      `to ${kbAnalyticsDir} (skipped ${skipped} already-migrated source(s)).`
  );
}

main();
