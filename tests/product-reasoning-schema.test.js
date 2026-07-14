"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  decisionId,
  featureId,
  featureSourceSnapshot,
  promoteDecisionBrief,
  rankIdeaBriefs,
  reconcileFeatureInventory,
  validateDecisionBrief,
  validateFeatureSourceRefs,
  validateFeatureInventory,
} = require("../scripts/lib/product-reasoning-schema");

function brief(kind, slug, overrides = {}) {
  const reader =
    kind === "think"
      ? `thinking/${slug}.md`
      : kind === "idea"
        ? `backlog/${slug}.md`
        : "strategy.md";
  const value = {
    schema_version: 1,
    document_type: "decision-brief",
    decision_id: decisionId(kind, slug),
    kind,
    slug,
    title: slug,
    problem: "A concrete product problem needs a deliberate decision.",
    evidence_refs: [
      {
        ref: "evidence/research/source.md#finding-1",
        evidence_id: null,
        note: "Observed signal",
      },
    ],
    alternatives: [
      { id: "focused", title: "Focused", tradeoff: "Lower reach for faster learning." },
      { id: "broad", title: "Broad", tradeoff: "More reach with higher delivery risk." },
    ],
    decision: {
      status: "confirmed",
      choice: "focused",
      rationale: "Tests the riskiest assumption first.",
    },
    confidence: {
      level: "medium",
      basis: ["One current research signal", "Delivery feasibility is verified"],
    },
    non_goals: ["Solve adjacent workflows"],
    next_trigger: { lane: "groom", condition: "User confirms scope", target: null },
    promotion: { status: "not-offered", target_kind: null, target_ref: null, confirmed_at: null },
    source_artifacts: [{ path: reader, sha256: `sha256:${"a".repeat(64)}` }],
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
    ...overrides,
  };
  if (kind === "strategy")
    value.strategy_context = overrides.strategy_context || {
      priorities: [{ id: "retention", title: "Improve retention" }],
      non_goals: [{ id: "enterprise", title: "Enterprise administration" }],
    };
  if (kind === "idea")
    value.alignment = overrides.alignment || {
      strength: "strong",
      priority_ids: ["retention"],
      non_goal_conflicts: [],
      evidence_strength: "moderate",
      competitor_gap: "unique",
      dependencies: [],
      scope_signal: "small",
    };
  return value;
}

test("decision identity is provider-neutral and schema validation is closed", () => {
  const value = brief("think", "retention-loop");
  assert.equal(value.decision_id, decisionId("think", "retention-loop"));
  assert.deepEqual(validateDecisionBrief(value), []);
  assert.match(validateDecisionBrief({ ...value, raw_prompt: "private" }).join("\n"), /unknown/);
});

test("confirmed decisions require real alternatives and low evidence caps confidence", () => {
  const noAlternatives = brief("think", "one-way", { alternatives: [] });
  assert.match(validateDecisionBrief(noAlternatives).join("\n"), /at least two alternatives/);
  const unsupported = brief("think", "unsupported", {
    evidence_refs: [],
    confidence: { level: "high", basis: ["intuition"] },
  });
  assert.match(validateDecisionBrief(unsupported).join("\n"), /low confidence/);
});

test("promotion cannot claim success without a verified target binding", () => {
  const value = brief("think", "promotion", {
    promotion: { status: "promoted", target_kind: "groom", target_ref: null, confirmed_at: null },
  });
  assert.match(validateDecisionBrief(value).join("\n"), /portable|RFC 3339/);
  const offered = brief("think", "offered", {
    promotion: { status: "offered", target_kind: "groom", target_ref: null, confirmed_at: null },
  });
  assert.match(validateDecisionBrief(offered).join("\n"), /target_kind must be null/);
});

