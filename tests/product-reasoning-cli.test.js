"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.join(__dirname, "..", "scripts", "product-reasoning.js");

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("identity commands are deterministic and reject incomplete arguments", () => {
  const first = run(["decision-id", "--kind", "think", "--slug", "retention-loop"]);
  const second = run(["decision-id", "--kind", "think", "--slug", "retention-loop"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /dec-[a-f0-9]{20}/);
  assert.equal(run(["feature-id", "--project", "example"]).status, 1);
});

test("validate dispatches only known product reasoning document types", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unknown = path.join(root, "unknown.json");
  fs.writeFileSync(unknown, JSON.stringify({ document_type: "other" }));
  const result = run(["validate", "--input", unknown]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /document_type must be decision-brief or feature-inventory/);
});

test("JSON inputs reject symbolic links", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "target.json");
  const link = path.join(root, "link.json");
  fs.writeFileSync(target, "{}");
  fs.symlinkSync(target, link);
  const result = run(["validate", "--input", link]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.length > 0);
});

test("promote verifies bindings and atomically closes origin lineage", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-promote-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisionPath = "pm/backlog/ai-dashboard.decision.json";
  const targetRef = "pm/backlog/proposals/ai-dashboard.json";
  fs.mkdirSync(path.join(root, "pm", "backlog", "proposals"), { recursive: true });
  const sourceFixture = path.join(
    __dirname,
    "..",
    "evals",
    "product-reasoning-quality",
    "strong",
    "decision.json"
  );
  fs.copyFileSync(sourceFixture, path.join(root, decisionPath));
  fs.writeFileSync(path.join(root, targetRef), '{"lifecycle":"approved"}\n');
  const requestPath = path.join(root, "request.json");
  fs.writeFileSync(
    requestPath,
    JSON.stringify({
      decision_path: decisionPath,
      target_ref: targetRef,
      confirmed_at: "2026-07-14T02:00:00Z",
      binding_paths: [targetRef],
    })
  );

  const result = run(["promote", "--project", root, "--request", requestPath]);
  assert.equal(result.status, 0, result.stderr);
  const promoted = JSON.parse(fs.readFileSync(path.join(root, decisionPath), "utf8"));
  assert.equal(promoted.promotion.status, "promoted");
  assert.equal(promoted.promotion.target_ref, targetRef);
  assert.equal(promoted.source_artifacts[0].path, targetRef);
});
