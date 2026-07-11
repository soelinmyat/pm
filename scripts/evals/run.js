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
const { parseFrontmatter } = require("../kb-frontmatter.js");
const { loadQualityCase, loadQualityProfile } = require("./quality.js");

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
    qualityCase: null,
    qualityProfile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--agent") {
      opts.agent = requireValue(argv, (index += 1), arg);
    } else if (arg === "--run-id") {
      opts.runId = requireValue(argv, (index += 1), arg);
    } else if (arg === "--root") {
      opts.rootDir = path.resolve(requireValue(argv, (index += 1), arg));
    } else if (arg === "--quality-case") {
      opts.qualityCase = requireValue(argv, (index += 1), arg);
    } else if (arg === "--quality-profile") {
      opts.qualityProfile = requireValue(argv, (index += 1), arg);
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
  const qualityCase = opts.qualityCase ? loadQualityCase(rootDir, opts.qualityCase) : null;
  if (qualityCase) validateQualityCaseCompatibility(scenarioDir, qualityCase);
  const qualityProfile = opts.qualityProfile
    ? loadQualityProfile(rootDir, opts.qualityProfile)
    : null;
  if (qualityProfile && !qualityCase) {
    throw new Error("--quality-profile requires --quality-case");
  }
  if (qualityCase && ["codex", "claude"].includes(agent) && !qualityProfile) {
    throw new Error("live quality runs require --quality-profile");
  }
  if (qualityProfile && qualityProfile.adapter !== agent) {
    throw new Error(
      `quality profile ${qualityProfile.id} requires adapter ${qualityProfile.adapter}, not ${agent}`
    );
  }

  const runDir = path.join(rootDir, "eval-results", "runs", runId);
  const paths = createRunLayout(runDir);
  paths.rootDir = rootDir;
  paths.scenarioDir = scenarioDir;
  paths.scenarioId = scenarioId;
  paths.runId = runId;
  paths.qualityProfile = qualityProfile;

  stageRuntime(rootDir, paths.runtimeDir);
  safeCopyTree(scenarioDir, paths.scenarioStageDir);
  if (qualityCase) {
    stageQualityCase(paths, qualityCase);
  }
  if (qualityProfile) {
    writeJson(path.join(paths.metadataDir, "quality_profile_identity.json"), {
      schema_version: 1,
      id: qualityProfile.id,
      adapter: qualityProfile.adapter,
      model: qualityProfile.model,
      effort: qualityProfile.effort,
    });
  }
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
    argv: [
      "node",
      "scripts/evals/run.js",
      rel(scenarioDir, rootDir),
      "--agent",
      agent,
      ...(opts.qualityCase ? ["--quality-case", opts.qualityCase] : []),
      ...(opts.qualityProfile ? ["--quality-profile", opts.qualityProfile] : []),
    ],
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
  const hostRepoBefore = hostRepoSnapshot(rootDir);
  const adapterResult = adapter.run({ scenarioId, paths });
  // Backstop: if the run mutated the harness repo outside the (gitignored) run
  // dir — a walked-up commit, or new dirt/untracked in the source tree — that is
  // a containment escape regardless of what the adapter reported.
  if (hostRepoEscaped(rootDir, hostRepoBefore)) {
    const verdict = makeVerdict({
      scenarioId,
      agent,
      runId,
      startedAt,
      status: "fail",
      reason: "containment-escape",
    });
    writeJson(path.join(runDir, "verdict.json"), verdict);
    return verdict;
  }
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
    // escape) — skip the post-check phase; pre already ran and its records are
    // superseded by the hard fail.
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

function validateQualityCaseCompatibility(scenarioDir, qualityCase) {
  const scenarioId = path.basename(scenarioDir);
  if (scenarioId !== qualityCase.scenario_ref) {
    throw new Error(
      `quality case ${qualityCase.id} requires scenario ${qualityCase.scenario_ref}, not ${scenarioId}`
    );
  }
  const actualHash = createScenarioIdentity({ id: scenarioId, scenarioDir }).scenario_hash;
  if (actualHash !== qualityCase.scenario_contract_hash) {
    throw new Error(`quality case ${qualityCase.id} scenario contract has changed`);
  }
  const story = parseFrontmatter(fs.readFileSync(path.join(scenarioDir, "story.md"), "utf8"));
  const tags = new Set(Array.isArray(story.data.tags) ? story.data.tags : []);
  for (const tag of [qualityCase.workflow, qualityCase.type, "quality-evaluation"]) {
    if (!tags.has(tag))
      throw new Error(`quality case ${qualityCase.id} scenario missing tag ${tag}`);
  }
}

function stageQualityCase(paths, qualityCase) {
  const storyPath = path.join(paths.scenarioStageDir, "story.md");
  const story = fs.readFileSync(storyPath, "utf8");
  const marker = /User message:[\s\S]*?\n\nStop condition:/;
  if (!marker.test(story)) {
    throw new Error(
      `scenario ${paths.scenarioId} cannot accept a quality case: story has no user-message boundary`
    );
  }
  fs.writeFileSync(
    storyPath,
    story.replace(marker, () => `User message: ${qualityCase.prompt}\n\nStop condition:`)
  );
  writeJson(path.join(paths.metadataDir, "quality_case_identity.json"), {
    schema_version: 1,
    id: qualityCase.id,
    workflow: qualityCase.workflow,
    type: qualityCase.type,
    prompt_ref: qualityCase.prompt_ref,
    prompt_hash: qualityCase.prompt_hash,
    base_scenario: paths.scenarioId,
    scenario_ref: qualityCase.scenario_ref,
    scenario_contract_hash: qualityCase.scenario_contract_hash,
  });
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

// Host-repo escape backstop. eval-results/ is gitignored, so the run dir never
// appears in `git status` here — only mutations OUTSIDE it do. Comparing a
// before/after snapshot catches the plain-`git commit` walk-up from a repo-less
// workdir plus every relative-cd / symlink / env-var bypass the transcript
// tripwire cannot see. Degrades to a no-op when rootDir is not a git repo (git()
// returns "" for both, so before === after).
function hostRepoSnapshot(rootDir) {
  return {
    head: git(rootDir, ["rev-parse", "HEAD"]),
    status: git(rootDir, ["status", "--porcelain"]),
  };
}

function hostRepoEscaped(rootDir, before) {
  const after = hostRepoSnapshot(rootDir);
  return after.head !== before.head || after.status !== before.status;
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
  // Universal root repo: every workdir owns a git repo BEFORE its setup.sh runs,
  // so an engine can never walk up and mutate whatever repo encloses the staging
  // area. Scenarios that build their own root repo just reinitialize (harmless,
  // stays on main); scenarios that use nested subrepos (app/, kb/, …) or their
  // own root repo are unaffected. This is a barrier; the delta check in runEval
  // is the backstop.
  git(paths.workdir, ["init", "-q", "-b", "main"]);
  git(paths.workdir, ["config", "user.email", "pm-eval@example.com"]);
  git(paths.workdir, ["config", "user.name", "PM Eval"]);

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
    PM_PLUGIN_ROOT: paths.runtimeDir,
    CLAUDE_PLUGIN_ROOT: paths.runtimeDir,
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
  hostRepoSnapshot,
  hostRepoEscaped,
  stageQualityCase,
};
