"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validate } = require("../scripts/validate");
const { decisionId, featureSourceSnapshot } = require("../scripts/lib/product-reasoning-schema");
const { verifyArtifactBindings } = require("../scripts/lib/product-reasoning-bindings");

function sha(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function renderFeatureMarkdown(inventory) {
  const features = inventory.areas.flatMap((area) => area.features);
  return Buffer.from(
    `---\ngenerated: ${inventory.generated_at.slice(0, 10)}\ninventory_version: 2\ninventory_file: product/features.json\nsource_project: ${inventory.source_project}\nfiles_scanned: ${inventory.scan.files_scanned}\nfiles_total: ${inventory.scan.files_total}\nfeature_count: ${features.length}\narea_count: ${inventory.areas.length}\nareas:\n${inventory.areas
      .map(
        (area) =>
          `  - name: "${area.name}"\n    features:\n${area.features.map((feature) => `      - "${feature.key}"`).join("\n")}`
      )
      .join("\n")}\n---\n\n# Features\n\n${inventory.areas
      .map(
        (area) =>
          `## ${area.name}\n\n${area.features
            .map(
              (feature) =>
                `### ${feature.name} <!-- ${feature.feature_id} -->\n\n${feature.outcome}`
            )
            .join("\n\n")}`
      )
      .join("\n\n")}\n`
  );
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
  assert.ok(
    result.errors.some(
      (entry) =>
        entry.msg.includes("companion requires v2 canonical reader") ||
        entry.msg.includes("reasoning_version must equal 2")
    ),
    JSON.stringify(result.errors)
  );

  const linkedMarkdown = Buffer.from(
    "---\ntype: thinking\ntopic: Test\nslug: test\ncreated: 2026-07-14\nupdated: 2026-07-14\nstatus: active\nreasoning_version: 2\ndecision_brief: thinking/test.decision.json\n---\n\n# Test\n"
  );
  fs.writeFileSync(path.join(pm, "thinking", "test.md"), linkedMarkdown);
  brief.source_artifacts[0].sha256 = sha(linkedMarkdown);
  fs.writeFileSync(path.join(pm, "thinking", "test.decision.json"), JSON.stringify(brief));
  const originalOpen = fs.openSync;
  let companionOpens = 0;
  let readerOpens = 0;
  const companionRealPath = fs.realpathSync(path.join(pm, "thinking", "test.decision.json"));
  const readerRealPath = fs.realpathSync(path.join(pm, "thinking", "test.md"));
  fs.openSync = function countedOpen(filePath, ...args) {
    if (path.resolve(filePath) === companionRealPath) companionOpens += 1;
    if (path.resolve(filePath) === readerRealPath) readerOpens += 1;
    return originalOpen.call(fs, filePath, ...args);
  };
  try {
    result = validate(pm);
  } finally {
    fs.openSync = originalOpen;
  }
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.equal(companionOpens, 1);
  assert.equal(readerOpens, 1);

  fs.writeFileSync(
    path.join(pm, "thinking", "test.md"),
    linkedMarkdown
      .toString("utf8")
      .replace("decision_brief: thinking/test.decision.json", "decision_brief: ../outside.json")
  );
  result = validate(pm);
  assert.ok(result.errors.some((entry) => entry.msg.includes("canonical companion")));

  fs.writeFileSync(path.join(pm, "thinking", "test.md"), linkedMarkdown);
  brief.kind = "idea";
  brief.decision_id = decisionId("idea", "test");
  brief.alignment = {
    strength: "partial",
    priority_ids: [],
    non_goal_conflicts: [],
    evidence_strength: "moderate",
    competitor_gap: "partial",
    dependencies: [],
    scope_signal: "small",
  };
  fs.writeFileSync(path.join(pm, "thinking", "test.decision.json"), JSON.stringify(brief));
  result = validate(pm);
  assert.ok(result.errors.some((entry) => entry.msg.includes("decision kind must equal think")));

  brief.kind = "think";
  brief.decision_id = decisionId("think", "test");
  delete brief.alignment;
  brief.source_artifacts[0].sha256 = `sha256:${"f".repeat(64)}`;
  fs.writeFileSync(path.join(pm, "thinking", "test.decision.json"), JSON.stringify(brief));
  result = validate(pm);
  assert.ok(result.errors.some((entry) => entry.msg.includes("SHA-256 does not match")));
});

