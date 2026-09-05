"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dev = require("../scripts/lib/dev-session-schema.js");
const groom = require("../scripts/lib/groom-session-schema.js");
const rfc = require("../scripts/lib/rfc-session-schema.js");

test("persisted sessions cannot smuggle Astra through another profile", () => {
  const repo = makeRepo();
  try {
    for (const [workflow, api, profile] of [
      ["Dev", dev, "codex-workhorse"],
      ["Groom", groom, "gpt-5.6-sol-high"],
      ["RFC", rfc, "gpt-5.6-sol-high"],
    ]) {
      const session = api.createSession({
        slug: `${workflow.toLowerCase()}-astra-persisted`,
        sourceDir: repo,
      });
      session.execution = {
        ...session.execution,
        profile,
        runtime: "codex",
        model: "gpt-6-astra",
        reasoning: "ultra",
      };
      assert.ok(
        api
          .validateSession(session)
          .some((issue) => /explicitly selected named base profile/.test(issue.message)),
        `${workflow} must reject a forged persisted Astra binding`
      );
      assert.throws(
        () => api.nextDecision(session, path.join(repo, `${workflow}.json`)),
        /explicitly selected named base profile/,
        `${workflow} resume/read paths must fail closed`
      );
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("explicit named Astra sessions accept ultra effort", () => {
  const repo = makeRepo();
  try {
    for (const [workflow, api, profile] of [
      ["Dev", dev, "codex-astra"],
      ["Groom", groom, "gpt-6-astra-high"],
      ["RFC", rfc, "gpt-6-astra-high"],
    ]) {
      const session = api.createSession({
        slug: `${workflow.toLowerCase()}-astra-ultra`,
        sourceDir: repo,
        profile,
        runtime: "codex",
        model: "gpt-6-astra",
        reasoning: "ultra",
      });
      assert.deepEqual(api.validateSession(session), []);

      const providerLaundered = structuredClone(session);
      providerLaundered.execution.runtime = "claude";
      assert.ok(
        api
          .validateSession(providerLaundered)
          .some((issue) => /explicitly selected named base profile/.test(issue.message)),
        `${workflow} must reject a forged persisted Astra provider binding`
      );
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Astra phase results remain bound to the explicitly selected session profile", () => {
  const repo = makeRepo();
  try {
    const devSession = dev.createSession({
      slug: "dev-astra-result",
      sourceDir: repo,
      profile: "codex-astra",
      runtime: "codex",
      model: "gpt-6-astra",
      reasoning: "high",
    });
    const devResult = {
      schema_version: 1,
      run_id: devSession.run_id,
      phase: devSession.phase,
      attempt: 1,
      status: "failed",
      summary: "Worker failed before intake completed",
      commit: null,
      files_changed: [],
      evidence: [],
      blocker: null,
      runtime: {
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoning: "high",
        session_id: "thread-dev",
      },
    };
    assert.ok(
      dev
        .validateResult(devSession, devResult)
        .some((issue) => /cannot override/.test(issue.message))
    );

    const groomSession = groom.createSession({
      slug: "groom-astra-result",
      sourceDir: repo,
      profile: "gpt-6-astra-high",
      runtime: "codex",
      model: "gpt-6-astra",
      reasoning: "high",
    });
    const groomResult = workflowResult(groomSession, "gpt-5.6-sol");
    delete groomResult.artifact;
    delete groomResult.reviewer_verdicts;
    assert.throws(() => groom.recordResult(groomSession, groomResult), /cannot override/);

    const rfcSession = rfc.createSession({
      slug: "rfc-astra-result",
      sourceDir: repo,
      profile: "gpt-6-astra-high",
      runtime: "codex",
      model: "gpt-6-astra",
      reasoning: "high",
    });
    const rfcResult = workflowResult(rfcSession, "gpt-5.6-sol");
    delete rfcResult.proposal;
    delete rfcResult.question_outcomes;
    delete rfcResult.capability_downgrades;
    assert.throws(() => rfc.recordResult(rfcSession, rfcResult), /cannot override/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("legacy non-Astra model overrides remain valid in persisted sessions", () => {
  const repo = makeRepo();
  try {
    const cases = [
      [dev, "codex-workhorse"],
      [groom, "gpt-5.6-sol-high"],
      [rfc, "gpt-5.6-sol-high"],
    ];
    for (const [api, profile] of cases) {
      const session = api.createSession({
        slug: `compatible-${profile.replaceAll(".", "-")}`,
        sourceDir: repo,
        profile,
        runtime: "codex",
        model: "private-compatible-model",
        reasoning: "ultra",
      });
      assert.deepEqual(api.validateSession(session), []);
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function workflowResult(session, model) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "failed",
    summary: "Worker failed before intake completed",
    proposal: null,
    artifact: null,
    evidence: [],
    question_outcomes: [],
    reviewer_verdicts: [],
    capability_downgrades: [],
    blocker: null,
    runtime: {
      provider: "codex",
      model,
      reasoning: "high",
      session_id: "thread-workflow",
    },
  };
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-astra-session-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}
