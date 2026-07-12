"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  allocateLenses,
  changeAnchorText,
  devReviewContext,
  deriveLensApplicability,
  findingId,
  mergeSignals,
} = require("../scripts/lib/review-contract");

const ALL = ["bug", "design", "edge", "reuse", "quality", "efficiency"];

test("change-anchor labels share exact head, base, and path formatting", () => {
  assert.equal(
    changeAnchorText({
      path: "src/cache.js",
      side: "head",
      line_start: 4,
      line_end: 9,
      affected_ref: "src/cache.js:12",
      relation: "The changed write leaves the affected read stale.",
    }),
    "src/cache.js [head 4-9] → src/cache.js:12 — The changed write leaves the affected read stale."
  );
  assert.equal(
    changeAnchorText({
      path: "src/cache.js",
      side: "base",
      line_start: 2,
      line_end: 3,
      affected_ref: "src/cache.js:8",
      relation: "Removing the guard changes the affected branch.",
    }),
    "src/cache.js [base 2-3] → src/cache.js:8 — Removing the guard changes the affected branch."
  );
  assert.equal(
    changeAnchorText({
      path: "assets/logo.png",
      side: "path",
      affected_ref: "src/header.js:10",
      relation: "The changed asset is displayed by the affected header.",
    }),
    "assets/logo.png [path] → src/header.js:10 — The changed asset is displayed by the affected header."
  );
});

test("adaptive allocation covers every logical lens exactly once", () => {
  for (const maxWorkers of [1, 2, 3, 4, 5, 6, 10]) {
    const allocation = allocateLenses(ALL, maxWorkers, "codex-workhorse");
    const assigned = allocation.flatMap((worker) => worker.lenses);
    assert.deepEqual([...assigned].sort(), [...ALL].sort());
    assert.equal(new Set(assigned).size, ALL.length);
    assert.equal(allocation.length, Math.min(maxWorkers, ALL.length));
    if (maxWorkers >= 3) {
      assert.deepEqual(allocation.find((worker) => worker.lenses.includes("bug")).lenses, ["bug"]);
      assert.deepEqual(allocation.find((worker) => worker.lenses.includes("edge")).lenses, [
        "edge",
      ]);
    }
  }
});

test("finding identity is deterministic across evidence order but changes with location", () => {
  const finding = sampleFinding();
  const reversed = { ...finding, evidence: [...finding.evidence].reverse() };
  assert.equal(findingId(finding), findingId(reversed));
  assert.equal(findingId(finding), findingId({ ...finding, category: "edge" }));
  const saltedSource = structuredClone(finding);
  saltedSource.evidence[0].sha256 = "f".repeat(64);
  assert.equal(findingId(finding), findingId(saltedSource));
  assert.notEqual(findingId(finding), findingId({ ...finding, line_start: 11 }));
});

test("merge retains reviewer signals and exposes material disagreement", () => {
  const first = { ...sampleFinding(), id: findingId(sampleFinding()), reviewer_id: "worker-bug" };
  const second = {
    ...first,
    reviewer_id: "worker-edge",
    severity: "low",
    owner: "qa",
    fix: "Exercise the live flow in QA.",
  };
  const merged = mergeSignals([first, second], []);
  assert.equal(merged.findings.length, 1);
  assert.equal(merged.findings[0].signals.length, 2);
  assert.equal(merged.findings[0].disputed, true);
  assert.equal(merged.unresolved_disagreements.length, 1);

  const decided = mergeSignals(
    [first, second],
    [
      {
        finding_id: first.id,
        approver: "Maintainer",
        action: "keep-review",
        rationale: "The defect is statically reproducible and belongs to Review.",
        decided_at: "2026-07-12T00:00:00Z",
      },
    ]
  );
  assert.deepEqual(decided.unresolved_disagreements, [first.id]);
  assert.equal(decided.findings[0].owner, "review");
});

test("decision requirement disagreement is material and remains decision-bound", () => {
  const first = { ...sampleFinding(), id: findingId(sampleFinding()), reviewer_id: "worker-a" };
  const second = { ...first, reviewer_id: "worker-b", decision_required: true };
  const merged = mergeSignals([first, second], []);
  assert.equal(merged.findings[0].disputed, true);
  assert.equal(merged.findings[0].decision_required, true);
  assert.deepEqual(merged.unresolved_disagreements, [first.id]);
});

test("incompatible fixes are material disagreement even with the same fix kind", () => {
  const first = { ...sampleFinding(), id: findingId(sampleFinding()), reviewer_id: "worker-a" };
  const second = { ...first, reviewer_id: "worker-b", fix: "Delete the cache entirely." };
  const merged = mergeSignals([first, second], []);
  assert.equal(merged.findings[0].disputed, true);
  assert.deepEqual(merged.unresolved_disagreements, [first.id]);
});