test("normal validation rejects decision companion symlinks", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-symlink-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "thinking"), { recursive: true });
  fs.writeFileSync(
    path.join(pm, "thinking", "linked.md"),
    "---\ntype: thinking\ntopic: Linked\nslug: linked\ncreated: 2026-07-14\nupdated: 2026-07-14\nstatus: active\n---\n"
  );
  fs.writeFileSync(path.join(root, "outside.json"), "{}\n");
  fs.symlinkSync(
    path.join(root, "outside.json"),
    path.join(pm, "thinking", "linked.decision.json")
  );
  const result = validate(pm);
  assert.ok(result.errors.some((entry) => entry.msg.includes("symlink")));

  fs.mkdirSync(path.join(pm, "product"));
  fs.writeFileSync(
    path.join(pm, "product", "features.md"),
    "---\ngenerated: 2026-07-14\ninventory_version: 2\ninventory_file: product/features.json\nsource_project: example\nfiles_scanned: 1\nfeature_count: 1\narea_count: 1\nareas:\n  - Core\n---\n\n### Feature\n"
  );
  fs.symlinkSync(path.join(root, "missing.json"), path.join(pm, "product", "features.json"));
  const withFeatureLink = validate(pm);
  assert.ok(withFeatureLink.errors.some((entry) => entry.msg.includes("symlink")));
});

test("lineage frontmatter requires canonical companions in Strategy, Think, and Ideate", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-frontmatter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "thinking"), { recursive: true });
  fs.mkdirSync(path.join(pm, "backlog"), { recursive: true });
  fs.writeFileSync(
    path.join(pm, "strategy.md"),
    "---\ntype: strategy\ncreated: 2026-07-14\nupdated: 2026-07-14\nreasoning_version: 2\ndecision_brief: strategy.decision.json\n---\n"
  );
  fs.writeFileSync(
    path.join(pm, "thinking", "choice.md"),
    "---\ntype: thinking\ntopic: Choice\nslug: choice\ncreated: 2026-07-14\nupdated: 2026-07-14\nstatus: active\nreasoning_version: 2\ndecision_brief: thinking/choice.decision.json\n---\n"
  );
  fs.writeFileSync(
    path.join(pm, "backlog", "idea.md"),
    "---\ntype: backlog\nid: PM-001\ntitle: Idea\noutcome: Test the idea\nstatus: idea\npriority: medium\ncreated: 2026-07-14\nupdated: 2026-07-14\nreasoning_version: 2\ndecision_brief: backlog/idea.decision.json\n---\n"
  );
  const result = validate(pm);
  for (const artifact of ["strategy.md", "thinking/choice.md", "backlog/idea.md"]) {
    assert.ok(
      result.errors.some(
        (entry) => entry.file === artifact && entry.msg.includes("invalid companion")
      ),
      `${artifact} did not require its companion: ${JSON.stringify(result.errors)}`
    );
  }
});

test("malformed linked decision roots return bounded validation errors without throwing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-linked-total-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "thinking"), { recursive: true });
  fs.writeFileSync(
    path.join(pm, "thinking", "choice.md"),
    "---\ntype: thinking\ntopic: Choice\nslug: choice\ncreated: 2026-07-14\nupdated: 2026-07-14\nstatus: active\nreasoning_version: 2\ndecision_brief: thinking/choice.decision.json\n---\n"
  );
  for (const value of [null, 1, "invalid", []]) {
    fs.writeFileSync(path.join(pm, "thinking", "choice.decision.json"), JSON.stringify(value));
    let result;
    assert.doesNotThrow(() => {
      result = validate(pm);
    });
    assert.ok(result.errors.some((entry) => entry.msg.includes("must be an object")));
  }
});

test("v2 feature Markdown requires its canonical regular companion", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-features-linked-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "product"), { recursive: true });
  const markdown =
    "---\ngenerated: 2026-07-14\ninventory_version: 2\ninventory_file: product/features.json\nsource_project: example\nfiles_scanned: 1\nfeature_count: 1\narea_count: 1\nareas:\n  - Core\n---\n\n### Feature\n";
  fs.writeFileSync(path.join(pm, "product", "features.md"), markdown);
  let result = validate(pm, { sourceDir: root });
  assert.ok(result.errors.some((entry) => entry.msg.includes("invalid companion")));

  fs.writeFileSync(
    path.join(pm, "product", "features.md"),
    markdown.replace("product/features.json", "product/inventory.json")
  );
  result = validate(pm, { sourceDir: root });
  assert.ok(result.errors.some((entry) => entry.msg.includes("canonical companion")));
});

