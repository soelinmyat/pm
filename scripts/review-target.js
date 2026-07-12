#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  allocateLenses,
  deriveLensApplicability,
  devReviewContext,
} = require("./lib/review-contract");
const projectWriter = require("./lib/project-atomic-write");
const { readProjectInput } = require("./lib/safe-project-output");
const {
  expectedPriorReportPath,
  expectedReviewPath,
  requireReviewPath,
  reviewPathContext,
  reviewRootFromTargetPath,
} = require("./lib/review-paths");

const MAX_BOUND_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;

function buildReviewTarget(options) {
  const root = fs.realpathSync(path.resolve(options.root || process.cwd()));
  assertCleanWorktree(root);
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  if (options.commit && options.commit !== commit)
    throw new Error(`supplied commit must equal current HEAD ${commit}`);
  const trusted = resolveTrustedBase(root);
  const baseRef = options.baseRef || trusted.ref;
  const baseCommit = options.baseCommit || trusted.commit;
  if (baseRef !== trusted.ref) throw new Error(`base must equal remote default ${trusted.ref}`);
  if (baseCommit !== trusted.commit)
    throw new Error(`base commit must equal remote default ${trusted.commit}`);
  const diff = git(root, ["diff", "--binary", `${baseCommit}...${commit}`], null);
  const changedFiles = changedFileInventory(root, baseCommit, commit);
  if (changedFiles.length === 0) throw new Error("review target has no changed files");
  if (changedFiles.length > 500) throw new Error("review target exceeds the 500-file budget");

  const mode = options.mode || "full";
  if (!new Set(["full", "code-scan"]).has(mode)) throw new Error("mode must be full or code-scan");
  const designEvidence = optionalBinding(
    root,
    options.designCritiquePath,
    "design critique report"
  );
  if (designEvidence && designEvidence.commit !== commit)
    throw new Error(`design critique report must attest current HEAD ${commit}`);
  const lenses = deriveLensApplicability(mode, changedFiles);
  const profile = loadProfile(options.profile || "codex-workhorse");
  const maxWorkers = positiveInt(options.maxWorkers || 3, "max workers");
  const allocation = allocateLenses(
    lenses.filter((item) => item.applicable).map((item) => item.name),
    maxWorkers,
    options.profile || "codex-workhorse"
  ).map((worker) => ({ ...worker, runtime: profile }));
  const round = positiveInt(options.round || 1, "round");
  if (round > 3) throw new Error("review round cannot exceed 3");
  const priorLoaded = optionalJsonFileBinding(root, options.priorReportPath, "prior report");
  const priorReport = priorLoaded?.binding || null;
  if (round > 1 && !priorReport) throw new Error("rounds after 1 require a prior report binding");
  if (round === 1 && priorReport) throw new Error("round 1 cannot bind a prior report");
  if (priorLoaded) {
    const priorCommit = priorLoaded.value?.source?.commit;
    if (!/^[a-f0-9]{40,64}$/.test(priorCommit || ""))
      throw new Error("prior report must contain a valid source commit");
    if (priorCommit === commit) throw new Error("later review rounds require a source mutation");
    try {
      git(root, ["merge-base", "--is-ancestor", priorCommit, commit]);
    } catch {
      throw new Error("prior report source commit must be an ancestor of current HEAD");
    }
  }
  const acceptance = optionalFileBinding(root, options.acceptancePath, "acceptance criteria");
  const devContext = options.devSessionPath ? loadDevContext(root, options.devSessionPath) : null;

  return {
    schema_version: 1,
    run_id: options.runId || `review-${crypto.randomUUID()}`,
    review_round: round,
    iteration_cap: 3,
    created_at: new Date().toISOString(),
    mode,
    source: {
      commit,
      base_ref: baseRef,
      base_commit: baseCommit,
      diff_sha256: digest(diff),
    },
    changed_files: changedFiles,
    dev_context: devContext,
    acceptance,
    upstream: { design_critique: designEvidence },
    ownership: {
      review: ["source-correctness", "contracts", "tests", "reuse", "quality", "efficiency"],
      design_critique: ["rendered-hierarchy", "density", "responsive-craft", "print-craft"],
      qa: ["live-behavior", "navigation", "state-transitions", "integrations"],
    },
    lenses,
    allocation,
    prior_report: priorReport,
  };
}