test("overlapping findings with different identities cannot evade fix disagreement", () => {
  const first = { ...sampleFinding(), reviewer_id: "worker-a" };
  first.id = findingId(first);
  const second = {
    ...sampleFinding(),
    reviewer_id: "worker-b",
    rule: "cache-coherency-contract",
    evidence: [{ kind: "source", ref: "src/example.js:11" }],
    fix: "Delete caching from the read path.",
  };
  second.id = findingId(second);
  assert.notEqual(first.id, second.id);
  const merged = mergeSignals([first, second], []);
  assert.equal(
    merged.findings.every((finding) => finding.disputed),
    true
  );
  assert.deepEqual(merged.unresolved_disagreements, [first.id, second.id].sort());
});

test("Dev review context binds route identity and ordered acceptance criteria", () => {
  const session = {
    run_id: "dev_example",
    slug: "example",
    routing: { review_mode: "full", decision_version: 2 },
    task: { acceptance_criteria: ["First", "Second"] },
  };
  const context = devReviewContext(session);
  assert.deepEqual(context, {
    run_id: "dev_example",
    slug: "example",
    review_mode: "full",
    decision_version: 2,
    acceptance_sha256: context.acceptance_sha256,
  });
  assert.match(context.acceptance_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(
    context.acceptance_sha256,
    devReviewContext({
      ...session,
      task: { acceptance_criteria: ["Second", "First"] },
    }).acceptance_sha256
  );
});

test("Review design applicability shares Dev's UI-impact classifier", () => {
  const positives = [
    "src/app/app.component.ts",
    "apps/admin/app/page.ts",
    "src/features/orders/useOrderFilters.ts",
    "src/router/index.ts",
    "tailwind.config.ts",
    "packages/ui/tokens/colors.json",
    "app/page.mdx",
    "frontend/state.ts",
    "ios/ContentView.swift",
    "ios/Checkout/Card.swift",
    "ios/Checkout/CardViewController.m",
    "ios/en.lproj/Checkout.strings",
    "ios/App/Main.storyboard",
    "ios/App/Assets.xcassets/Accent.colorset/Contents.json",
    "ContentView.swift",
    "MyApp/ContentView.swift",
    "Features/Home/HomeScreen.swift",
    "Checkout/CardViewController.swift",
    "Checkout/CardViewController.m",
    "AppDelegate.swift",
    "MyApp/SceneDelegate.m",
    "android/CheckoutScreen.kt",
    "android/app/src/main/java/com/acme/payments/Card.kt",
    "android/app/src/main/res/layout/checkout.xml",
    "android/app/src/main/res/drawable/card.xml",
    "mobile/src/main/java/com/acme/CheckoutScreen.kt",
    "feature-checkout/src/main/kotlin/com/acme/CheckoutActivity.kt",
    "feature-checkout/src/main/kotlin/com/acme/ui/CheckoutView.kt",
    "feature-checkout/src/main/kotlin/com/acme/adapters/CheckoutAdapter.kt",
    "feature-checkout/src/main/res/layout/checkout.xml",
    "feature-checkout/src/debug/res/values/colors.xml",
    "lib/widgets/cart_widget.dart",
    "lib/checkout/card.dart",
    "public/images/checkout-card.svg",
  ];
  for (const path of positives) {
    const design = deriveLensApplicability("full", [{ path }]).find(
      (item) => item.name === "design"
    );
    assert.equal(design.applicable, true, path);
  }
  for (const path of [
    "server/jobs/sync.ts",
    "pm/backlog/rfc.html",
    ".pm/private/report.html",
    "Sources/Networking/APIClient.swift",
    "Sources/Core/DateParser.swift",
    "Sources/Models/User.swift",
    "services/payments/src/main/kotlin/com/acme/Ledger.kt",
    "services/payments/src/main/kotlin/com/acme/PaymentAdapter.kt",
    "services/payments/src/main/kotlin/com/acme/Overview.kt",
    "app/services/Billing.kt",
    "app/domain/Ledger.kt",
    "app/jobs/Reconcile.kt",
  ]) {
    const design = deriveLensApplicability("full", [{ path }]).find(
      (item) => item.name === "design"
    );
    assert.equal(design.applicable, false, path);
  }
});

function sampleFinding() {
  return {
    category: "bug",
    severity: "high",
    confidence: 96,
    file: "src/example.js",
    line_start: 10,
    line_end: 12,
    rule: "stale-cache",
    issue: "The mutation leaves the cached value stale.",
    impact: "Readers observe the pre-mutation value.",
    fix: "Invalidate the cache after the write.",
    fix_kind: "behavioral",
    verify: "node --test tests/example.test.js",
    evidence: [
      { kind: "source", ref: "src/example.js:10" },
      { kind: "test", ref: "tests/example.test.js:20" },
    ],
    owner: "review",
    disposition: "open",
    decision_required: false,
  };
}
