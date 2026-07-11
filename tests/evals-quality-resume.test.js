"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { check } = require("../scripts/evals/quality-resume.js");

const root = path.resolve(__dirname, "..");
const runScript = path.join(root, "scripts", "evals", "run.js");

for (const workflow of ["dev", "rfc"]) {
  test(`${workflow} resume fixture uses a partial native session and freezes invariants`, () => {
    const scenario = `quality-${workflow}-resume`;
    const runId = `20260712T124000Z--${scenario}--stub`;
    const runDir = path.join(root, "eval-results", "runs", runId);
    fs.rmSync(runDir, { recursive: true, force: true });
    try {
      const result = spawnSync(
        process.execPath,
        [
          runScript,
          `evals/scenarios/${scenario}`,
          "--agent",
          "stub",
          "--quality-case",
          `${workflow}-resume`,
          "--run-id",
          runId,
        ],
        { cwd: root, encoding: "utf8" }
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const workdir = path.join(runDir, "workdir");
      const invariants = JSON.parse(
        fs.readFileSync(path.join(workdir, ".pm", "quality", "resume-invariants.json"), "utf8")
      );
      const session = JSON.parse(
        fs.readFileSync(path.join(workdir, invariants.native_path), "utf8")
      );
      assert.notEqual(session.phase, "intake");
      assert.equal(check(workflow, workdir), true);
      const revalidationPath = path.join(workdir, ".pm", "quality", "resume-revalidation.json");
      const revalidation = JSON.parse(fs.readFileSync(revalidationPath, "utf8"));
      fs.writeFileSync(
        revalidationPath,
        `${JSON.stringify({ ...revalidation, revalidated_at: "not-a-date" }, null, 2)}\n`
      );
      assert.throws(() => check(workflow, workdir), /revalidation evidence/);
      fs.writeFileSync(revalidationPath, `${JSON.stringify(revalidation, null, 2)}\n`);
      const sessionPath = path.join(workdir, invariants.native_path);
      const regressed = { ...session, phase: workflow === "rfc" ? "intake" : "workspace" };
      fs.writeFileSync(sessionPath, `${JSON.stringify(regressed, null, 2)}\n`);
      assert.throws(() => check(workflow, workdir), /regressed|invalid/);
      fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
      fs.writeFileSync(path.join(workdir, "user-owned-dirt.txt"), "overwritten\n");
      assert.throws(() => check(workflow, workdir), /resume invariant changed/);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
}