test("promotion transition refreshes target and binding state as one validated record", () => {
  const promoted = promoteDecisionBrief(
    brief("idea", "promotion-transition"),
    "backlog/proposals/promotion-transition.json",
    [
      {
        path: "backlog/proposals/promotion-transition.json",
        sha256: `sha256:${"c".repeat(64)}`,
      },
      {
        path: "backlog/proposals/promotion-transition.approval.json",
        sha256: `sha256:${"e".repeat(64)}`,
      },
      {
        path: "backlog/promotion-transition.md",
        sha256: `sha256:${"d".repeat(64)}`,
      },
    ],
    "2026-07-14T01:00:00Z",
    { id: "groom-decision", sha256: `sha256:${"f".repeat(64)}` },
    `sha256:${"1".repeat(64)}`
  );
  assert.equal(promoted.promotion.status, "promoted");
  assert.equal(promoted.updated_at, "2026-07-14T01:00:00Z");
  assert.deepEqual(validateDecisionBrief(promoted), []);
});

test("artifact paths are KB-relative while HTTPS evidence locators remain portable", () => {
  const externalEvidence = brief("think", "external-evidence", {
    evidence_refs: [
      { ref: "https://example.com/research", evidence_id: null, note: "Public source" },
    ],
  });
  assert.deepEqual(validateDecisionBrief(externalEvidence), []);
  externalEvidence.source_artifacts[0].path = "https://example.com/artifact.md";
  assert.match(validateDecisionBrief(externalEvidence).join("\n"), /portable knowledge-base path/);
  externalEvidence.source_artifacts[0].path = "pm/thinking/example.md";
  assert.match(validateDecisionBrief(externalEvidence).join("\n"), /without a pm\/ prefix/);
});

test("decision comparison and inventory presentation reject ambiguous duplicates", () => {
  const duplicated = brief("think", "duplicate-alternative");
  duplicated.alternatives[1].id = duplicated.alternatives[0].id;
  assert.match(validateDecisionBrief(duplicated).join("\n"), /duplicated/);
  duplicated.alternatives[1] = {
    id: "different-id",
    title: duplicated.alternatives[0].title.toUpperCase(),
    tradeoff: `${duplicated.alternatives[0].tradeoff} `,
  };
  assert.match(validateDecisionBrief(duplicated).join("\n"), /duplicates another alternative/);

  const features = ["one", "two", "three", "four", "five", "six", "seven", "eight"].map((key) =>
    feature(key)
  );
  features[0].highlights = ["Only one"];
  assert.match(validateFeatureInventory(inventory(features)).join("\n"), /2 through 4/);
});

test("decision validation is total for malformed alternative collections", () => {
  const malformed = brief("think", "malformed-alternatives", { alternatives: {} });
  assert.doesNotThrow(() => validateDecisionBrief(malformed));
  assert.match(validateDecisionBrief(malformed).join("\n"), /must be an array/);
});

test("promoted decision validation is total and artifact bindings are bounded", () => {
  const promoted = brief("think", "bounded-bindings", {
    promotion: {
      status: "promoted",
      target_kind: "groom",
      target_ref: "backlog/proposals/bounded-bindings.json",
      confirmed_at: "2026-07-14T01:00:00Z",
    },
  });
  for (const malformed of [true, 1, "bindings", {}]) {
    const value = { ...promoted, source_artifacts: malformed };
    assert.doesNotThrow(() => validateDecisionBrief(value));
    assert.match(validateDecisionBrief(value).join("\n"), /must be an array/);
  }
  promoted.source_artifacts = Array.from({ length: 17 }, (_, index) => ({
    path: `backlog/binding-${index}.md`,
    sha256: `sha256:${"a".repeat(64)}`,
  }));
  assert.match(validateDecisionBrief(promoted).join("\n"), /cannot exceed 16/);
  promoted.source_artifacts = promoted.source_artifacts.slice(0, 16);
  assert.doesNotMatch(validateDecisionBrief(promoted).join("\n"), /cannot exceed 16/);
  promoted.source_artifacts = [
    { path: "backlog/same.md", sha256: `sha256:${"a".repeat(64)}` },
    { path: "backlog/same.md", sha256: `sha256:${"a".repeat(64)}` },
  ];
  assert.match(validateDecisionBrief(promoted).join("\n"), /path is duplicated/);
});

