"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validate } = require("../scripts/validate");
const { decisionId } = require("../scripts/lib/product-reasoning-schema");

function sha(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

test("normal validation checks present decision companions without requiring them for legacy artifacts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-validate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "thinking"), { recursive: true });
  const markdown = Buffer.from(
    "---\ntype: thinking\ntopic: Test\nslug: test\ncreated: 2026-07-14\nupdated: 2026-07-14\nstatus: active\n---\n\n# Test\n"
  );
  fs.writeFileSync(path.join(pm, "thinking", "test.md"), markdown);
  let result = validate(pm);
  assert.equal(result.errors.length, 0, JSON.stringify(result.details));

  const brief = {
    schema_version: 1,
    document_type: "decision-brief",
    decision_id: decisionId("think", "test"),
    kind: "think",
    slug: "test",
    title: "Test",
    problem: "A product decision needs a grounded direction.",
    evidence_refs: [],
    alternatives: [
      { id: "first", title: "First", tradeoff: "Fast but narrow." },
      { id: "second", title: "Second", tradeoff: "Broad but slower." },
    ],
    decision: {
      status: "confirmed",
      choice: "first",
      rationale: "Choose the bounded learning path.",
    },
    confidence: { level: "low", basis: ["No durable evidence yet"] },
    non_goals: ["Solve adjacent problems"],
    next_trigger: {
      lane: "research",
      condition: "Confidence must increase before grooming.",
      target: null,
    },
    promotion: { status: "not-offered", target_kind: null, target_ref: null, confirmed_at: null },
    source_artifacts: [{ path: "thinking/test.md", sha256: sha(markdown) }],
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
  };
  fs.writeFileSync(path.join(pm, "thinking", "test.decision.json"), JSON.stringify(brief));
  result = validate(pm);
  assert.equal(result.errors.length, 0, JSON.stringify(result.details));

  brief.source_artifacts[0].sha256 = `sha256:${"f".repeat(64)}`;
  fs.writeFileSync(path.join(pm, "thinking", "test.decision.json"), JSON.stringify(brief));
  result = validate(pm);
  assert.ok(result.errors.some((entry) => entry.msg.includes("SHA-256 does not match")));
});

test("KB-relative feature bindings validate in nested and flat PM layouts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-layouts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const pm of [path.join(root, "nested", "pm"), path.join(root, "flat-kb")]) {
    fs.mkdirSync(path.join(pm, "product"), { recursive: true });
    const inventory = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "evals", "product-reasoning-quality", "strong", "features.json"),
        "utf8"
      )
    );
    const features = inventory.areas.flatMap((area) => area.features);
    const markdown = Buffer.from(
      `---\ngenerated: 2026-07-14\nsource_project: example\nfiles_scanned: 20\nfeature_count: ${features.length}\narea_count: ${inventory.areas.length}\nareas:\n${inventory.areas.map((area) => `  - ${area.name}`).join("\n")}\n---\n\n# Features\n\n${features.map((feature) => `### ${feature.name}`).join("\n\n")}\n`
    );
    fs.writeFileSync(path.join(pm, "product", "features.md"), markdown);
    inventory.markdown_binding.sha256 = sha(markdown);
    fs.writeFileSync(path.join(pm, "product", "features.json"), JSON.stringify(inventory));
    const result = validate(pm);
    assert.equal(result.errors.length, 0, JSON.stringify(result.details));
  }
});

test("binding validation rejects an ancestor symlink", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-symlink-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pm = path.join(root, "pm");
  const outside = path.join(root, "outside");
  fs.mkdirSync(path.join(pm, "thinking"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const markdown = Buffer.from("# Outside\n");
  fs.writeFileSync(path.join(outside, "bound.md"), markdown);
  fs.symlinkSync(outside, path.join(pm, "bindings"));
  const brief = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "evals", "product-reasoning-quality", "strong", "decision.json"),
      "utf8"
    )
  );
  brief.source_artifacts = [{ path: "bindings/bound.md", sha256: sha(markdown) }];
  fs.writeFileSync(path.join(pm, "thinking", "symlink.decision.json"), JSON.stringify(brief));
  const result = validate(pm);
  assert.ok(result.errors.some((entry) => entry.msg.includes("contains symlink")));
});
