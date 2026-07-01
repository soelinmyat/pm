#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  REQUIRED_SENTINEL_IDS,
  validateBaselineLedger,
  validateResultLedger,
} = require("./check.js");
const { loadAdapter, runEval, timestamp } = require("./run.js");

const DEFAULT_BASELINE = "evals/baselines/sentinel.json";

function main(argv) {
  try {
    const opts = parseArgs(argv);
    const output = score(opts);
    if (opts.json) {
      process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    } else {
      process.stdout.write(formatScore(output) + "\n");
    }
    return 0;
  } catch (err) {
    if (err instanceof Usage) {
      process.stdout.write(`${err.message}\n`);
      return 0;
    }
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

function parseArgs(argv) {
  const opts = {
    rootDir: process.cwd(),
    baselinePath: DEFAULT_BASELINE,
    resultsPath: "",
    writePath: "",
    agent: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      opts.rootDir = path.resolve(requireValue(argv, ++index, arg));
    } else if (arg === "--baseline") {
      opts.baselinePath = requireValue(argv, ++index, arg);
    } else if (arg === "--results") {
      opts.resultsPath = requireValue(argv, ++index, arg);
    } else if (arg === "--write") {
      opts.writePath = requireValue(argv, ++index, arg);
    } else if (arg === "--agent") {
      opts.agent = requireValue(argv, ++index, arg);
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }

  if (opts.help) {
    throw new Usage(usage());
  }
  if (opts.agent && opts.resultsPath) {
    throw new Error("--agent and --results are mutually exclusive");
  }
  if (opts.writePath && !opts.agent) {
    throw new Error("--write requires --agent");
  }
  if (!opts.agent && !opts.resultsPath) {
    throw new Error(usage());
  }
  return opts;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function usage() {
  return [
    "Usage:",
    "  node scripts/evals/score.js --agent <adapter> [--write PATH] [--baseline PATH] [--json]",
    "  node scripts/evals/score.js --results PATH [--baseline PATH] [--json]",
  ].join("\n");
}

function score(opts) {
  const rootDir = path.resolve(opts.rootDir);
  let resultLedger;
  let resultsRef;
  if (opts.agent) {
    resultLedger = runSentinelSuite({ rootDir, agent: opts.agent });
    resultsRef = opts.writePath || "(generated)";
    if (opts.writePath) {
      writeLedger(path.resolve(rootDir, opts.writePath), resultLedger);
    }
  } else {
    resultsRef = opts.resultsPath;
    resultLedger = readJson(path.resolve(rootDir, opts.resultsPath));
  }

  const resultValidation = validateResultLedger(resultLedger, resultsRef, {
    requiredScenarioIds: REQUIRED_SENTINEL_IDS,
  });
  if (!resultValidation.ok) {
    throw new Error(`result ledger invalid: ${JSON.stringify(resultValidation.issues, null, 2)}`);
  }

  const baselineFullPath = path.resolve(rootDir, opts.baselinePath);
  const baselineLedger = fs.existsSync(baselineFullPath) ? readJson(baselineFullPath) : null;
  if (baselineLedger) {
    const baselineValidation = validateBaselineLedger(baselineLedger, opts.baselinePath, {
      requiredScenarioIds: REQUIRED_SENTINEL_IDS,
    });
    if (!baselineValidation.ok) {
      throw new Error(
        `baseline ledger invalid: ${JSON.stringify(baselineValidation.issues, null, 2)}`
      );
    }
  }

  return buildScoreReport({
    baseline: baselineLedger,
    results: resultLedger,
    baselineRef: baselineLedger ? opts.baselinePath : null,
    resultsRef,
  });
}

function runSentinelSuite({ rootDir, agent }) {
  loadAdapter(agent);
  const rows = [];
  for (const [index, scenarioId] of REQUIRED_SENTINEL_IDS.entries()) {
    const verdict = runEval({
      rootDir,
      scenarioArg: path.join("evals", "scenarios", scenarioId),
      agent,
      runId: uniqueRunId(rootDir, scenarioId, agent, index),
    });
    rows.push(verdictToLedgerRow(verdict));
  }
  return {
    $schema: "https://pm-plugin.local/evals/baseline.schema.json",
    schema_version: 1,
    updated: today(),
    scenarios: rows,
  };
}

function uniqueRunId(rootDir, scenarioId, agent, index) {
  const now = Date.now();
  for (let offset = 0; offset < 120; offset += 1) {
    const stamp = timestamp(new Date(now + (index + offset) * 1000));
    const runId = `${stamp}--${scenarioId}--${agent}`;
    if (!fs.existsSync(path.join(rootDir, "eval-results", "runs", runId))) {
      return runId;
    }
  }
  throw new Error(`unable to allocate run id for ${scenarioId}`);
}

function verdictToLedgerRow(verdict) {
  return {
    id: verdict.scenario,
    tier: "sentinel",
    agent: verdict.agent,
    status: verdict.status,
    reason: verdict.status === "pass" ? "" : verdict.reason || "no reason recorded",
    artifact_ref: verdict.artifact_ref,
    recorded_at: verdict.ended_at,
  };
}

function buildScoreReport({ baseline, results, baselineRef, resultsRef }) {
  const resultStats = summarizeLedger(results);
  const baselineStats = baseline ? summarizeLedger(baseline) : null;
  const comparison = baseline ? compareLedgers(baseline, results) : null;
  return {
    results_ref: resultsRef,
    baseline_ref: baselineRef,
    agent: commonAgent(results),
    results: resultStats,
    baseline: baselineStats,
    comparison,
  };
}

function summarizeLedger(ledger) {
  const counts = { pass: 0, fail: 0, skip: 0, indeterminate: 0 };
  for (const row of ledger.scenarios) counts[row.status] += 1;
  const determinate = counts.pass + counts.fail;
  return {
    total: ledger.scenarios.length,
    ...counts,
    determinate,
    determinate_pass_rate: determinate === 0 ? null : counts.pass / determinate,
  };
}

function compareLedgers(baseline, results) {
  const baselineById = new Map(baseline.scenarios.map((row) => [row.id, row]));
  const comparable = [];
  const improvements = [];
  const regressions = [];
  const newlyUnscorable = [];
  const newlyScored = [];
  const notComparable = [];

  for (const result of results.scenarios) {
    const base = baselineById.get(result.id);
    if (!base) {
      notComparable.push(result.id);
      continue;
    }
    const baseDet = isDeterminate(base.status);
    const resultDet = isDeterminate(result.status);
    if (baseDet && resultDet) {
      comparable.push(result.id);
      if (base.status === "fail" && result.status === "pass") improvements.push(result.id);
      if (base.status === "pass" && result.status === "fail") regressions.push(result.id);
    } else if (baseDet && !resultDet) {
      newlyUnscorable.push(result.id);
      notComparable.push(result.id);
    } else if (!baseDet && resultDet) {
      newlyScored.push(result.id);
      notComparable.push(result.id);
    } else {
      notComparable.push(result.id);
    }
  }

  return {
    comparable: comparable.length,
    improvements,
    regressions,
    newly_unscorable: newlyUnscorable,
    newly_scored: newlyScored,
    not_comparable: notComparable,
  };
}

function isDeterminate(status) {
  return status === "pass" || status === "fail";
}

function commonAgent(ledger) {
  const agents = [...new Set(ledger.scenarios.map((row) => row.agent))];
  return agents.length === 1 ? agents[0] : "mixed";
}

function formatScore(report) {
  const lines = [];
  lines.push("PM Eval Score");
  lines.push(`Agent: ${report.agent}`);
  lines.push(`Results: ${report.results_ref}`);
  lines.push(formatStats("Current", report.results));
  if (report.baseline) {
    lines.push(formatStats("Baseline", report.baseline));
    lines.push(`Comparable rows: ${report.comparison.comparable}`);
    lines.push(`Improvements: ${formatList(report.comparison.improvements)}`);
    lines.push(`Regressions: ${formatList(report.comparison.regressions)}`);
    lines.push(`Newly unscorable: ${formatList(report.comparison.newly_unscorable)}`);
    lines.push(`Newly scored: ${formatList(report.comparison.newly_scored)}`);
    if (report.results.determinate === 0) {
      lines.push(
        "Current score is not comparable to baseline. All result rows are skipped or indeterminate."
      );
    } else if (report.comparison.comparable === 0) {
      lines.push(
        "Current score is not comparable to baseline. No rows are determinate in both baseline and current results."
      );
    }
  } else {
    lines.push("Baseline: missing; comparison skipped.");
  }
  return lines.join("\n");
}

function formatStats(label, stats) {
  return `${label}: ${stats.pass} pass, ${stats.fail} fail, ${stats.skip} skip, ${
    stats.indeterminate
  } indeterminate; determinate pass rate ${formatRate(stats.determinate_pass_rate)} (${
    stats.pass
  }/${stats.determinate})`;
}

function formatRate(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatList(items) {
  return items.length === 0 ? "none" : `${items.length} (${items.join(", ")})`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeLedger(filePath, ledger) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2) + "\n");
}

function today(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

class Usage extends Error {}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  buildScoreReport,
  compareLedgers,
  formatScore,
  parseArgs,
  runSentinelSuite,
  score,
  summarizeLedger,
  verdictToLedgerRow,
};