test("decision cross-fields bind canonical readers and promotion lineage", () => {
  const missingReader = brief("idea", "canonical-reader");
  missingReader.source_artifacts[0].path = "backlog/unrelated.md";
  assert.match(validateDecisionBrief(missingReader).join("\n"), /canonical reader/);

  const promoted = brief("idea", "canonical-reader", {
    promotion: {
      status: "promoted",
      target_kind: "groom",
      target_ref: "backlog/unrelated.json",
      confirmed_at: "2026-07-14T00:00:00Z",
    },
  });
  promoted.source_artifacts.push({
    path: "backlog/unrelated.json",
    sha256: `sha256:${"b".repeat(64)}`,
  });
  assert.match(validateDecisionBrief(promoted).join("\n"), /target_ref must equal/);
  promoted.promotion.target_ref = "backlog/proposals/canonical-reader.json";
  promoted.source_artifacts.push({
    path: promoted.promotion.target_ref,
    sha256: `sha256:${"c".repeat(64)}`,
  });
  assert.match(validateDecisionBrief(promoted).join("\n"), /approval audit/);
  promoted.source_artifacts.push({
    path: "backlog/proposals/canonical-reader.approval.json",
    sha256: `sha256:${"d".repeat(64)}`,
  });
  promoted.promotion.confirmed_at = "2026-07-14T01:00:00Z";
  assert.match(validateDecisionBrief(promoted).join("\n"), /confirmation must equal updated_at/);

  const strategy = brief("strategy", "product-direction", {
    promotion: {
      status: "promoted",
      target_kind: "groom",
      target_ref: "backlog/proposals/product-direction.json",
      confirmed_at: "2026-07-14T00:00:00Z",
    },
  });
  strategy.source_artifacts.push({
    path: strategy.promotion.target_ref,
    sha256: `sha256:${"c".repeat(64)}`,
  });
  assert.match(validateDecisionBrief(strategy).join("\n"), /only Think and Ideate/);
});

test("idea decisions retain at least one source signal", () => {
  const unsupported = brief("idea", "unsupported-idea", {
    evidence_refs: [],
    confidence: { level: "low", basis: ["Unverified hypothesis"] },
  });
  assert.match(validateDecisionBrief(unsupported).join("\n"), /source signal/);
});

test("idea evidence labels are calibrated to distinct cited signals", () => {
  const inflated = brief("idea", "inflated-evidence", {
    alignment: {
      strength: "strong",
      priority_ids: ["retention"],
      non_goal_conflicts: [],
      evidence_strength: "strong",
      competitor_gap: "unique",
      dependencies: [],
      scope_signal: "small",
    },
  });
  assert.match(validateDecisionBrief(inflated).join("\n"), /at least three distinct signals/);
  inflated.evidence_refs.push(
    { ref: "evidence/research/two.md", evidence_id: null, note: "Second signal" },
    { ref: "evidence/research/three.md", evidence_id: null, note: "Third signal" }
  );
  assert.deepEqual(validateDecisionBrief(inflated), []);
});

test("idea alignment enums reject inherited object keys", () => {
  const fields = ["strength", "evidence_strength", "competitor_gap", "scope_signal"];
  for (const field of fields)
    for (const inherited of ["toString", "constructor", "__proto__"]) {
      const candidate = brief("idea", `invalid-${field}-${inherited}`);
      candidate.alignment[field] = inherited;
      assert.match(validateDecisionBrief(candidate).join("\n"), new RegExp(field));
      assert.throws(() => rankIdeaBriefs([candidate]), /invalid idea brief/);
    }
});

test("timestamps reject normalized calendar overflow", () => {
  const invalid = brief("think", "invalid-date", { updated_at: "2026-02-30T00:00:00Z" });
  assert.match(validateDecisionBrief(invalid).join("\n"), /updated_at must be RFC 3339/);
});

test("idea ranking is deterministic and exposes strategy conflicts", () => {
  const strategy = brief("strategy", "product-direction");
  const strong = brief("idea", "strong-idea");
  const conflicted = brief("idea", "conflicted-idea", {
    alignment: {
      strength: "partial",
      priority_ids: ["unknown-priority"],
      non_goal_conflicts: ["enterprise", "stale-token"],
      evidence_strength: "moderate",
      competitor_gap: "partial",
      dependencies: ["foundation"],
      scope_signal: "large",
    },
  });
  const first = rankIdeaBriefs([conflicted, strong], strategy);
  const second = rankIdeaBriefs([strong, conflicted], strategy);
  assert.deepEqual(first, second);
  assert.equal(first[0].decision_id, strong.decision_id);
  assert.deepEqual(first[1].unknown_priorities, ["unknown-priority"]);
  assert.deepEqual(first[1].non_goal_conflicts, ["enterprise"]);
  assert.deepEqual(first[1].unknown_non_goals, ["stale-token"]);
});

