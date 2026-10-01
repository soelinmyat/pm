"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");
const { createNativeRuntime } = require("../scripts/productmemory-native-runtime");
const { DIMENSION_NAMES } = require("../scripts/lib/dev-risk");
const { sha } = require("../scripts/lib/native-dev-contract");
const {
  bindCurrentReviewContract,
  materializeProposalSources,
} = require("./helpers/groom-review-fixture");
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-certification-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Fixture");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/example.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  fs.writeFileSync(
    path.join(root, "native-check.cjs"),
    "require('node:assert/strict').equal(require('./src/example.js'), 2);\n"
  );
  git("add", ".");
  git("commit", "-qm", "baseline");
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "native-certification-origin-"));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", "main");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git("checkout", "-qb", "structured-groom");
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "remote-contract-"));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  const proposal = bindCurrentReviewContract(
    structuredClone(require("./fixtures/proposals/strong-v1.json"))
  );
  proposal.design_requirements = [
    {
      id: "design:cli-errors",
      requirement:
        "Return stable CLI exit codes with an actionable explanation for invalid and unavailable states.",
    },
  ];
  proposal.design_context = {
    design_requirements: proposal.design_requirements.map((row) => row.requirement),
    ui_impact: false,
    prototype: null,
    critical_states: ["success", "invalid input", "service unavailable"],
    experience_invariants: [
      "Every failure keeps a stable nonzero exit code and names the caller's next action.",
    ],
    visual_invariants: [],
  };
  materializeProposalSources(source, proposal);
  const rfc = {
    schema_version: 3,
    slug: proposal.slug,
    title: "Native implementation",
    size: proposal.size,
    design_context: proposal.design_context,
    issues: [
      {
        num: 1,
        title: "Implement contract",
        size: "M",
        depends_on: [],
        owns: ["src/example.js"],
        acceptance_criteria: ["Source and approval stay bound"],
        approach: "Implement source binding",
        verification_commands: ["node --test"],
        test_hooks: ["Unit -> source binding"],
      },
    ],
    test_strategy: {
      test_levels: "Unit and integration",
      new_infrastructure: "None",
      regression_surface: "Approval binding",
      verification_commands: "node --test",
      open_questions: "None",
    },
  };
  const execution = {
    schema_version: 1,
    kind: "proposal",
    ui_platform: "web",
    risk: {
      ...Object.fromEntries(DIMENSION_NAMES.map((name) => [name, name === "behavioral" ? 1 : 0])),
      destructive_data: false,
    },
  };
  const documents = new Map([
    ["pm/proposal.json", Buffer.from(JSON.stringify(proposal))],
    ["pm/rfc.json", Buffer.from(JSON.stringify(rfc))],
    ["pm/execution.json", Buffer.from(JSON.stringify(execution))],
  ]);
  for (const item of proposal.source.lineage)
    documents.set(item.path, fs.readFileSync(path.join(source, item.path)));
  const entries = [...documents]
    .map(([document, bytes], index) => ({
      path: document,
      role:
        document === "pm/proposal.json"
          ? "proposal"
          : document === "pm/rfc.json"
            ? "rfc"
            : "supporting",
      revision: 1,
      knowledge_version_id: index + 1,
      content_hash: sha(bytes),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const workflow = {
    id: 1,
    project: "cleanlog",
    record_id: "bkl_NATIVE",
    revision: 5,
    status: "planned",
    owner_id: 2,
    dependencies: [],
    bundle: {
      id: 4,
      digest: "b".repeat(64),
      current: true,
      review: { id: 7, user: "second-person@example.com", decision: "approved" },
      entries,
    },
    sessions: [],
  };
  const calls = [];
  const transport = {
    identity: { service_url: "https://productmemory.io", project: "cleanlog" },
    request: async (input) => {
      calls.push(input);
      const url = new URL(input.path, transport.identity.service_url);
      if (url.pathname === "/api/v1/knowledge_file") {
        const bytes = documents.get(url.searchParams.get("path"));
        return {
          status: 200,
          body: {
            path: url.searchParams.get("path"),
            revision: 1,
            content_hash: sha(bytes),
            byte_size: bytes.length,
            content_base64: bytes.toString("base64"),
          },
        };
      }
      if (input.method === "PATCH") {
        const session = workflow.sessions[0];
        Object.assign(session, {
          state: input.body.state,
          result_commit: input.body.result_commit,
          verification: input.body.verification,
          revision: session.revision + 1,
        });
        workflow.revision++;
        return {
          status: 200,
          body: { workflow: structuredClone(workflow), session: structuredClone(session) },
        };
      }
      if (input.method === "POST") {
        const session = {
          id: 9,
          revision: 1,
          feature_workflow_id: 1,
          feature_bundle_id: 4,
          feature_bundle_review_id: 7,
          owner_id: 2,
          state: "running",
          ...input.body,
        };
        workflow.revision++;
        workflow.status = "in-progress";
        workflow.sessions = [session];
        return { status: 200, body: { workflow: structuredClone(workflow), session } };
      }
      return { status: 200, body: structuredClone(workflow) };
    },
  };
  return {
    root,
    git,
    workflow,
    documents,
    calls,
    transport,
    options: {
      sourceDir: root,
      slug: proposal.slug,
      recordId: workflow.record_id,
      executionPath: "pm/execution.json",
    },
  };
}

function writeJson(root, relative, value) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function publishReview(f, sessionPath, session) {
  const { buildReviewTarget } = require("../scripts/review-target");
  const { checkReview, expandFromReport } = require("../scripts/review-check");
  const reviewDir = `.pm/dev-sessions/${session.slug}/review`;
  const roundDir = `${reviewDir}/runs/native-certification/round-1`;
  const targetPath = `${roundDir}/target.json`;
  const target = buildReviewTarget({
    root: f.root,
    outPath: targetPath,
    devSessionPath: sessionPath,
    mode: session.routing.review_mode,
    runId: "native-certification",
    profile: "codex-workhorse",
    maxWorkers: 3,
  });
  writeJson(f.root, targetPath, target);
  const targetBinding = {
    path: targetPath,
    sha256: sha(fs.readFileSync(path.join(f.root, targetPath))),
  };
  // Reviewer judgments are fixture inputs; target generation, result validation,
  // report publication, freshness, and the final delivery verifier are all real.
  const resultPaths = target.allocation.map((worker) => {
    const relative = `${roundDir}/results/${worker.worker_id}.json`;
    writeJson(f.root, relative, {
      schema_version: 1,
      run_id: target.run_id,
      review_round: target.review_round,
      target: targetBinding,
      source: target.source,
      worker_id: worker.worker_id,
      profile: worker.profile,
      runtime: worker.runtime,
      lenses: worker.lenses,
      verdicts: worker.lenses.map((lens) => ({
        lens,
        outcome: "clean",
        summary: `No actionable ${lens} finding in the fixture implementation.`,
      })),
      findings: [],
      checked_at: new Date().toISOString(),
    });
    return relative;
  });
  const reportPath = `${reviewDir}/report.json`;
  const checked = checkReview({
    root: f.root,
    targetPath,
    resultPaths,
    reportPath,
    writeReport: true,
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.issues));
  assert.equal(checked.report.outcome, "passed");
  assert.equal(checked.report.human_report, null);
  const validated = checkReview(expandFromReport({ root: f.root, reportPath, fromReport: true }));
  assert.equal(validated.ok, true, JSON.stringify(validated.issues));
  return path.join(f.root, reportPath);
}

for (const mutation of [null, "invalid-review", "changed-gates"]) {
  test(`native certification uses current canonical evidence (${mutation || "success"})`, async (t) => {
    const f = fixture(t);
    const runtime = createNativeRuntime(f.transport);
    const initialized = await runtime.initialize(f.options);
    const sessionPath = initialized.session_path;
    let session = initialized.session;
    const testCommand = "node native-check.cjs";
    const executeTest = () =>
      spawnSync(process.execPath, ["native-check.cjs"], {
        cwd: f.root,
        encoding: "utf8",
      });
    const record = async (evidence, filesChanged = []) => {
      const decision = await runtime.decision(sessionPath);
      const result = {
        schema_version: 1,
        run_id: session.run_id,
        phase: decision.phase,
        attempt: decision.attempt,
        status: "passed",
        summary: `${decision.phase} completed against the native contract`,
        commit: decision.requires_commit ? f.git("rev-parse", "HEAD") : null,
        files_changed: filesChanged,
        evidence,
        blocker: null,
        runtime: { provider: "codex", model: "fixture", reasoning: "high" },
      };
      session = await runtime.record(sessionPath, result);
    };
    assert.deepEqual(session.routing.required_gates, ["tdd", "review", "verification"]);
    assert.equal(session.phase, "intake");
    await record([
      {
        kind: "intake",
        command: "native reviewed execution contract",
        exit_code: 0,
        artifact: session.task.reference,
      },
    ]);
    assert.equal(session.phase, "workspace");
    session = await runtime.workspace(sessionPath);
    await record([
      { kind: "workspace", command: "git status --short", exit_code: 0, artifact: f.root },
    ]);
    assert.equal(session.phase, "readiness");
    const rfcEntry = session.task.native.entries.find((entry) => entry.role === "rfc");
    await record([
      {
        kind: "rfc-readiness",
        command: "native bundle readiness",
        exit_code: 0,
        artifact: path.join(session.task.native.snapshot_root, rfcEntry.path),
      },
    ]);
    assert.equal(session.phase, "implementation");
    session = await runtime.transitionWorkUnit(sessionPath, { id: "rfc-1", status: "running" });
    const red = executeTest();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    fs.writeFileSync(path.join(f.root, "src/example.js"), "module.exports = 2;\n");
    const green = executeTest();
    assert.equal(green.status, 0, green.stdout + green.stderr);
    f.git("add", "src/example.js");
    f.git("commit", "-qm", "Implement native contract fixture");
    const commit = f.git("rev-parse", "HEAD");
    const testEvidence = {
      kind: "test",
      command: testCommand,
      exit_code: green.status,
      artifact: path.join(f.root, "native-check.cjs"),
    };
    session = await runtime.transitionWorkUnit(sessionPath, {
      id: "rfc-1",
      status: "completed",
      result: {
        schema_version: 1,
        work_unit_id: "rfc-1",
        status: "completed",
        summary: "Implemented the approved native contract after a failing regression",
        commit,
        files_changed: 1,
        evidence: [testEvidence],
        blocker: null,
        runtime: { provider: "codex", model: "fixture" },
      },
    });
    await record([testEvidence], ["src/example.js"]);
    assert.equal(session.phase, "review");
    await runtime.gate(sessionPath, { name: "tdd" });
    const reportPath = publishReview(f, sessionPath, session);
    const verification = executeTest();
    assert.equal(verification.status, 0, verification.stdout + verification.stderr);
    await record([
      {
        kind: "review",
        command: "node scripts/review-check.js --from-report",
        exit_code: 0,
        artifact: reportPath,
      },
      { ...testEvidence, exit_code: verification.status },
    ]);
    assert.equal(session.phase, "ship");
    await runtime.gate(sessionPath, { name: "review" });
    await runtime.gate(sessionPath, { name: "verification" });
    const manifestPath = path.join(path.dirname(sessionPath), "gates.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    assert.deepEqual(
      manifest.gates.map(({ name }) => name).sort(),
      [...session.routing.required_gates].sort()
    );
    assert.ok(manifest.gates.every((row) => row.status === "passed" && row.commit === commit));
    if (mutation) {
      const request = f.transport.request;
      let mutated = false;
      f.transport.request = async (input) => {
        const intentPath = path.join(path.dirname(sessionPath), "native-certification-intent.json");
        if (!mutated && input.method === "GET" && fs.existsSync(intentPath)) {
          mutated = true;
          if (mutation === "invalid-review") {
            const review = JSON.parse(fs.readFileSync(reportPath));
            review.outcome = "failed";
            fs.writeFileSync(reportPath, JSON.stringify(review));
          } else {
            const gates = JSON.parse(fs.readFileSync(manifestPath));
            gates.gates[0].checked_at = new Date(Date.now() + 1000).toISOString();
            fs.writeFileSync(manifestPath, JSON.stringify(gates));
          }
        }
        return request(input);
      };
      await assert.rejects(runtime.certify(sessionPath));
      assert.equal(mutated, true);
      assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 0);
      assert.equal(f.workflow.sessions[0].state, "running");
      assert.equal(
        JSON.parse(fs.readFileSync(sessionPath)).task.native.remote_session_state,
        "running"
      );
      return;
    }
    const certified = await runtime.certify(sessionPath);
    assert.equal(certified.session.task.native.remote_session_state, "verified");
    assert.equal(certified.session.task.native.certification.commit, commit);
    assert.equal(
      certified.session.task.native.certification.gate_manifest_sha256,
      sha(fs.readFileSync(manifestPath))
    );
    const reports = f.calls.filter((call) => call.method === "PATCH");
    assert.equal(reports.length, 1);
    assert.equal(reports[0].body.result_commit, commit);
    assert.equal(reports[0].body.state, "verified");
    const remoteProof = JSON.parse(reports[0].body.verification);
    assert.equal(remoteProof.kind, "pm-native-canonical-gates-v1");
    assert.equal(remoteProof.run_id, session.run_id);
    assert.deepEqual(
      remoteProof.gates.map(({ name }) => name).sort(),
      [...session.routing.required_gates].sort()
    );
    assert.equal((await runtime.certify(sessionPath)).idempotent, true);
    assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 1);
    assert.equal(fs.existsSync(path.join(f.root, "pm")), false);
    assert.equal(certified.session.authority.push_feature_branch, false);
    assert.equal(certified.session.authority.merge, false);
  });
}
