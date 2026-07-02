#!/usr/bin/env node
"use strict";

const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { validateScenario } = require("./check.js");
const { buildSandboxPlan } = require("./containment.js");
const { detectContainerRuntime } = require("./sandbox.js");
const { safeCopyTree, createSourceIdentity, createScenarioIdentity } = require("./stage.js");
const { parseCheckFrames } = require("./transcript.js");
const { composeVerdict } = require("./verdict.js");

const RUNTIME_PATHS = [
  "commands",
  "skills",
  "scripts",
  "hooks",
  "references",
  "agents",
  "templates",
  "plugin.config.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".codex/INSTALL.md",
  "README.md",
];

function main(argv) {
  try {
    const opts = parseArgs(argv);
    const verdict = runEval(opts);
    process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
    return verdict.status === "pass" || verdict.status === "skip" ? 0 : 1;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

function parseArgs(argv) {
  const opts = {
    rootDir: process.cwd(),
    agent: "stub",
    scenarioArg: null,
    runId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--agent") {
      opts.agent = requireValue(argv, (index += 1), arg);
    } else if (arg === "--run-id") {
      opts.runId = requireValue(argv, (index += 1), arg);
    } else if (arg === "--root") {
      opts.rootDir = path.resolve(requireValue(argv, (index += 1), arg));
    } else if (!opts.scenarioArg) {
      opts.scenarioArg = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!opts.scenarioArg) {
    throw new Error("usage: node scripts/evals/run.js <scenario-dir> [--agent stub|codex]");
  }
  return opts;
}

function requireValue(argv, index, flag) {
  if (!argv[index]) throw new Error(`${flag} requires a value`);
  return argv[index];
}

function runEval(opts) {
  const rootDir = path.resolve(opts.rootDir);
  const scenarioDir = path.resolve(rootDir, opts.scenarioArg);
  const scenarioId = path.basename(scenarioDir);
  const agent = opts.agent;
  const runId = opts.runId || `${timestamp()}--${scenarioId}--${agent}`;
  const startedAt = new Date().toISOString();

  validateRunId(runId, scenarioId, agent);
  const adapter = loadAdapter(agent);

  const validation = validateScenario(scenarioDir);
  if (!validation.ok) {
    throw new Error(`scenario validation failed: ${JSON.stringify(validation.issues, null, 2)}`);
  }

  const runDir = path.join(rootDir, "eval-results", "runs", runId);
  const paths = createRunLayout(runDir);
  paths.rootDir = rootDir;
  paths.scenarioDir = scenarioDir;
  paths.scenarioId = scenarioId;
  paths.runId = runId;

  stageRuntime(rootDir, paths.runtimeDir);
  safeCopyTree(scenarioDir, paths.scenarioStageDir);
  writeJson(
    path.join(paths.metadataDir, "source_identity.json"),
    sourceIdentity(rootDir, paths.runtimeDir)
  );
  writeJson(
    path.join(paths.metadataDir, "scenario_identity.json"),
    createScenarioIdentity({ id: scenarioId, scenarioDir: paths.scenarioStageDir })
  );
  writeSandboxIdentity(paths, agent);

  writeJson(path.join(paths.metadataDir, "adapter_boot.json"), {
    adapter: adapter.name || agent,
    run_id: runId,
    isolated_home: rel(paths.homeDir, runDir),
    staged_plugin_root: rel(paths.runtimeDir, runDir),
    argv: ["node", "scripts/evals/run.js", rel(scenarioDir, rootDir), "--agent", agent],
  });

  const preflight = runAdapterPreflight(adapter, { scenarioId, paths });
  if (preflight.status === "skip") {
    const verdict = makeVerdict({
      scenarioId,
      agent,
      runId,
      startedAt,
      status: "skip",
      reason: preflight.reason,
    });
    writeJson(path.join(runDir, "verdict.json"), verdict);
    return verdict;
  }

  const setup = runSetup(paths);
  if (setup.status !== 0) {
    const verdict = makeVerdict({
      scenarioId,
      agent,
      runId,
      startedAt,
      status: "indeterminate",
      reason: "setup-failed",
    });
    writeJson(path.join(runDir, "verdict.json"), verdict);
    return verdict;
  }

  const pre = runCheckPhase(paths, "pre");
  const adapterResult = adapter.run({ scenarioId, paths });
  if (adapterResult.status === "skip") {
    const verdict = makeVerdict({
      scenarioId,
      agent,
      runId,
      startedAt,
      status: "skip",
      reason: adapterResult.reason,
    });
    writeJson(path.join(runDir, "verdict.json"), verdict);
    return verdict;
  }
  if (adapterResult.status === "indeterminate") {
    const verdict = makeVerdict({
      scenarioId,
      agent,
      runId,
      startedAt,
      status: "indeterminate",
      reason: adapterResult.reason || "adapter-indeterminate",
    });
    writeJson(path.join(runDir, "verdict.json"), verdict);
    return verdict;
  }
  if (adapterResult.status === "fail") {
    // A behavioral failure the adapter detected post-run (e.g. containment
    // escape). Unlike wrong-source (indeterminate = untrustworthy harness), the
    // agent misbehaved, so this is a hard fail — skip the check phases.
    const verdict = makeVerdict({
      scenarioId,
      agent,
      runId,
      startedAt,
      status: "fail",
      reason: adapterResult.reason || "adapter-fail",
    });
    writeJson(path.join(runDir, "verdict.json"), verdict);
    return verdict;
  }
  const post = runCheckPhase(paths, "post");

  const hazards = [...pre.hazards, ...post.hazards];
  const verdict = composeVerdict({
    scenario: scenarioId,
    agent,
    runId,
    startedAt,
    endedAt: new Date().toISOString(),
    preExecuted: true,
    postExecuted: true,
    preRecords: pre.records,
    postRecords: post.records,
    hazards,
  });
  writeJson(path.join(runDir, "verdict.json"), verdict);
  return verdict;
}

function validateRunId(runId, scenarioId, agent) {
  const expectedSuffix = `--${scenarioId}--${agent}`;
  if (!runId.endsWith(expectedSuffix)) {
    throw new Error(`run id must end with ${expectedSuffix}`);
  }
  if (!/^[0-9]{8}T[0-9]{6}Z--[a-z0-9][a-z0-9-]{0,80}--[a-z0-9][a-z0-9-]{0,40}$/.test(runId)) {
    throw new Error(`invalid run id: ${runId}`);
  }
}

function createRunLayout(runDir) {
  fs.mkdirSync(path.dirname(runDir), { recursive: true });
  fs.mkdirSync(runDir, { recursive: false });

  const paths = {
    runDir,
    runtimeDir: path.join(runDir, "runtime", "pm"),
    scenarioStageDir: path.join(runDir, "scenario"),
    workdir: path.join(runDir, "workdir"),
    homeDir: path.join(runDir, "home"),
    xdgCacheDir: path.join(runDir, "xdg-cache"),
    xdgConfigDir: path.join(runDir, "xdg-config"),
    xdgDataDir: path.join(runDir, "xdg-data"),
    tmpDir: path.join(runDir, "tmp"),
    artifactsDir: path.join(runDir, "artifacts"),
    metadataDir: path.join(runDir, "metadata"),
  };
  paths.transcriptRaw = path.join(paths.metadataDir, "transcript.raw.jsonl");
  paths.transcriptNormalized = path.join(paths.metadataDir, "transcript.normalized.jsonl");

  for (const dir of [
    paths.runtimeDir,
    paths.scenarioStageDir,
    paths.workdir,
    paths.homeDir,
    paths.xdgCacheDir,
    paths.xdgConfigDir,
    paths.xdgDataDir,
    paths.tmpDir,
    paths.artifactsDir,
    paths.metadataDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(paths.artifactsDir, "raw-output"), { recursive: true });
  return paths;
}

function stageRuntime(rootDir, runtimeDir) {
  for (const relPath of RUNTIME_PATHS) {
    const source = path.join(rootDir, relPath);
    if (!fs.existsSync(source)) continue;
    safeCopyTree(source, path.join(runtimeDir, relPath));
  }
}

function sourceIdentity(rootDir, runtimeDir) {
  return createSourceIdentity({
    sourceRef: git(rootDir, ["rev-parse", "--short", "HEAD"]) || "unknown",
    branch: git(rootDir, ["branch", "--show-current"]) || "unknown",
    dirty: Boolean(git(rootDir, ["status", "--porcelain"])),
    runtimeDir,
  });
}

function writeSandboxIdentity(paths, agent) {
  const detected = detectContainerRuntime();
  writeJson(path.join(paths.metadataDir, "sandbox_identity.json"), {
    mode: agent === "stub" ? "stub-local" : "container-required",
    container_runtime: detected.ok ? detected.name : null,
    plan: buildSandboxPlan({ runDir: paths.runDir, adapter: agent }),
  });
}

function runAdapterPreflight(adapter, context) {
  if (typeof adapter.preflight !== "function") return { status: "pass" };
  return adapter.preflight(context) || { status: "pass" };
}

function runSetup(paths) {
  const setupPath = path.join(paths.scenarioStageDir, "setup.sh");
  const result = spawnSync("bash", [setupPath], {
    cwd: paths.workdir,
    env: phaseEnv(paths),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  writeText(path.join(paths.metadataDir, "setup.stdout.log"), result.stdout || "");
  writeText(path.join(paths.metadataDir, "setup.stderr.log"), result.stderr || "");
  return result;
}

function runCheckPhase(paths, phase) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const result = spawnSync(
    "bash",
    [
      "-c",
      'set -euo pipefail; source "$1"; source "$2"; __pm_eval_init "$3" "$4"; "$3"',
      "pm-eval-check",
      path.join(paths.runtimeDir, "scripts", "evals", "prelude.sh"),
      path.join(paths.scenarioStageDir, "checks.sh"),
      phase,
      nonce,
    ],
    {
      cwd: paths.workdir,
      env: phaseEnv(paths),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    }
  );
  writeText(path.join(paths.metadataDir, `${phase}.stdout.log`), result.stdout || "");
  writeText(path.join(paths.metadataDir, `${phase}.stderr.log`), result.stderr || "");

  const parsed = parseCheckFrames(result.stdout, {
    nonce,
    phase,
    maxPayloadBytes: 1024 * 1024,
  });
  const records = parsed.records;
  if (result.status !== 0 && records.length === 0) {
    records.push({ phase, helper: "phase", status: "indeterminate", reason: `${phase}-failed` });
  }
  writeJsonl(path.join(paths.metadataDir, `check-results.${phase}.jsonl`), records);

  return {
    records,
    hazards: parsed.rejected.map((rejected) => ({
      reason: "transcript-boundary",
      detail: `${phase}:${rejected.line}:${rejected.reason}`,
    })),
  };
}

function phaseEnv(paths) {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: paths.homeDir,
    TMPDIR: paths.tmpDir,
    XDG_CACHE_HOME: paths.xdgCacheDir,
    XDG_CONFIG_HOME: paths.xdgConfigDir,
    XDG_DATA_HOME: paths.xdgDataDir,
    PM_EVAL_ARTIFACTS_DIR: paths.artifactsDir,
    PM_EVAL_TRANSCRIPT: paths.transcriptNormalized,
    PM_EVAL_TRANSCRIPT_MODULE: path.join(paths.runtimeDir, "scripts", "evals", "transcript.js"),
  };
}

function loadAdapter(agent) {
  if (!/^[a-z][a-z0-9-]*$/.test(agent)) throw new Error(`invalid adapter name: ${agent}`);
  const adapterPath = path.join(__dirname, "adapters", `${agent}.js`);
  if (!fs.existsSync(adapterPath)) throw new Error(`unknown adapter: ${agent}`);
  return require(adapterPath);
}

function makeVerdict({ scenarioId, agent, runId, startedAt, status, reason }) {
  const endedAt = new Date().toISOString();
  return {
    scenario: scenarioId,
    agent,
    status,
    reason,
    run_id: runId,
    source_identity: "metadata/source_identity.json",
    scenario_identity: "metadata/scenario_identity.json",
    artifact_ref: `runs/${runId}`,
    started_at: startedAt,
    ended_at: endedAt,
  };
}

function timestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function git(rootDir, args) {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")
  );
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function rel(target, from) {
  return path.relative(from, target).split(path.sep).join("/");
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  runEval,
  loadAdapter,
  parseArgs,
  timestamp,
};