test("idea ranking does not call unverified strategy tokens confirmed conflicts", () => {
  const candidate = brief("idea", "unbound-strategy", {
    alignment: {
      strength: "partial",
      priority_ids: ["possible-priority"],
      non_goal_conflicts: ["possible-conflict"],
      evidence_strength: "moderate",
      competitor_gap: "partial",
      dependencies: [],
      scope_signal: "small",
    },
  });
  const [ranked] = rankIdeaBriefs([candidate]);
  assert.deepEqual(ranked.unknown_priorities, ["possible-priority"]);
  assert.deepEqual(ranked.non_goal_conflicts, []);
  assert.deepEqual(ranked.unknown_non_goals, ["possible-conflict"]);
});

function inventory(features) {
  return {
    schema_version: 2,
    document_type: "feature-inventory",
    generated_at: "2026-07-14T00:00:00Z",
    source_project: "example",
    scan: {
      mode: "git",
      files_scanned: 12,
      files_total: 20,
      commit: "a".repeat(40),
      snapshot_sha256: null,
    },
    areas: [
      { name: "Discover", features: features.slice(0, 3) },
      { name: "Build", features: features.slice(3, 6) },
      { name: "Learn", features: features.slice(6, 8) },
    ],
    markdown_binding: { path: "product/features.md", sha256: `sha256:${"b".repeat(64)}` },
  };
}

function feature(key, refs = [`src/${key}.js`]) {
  return {
    feature_id: featureId("example", key),
    key,
    name: key,
    outcome: `Users can complete ${key} without manual reconstruction.`,
    highlights: ["Complete the main user outcome", "See actionable status"],
    confidence: "high",
    source_refs: refs,
  };
}

test("feature inventory validates stable IDs, source refs, and calibrated bounds", () => {
  const value = inventory(
    ["one", "two", "three", "four", "five", "six", "seven", "eight"].map((key) => feature(key))
  );
  assert.deepEqual(validateFeatureInventory(value), []);
  value.areas[0].features[0].source_refs = ["/private/source.js"];
  assert.match(validateFeatureInventory(value).join("\n"), /portable/);
});

test("feature source refs resolve at the recorded scan commit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-feature-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "capability.js"), "export const capability = true;\n");
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "Test"],
    ["add", "src/capability.js"],
    ["commit", "-qm", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const commit = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  const value = inventory(
    ["one", "two", "three", "four", "five", "six", "seven", "eight"].map((key) =>
      feature(key, ["src/capability.js"])
    )
  );
  value.scan.commit = commit;
  assert.deepEqual(validateFeatureSourceRefs(value, root), []);
  value.scan.commit = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  assert.match(validateFeatureSourceRefs(value, root).join("\n"), /exact commit object/);
  assert.equal(
    spawnSync("git", ["tag", "-a", "snapshot-tag", "-m", "snapshot"], {
      cwd: root,
      encoding: "utf8",
    }).status,
    0
  );
  value.scan.commit = spawnSync("git", ["rev-parse", "refs/tags/snapshot-tag"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  assert.match(validateFeatureSourceRefs(value, root).join("\n"), /exact commit object/);
  value.scan.commit = commit;
  value.areas[0].features[0].source_refs = ["src/missing.js"];
  assert.match(validateFeatureSourceRefs(value, root).join("\n"), /absent at scan.commit/);
});

test("non-Git feature refs bind a deterministic filesystem snapshot", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-feature-filesystem-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "capability.js"), "export const capability = true;\n");
  const refs = ["src/capability.js"];
  const snapshot = featureSourceSnapshot(root, refs);
  const value = inventory(
    ["one", "two", "three", "four", "five", "six", "seven", "eight"].map((key) =>
      feature(key, refs)
    )
  );
  value.scan = {
    mode: "filesystem",
    files_scanned: 1,
    files_total: 1,
    commit: null,
    snapshot_sha256: snapshot.snapshot_sha256,
  };
  assert.deepEqual(validateFeatureSourceRefs(value, root), []);
  fs.writeFileSync(path.join(root, "src", "capability.js"), "export const capability = false;\n");
  assert.match(validateFeatureSourceRefs(value, root).join("\n"), /snapshot does not match/);
});

