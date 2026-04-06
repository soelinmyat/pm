#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
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

function runGit(args, cwd) {
  try {
    return childProcess
      .execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
  } catch {
    return "";
  }
}

function detectProjectRoot(projectDir) {
  const cwd = projectDir || process.cwd();
  return runGit(["rev-parse", "--show-toplevel"], cwd) || cwd;
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "n/a";
  }
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) {
    return remSeconds === 0 ? `${minutes}m` : `${minutes}m ${remSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}

function median(numbers) {
  if (!numbers.length) {
    return null;
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function aggregateBy(records, keyFn, fields) {
  const buckets = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!buckets.has(key)) {
      buckets.set(key, { key, count: 0 });
    }
    const bucket = buckets.get(key);
    bucket.count += 1;
    for (const field of fields) {
      bucket[field] = (bucket[field] || 0) + (Number(record[field]) || 0);
    }
  }
  return [...buckets.values()];
}

function topBy(records, field, limit) {
  return [...records]
    .filter((record) => Number.isFinite(record[field]))
    .sort((a, b) => b[field] - a[field])
    .slice(0, limit);
}

function formatStepLabel(record) {
  const phase = record.phase ? `${record.phase} / ` : "";
  return `${record.skill} — ${phase}${record.step}`;
}

function buildBaseline(projectRoot) {
  const analyticsDir = path.join(projectRoot, ".pm", "analytics");
  const activity = readJsonLines(path.join(analyticsDir, "activity.jsonl"));
  const steps = readJsonLines(path.join(analyticsDir, "steps.jsonl"));
  const today = new Date().toISOString().slice(0, 10);

  const lines = [
    "---",
    "type: telemetry-baseline",
    `created: ${today}`,
    `updated: ${today}`,
    "source: .pm/analytics/",
    "---",
    "",
    "# PM Workflow Telemetry Baseline",
    "",
  ];

  if (activity.length === 0 && steps.length === 0) {
    lines.push(
      "No telemetry runs have been captured yet.",
      "",
      "## Next Step",
      "",
      "1. Enable analytics in `.claude/pm.local.md` with `analytics: true`.",
      "2. Run one or more PM workflows.",
      '3. Re-run `node scripts/pm-baseline.js --project-dir "$PWD" --output pm/evidence/research/tracking-dogfooding/baseline.md`.',
      ""
    );
    return lines.join("\n");
  }

  const runIds = new Set();
  for (const record of activity) {
    if (record.run_id) {
      runIds.add(record.run_id);
    }
  }
  for (const record of steps) {
    if (record.run_id) {
      runIds.add(record.run_id);
    }
  }

  const failedReviewSignals = steps.filter((record) => {
    const step = String(record.step || "").toLowerCase();
    const status = String(record.status || "").toLowerCase();
    return (
      step.includes("review") &&
      (status.includes("fail") || status.includes("blocked") || status.includes("send-back"))
    );
  }).length;

  lines.push("## Summary", "");
  lines.push(`- Runs captured: ${runIds.size || 0}`);
  lines.push(`- Activity events: ${activity.length}`);
  lines.push(`- Step spans: ${steps.length}`);
  lines.push(
    `- Median step duration: ${formatDuration(median(steps.map((record) => Number(record.duration_ms) || 0).filter(Boolean)))}`
  );
  lines.push(
    `- Median estimated step tokens: ${median(steps.map((record) => (Number(record.est_input_tokens) || 0) + (Number(record.est_output_tokens) || 0)).filter(Boolean)) || "n/a"}`
  );
  lines.push(`- Review/send-back signals: ${failedReviewSignals}`);
  lines.push("");

  const slowestSteps = topBy(steps, "duration_ms", 5);
  lines.push("## Slowest Steps", "");
  if (slowestSteps.length === 0) {
    lines.push("- No step timing records yet.");
  } else {
    for (const record of slowestSteps) {
      lines.push(
        `- ${formatStepLabel(record)} — ${formatDuration(record.duration_ms)} (${record.run_id})`
      );
    }
  }
  lines.push("");

  const tokenHeavySteps = [...steps]
    .map((record) => ({
      ...record,
      total_tokens:
        (Number(record.est_input_tokens) || 0) + (Number(record.est_output_tokens) || 0),
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .slice(0, 5);
  lines.push("## Highest Estimated Token Steps", "");
  if (tokenHeavySteps.length === 0 || tokenHeavySteps[0].total_tokens === 0) {
    lines.push("- No token records yet.");
  } else {
    for (const record of tokenHeavySteps) {
      lines.push(
        `- ${formatStepLabel(record)} — ${record.total_tokens} tokens (${record.token_source})`
      );
    }
  }
  lines.push("");

  const retries = steps.filter((record) => Number(record.attempt) > 1);
  lines.push("## Retry Hotspots", "");
  if (retries.length === 0) {
    lines.push("- No retry-heavy steps recorded yet.");
  } else {
    const groupedRetries = aggregateBy(
      retries,
      (record) => `${record.skill}:${record.phase || "none"}:${record.step}`,
      ["duration_ms"]
    );
    groupedRetries.sort((a, b) => b.count - a.count || b.duration_ms - a.duration_ms);
    for (const retry of groupedRetries.slice(0, 5)) {
      lines.push(`- ${retry.key} — ${retry.count} retry spans`);
    }
  }
  lines.push("");

  const bySkill = aggregateBy(steps, (record) => record.skill, [
    "duration_ms",
    "est_input_tokens",
    "est_output_tokens",
  ]);
  bySkill.sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0));
  lines.push("## Skill Breakdown", "");
  if (bySkill.length === 0) {
    lines.push("- No skill breakdown available.");
  } else {
    for (const bucket of bySkill) {
      const totalTokens = (bucket.est_input_tokens || 0) + (bucket.est_output_tokens || 0);
      lines.push(
        `- ${bucket.key}: ${bucket.count} steps, ${formatDuration(bucket.duration_ms || 0)}, ${totalTokens} est tokens`
      );
    }
  }
  lines.push("");

  const byActor = aggregateBy(steps, (record) => record.actor || "orchestrator", [
    "duration_ms",
    "est_input_tokens",
    "est_output_tokens",
  ]);
  byActor.sort((a, b) => {
    const aTokens = (b.est_input_tokens || 0) + (b.est_output_tokens || 0);
    const bTokens = (a.est_input_tokens || 0) + (a.est_output_tokens || 0);
    return aTokens - bTokens;
  });
  lines.push("## Actor Breakdown (Orchestrator vs Agents)", "");
  if (byActor.length === 0) {
    lines.push("- No actor data available yet.");
  } else {
    let totalAllTokens = 0;
    for (const bucket of byActor) {
      totalAllTokens += (bucket.est_input_tokens || 0) + (bucket.est_output_tokens || 0);
    }
    for (const bucket of byActor) {
      const totalTokens = (bucket.est_input_tokens || 0) + (bucket.est_output_tokens || 0);
      const pct = totalAllTokens > 0 ? Math.round((totalTokens / totalAllTokens) * 100) : 0;
      lines.push(
        `- ${bucket.key}: ${bucket.count} steps, ${formatDuration(bucket.duration_ms || 0)}, ${totalTokens} est tokens (${pct}%)`
      );
    }
  }
  lines.push("");

  const agentSteps = steps.filter((record) => (record.actor || "").startsWith("agent:"));
  const byAgentType = aggregateBy(agentSteps, (record) => record.actor, [
    "duration_ms",
    "est_input_tokens",
    "est_output_tokens",
  ]);
  byAgentType.sort((a, b) => b.count - a.count);
  lines.push("## Agent Dispatch Frequency", "");
  if (byAgentType.length === 0) {
    lines.push("- No agent dispatches recorded yet.");
  } else {
    for (const bucket of byAgentType) {
      const totalTokens = (bucket.est_input_tokens || 0) + (bucket.est_output_tokens || 0);
      const avgTokens = bucket.count > 0 ? Math.round(totalTokens / bucket.count) : 0;
      lines.push(
        `- ${bucket.key}: ${bucket.count} dispatches, avg ${avgTokens} est tokens/dispatch`
      );
    }
  }
  lines.push("");

  lines.push("## Notes", "");
  lines.push(
    "- Exact token usage is used when supplied by the workflow. Otherwise the logger falls back to character-based estimates."
  );
  lines.push(
    "- Agent token estimates reflect prompt/result I/O size only — actual agent consumption (file reads, tool calls, thinking) is higher."
  );
  lines.push(
    "- Review/send-back signals are currently inferred from step status fields and should be interpreted as directional until more corpus exists."
  );
  lines.push("");

  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = detectProjectRoot(options["project-dir"]);
  const markdown = buildBaseline(projectRoot);
  if (options.output) {
    const outputPath = path.isAbsolute(options.output)
      ? options.output
      : path.join(projectRoot, options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, markdown);
  } else {
    process.stdout.write(markdown);
  }
}

main();