test("KB-relative feature bindings validate in nested and flat PM layouts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-layouts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, "source");
  fs.mkdirSync(sourceDir);
  for (const pm of [path.join(root, "nested", "pm"), path.join(root, "flat-kb")]) {
    fs.mkdirSync(path.join(pm, "product"), { recursive: true });
    const inventory = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "evals", "product-reasoning-quality", "strong", "features.json"),
        "utf8"
      )
    );
    const features = inventory.areas.flatMap((area) => area.features);
    for (const sourceRef of new Set(features.flatMap((feature) => feature.source_refs))) {
      const sourcePath = path.join(sourceDir, sourceRef);
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      if (!fs.existsSync(sourcePath)) fs.writeFileSync(sourcePath, `${sourceRef}\n`);
    }
    const snapshot = featureSourceSnapshot(
      sourceDir,
      features.flatMap((feature) => feature.source_refs)
    );
    inventory.scan = {
      mode: "filesystem",
      files_scanned: snapshot.file_count,
      files_total: snapshot.file_count,
      commit: null,
      snapshot_sha256: snapshot.snapshot_sha256,
    };
    const markdown = renderFeatureMarkdown(inventory);
    fs.writeFileSync(path.join(pm, "product", "features.md"), markdown);
    inventory.markdown_binding.sha256 = sha(markdown);
    fs.writeFileSync(path.join(pm, "product", "features.json"), JSON.stringify(inventory));
    const result = validate(pm, { sourceDir });
    assert.equal(result.errors.length, 0, JSON.stringify(result.details));
    const driftedMarkdown = Buffer.from(
      markdown.toString("utf8").replace(features[0].feature_id, `feat-${"f".repeat(20)}`)
    );
    fs.writeFileSync(path.join(pm, "product", "features.md"), driftedMarkdown);
    inventory.markdown_binding.sha256 = sha(driftedMarkdown);
    fs.writeFileSync(path.join(pm, "product", "features.json"), JSON.stringify(inventory));
    const semanticallyDrifted = validate(pm, { sourceDir });
    assert.ok(semanticallyDrifted.errors.some((entry) => entry.msg.includes("feature IDs")));
    fs.writeFileSync(path.join(pm, "product", "features.md"), markdown);
    inventory.markdown_binding.sha256 = sha(markdown);
    fs.writeFileSync(path.join(pm, "product", "features.json"), JSON.stringify(inventory));
    const staleRef = features[0].source_refs[0];
    fs.writeFileSync(path.join(sourceDir, staleRef), "changed\n");
    const stale = validate(pm, { sourceDir });
    assert.ok(stale.errors.some((entry) => entry.msg.includes("snapshot does not match")));
    fs.writeFileSync(path.join(sourceDir, staleRef), `${staleRef}\n`);
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
  fs.mkdirSync(path.join(pm, "backlog"), { recursive: true });
  const canonical = Buffer.from("# Guided evidence refresh\n");
  fs.writeFileSync(path.join(pm, "backlog", "guided-evidence-refresh.md"), canonical);
  brief.source_artifacts = [
    { path: "backlog/guided-evidence-refresh.md", sha256: sha(canonical) },
    { path: "bindings/bound.md", sha256: sha(markdown) },
  ];
  fs.writeFileSync(path.join(pm, "thinking", "symlink.decision.json"), JSON.stringify(brief));
  const result = validate(pm);
  assert.ok(result.errors.some((entry) => entry.msg.includes("contains symlink")));
});

test("binding validation enforces a 64 MiB aggregate budget", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-aggregate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "backlog"), { recursive: true });
  fs.mkdirSync(path.join(pm, "bindings"));
  const first = path.join(pm, "bindings", "binding-0.bin");
  fs.writeFileSync(first, Buffer.alloc(14 * 1024 * 1024, 0x61));
  for (let index = 1; index < 5; index += 1)
    fs.linkSync(first, path.join(pm, "bindings", `binding-${index}.bin`));
  const bytes = fs.readFileSync(first);
  const brief = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "evals", "product-reasoning-quality", "strong", "decision.json"),
      "utf8"
    )
  );
  const canonical = Buffer.from("# Guided evidence refresh\n");
  fs.writeFileSync(path.join(pm, "backlog", "guided-evidence-refresh.md"), canonical);
  brief.source_artifacts = [
    { path: "backlog/guided-evidence-refresh.md", sha256: sha(canonical) },
    ...Array.from({ length: 5 }, (_, index) => ({
      path: `bindings/binding-${index}.bin`,
      sha256: sha(bytes),
    })),
    { path: "bindings/must-not-open.bin", sha256: `sha256:${"f".repeat(64)}` },
  ];
  fs.writeFileSync(path.join(pm, "backlog", "aggregate.decision.json"), JSON.stringify(brief));
  const result = validate(pm);
  assert.ok(result.errors.some((entry) => entry.msg.includes("aggregate binding bytes")));
  assert.ok(result.errors.every((entry) => !entry.msg.includes("must-not-open")));
});

test("binding validation shares one aggregate budget across sequential reads", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reasoning-shared-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = Buffer.alloc(1024, 0x61);
  const second = Buffer.alloc(1024, 0x62);
  fs.writeFileSync(path.join(root, "first.bin"), first);
  fs.writeFileSync(path.join(root, "second.bin"), second);
  const budgetState = { remaining: 1536 };
  assert.deepEqual(
    verifyArtifactBindings(root, [{ path: "first.bin", sha256: sha(first) }], {
      maxFileBytes: 1024,
      maxTotalBytes: 1536,
      budgetState,
    }),
    []
  );
  assert.match(
    verifyArtifactBindings(root, [{ path: "second.bin", sha256: sha(second) }], {
      maxFileBytes: 1024,
      maxTotalBytes: 1536,
      budgetState,
    }).join("\n"),
    /aggregate binding bytes/
  );
});