test("feature reconciliation preserves identity across rename with strong source continuity", () => {
  const priorFeatures = ["one", "two", "three", "four", "five", "six", "seven", "eight"].map(
    (key) => feature(key)
  );
  const previous = inventory(priorFeatures);
  const renamed = feature("renamed-one", ["src/one.js"]);
  const proposed = inventory([renamed, ...priorFeatures.slice(1)]);
  const result = reconcileFeatureInventory(previous, proposed);
  assert.deepEqual(result.ambiguous, []);
  assert.equal(result.inventory.areas[0].features[0].feature_id, priorFeatures[0].feature_id);
  assert.deepEqual(validateFeatureInventory(result.inventory), []);
});

test("feature reconciliation fails closed on equally plausible source matches", () => {
  const priorFeatures = [
    feature("one", ["src/shared.js"]),
    feature("two", ["src/shared.js"]),
    ...["three", "four", "five", "six", "seven", "eight"].map((key) => feature(key)),
  ];
  const previous = inventory(priorFeatures);
  const proposedFeatures = [feature("replacement", ["src/shared.js"]), ...priorFeatures.slice(2)];
  const proposed = inventory([...proposedFeatures, feature("nine")]);
  const result = reconcileFeatureInventory(previous, proposed);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].key, "replacement");
  assert.ok(!result.retired.includes(priorFeatures[0].feature_id));
  assert.ok(!result.retired.includes(priorFeatures[1].feature_id));
});

test("feature reconciliation requires resolution for unequal plausible merge inputs", () => {
  const priorFeatures = [
    feature("one", ["src/a.js", "src/b.js", "src/c.js", "src/d.js"]),
    feature("two", ["src/a.js", "src/b.js", "src/c.js"]),
    ...["three", "four", "five", "six", "seven", "eight"].map((key) => feature(key)),
  ];
  const previous = inventory(priorFeatures);
  const merged = feature("merged", ["src/a.js", "src/b.js", "src/c.js", "src/d.js", "src/e.js"]);
  const proposed = inventory([merged, ...priorFeatures.slice(2), feature("nine")]);
  const unresolved = reconcileFeatureInventory(previous, proposed);
  assert.deepEqual(unresolved.ambiguous, [
    {
      key: "merged",
      candidates: [priorFeatures[0].feature_id, priorFeatures[1].feature_id].sort(),
    },
  ]);
  assert.ok(!unresolved.retired.includes(priorFeatures[0].feature_id));
  assert.ok(!unresolved.retired.includes(priorFeatures[1].feature_id));
});

test("feature reconciliation preserves balanced merge and split lineage for explicit resolution", () => {
  const mergedPrior = [
    feature("left", ["src/left-a.js", "src/left-b.js"]),
    feature("right", ["src/right-a.js", "src/right-b.js"]),
    ...["three", "four", "five", "six", "seven", "eight"].map((key) => feature(key)),
  ];
  const mergedProposed = inventory([
    feature("combined", ["src/left-a.js", "src/left-b.js", "src/right-a.js", "src/right-b.js"]),
    ...mergedPrior.slice(2),
    feature("nine"),
  ]);
  const merge = reconcileFeatureInventory(inventory(mergedPrior), mergedProposed);
  const mergeAmbiguity = merge.ambiguous.find((entry) => entry.key === "combined");
  assert.deepEqual(
    mergeAmbiguity.candidates,
    [mergedPrior[0].feature_id, mergedPrior[1].feature_id].sort()
  );
  assert.ok(!merge.retired.includes(mergedPrior[0].feature_id));
  assert.ok(!merge.retired.includes(mergedPrior[1].feature_id));

  const splitPrior = [
    feature("whole", ["src/a.js", "src/b.js", "src/c.js", "src/d.js"]),
    ...["two", "three", "four", "five", "six", "seven", "eight"].map((key) => feature(key)),
  ];
  const splitProposed = inventory([
    feature("first-half", ["src/a.js", "src/b.js"]),
    feature("second-half", ["src/c.js", "src/d.js"]),
    ...splitPrior.slice(1, 7),
  ]);
  const split = reconcileFeatureInventory(inventory(splitPrior), splitProposed);
  assert.deepEqual(
    split.ambiguous
      .filter((entry) => ["first-half", "second-half"].includes(entry.key))
      .map((entry) => entry.key)
      .sort(),
    ["first-half", "second-half"]
  );
  assert.ok(!split.retired.includes(splitPrior[0].feature_id));
});