function loadDevContext(root, relative) {
  const loaded = optionalJsonFileBinding(root, relative, "Dev session");
  if (!loaded) throw new Error("Dev session is required");
  const errors = require("./lib/dev-session-schema").validateSession(loaded.value);
  if (errors.length > 0)
    throw new Error(
      `Dev session is invalid: ${errors
        .slice(0, 3)
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ")}`
    );
  return devReviewContext(loaded.value);
}

function resolveTrustedBase(root) {
  let output;
  try {
    output = execFileSync("git", ["ls-remote", "--symref", "origin", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
  } catch (error) {
    const detail =
      error.code === "ETIMEDOUT" || error.signal
        ? "timed out after 15 seconds with prompts disabled"
        : String(error.stderr || error.message)
            .trim()
            .slice(0, 300);
    throw new Error(`cannot resolve authoritative origin default: ${detail}`);
  }
  const branch = output.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m)?.[1];
  const commit = output.match(/^([a-f0-9]{40,64})\s+HEAD$/m)?.[1];
  if (!branch || !commit) throw new Error("origin HEAD lacks a symbolic ref or object ID");
  return { ref: `origin/${branch}`, commit };
}

function changedFileInventory(root, baseCommit, commit) {
  const raw = git(root, ["diff", "--name-status", "-z", `${baseCommit}...${commit}`], null);
  const fields = raw.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const rows = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/.test(status))
      throw new Error(`unsupported git status ${status}`);
    let oldPath = null;
    let filePath = fields[index++];
    if (/^[RC]/.test(status)) {
      oldPath = filePath;
      filePath = fields[index++];
    }
    validateGitPath(filePath);
    if (oldPath) validateGitPath(oldPath);
    const deleted = status === "D";
    const binding = deleted
      ? { sha256: null, bytes: null }
      : bindCommittedFile(root, commit, filePath);
    rows.push({ path: filePath, old_path: oldPath, status, ...binding });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function bindCommittedFile(root, commit, relative) {
  const bytes = readCommittedBlob(root, commit, relative);
  return { sha256: digest(bytes), bytes: bytes.length };
}

function readCommittedBlob(root, commit, relative) {
  const tree = git(root, ["ls-tree", "-z", commit, "--", relative], null).toString("utf8");
  const match = tree.match(/^([0-7]{6}) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/);
  if (!match || match[3] !== relative || match[1] === "120000")
    throw new Error(`changed path must be a committed regular blob: ${relative}`);
  const size = Number(git(root, ["cat-file", "-s", match[2]]).trim());
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BOUND_BYTES)
    throw new Error(`changed file exceeds 64 MiB: ${relative}`);
  const bytes = git(root, ["cat-file", "blob", match[2]], null);
  if (bytes.length !== size) throw new Error(`changed blob size drifted: ${relative}`);
  return bytes;
}

