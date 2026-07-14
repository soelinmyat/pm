#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const rfc = require("../lib/rfc-session-schema.js");
const dev = require("../lib/dev-session-schema.js");
const {
  beginEffect,
  createReleaseTransaction,
  planEffect,
} = require("../lib/release-transaction-schema.js");
const { writeSession: writeRfcSession } = require("../rfc-session.js");

function seed(workflow, sourceDir) {
  const root = fs.realpathSync(sourceDir);
  let nativePath = null;
  let session = null;
  if (workflow === "rfc") {
    nativePath = path.join(root, ".pm", "rfc-sessions", "quality-resume", "session.json");
    session = rfc.createSession({ slug: "quality-resume", sourceDir: root });
    session = rfc.applyContext(session, {
      source_kind: "proposal",
      proposal_path: path.join(root, "pm", "backlog", "export-v2.md"),
      size: "M",
      acceptance_criteria: ["Preserve accepted export boundaries", "Revalidate source identity"],
    });
    session = rfc.recordResult(session, rfcResult(session));
    fs.mkdirSync(path.dirname(nativePath), { recursive: true });
    writeRfcSession(nativePath, session);
  } else if (["dev", "review", "design-critique", "ship"].includes(workflow)) {
    const slug = execFileSync("git", ["branch", "--show-current"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    nativePath = path.join(root, ".pm", "dev-sessions", slug, "session.json");
    session = dev.createSession({ slug, sourceDir: root });
    session = dev.applyRouting(session, {
      reference: path.join(root, "case-state.md"),
      kind: "task",
      size: "S",
      risk: {},
      acceptance_criteria: ["Preserve accepted work", "Revalidate source identity"],
      work_units: [],
    });
    session = dev.recordResult(session, devResult(session, "intake"));
    session = dev.recordResult(session, devResult(session, "workspace"));
    dev.writeSession(nativePath, session);
    if (workflow === "ship") seedAmbiguousShipEffect(root, session);
  }

  const genericPath = path.join(root, ".pm", "quality", "resume-session.json");
  const userPath = path.join(root, "user-owned-dirt.txt");
  const invariants = {
    schema_version: 1,
    workflow,
    native_path: nativePath ? path.relative(root, nativePath) : null,
    run_id: session && session.run_id,
    slug: session && session.slug,
    source: (session && session.source) || {
      repo_root: root,
      branch: git(root, ["branch", "--show-current"]),
      base_commit: git(root, ["rev-parse", "HEAD"]),
    },
    seeded_phase: session ? session.phase : "research",
    seeded_attempt: session ? session.phase_attempt : 1,
    seeded_at: new Date().toISOString(),
    revalidation_nonce: crypto.randomBytes(16).toString("hex"),
    accepted:
      workflow === "rfc"
        ? session.context.acceptance_criteria
        : session
          ? session.task.acceptance_criteria
          : ["preserve permission-scoped CSV delivery"],
    generic_sha256: sha(fs.readFileSync(genericPath)),
    user_sha256: sha(fs.readFileSync(userPath)),
  };
  const output = path.join(root, ".pm", "quality", "resume-invariants.json");
  fs.writeFileSync(output, `${JSON.stringify(invariants, null, 2)}\n`, { mode: 0o600 });
  return invariants;
}

function check(workflow, sourceDir) {
  const root = fs.realpathSync(sourceDir);
  const invariants = JSON.parse(
    fs.readFileSync(path.join(root, ".pm", "quality", "resume-invariants.json"), "utf8")
  );
  if (invariants.workflow !== workflow) throw new Error("resume workflow identity changed");
  assertHash(root, ".pm/quality/resume-session.json", invariants.generic_sha256);
  assertHash(root, "user-owned-dirt.txt", invariants.user_sha256);
  const revalidation = JSON.parse(
    fs.readFileSync(path.join(root, ".pm", "quality", "resume-revalidation.json"), "utf8")
  );
  const revalidatedAt = Date.parse(revalidation.revalidated_at);
  const seededAt = Date.parse(invariants.seeded_at);
  if (
    revalidation.workflow !== workflow ||
    revalidation.nonce !== invariants.revalidation_nonce ||
    revalidation.observed_branch !== invariants.source.branch ||
    revalidation.observed_head !== invariants.source.base_commit ||
    !Number.isFinite(revalidatedAt) ||
    !Number.isFinite(seededAt) ||
    revalidatedAt < seededAt ||
    revalidatedAt > Date.now() + 60_000
  ) {
    throw new Error("source identity revalidation evidence does not match the seeded checkpoint");
  }
  if (workflow === "groom") {
    const text = fs.readFileSync(
      path.join(root, ".pm", "groom-sessions", "quality-resume.md"),
      "utf8"
    );
    if (
      !/phase: (research|scope|scope-review|design|draft-proposal|team-review|present|link|synthesis|scope-lock|proposal-ready)/.test(
        text
      )
    ) {
      throw new Error("groom resume phase regressed to intake");
    }
    if (!text.includes("preserve permission-scoped CSV delivery")) {
      throw new Error("accepted Groom decision was not preserved");
    }
    return true;
  }
  const nativePath = path.join(root, invariants.native_path);
  const session = JSON.parse(fs.readFileSync(nativePath, "utf8"));
  const errors = workflow === "rfc" ? rfc.validateSession(session) : dev.validateSession(session);
  if (errors.length > 0)
    throw new Error(`native resume session invalid: ${JSON.stringify(errors)}`);
  if (session.run_id !== invariants.run_id || session.slug !== invariants.slug) {
    throw new Error("native resume identity changed");
  }
  for (const field of ["repo_root", "branch", "base_commit"]) {
    if (session.source[field] !== invariants.source[field]) {
      throw new Error(`native source ${field} changed`);
    }
  }
  if (session.phase === "intake") throw new Error("native resume phase regressed to intake");
  const phases = workflow === "rfc" ? rfc.PHASES : dev.PHASES;
  if (phases.indexOf(session.phase) < phases.indexOf(invariants.seeded_phase)) {
    throw new Error(
      `native resume phase regressed from ${invariants.seeded_phase} to ${session.phase}`
    );
  }
  const accepted =
    workflow === "rfc" ? session.context.acceptance_criteria : session.task.acceptance_criteria;
  for (const item of invariants.accepted) {
    if (!accepted.includes(item)) throw new Error(`accepted decision was not preserved: ${item}`);
  }
  if (workflow === "ship") checkAmbiguousShipEffect(root, invariants);
  return true;
}

function seedAmbiguousShipEffect(root, session) {
  const commit = git(root, ["rev-parse", "HEAD"]);
  const remote = git(root, ["remote", "get-url", "--push", "origin"]);
  let transaction = createReleaseTransaction({
    releaseMode: "delivery-only",
    runId: session.run_id,
    slug: session.slug,
    repository: "quality/ship-resume",
    deliveryRemote: "origin",
    headBranch: session.source.branch,
    baseBranch: session.source.default_branch,
    pushUrlSha256: sha(Buffer.from(remote)),
    preparedCommit: commit,
    manifestHashes: [],
  });
  const target = { remote: "origin", branch: session.source.branch, commit };
  transaction = planEffect(transaction, { effect: "push", target });
  transaction = beginEffect(transaction, {
    effect: "push",
    authority: { push_feature_branch: true },
    actor: "root",
  }).transaction;
  const transactionPath = path.join(
    root,
    ".pm",
    "dev-sessions",
    session.slug,
    "ship",
    "release-transaction.json"
  );
  fs.mkdirSync(path.dirname(transactionPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, { mode: 0o600 });
  execFileSync("git", ["push", "--quiet", "origin", `HEAD:refs/heads/${session.source.branch}`], {
    cwd: root,
  });
}

function checkAmbiguousShipEffect(root, invariants) {
  const transactionPath = path.join(
    root,
    ".pm",
    "dev-sessions",
    invariants.slug,
    "ship",
    "release-transaction.json"
  );
  const transaction = JSON.parse(fs.readFileSync(transactionPath, "utf8"));
  const push = transaction.effects.push;
  const remoteTip = git(root, [
    "--git-dir=.pm/quality/origin.git",
    "rev-parse",
    `refs/heads/${invariants.source.branch}`,
  ]);
  if (
    push.status !== "verified" ||
    push.attempts.length !== 1 ||
    push.verified_receipt?.receipt?.remote_tip !== invariants.source.base_commit ||
    remoteTip !== invariants.source.base_commit
  ) {
    throw new Error("Ship resume replayed or failed to reconcile the ambiguous Push attempt");
  }
}

function revalidate(workflow, sourceDir) {
  const root = fs.realpathSync(sourceDir);
  const invariants = JSON.parse(
    fs.readFileSync(path.join(root, ".pm", "quality", "resume-invariants.json"), "utf8")
  );
  const evidence = {
    schema_version: 1,
    workflow,
    observed_branch: git(root, ["branch", "--show-current"]),
    observed_head: git(root, ["rev-parse", "HEAD"]),
    seeded_phase: invariants.seeded_phase,
    nonce: invariants.revalidation_nonce,
    revalidated_at: new Date().toISOString(),
  };
  if (
    evidence.workflow !== invariants.workflow ||
    evidence.observed_branch !== invariants.source.branch ||
    evidence.observed_head !== invariants.source.base_commit
  ) {
    throw new Error("current source identity does not match the resumable checkpoint");
  }
  fs.writeFileSync(
    path.join(root, ".pm", "quality", "resume-revalidation.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 }
  );
  return evidence;
}

function rfcResult(session) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "passed",
    summary: "Intake and repository context were completed before pause",
    artifact: null,
    evidence: [{ kind: "intake", command: "quality fixture", exit_code: 0, artifact: null }],
    reviewer_verdicts: [],
    blocker: null,
    runtime: { provider: "inline", model: "fixture", reasoning: "high", session_id: null },
  };
}

function devResult(session, kind) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "passed",
    summary: `${kind} completed before pause`,
    commit: null,
    files_changed: [],
    evidence: [{ kind, command: "quality fixture", exit_code: 0, artifact: null }],
    blocker: null,
    runtime: { provider: "inline", model: "fixture", reasoning: "high", session_id: null },
  };
}

function assertHash(root, relative, expected) {
  if (sha(fs.readFileSync(path.join(root, relative))) !== expected) {
    throw new Error(`resume invariant changed: ${relative}`);
  }
}

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function main(argv) {
  try {
    const [command, workflow, sourceDir] = argv;
    if (!command || !workflow || !sourceDir) {
      throw new Error("usage: quality-resume.js <seed|revalidate|check> <workflow> <source-dir>");
    }
    if (command === "seed") seed(workflow, sourceDir);
    else if (command === "revalidate") revalidate(workflow, sourceDir);
    else if (command === "check") check(workflow, sourceDir);
    else throw new Error(`unknown command ${command}`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { check, revalidate, seed };
