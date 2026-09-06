"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { buildVerificationPlan } = require("../scripts/lib/verification-plan");
test("verification reuses only retained passing results with current complete identities", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-verification-plan-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
    fs.writeFileSync(path.join(root, "source.js"), "module.exports = 1;\n");
    fs.mkdirSync(path.join(root, ".pm"));
    fs.writeFileSync(path.join(root, ".pm/pass.log"), "passed\n");
    const input = {
      risk: "low",
      executable_change: true,
      stage: "baseline",
      repository_commands: ["npm test"],
      focused_commands: ["node --test tests/parser.test.js"],
      environment: { node: process.version },
      dependencies: { installed_tree: "known-digest" },
    };
    assert.throws(
      () =>
        buildVerificationPlan(
          { ...input, repository_commands: [], focused_commands: [] },
          { root }
        ),
      /requires at least one/
    );
    const first = buildVerificationPlan(input, { root });
    const artifact = {
      path: ".pm/pass.log",
      sha256: crypto.createHash("sha256").update("passed\n").digest("hex"),
    };
    const prior = first.checks.map(({ key }) => ({ key, status: "passed", artifact }));
    assert.ok(
      buildVerificationPlan(input, { root, prior }).checks.every((item) => item.action === "reuse")
    );
    assert.equal(
      buildVerificationPlan({ ...input, stage: "final" }, { root, prior }).checks[0].action,
      "run"
    );
    for (const changed of [
      { dependencies: null },
      { environment: { node: "changed" } },
      { dependencies: { installed_tree: "changed" } },
    ])
      assert.ok(
        buildVerificationPlan({ ...input, ...changed }, { root, prior }).checks.every(
          (item) => item.action === "run"
        )
      );
    fs.writeFileSync(path.join(root, "source.js"), "module.exports = 2;\n");
    assert.ok(
      buildVerificationPlan(input, { root, prior }).checks.every((item) => item.action === "run")
    );
    fs.writeFileSync(path.join(root, "source.js"), "module.exports = 1;\n");
    fs.writeFileSync(path.join(root, ".pm/pass.log"), "mutated\n");
    assert.ok(
      buildVerificationPlan(input, { root, prior }).checks.every((item) => item.action === "run")
    );
    const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-plan-evidence-"));
    try {
      fs.writeFileSync(path.join(evidenceRoot, "input.json"), JSON.stringify(input));
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, "../scripts/lib/verification-plan.js"),
          "--root",
          root,
          "--evidence-root",
          evidenceRoot,
          "--input",
          "input.json",
          "--out",
          "plan.json",
        ],
        { stdio: "pipe" }
      );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(evidenceRoot, "plan.json"))).kind,
        "verification-plan"
      );
      assert.equal(fs.existsSync(path.join(root, "plan.json")), false);
    } finally {
      fs.rmSync(evidenceRoot, { recursive: true, force: true });
    }
    const prose = buildVerificationPlan({ ...input, executable_change: false }, { root });
    assert.deepEqual(
      prose.checks.map((item) => item.command),
      ["npm test"]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