test("feature reconciliation reports many-to-one collisions independent of proposal order", () => {
  const priorFeatures = [
    feature("shared-prior", ["src/a.js", "src/b.js", "src/c.js", "src/d.js"]),
    ...["two", "three", "four", "five", "six", "seven", "eight"].map((key) => feature(key)),
  ];
  const previous = inventory(priorFeatures);
  const stronger = feature("stronger-rename", ["src/a.js", "src/b.js", "src/c.js", "src/d.js"]);
  const weaker = feature("weaker-rename", ["src/a.js", "src/b.js", "src/c.js"]);
  const tail = priorFeatures.slice(1);
  const first = reconcileFeatureInventory(previous, inventory([stronger, weaker, ...tail]));
  const second = reconcileFeatureInventory(previous, inventory([weaker, stronger, ...tail]));
  assert.deepEqual(first.ambiguous, second.ambiguous);
  assert.deepEqual(
    first.ambiguous.map((entry) => entry.key),
    ["stronger-rename", "weaker-rename"]
  );
  assert.ok(
    first.ambiguous.every((entry) => entry.candidates.includes(priorFeatures[0].feature_id))
  );
  assert.ok(!first.retired.includes(priorFeatures[0].feature_id));
});

test("feature reconciliation applies explicit rename, merge, split, and new resolutions", () => {
  const priorFeatures = [
    feature("shared-a", ["src/shared.js"]),
    feature("shared-b", ["src/shared.js"]),
    ...["three", "four", "five", "six", "seven", "eight"].map((key) => feature(key)),
  ];
  const previous = inventory(priorFeatures);
  const proposed = inventory([
    feature("replacement", ["src/shared.js"]),
    feature("split", ["src/shared.js"]),
    ...priorFeatures.slice(2),
  ]);
  const unresolved = reconcileFeatureInventory(previous, proposed);
  assert.equal(unresolved.ambiguous.length, 2);
  const resolved = reconcileFeatureInventory(previous, proposed, {
    replacement: priorFeatures[0].feature_id,
    split: "new",
  });
  assert.deepEqual(resolved.ambiguous, []);
  const byKey = new Map(
    resolved.inventory.areas.flatMap((area) => area.features).map((entry) => [entry.key, entry])
  );
  assert.equal(byKey.get("replacement").feature_id, priorFeatures[0].feature_id);
  assert.equal(byKey.get("split").feature_id, featureId(proposed.source_project, "split"));
  assert.throws(
    () =>
      reconcileFeatureInventory(previous, proposed, {
        replacement: priorFeatures[0].feature_id,
        split: priorFeatures[0].feature_id,
      }),
    /reuses claimed identity/
  );
  assert.throws(
    () =>
      reconcileFeatureInventory(previous, proposed, { replacement: "feat-00000000000000000000" }),
    /reported candidate/
  );
});

test("feature resolutions are own-property and ambiguity-only", () => {
  const exactFeatures = [
    "constructor",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
  ].map((key) => feature(key));
  const previous = inventory(exactFeatures);
  const proposed = inventory(structuredClone(exactFeatures));
  const unchanged = reconcileFeatureInventory(previous, proposed);
  assert.equal(unchanged.inventory.areas[0].features[0].feature_id, exactFeatures[0].feature_id);
  assert.throws(
    () => reconcileFeatureInventory(previous, proposed, { constructor: "new" }),
    /not an unresolved ambiguity/
  );
  assert.throws(
    () => reconcileFeatureInventory(previous, proposed, { two: exactFeatures[1].feature_id }),
    /not an unresolved ambiguity/
  );
});