function optionalBinding(root, relative, label) {
  const loaded = readOptionalFile(root, relative, label, MAX_JSON_BYTES);
  if (!loaded) return null;
  let value;
  try {
    value = JSON.parse(loaded.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
  return { ...loaded.binding, commit: value.commit || null, outcome: value.outcome || null };
}

function optionalFileBinding(root, relative, label) {
  return readOptionalFile(root, relative, label, MAX_BOUND_BYTES)?.binding || null;
}

function optionalJsonFileBinding(root, relative, label) {
  const loaded = readOptionalFile(root, relative, label, MAX_JSON_BYTES);
  if (!loaded) return null;
  let value;
  try {
    value = JSON.parse(loaded.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
  return { binding: loaded.binding, value };
}

function readOptionalFile(root, relative, label, maxBytes) {
  if (!relative) return null;
  validateGitPath(relative);
  let bytes;
  try {
    bytes = readProjectInput(root, relative, maxBytes).bytes;
  } catch (error) {
    if (error.message === `input exceeds ${maxBytes}-byte budget`)
      throw new Error(`${label} exceeds ${maxBytes === MAX_JSON_BYTES ? "4 MiB JSON" : "64 MiB"}`);
    throw error;
  }
  return {
    binding: { path: relative.split(path.sep).join("/"), sha256: digest(bytes) },
    bytes,
  };
}

function assertCleanWorktree(root) {
  const dirty = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty.trim())
    throw new Error("review target requires a clean worktree; commit or remove changes");
}

function loadProfile(name) {
  const profiles = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "skills/dev/references/model-profiles.json"), "utf8")
  ).profiles;
  const profile = profiles?.[name];
  if (!profile || !new Set(["codex", "claude", "inline"]).has(profile.provider))
    throw new Error(`unknown or invalid review profile ${name}`);
  if (!profile.model || !profile.effort || profile.externalEffects !== false)
    throw new Error(`review profile ${name} lacks safe model metadata`);
  return {
    provider: profile.provider,
    model: profile.model,
    effort: profile.effort,
    external_effects: false,
  };
}

function validateGitPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    path.isAbsolute(value) ||
    value.split(/[\\/]/).includes("..") ||
    value.includes("\0")
  )
    throw new Error(`invalid project-relative path: ${String(value)}`);
}

function git(root, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: root,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function positiveInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`${label} must be a positive integer`);
  return number;
}

function parseArgs(argv) {
  const out = {};
  const map = {
    "--root": "root",
    "--out": "outPath",
    "--run-id": "runId",
    "--round": "round",
    "--mode": "mode",
    "--profile": "profile",
    "--max-workers": "maxWorkers",
    "--base": "baseRef",
    "--base-commit": "baseCommit",
    "--commit": "commit",
    "--acceptance": "acceptancePath",
    "--dev-session": "devSessionPath",
    "--design-critique": "designCritiquePath",
    "--prior-report": "priorReportPath",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = map[argv[index]];
    if (!key) throw new Error(`unknown argument ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argv[index - 1]} requires a value`);
    out[key] = value;
  }
  if (!out.outPath) throw new Error("--out is required");
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    validateGitPath(options.outPath);
    const requestedRound = positiveInt(options.round || 1, "round");
    const requestedRoot = reviewRootFromTargetPath(options.outPath, requestedRound);
    if (
      requestedRound > 1 &&
      options.priorReportPath !== expectedPriorReportPath(requestedRoot, requestedRound)
    )
      throw new Error(
        `prior report path must equal ${expectedPriorReportPath(requestedRoot, requestedRound)}`
      );
    const target = buildReviewTarget(options);
    const reviewRoot = reviewPathContext(
      options.outPath,
      target.review_round,
      target.run_id
    ).evidenceRoot;
    requireReviewPath(
      options.outPath,
      expectedReviewPath(reviewRoot, target.review_round, "target"),
      "target"
    );
    try {
      const publication = projectWriter.writeProjectJsonAtomic(
        options.root || process.cwd(),
        options.outPath,
        target,
        {
          fileMode: 0o600,
          directoryMode: 0o700,
          replace: false,
        }
      );
      if (!publication.directory_synced)
        process.stderr.write(
          `Warning: target committed with unsupported directory sync ${publication.directory_sync_error}.\n`
        );
    } catch (error) {
      if (/EEXIST|file exists/i.test(error.message))
        throw new Error("refusing to overwrite an existing review target");
      throw error;
    }
    process.stdout.write(`${JSON.stringify(target, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  assertCleanWorktree,
  buildReviewTarget,
  changedFileInventory,
  loadProfile,
  parseArgs,
  readCommittedBlob,
  resolveTrustedBase,
};
