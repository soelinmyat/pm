"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  MAX_VIEWPORT_PIXELS,
  manifestShape,
  prepareCapturePlan,
  redactedUrlIdentity,
  resolveBrowser,
  runCaptureProbe,
  validateProbeResult,
  validateStateAssertion,
  validateSurfacePattern,
  validateViewport,
  urlMatchesSurface,
} = require("../scripts/design-critique-capture");
const {
  accessibilityObservations,
  appendBoundedEvidence,
  createVisibilityEvaluator,
  domObservations,
  installWebSocketPolicy,
  nodeVisibleInViewport,
  normalizeAllowedOrigins,
  verifyAssertionHitTargets,
  webSocketBlockPatterns,
  webSocketPolicyOrigins,
} = require("../scripts/design-critique-capture-probe");
const { normalizeRawAudit } = require("../scripts/design-critique-audit-normalize");

const EMPTY_DIFF_SHA256 = crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex");
let installedBrowser = null;
try {
  installedBrowser = resolveBrowser();
} catch {
  // Browser-backed cases carry an explicit skip below.
}
const browserSkip =
  (process.env.PM_SKIP_BROWSER_TESTS && "browser tests explicitly disabled") ||
  (!installedBrowser && "Chromium is not installed");

function route(commit = "a".repeat(40)) {
  return {
    schema_version: 2,
    run_id: "dc_test_capture",
    created_at: "2026-09-04T00:00:00.000Z",
    mode: "product-ui",
    source: {
      commit,
      base_ref: "origin/main",
      base_commit: commit,
      diff_sha256: EMPTY_DIFF_SHA256,
    },
    subjects: [
      {
        id: "account-detail",
        title: "Account detail",
        surface: "/accounts/:id",
        platform: "web",
      },
    ],
    coverage: [
      {
        id: "account-primary-desktop",
        subject_id: "account-detail",
        state: "primary",
        viewport: "desktop",
        required: true,
        reason: "Changed primary route",
      },
    ],
  };
}

function assertion(value = "primary") {
  return {
    schema_version: 2,
    subject_id: "account-detail",
    coverage_id: "account-primary-desktop",
    state: value,
    state_marker: {
      locator: { by: "test-id", value: "account-state" },
      attribute: "data-pm-state",
      value,
    },
    all: [
      {
        locator: { by: "role-name", value: "button:Save changes" },
        expect: { kind: "visible" },
      },
    ],
  };
}

function planOptions(extra = {}) {
  return {
    subjectId: "account-detail",
    coverageId: "account-primary-desktop",
    captureId: "capture-account-primary-desktop-r1",
    url: "http://127.0.0.1:4173/accounts/1",
    expectedUrl: "http://127.0.0.1:4173/accounts/1",
    width: 1024,
    height: 600,
    assertion: assertion(),
    assertionPath:
      ".pm/dev-sessions/test/design-critique/state-assertions/account-primary-desktop.json",
    assertionSha256: "b".repeat(64),
    allowedOrigins: [],
    outputDir: ".pm/dev-sessions/test/design-critique/round-1/capture-account-primary-desktop-r1",
    ...extra,
  };
}

test("capture plan derives state and viewport from the frozen coverage row", () => {
  const plan = prepareCapturePlan(
    route(),
    ".pm/dev-sessions/test/design-critique/route.json",
    planOptions()
  );
  assert.deepEqual(
    {
      subject: plan.subject.id,
      coverage: plan.coverage.id,
      state: plan.coverage.state,
      viewport: plan.coverage.viewport,
      width: plan.viewport.width,
      allowedOrigins: plan.allowedOrigins,
    },
    {
      subject: "account-detail",
      coverage: "account-primary-desktop",
      state: "primary",
      viewport: "desktop",
      width: 1024,
      allowedOrigins: ["http://127.0.0.1:4173"],
    }
  );
});

test("capture planning rejects date-only route timestamps", () => {
  const frozen = route();
  frozen.created_at = "2026-09-04";

  assert.throws(
    () =>
      prepareCapturePlan(frozen, ".pm/dev-sessions/test/design-critique/route.json", planOptions()),
    /route\.created_at must be RFC 3339/
  );
});

test("certifying state assertions are closed declarative data, not JavaScript", () => {
  assert.throws(
    () => validateStateAssertion({ schema_version: 1, expression: "window.ready === true" }),
    /expression is an unknown field/
  );
  assert.throws(
    () =>
      validateStateAssertion({
        ...assertion(),
        all: [
          {
            locator: { by: "selector", value: "body" },
            expect: { kind: "visible" },
          },
        ],
      }),
    /locator.by is invalid/
  );
  assert.throws(
    () =>
      validateStateAssertion(
        { ...assertion(), coverage_id: "account-error-desktop" },
        {
          subject_id: "account-detail",
          coverage_id: "account-primary-desktop",
          state: "primary",
        }
      ),
    /identity must match/
  );
  assert.throws(
    () =>
      validateStateAssertion({
        ...assertion(),
        state_marker: {
          locator: { by: "test-id", value: "account-state" },
          attribute: "data-state",
          value: "primary",
        },
      }),
    /must require data-pm-state/
  );
  assert.doesNotThrow(() => validateStateAssertion(assertion()));
});

test("semantic UI states require a state-specific declarative guard", () => {
  assert.throws(
    () => validateStateAssertion({ ...assertion(), all: [] }),
    /must contain 1 through 20 guard clauses/
  );
  const guards = {
    error: [
      {
        locator: { by: "role-name", value: "alert:Payment failed" },
        expect: { kind: "visible" },
      },
    ],
    loading: [
      {
        locator: { by: "role-name", value: "progressbar:Loading account" },
        expect: { kind: "visible" },
      },
    ],
    focus: [
      { locator: { by: "id", value: "account-name" }, expect: { kind: "focused" } },
      { locator: { by: "id", value: "account-name" }, expect: { kind: "visible" } },
    ],
    disabled: [
      {
        locator: { by: "id", value: "save" },
        expect: { kind: "attribute-equals", name: "aria-disabled", value: "true" },
      },
      { locator: { by: "id", value: "save" }, expect: { kind: "visible" } },
    ],
    keyboard: [
      { locator: { by: "id", value: "account-name" }, expect: { kind: "focused" } },
      { locator: { by: "id", value: "account-name" }, expect: { kind: "visible" } },
    ],
    modal: [
      {
        locator: { by: "role-name", value: "dialog:Confirm changes" },
        expect: { kind: "visible" },
      },
    ],
  };
  for (const [state, guard] of Object.entries(guards)) {
    const candidate = {
      ...assertion(state),
      all: [
        {
          locator: { by: "test-id", value: "unrelated-content" },
          expect: { kind: "visible" },
        },
      ],
    };
    assert.throws(
      () => validateStateAssertion(candidate),
      new RegExp(`state assertion for ${state} requires`)
    );
    assert.doesNotThrow(() => validateStateAssertion({ ...candidate, all: guard }));
  }
});

test("web route patterns bind only safe exact path segments", () => {
  assert.doesNotThrow(() => validateSurfacePattern("/accounts/:id"));
  for (const unsafe of [
    "accounts/:id",
    "/accounts/*",
    "/accounts/",
    "/accounts/../admin",
    "/accounts?id=1",
  ])
    assert.throws(() => validateSurfacePattern(unsafe), /subject surface/);
  assert.equal(
    urlMatchesSurface("https://app.test/accounts/acct-1?token=secret", "/accounts/:id"),
    true
  );
  assert.equal(urlMatchesSurface("https://app.test/admin/acct-1", "/accounts/:id"), false);
  assert.throws(
    () => urlMatchesSurface("https://app.test/accounts/%2Fadmin", "/accounts/:id"),
    /safe route alphabet/
  );
});

test("URL identities redact query and fragment values while binding the full URL", () => {
  const secret = "do-not-persist-this-secret";
  const first = redactedUrlIdentity(
    `https://app.test/accounts/acct-1?token=${secret}#${secret}`,
    "URL"
  );
  const second = redactedUrlIdentity(
    "https://app.test/accounts/acct-1?token=another#another",
    "URL"
  );
  const serialized = JSON.stringify(first.public);
  assert.equal(serialized.includes(secret), false);
  assert.deepEqual(
    {
      origin: first.public.origin,
      pathname: first.public.pathname,
      has_query: first.public.has_query,
      has_fragment: first.public.has_fragment,
    },
    {
      origin: "https://app.test",
      pathname: "/accounts/acct-1",
      has_query: true,
      has_fragment: true,
    }
  );
  assert.notEqual(first.public.full_url_sha256, second.public.full_url_sha256);
});

test("routed viewport labels enforce plausible dimensions", () => {
  assert.deepEqual(validateViewport("narrow", 320, 480), { width: 320, height: 480 });
  assert.deepEqual(validateViewport("desktop", 4096, 4096), { width: 4096, height: 4096 });
  assert.deepEqual(validateViewport("desktop", 8192, 600), { width: 8192, height: 600 });
  assert.deepEqual(validateViewport("narrow", 320, 8192), { width: 320, height: 8192 });
  assert.throws(() => validateViewport("narrow", 319, 480), /outside its accepted range/);
  assert.throws(() => validateViewport("tablet", 768, 599), /at least 600/);
  assert.throws(() => validateViewport("desktop", 1023, 800), /outside its accepted range/);
  assert.throws(
    () => validateViewport("desktop", Number.MAX_SAFE_INTEGER, 600),
    /outside its accepted range/
  );
  assert.throws(
    () => validateViewport("desktop", 1024, Number.MAX_SAFE_INTEGER),
    /must be at most 8192/
  );
  assert.throws(
    () => validateViewport("desktop", 8192, 8192),
    new RegExp(`exceeds the ${MAX_VIEWPORT_PIXELS}-pixel budget`)
  );
  assert.throws(
    () =>
      prepareCapturePlan(
        route(),
        ".pm/dev-sessions/test/design-critique/route.json",
        planOptions({ width: 8192, height: 8192 })
      ),
    /exceeds the 16777216-pixel budget/
  );
});

test("composite controls require a browser-observed document focus entry point", () => {
  const model = [
    { index: 0, backendNodeId: 1, parentIndex: -1, nodeName: "main", attributes: {} },
    {
      index: 1,
      backendNodeId: 2,
      parentIndex: 0,
      nodeName: "div",
      attributes: { role: "tablist" },
    },
    {
      index: 2,
      backendNodeId: 3,
      parentIndex: 1,
      nodeName: "button",
      attributes: { id: "summary-tab", role: "tab", tabindex: "-1" },
    },
    {
      index: 3,
      backendNodeId: 4,
      parentIndex: 1,
      nodeName: "button",
      attributes: { id: "history-tab", role: "tab", tabindex: "-1" },
    },
  ];
  const axTree = {
    nodes: [
      {
        nodeId: "main",
        backendDOMNodeId: 1,
        role: { value: "main" },
        name: { value: "" },
        properties: [],
      },
      {
        nodeId: "views",
        parentId: "main",
        backendDOMNodeId: 2,
        role: { value: "tablist" },
        name: { value: "Views" },
        properties: [],
      },
      {
        nodeId: "summary",
        parentId: "views",
        backendDOMNodeId: 3,
        role: { value: "tab" },
        name: { value: "Summary" },
        properties: [],
      },
      {
        nodeId: "history",
        parentId: "views",
        backendDOMNodeId: 4,
        role: { value: "tab" },
        name: { value: "History" },
        properties: [],
      },
    ],
  };
  const observations = accessibilityObservations(axTree, model);
  assert.ok(observations.controls.every((item) => item.focus_context === "document"));
  const audit = normalizeRawAudit(
    {
      schema_version: 1,
      kind: "accessibility-tree",
      subject_id: "broken-tabs",
      commit: "a".repeat(40),
      capture_ids: ["capture-broken-tabs-primary-desktop-r1"],
      observations,
    },
    { path: ".pm/test/raw-a11y.json", sha256: "b".repeat(64) }
  );
  assert.equal(audit.checks.focus_order, false);
  assert.equal(audit.findings.filter((item) => item.code === "not-keyboard-reachable").length, 2);
});

test("capture plan refuses noncanonical assertion and output locations", () => {
  const frozen = route();
  assert.throws(
    () =>
      prepareCapturePlan(
        frozen,
        ".pm/dev-sessions/test/design-critique/route.json",
        planOptions({ assertionPath: ".pm/dev-sessions/test/assertion.json" })
      ),
    /canonical path/
  );
  assert.throws(
    () =>
      prepareCapturePlan(
        frozen,
        ".pm/dev-sessions/test/design-critique/route.json",
        planOptions({ outputDir: ".pm/dev-sessions/test/design-critique/round-1/other" })
      ),
    /output directory must be/
  );
  assert.throws(
    () =>
      prepareCapturePlan(
        frozen,
        ".pm/dev-sessions/test/design-critique/route.json",
        planOptions({ url: "http://127.0.0.1:4173/admin/1" })
      ),
    /capture URL path does not match/
  );
  assert.throws(
    () =>
      prepareCapturePlan(
        frozen,
        ".pm/dev-sessions/test/design-critique/route.json",
        planOptions({ expectedUrl: "http://127.0.0.1:4173/admin/1" })
      ),
    /expected final URL path does not match/
  );
  assert.throws(
    () =>
      prepareCapturePlan(
        frozen,
        ".pm/dev-sessions/test/design-critique/route.json",
        planOptions({
          expectedUrl: "https://lookalike.test/accounts/1",
          allowedOrigins: ["https://lookalike.test"],
        })
      ),
    /expected final URL origin must match the requested page origin/
  );
});

test("probe validation fails closed on URL, viewport, or network drift", () => {
  const plan = prepareCapturePlan(
    route(),
    ".pm/dev-sessions/test/design-critique/route.json",
    planOptions()
  );
  const attestation = {
    dev: "1",
    ino: "2",
    size: "1024",
    mtime_ns: "3",
    ctime_ns: "4",
    sha256: "c".repeat(64),
  };
  const result = {
    schema_version: 2,
    page: {
      target_id: "target",
      main_frame_id: "frame",
      loader_id: "loader",
      final_url: plan.expectedUrlIdentity,
      css_viewport: {
        inner_width: 1024,
        inner_height: 600,
        client_width: 1024,
        client_height: 600,
        scroll_width: 1024,
        scroll_height: 600,
        device_scale_factor: 1,
        scroll_x: 0,
        scroll_y: 0,
        visual_scale: 1,
        page_zoom: 1,
      },
    },
    assertion_visibility: {
      method: "cdp-dom-get-node-for-location-v1",
      effective_opacity_floor: 0.01,
      verified_nodes: 2,
      checks: [
        {
          label: "state marker",
          asserted_backend_node_id: 1,
          hit_backend_node_id: 1,
          x: 10,
          y: 10,
        },
        {
          label: "state assertion clause 1",
          asserted_backend_node_id: 3,
          hit_backend_node_id: 3,
          x: 20,
          y: 20,
        },
      ],
    },
    assertion_passed: true,
    accessibility_observations: { landmarks: [], controls: [] },
    dom_observations: {
      viewport: { inner_width: 1024, client_width: 1024, scroll_width: 1024 },
      hierarchy: [],
      edge_alignment: [],
      consistency: [],
      asymmetry: [],
    },
    screenshot: attestation,
    verification_screenshot: attestation,
    network: {
      policy: "explicit-origin-allowlist",
      allowed_origins: plan.allowedOrigins,
      observed_origins: plan.allowedOrigins,
      requests: [],
      violations: [],
    },
    timestamps: {
      started_at: "2026-09-04T00:00:00.000Z",
      page_ready_at: "2026-09-04T00:00:01.000Z",
      captured_at: "2026-09-04T00:00:02.000Z",
      completed_at: "2026-09-04T00:00:03.000Z",
    },
  };
  assert.doesNotThrow(() => validateProbeResult(result, plan));
  assert.throws(
    () =>
      validateProbeResult(
        {
          ...result,
          page: {
            ...result.page,
            final_url: redactedUrlIdentity(`${plan.expectedUrl}?drift=1`, "URL").public,
          },
        },
        plan
      ),
    /navigation drift/
  );
  assert.throws(
    () =>
      validateProbeResult(
        {
          ...result,
          page: {
            ...result.page,
            css_viewport: { ...result.page.css_viewport, inner_width: 1000 },
          },
        },
        plan
      ),
    /CSS viewport/
  );
  assert.throws(
    () =>
      validateProbeResult(
        {
          ...result,
          network: { ...result.network, violations: [{ origin: "https://evil.test" }] },
        },
        plan
      ),
    /network policy violation/
  );
});

test("capture manifest rejects unknown fields at nested boundaries", () => {
  const publicUrl = redactedUrlIdentity("http://127.0.0.1/accounts/1", "URL").public;
  const fixture = {
    schema_version: 2,
    kind: "product-ui-capture",
    run_id: "dc_test",
    mode: "product-ui",
    commit: "a".repeat(40),
    route: { path: ".pm/dev-sessions/test/design-critique/route.json", sha256: "b".repeat(64) },
    subject_id: "account-detail",
    coverage: { id: "account-primary-desktop", state: "primary", viewport: "desktop" },
    capture: {
      id: "capture-account-primary-desktop-r1",
      path: ".pm/example/capture.png",
      sha256: "c".repeat(64),
      pixel_sha256: "d".repeat(64),
      visual_metrics: {
        meaningful_pixel_ratio: 0.4,
        meaningful_tile_ratio: 0.8,
        color_bucket_count: 12,
        luminance_range: 180,
        perceptual_grid: Buffer.alloc(192, 64).toString("base64"),
      },
      width: 1024,
      height: 600,
      full_page: false,
      round: 1,
      captured_at: "2026-09-04T00:00:00.000Z",
    },
    raw_evidence: {
      accessibility_tree: { path: ".pm/example/a11y.json", sha256: "e".repeat(64) },
      dom_audit: { path: ".pm/example/dom.json", sha256: "f".repeat(64) },
      network_ledger: { path: ".pm/example/network.json", sha256: "0".repeat(64) },
    },
    page: {
      route_surface: "/accounts/:id",
      requested_url: publicUrl,
      expected_url: publicUrl,
      final_url: publicUrl,
      target_id: "target",
      main_frame_id: "frame",
      loader_id: "loader",
      css_viewport: {
        inner_width: 1024,
        inner_height: 600,
        client_width: 1024,
        client_height: 600,
        scroll_width: 1024,
        scroll_height: 600,
        device_scale_factor: 1,
        scroll_x: 0,
        scroll_y: 0,
        visual_scale: 1,
        page_zoom: 1,
      },
      state_assertion: {
        path: ".pm/example/assertion.json",
        sha256: "1".repeat(64),
        passed: true,
        visibility: {
          method: "cdp-dom-get-node-for-location-v1",
          effective_opacity_floor: 0.01,
          verified_nodes: 2,
          checks: [
            {
              label: "state marker",
              asserted_backend_node_id: 1,
              hit_backend_node_id: 2,
              x: 10,
              y: 10,
            },
            {
              label: "state assertion clause 1",
              asserted_backend_node_id: 3,
              hit_backend_node_id: 3,
              x: 20,
              y: 20,
            },
          ],
        },
      },
    },
    observation: {
      assurance_level: "workflow-attested-non-cryptographic",
      producer: { name: "pm:design-critique-capture", version: "1.0.0" },
      browser: {
        engine: "chromium",
        before: { path: "/browser", bytes: 1, sha256: "2".repeat(64), version: "Chrome 1" },
        after: { path: "/browser", bytes: 1, sha256: "2".repeat(64), version: "Chrome 1" },
      },
      source: {
        before: { head: "a", tree: "b", tracked_status_sha256: "3".repeat(64), clean: true },
        after: { head: "a", tree: "b", tracked_status_sha256: "3".repeat(64), clean: true },
        guard: "clean-tracked-tree-before-and-after",
      },
      network: {
        policy: "explicit-origin-allowlist",
        allowed_origins: [],
        observed_origins: [],
        request_count: 0,
        ledger_sha256: "4".repeat(64),
        violations: 0,
      },
      configuration: {
        readiness_timeout_ms: 15_000,
        settle_ms: 250,
        browser_args_profile: "pm-product-ui-capture-v2",
        acquisition: "native-cdp-dom-ax-plus-two-pixel-stability-samples-and-network-barrier",
      },
      invocation_configuration_sha256: "5".repeat(64),
      stability: {
        samples: 2,
        native_observations_sha256: "6".repeat(64),
        decoded_pixels_sha256: "d".repeat(64),
      },
    },
    timestamps: {
      started_at: "2026-09-04T00:00:00.000Z",
      page_ready_at: "2026-09-04T00:00:00.000Z",
      captured_at: "2026-09-04T00:00:00.000Z",
      completed_at: "2026-09-04T00:00:00.000Z",
    },
  };
  assert.doesNotThrow(() => manifestShape(fixture));
  assert.throws(
    () => manifestShape({ ...fixture, capture: { ...fixture.capture, trusted: true } }),
    /trusted is an unknown field/
  );
});

test("visible assertions account for ancestors, clipping, and viewport intersection", () => {
  const metrics = {
    cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 100, clientHeight: 100 },
  };
  const createNode = (index, parentIndex, bounds, styles = {}, attributes = {}) => ({
    index,
    parentIndex,
    attributes,
    layout: { bounds },
    styles,
  });
  const style = (node, name) => node.styles[name] || "";

  const root = createNode(0, -1, [0, 0, 100, 100]);
  const partial = createNode(1, 0, [95, 95, 20, 20]);
  assert.equal(nodeVisibleInViewport(partial, [root, partial], style, metrics), true);

  const transparentRoot = createNode(0, -1, [0, 0, 100, 100], { opacity: "0" });
  const child = createNode(1, 0, [10, 10, 20, 20]);
  assert.equal(nodeVisibleInViewport(child, [transparentRoot, child], style, metrics), false);
  const nearTransparentRoot = createNode(0, -1, [0, 0, 100, 100], { opacity: "0.009" });
  assert.equal(nodeVisibleInViewport(child, [nearTransparentRoot, child], style, metrics), false);

  const visibilityHiddenRoot = createNode(0, -1, [0, 0, 100, 100], {
    visibility: "hidden",
  });
  const inheritedHiddenChild = createNode(1, 0, [10, 10, 20, 20], {
    visibility: "hidden",
  });
  assert.equal(
    nodeVisibleInViewport(
      inheritedHiddenChild,
      [visibilityHiddenRoot, inheritedHiddenChild],
      style,
      metrics
    ),
    false
  );
  const visibilityOverrideChild = createNode(1, 0, [10, 10, 20, 20], {
    visibility: "visible",
  });
  assert.equal(
    nodeVisibleInViewport(
      visibilityOverrideChild,
      [visibilityHiddenRoot, visibilityOverrideChild],
      style,
      metrics
    ),
    true
  );

  const cssShownHiddenRoot = createNode(
    0,
    -1,
    [0, 0, 100, 100],
    { display: "block" },
    { hidden: "" }
  );
  assert.equal(
    nodeVisibleInViewport(child, [cssShownHiddenRoot, child], style, metrics),
    true,
    "computed display must remain authoritative when author CSS overrides [hidden]"
  );

  for (const blockingStyles of [{ display: "none" }, { "content-visibility": "hidden" }]) {
    const blockingRoot = createNode(0, -1, [0, 0, 100, 100], blockingStyles);
    assert.equal(nodeVisibleInViewport(child, [blockingRoot, child], style, metrics), false);
  }

  const clippedRoot = createNode(0, -1, [0, 0, 50, 50], {
    "overflow-x": "hidden",
    "overflow-y": "hidden",
  });
  const clippedChild = createNode(1, 0, [60, 60, 20, 20]);
  assert.equal(
    nodeVisibleInViewport(clippedChild, [clippedRoot, clippedChild], style, metrics),
    false
  );

  for (const paintStyles of [
    { "clip-path": "inset(50%)" },
    { "clip-path": "circle(0% at 50% 50%)" },
    { filter: "blur(2px) opacity(0%)" },
    { "mask-image": "linear-gradient(transparent, transparent)" },
    { "mask-image": "radial-gradient(circle at center, transparent, transparent)" },
    {
      "mask-image":
        "repeating-radial-gradient(circle at center, transparent 0 10px, transparent 10px 20px)",
    },
    { "-webkit-mask-image": "linear-gradient(rgba(0, 0, 0, 0), transparent)" },
  ]) {
    const paintClippedRoot = createNode(0, -1, [0, 0, 100, 100], paintStyles);
    assert.equal(nodeVisibleInViewport(child, [paintClippedRoot, child], style, metrics), false);
  }

  for (const partialPaintStyles of [
    { "clip-path": "inset(10%)" },
    { "clip-path": "circle(40% at 50% 50%)" },
    { filter: "opacity(50%)" },
    { "mask-image": "linear-gradient(transparent, black)" },
    { "mask-image": "radial-gradient(circle at center, transparent, black)" },
  ]) {
    const partiallyPaintedRoot = createNode(0, -1, [0, 0, 100, 100], partialPaintStyles);
    assert.equal(nodeVisibleInViewport(child, [partiallyPaintedRoot, child], style, metrics), true);
  }

  const offscreen = createNode(1, 0, [101, 10, 20, 20]);
  assert.equal(nodeVisibleInViewport(offscreen, [root, offscreen], style, metrics), false);
});

test("visibility evaluation is iterative and linear at the maximum DOM depth", () => {
  const count = 50_000;
  const model = Array.from({ length: count }, (_, index) => ({
    index,
    parentIndex: index - 1,
    attributes: {},
    layout: { bounds: [0, 0, 10, 10] },
    styles: {
      display: "block",
      visibility: "visible",
      opacity: "1",
      "overflow-x": "visible",
      "overflow-y": "visible",
      "content-visibility": "visible",
      "clip-path": "none",
      filter: "none",
      "mask-image": "none",
      "-webkit-mask-image": "none",
    },
  }));
  const metrics = {
    cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 100, clientHeight: 100 },
  };
  let styleReads = 0;
  const style = (node, name) => {
    styleReads += 1;
    return node.styles[name] || "";
  };

  const evaluate = createVisibilityEvaluator(model, style, metrics);
  for (const node of model) assert.notEqual(evaluate(node), null);

  assert.ok(styleReads <= count * 12, `expected linear style reads, observed ${styleReads}`);
});

test("DOM observations exclude ancestor-hidden, clipped, and offscreen descendants", () => {
  const computedStyles = [
    "display",
    "visibility",
    "opacity",
    "font-size",
    "font-weight",
    "overflow",
    "overflow-x",
    "overflow-y",
    "content-visibility",
    "clip-path",
    "filter",
    "mask-image",
    "-webkit-mask-image",
    "position",
  ];
  const styleValues = (overrides = {}) =>
    computedStyles.map(
      (name) =>
        overrides[name] ??
        {
          display: "block",
          visibility: "visible",
          opacity: "1",
          "font-size": "16px",
          "font-weight": "400",
          overflow: "visible",
          "overflow-x": "visible",
          "overflow-y": "visible",
          "content-visibility": "visible",
          "clip-path": "none",
          filter: "none",
          "mask-image": "none",
          "-webkit-mask-image": "none",
          position: "static",
        }[name]
    );
  const node = (index, parentIndex, nodeName, bounds, overrides = {}) => ({
    index,
    backendNodeId: index + 1,
    parentIndex,
    nodeName,
    attributes: { id: `node-${index}` },
    layout: { bounds, styles: styleValues(overrides) },
  });
  const metrics = {
    cssLayoutViewport: { clientWidth: 400, clientHeight: 300 },
    cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 400, clientHeight: 300 },
    cssContentSize: { width: 500, height: 300 },
  };
  const visiblePair = [
    node(1, 0, "h1", [10, 10, 180, 30], { "font-size": "24px" }),
    node(2, 0, "h2", [10, 50, 180, 24], { "font-size": "16px" }),
  ];
  const scenarios = [
    [
      node(3, 0, "div", [10, 100, 180, 80], { opacity: "0" }),
      node(4, 3, "h1", [10, 100, 180, 24], { "font-size": "12px" }),
      node(5, 3, "h2", [10, 130, 180, 30], { "font-size": "30px" }),
    ],
    [
      node(3, 0, "div", [10, 100, 40, 40], {
        overflow: "hidden",
        "overflow-x": "hidden",
        "overflow-y": "hidden",
      }),
      node(4, 3, "h1", [100, 100, 180, 24], { "font-size": "12px" }),
      node(5, 3, "h2", [100, 130, 180, 30], { "font-size": "30px" }),
    ],
    [
      node(3, 0, "div", [450, 100, 180, 80]),
      node(4, 3, "h1", [450, 100, 180, 24], { "font-size": "12px" }),
      node(5, 3, "h2", [450, 130, 180, 30], { "font-size": "30px" }),
    ],
    [
      node(3, 0, "div", [10, 100, 180, 80], { "clip-path": "inset(50%)" }),
      node(4, 3, "h1", [10, 100, 180, 24], { "font-size": "12px" }),
      node(5, 3, "h2", [10, 130, 180, 30], { "font-size": "30px" }),
    ],
    [
      node(3, 0, "div", [10, 100, 180, 80], { filter: "opacity(0)" }),
      node(4, 3, "h1", [10, 100, 180, 24], { "font-size": "12px" }),
      node(5, 3, "h2", [10, 130, 180, 30], { "font-size": "30px" }),
    ],
    [
      node(3, 0, "div", [10, 100, 180, 80], {
        "mask-image": "linear-gradient(transparent, transparent)",
      }),
      node(4, 3, "h1", [10, 100, 180, 24], { "font-size": "12px" }),
      node(5, 3, "h2", [10, 130, 180, 30], { "font-size": "30px" }),
    ],
  ];

  for (const hiddenSubtree of scenarios) {
    const model = [node(0, -1, "main", [0, 0, 400, 300]), ...visiblePair, ...hiddenSubtree];
    assert.deepEqual(domObservations(model, metrics, computedStyles).hierarchy, []);
  }

  const clippedAlignmentModel = [
    node(0, -1, "main", [0, 0, 400, 300]),
    node(1, 0, "section", [0, 100, 100, 100], {
      overflow: "hidden",
      "overflow-x": "hidden",
      "overflow-y": "hidden",
    }),
    node(2, 1, "div", [0, 100, 100, 20]),
    node(3, 1, "div", [0, 130, 100, 20]),
    node(4, 1, "div", [0, 160, 150, 20]),
  ];
  assert.deepEqual(
    domObservations(clippedAlignmentModel, metrics, computedStyles).edge_alignment,
    [],
    "alignment must use the rendered intersection rather than clipped-away bounds"
  );
});

test("DOM consistency separates declared and native variants within component groups", () => {
  const computedStyles = [
    "display",
    "visibility",
    "opacity",
    "background-color",
    "overflow",
    "overflow-x",
    "overflow-y",
    "content-visibility",
  ];
  const styleValues = (background) =>
    computedStyles.map(
      (name) =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          "background-color": background,
          overflow: "visible",
          "overflow-x": "visible",
          "overflow-y": "visible",
          "content-visibility": "visible",
        })[name]
    );
  const button = (index, classes, background, attributes = {}) => ({
    index,
    backendNodeId: index + 1,
    parentIndex: 0,
    nodeName: "button",
    attributes: { id: `button-${index}`, class: classes, ...attributes },
    layout: { bounds: [10, 10 + index * 30, 120, 24], styles: styleValues(background) },
  });
  const root = {
    index: 0,
    backendNodeId: 1,
    parentIndex: -1,
    nodeName: "main",
    attributes: {},
    layout: { bounds: [0, 0, 400, 300], styles: styleValues("transparent") },
  };
  const metrics = {
    cssLayoutViewport: { clientWidth: 400, clientHeight: 300 },
    cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 400, clientHeight: 300 },
    cssContentSize: { width: 400, height: 300 },
  };
  const primaryOne = button(1, "button primary", "rgb(0, 80, 200)", {
    "aria-label": "Save account",
  });
  const primaryTwo = button(2, "primary button", "rgb(0, 80, 200)", {
    "aria-label": "Invite member",
  });
  const secondary = button(3, "button secondary", "rgb(255, 255, 255)", {
    "aria-label": "Cancel",
  });

  assert.deepEqual(
    domObservations([root, primaryOne, primaryTwo, secondary], metrics, computedStyles).consistency,
    []
  );

  const divergentPrimary = button(2, "primary button", "rgb(200, 0, 0)", {
    "aria-label": "Arbitrary replacement label",
  });
  const findings = domObservations(
    [root, primaryOne, divergentPrimary, secondary],
    metrics,
    computedStyles
  ).consistency;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "visual-variance");
  assert.match(findings[0].detail, /^button background-color:/);
  assert.doesNotMatch(findings[0].detail, /Arbitrary replacement label/);

  const explicitPrimaryOne = button(1, "button primary is-idle", "rgb(0, 80, 200)", {
    "data-component": "action",
    "data-variant": "primary",
  });
  const explicitPrimaryTwo = button(2, "button primary analytics-hook", "rgb(200, 0, 0)", {
    "data-component": "action",
    "data-variant": "primary",
  });
  const explicitSecondary = button(3, "button secondary", "rgb(255, 255, 255)", {
    "data-component": "action",
    "data-variant": "secondary",
  });
  const explicitFindings = domObservations(
    [root, explicitPrimaryOne, explicitPrimaryTwo, explicitSecondary],
    metrics,
    computedStyles
  ).consistency;
  assert.equal(explicitFindings.length, 1);
  assert.equal(explicitFindings[0].code, "visual-variance");
  assert.match(explicitFindings[0].detail, /^button background-color:/);

  const componentOnlyPrimaryOne = button(1, "action primary", "rgb(0, 80, 200)", {
    "data-component": "action",
  });
  const componentOnlyPrimaryTwo = button(2, "primary action", "rgb(200, 0, 0)", {
    "data-component": "action",
  });
  const componentOnlySecondary = button(3, "action secondary", "rgb(255, 255, 255)", {
    "data-component": "action",
  });
  const componentOnlyFindings = domObservations(
    [root, componentOnlyPrimaryOne, componentOnlyPrimaryTwo, componentOnlySecondary],
    metrics,
    computedStyles
  ).consistency;
  assert.equal(componentOnlyFindings.length, 1);
  assert.equal(componentOnlyFindings[0].code, "visual-variance");

  const disabledPrimary = button(2, "primary button", "rgb(180, 180, 180)", {
    disabled: "",
  });
  assert.deepEqual(
    domObservations([root, primaryOne, disabledPrimary], metrics, computedStyles).consistency,
    [],
    "enabled and disabled controls are intentional native states"
  );

  const input = (index, type, background) => ({
    index,
    backendNodeId: index + 1,
    parentIndex: 0,
    nodeName: "input",
    attributes: { id: `input-${index}`, type },
    layout: { bounds: [10, 10 + index * 30, 120, 24], styles: styleValues(background) },
  });
  const textInput = input(1, "text", "rgb(255, 255, 255)");
  const checkboxInput = input(2, "checkbox", "rgb(0, 80, 200)");
  assert.deepEqual(
    domObservations([root, textInput, checkboxInput], metrics, computedStyles).consistency,
    [],
    "different native input types must not be compared as one visual variant"
  );

  const divergentTextInput = input(2, "text", "rgb(200, 0, 0)");
  const textInputFindings = domObservations(
    [root, textInput, divergentTextInput],
    metrics,
    computedStyles
  ).consistency;
  assert.equal(textInputFindings.length, 1);
  assert.equal(textInputFindings[0].code, "visual-variance");
});

test("DOM asymmetry requires a repeated component baseline and reports only outliers", () => {
  const computedStyles = [
    "display",
    "visibility",
    "opacity",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "overflow",
    "overflow-x",
    "overflow-y",
    "content-visibility",
    "clip-path",
    "filter",
    "mask-image",
    "-webkit-mask-image",
  ];
  const styleValues = (padding) => {
    const [top, right, bottom, left] = padding;
    return computedStyles.map(
      (name) =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          "padding-top": `${top}px`,
          "padding-right": `${right}px`,
          "padding-bottom": `${bottom}px`,
          "padding-left": `${left}px`,
          overflow: "visible",
          "overflow-x": "visible",
          "overflow-y": "visible",
          "content-visibility": "visible",
          "clip-path": "none",
          filter: "none",
          "mask-image": "none",
          "-webkit-mask-image": "none",
        })[name]
    );
  };
  const container = (index, classes, padding, attributes = {}) => ({
    index,
    backendNodeId: index + 1,
    parentIndex: 0,
    nodeName: "section",
    attributes: { id: `container-${index}`, class: classes, ...attributes },
    layout: { bounds: [10, 10 + index * 50, 200, 40], styles: styleValues(padding) },
  });
  const root = {
    index: 0,
    backendNodeId: 1,
    parentIndex: -1,
    nodeName: "main",
    attributes: {},
    layout: { bounds: [0, 0, 400, 300], styles: styleValues([0, 0, 0, 0]) },
  };
  const metrics = {
    cssLayoutViewport: { clientWidth: 400, clientHeight: 300 },
    cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 400, clientHeight: 300 },
    cssContentSize: { width: 400, height: 300 },
  };

  const intentionalHero = container(1, "hero", [24, 16, 8, 16]);
  assert.deepEqual(
    domObservations([root, intentionalHero], metrics, computedStyles).asymmetry,
    [],
    "one-off asymmetric composition has no repeated-component baseline"
  );

  const cardOne = container(1, "card", [16, 16, 16, 16]);
  const cardTwo = container(2, "card", [16, 16, 16, 16]);
  const cardOutlier = container(3, "card", [28, 16, 8, 16]);
  const outliers = domObservations(
    [root, cardOne, cardTwo, cardOutlier],
    metrics,
    computedStyles
  ).asymmetry;
  assert.equal(outliers.length, 1);
  assert.equal(outliers[0].code, "asymmetric-padding");
  assert.match(outliers[0].detail, /repeated component baseline 16px\/16px/);

  const intentionalOne = container(1, "timeline-row", [24, 16, 8, 16]);
  const intentionalTwo = container(2, "timeline-row", [24, 16, 8, 16]);
  const intentionalThree = container(3, "timeline-row", [24, 16, 8, 16]);
  assert.deepEqual(
    domObservations(
      [root, intentionalOne, intentionalTwo, intentionalThree],
      metrics,
      computedStyles
    ).asymmetry,
    [],
    "repeated intentional asymmetry is a component pattern rather than an outlier"
  );

  const splitOne = container(1, "split-card", [16, 16, 16, 16]);
  const splitTwo = container(2, "split-card", [16, 16, 16, 16]);
  const splitThree = container(3, "split-card", [28, 16, 8, 16]);
  const splitFour = container(4, "split-card", [28, 16, 8, 16]);
  assert.deepEqual(
    domObservations([root, splitOne, splitTwo, splitThree, splitFour], metrics, computedStyles)
      .asymmetry,
    [],
    "an even style split does not establish a repeated-component baseline"
  );
});

test("native hit testing distinguishes legitimate nested content from occluding overlays", async () => {
  const metrics = {
    cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 100, clientHeight: 100 },
  };
  const target = {
    index: 0,
    backendNodeId: 1,
    parentIndex: -1,
    attributes: {},
    layout: { bounds: [10, 10, 40, 40] },
    styles: {},
  };
  const descendant = {
    index: 1,
    backendNodeId: 2,
    parentIndex: 0,
    attributes: {},
    layout: { bounds: [15, 15, 10, 10] },
    styles: {},
  };
  const overlay = {
    index: 2,
    backendNodeId: 3,
    parentIndex: -1,
    attributes: {},
    layout: { bounds: [0, 0, 100, 100] },
    styles: {},
  };
  const model = [target, descendant, overlay];
  const style = (node, name) => node.styles[name] || "";
  await assert.rejects(
    () =>
      verifyAssertionHitTargets(
        { send: async () => ({ backendNodeId: overlay.backendNodeId }) },
        [{ label: "state marker", node: target }],
        model,
        style,
        metrics
      ),
    /fully occluded/
  );
  const passed = await verifyAssertionHitTargets(
    { send: async () => ({ backendNodeId: descendant.backendNodeId }) },
    [{ label: "state marker", node: target }],
    model,
    style,
    metrics
  );
  assert.equal(passed.verified_nodes, 1);

  const nestedWrapper = {
    index: 2,
    backendNodeId: 3,
    parentIndex: target.index,
    attributes: {},
    layout: { bounds: [10, 10, 40, 40] },
    styles: {},
  };
  const nestedOverlay = {
    index: 3,
    backendNodeId: 4,
    parentIndex: nestedWrapper.index,
    attributes: {},
    layout: { bounds: [0, 0, 100, 100] },
    styles: { position: "fixed" },
  };
  await assert.rejects(
    () =>
      verifyAssertionHitTargets(
        { send: async () => ({ backendNodeId: nestedOverlay.backendNodeId }) },
        [{ label: "state marker", node: target }],
        [target, descendant, nestedWrapper, nestedOverlay],
        style,
        metrics
      ),
    /covered by a positioned descendant/
  );
});

test("observation limits fail loudly instead of truncating evidence", () => {
  const landmarkModel = Array.from({ length: 101 }, (_, index) => ({
    index,
    backendNodeId: index + 1,
    parentIndex: -1,
    nodeName: "nav",
    attributes: { id: `nav-${index}` },
    layout: { bounds: [0, 0, 10, 10], styles: [] },
  }));
  const landmarkTree = {
    nodes: landmarkModel.map((node) => ({
      ignored: false,
      backendDOMNodeId: node.backendNodeId,
      role: { value: "navigation" },
      name: { value: `Navigation ${node.index}` },
      properties: [],
    })),
  };
  assert.throws(
    () => accessibilityObservations(landmarkTree, landmarkModel),
    /accessibility landmarks exceed/
  );

  const values = [];
  appendBoundedEvidence(values, "first", 1, "network requests");
  assert.throws(
    () => appendBoundedEvidence(values, "second", 1, "network requests"),
    /network requests exceed/
  );
  assert.deepEqual(values, ["first"]);
});

test("WebSocket policy requires explicit socket origins and orders allow rules before denies", () => {
  assert.deepEqual(
    [...webSocketPolicyOrigins(new Set(["http://example.test:8080", "ws://example.test:8080"]))],
    ["http://example.test:8080", "ws://example.test:8080"]
  );
  assert.deepEqual(
    webSocketBlockPatterns(new Set(["http://example.test:8080", "ws://example.test:8080"])),
    [
      { urlPattern: "ws://example.test:8080/*", block: false },
      { urlPattern: "ws://*:*/*", block: true },
      { urlPattern: "wss://*:*/*", block: true },
    ]
  );
  assert.deepEqual(
    [...normalizeAllowedOrigins(["https://example.test", "wss://socket.example.test"])],
    ["https://example.test", "wss://socket.example.test"]
  );
  assert.throws(() => normalizeAllowedOrigins(["wss://*.example.test"]), /wildcard-free/);
  assert.throws(
    () =>
      prepareCapturePlan(
        route(),
        ".pm/dev-sessions/test/design-critique/route.json",
        planOptions({ allowedOrigins: ["wss://*.example.test"] })
      ),
    /cannot contain wildcards/
  );
});

test("WebSocket policy falls back to block-all and fails closed if neither mode installs", async () => {
  const fallbackCalls = [];
  const fallbackClient = {
    async send(method, params) {
      fallbackCalls.push([method, params]);
      if (params.urlPatterns) throw new Error("modern patterns unavailable");
      return {};
    },
  };
  assert.equal(
    await installWebSocketPolicy(fallbackClient, new Set(["wss://socket.example.test"])),
    "block-all-fallback"
  );
  assert.deepEqual(fallbackCalls, [
    [
      "Network.setBlockedURLs",
      {
        urlPatterns: [
          { urlPattern: "wss://socket.example.test/*", block: false },
          { urlPattern: "ws://*:*/*", block: true },
          { urlPattern: "wss://*:*/*", block: true },
        ],
      },
    ],
    ["Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] }],
  ]);

  const unavailableClient = {
    async send(_method, params) {
      throw new Error(params.urlPatterns ? "modern unavailable" : "legacy unavailable");
    },
  };
  await assert.rejects(
    installWebSocketPolicy(unavailableClient, new Set()),
    /cannot install the pre-connect WebSocket policy: legacy unavailable/
  );
});

function waitForChildLine(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error("child did not report readiness")),
      timeoutMs
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timeout);
      resolve(stdout.slice(0, newline));
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (stdout.includes("\n")) return;
      clearTimeout(timeout);
      reject(new Error(`child exited ${code} before readiness: ${stderr.trim()}`));
    });
  });
}

function waitForChildResult(child, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("child command timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 1_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function startLoopbackWebSocketServer(root) {
  const statsPath = path.join(root, "stats.json");
  const serverSource = String.raw`
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const http = require("node:http");
    const statsPath = process.argv[1];
    const stats = { handshakes: 0, frames: 0 };
    const save = () => fs.writeFileSync(statsPath, JSON.stringify(stats));
    const countApplicationFrame = (chunk) => {
      if (chunk.length > 0 && (chunk[0] & 0x0f) <= 2) stats.frames += 1;
    };
    save();
    const server = http.createServer((request, response) => {
      const requested = new URL(request.url, "http://" + request.headers.host);
      if (requested.pathname === "/service-worker.js") {
        const socketUrl = "ws://" + request.headers.host + "/socket";
        response.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "service-worker-allowed": "/"
        });
        response.end("new WebSocket(" + JSON.stringify(socketUrl) + ");");
        return;
      }
      if (requested.pathname !== "/capture") {
        response.writeHead(404);
        response.end();
        return;
      }
      const frameDelay = Number(requested.searchParams.get("frameDelay") || 0);
      const directSocket = requested.searchParams.get("directSocket") !== "0";
      const workerSocket = requested.searchParams.get("workerSocket") === "1";
      const nestedWorkerSocket = requested.searchParams.get("nestedWorkerSocket") === "1";
      const sharedWorker = requested.searchParams.get("sharedWorker") === "1";
      const serviceWorker = requested.searchParams.get("serviceWorker") === "1";
      const socketUrl = "ws://" + request.headers.host + "/socket";
      const directSocketScript = directSocket
        ? '<script>const socket=new WebSocket(' + JSON.stringify(socketUrl) + ');' +
          'socket.addEventListener("open",()=>setTimeout(()=>socket.send("capture-frame"),' +
          JSON.stringify(frameDelay) + '));</script>'
        : '';
      const workerSocketScript = workerSocket
        ? '<script>globalThis.__pmWorker=new Worker("data:text/javascript;charset=utf-8,"+' +
          'encodeURIComponent(' + JSON.stringify('new WebSocket(' + JSON.stringify(socketUrl) + ');') + '));</script>'
        : '';
      const nestedWorkerSocketScript = nestedWorkerSocket
        ? '<script>globalThis.__pmOuterWorker=new Worker("data:text/javascript;charset=utf-8,"+' +
          'encodeURIComponent(' + JSON.stringify(
            'globalThis.__pmNestedWorker=new Worker("data:text/javascript;charset=utf-8,"+' +
            'encodeURIComponent(' + JSON.stringify('new WebSocket(' + JSON.stringify(socketUrl) + ');') + '));'
          ) + '));</script>'
        : '';
      const sharedWorkerScript = sharedWorker
        ? '<script>{const source=' + JSON.stringify('new WebSocket(' + JSON.stringify(socketUrl) + ');') +
          ';const workerUrl=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));' +
          'new SharedWorker(workerUrl);}</script>'
        : '';
      const serviceWorkerScript = serviceWorker
        ? '<script>navigator.serviceWorker.register("/service-worker.js");</script>'
        : '';
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#eef2ff;color:#172033;font:16px system-ui}' +
        'main{max-width:800px;margin:40px auto;padding:32px;background:white;border-radius:16px}' +
        'button{padding:12px 20px;background:#3157d5;color:white;border:0;border-radius:8px}' +
        '</style></head><body><main data-testid="account-state" data-pm-state="primary">' +
        '<h1>Account overview</h1><p>Stable product evidence.</p><button>Save changes</button>' +
        directSocketScript + workerSocketScript + nestedWorkerSocketScript +
        sharedWorkerScript + serviceWorkerScript + '</main></body></html>'
      );
    });
    server.on("upgrade", (request, socket, head) => {
      stats.handshakes += 1;
      countApplicationFrame(head);
      save();
      const accept = crypto
        .createHash("sha1")
        .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
      );
      socket.on("data", (chunk) => {
        countApplicationFrame(chunk);
        save();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n");
    });
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
  `;
  const server = spawn(process.execPath, ["-e", serverSource, statsPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const { port } = JSON.parse(await waitForChildLine(server));
  return { server, statsPath, port };
}

function createBrowserFixture({
  externalRequest = false,
  occluded = false,
  descendantOccluded = false,
  lateRequest = false,
  webSocketUrl = null,
  webSocketFrameDelayMs = 0,
  persistentWorker = false,
  focusabilityControls = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-trusted-capture-"));
  const external = externalRequest ? '<img src="https://example.invalid/tracker.png" alt="">' : "";
  const overlay = occluded
    ? '<div style="position:fixed;inset:0;background:#111;z-index:9999">Overlay</div>'
    : "";
  const descendantOverlay = descendantOccluded
    ? '<div class="overlay-wrapper"><div style="position:fixed;inset:0;background:#111;z-index:9999">Nested overlay</div></div>'
    : "";
  const late = lateRequest
    ? '<script>setTimeout(()=>fetch("https://example.invalid/late"),300)</script>'
    : "";
  const webSocket = webSocketUrl
    ? `<script>{const socket=new WebSocket(${JSON.stringify(
        webSocketUrl
      )});socket.addEventListener("open",()=>setTimeout(()=>socket.send("capture-frame"),${JSON.stringify(
        webSocketFrameDelayMs
      )}));}</script>`
    : "";
  const persistentWorkerScript = persistentWorker
    ? '<script>new Worker("data:text/javascript;charset=utf-8,"+encodeURIComponent("setInterval(()=>{},10000)"));</script>'
    : "";
  const focusabilityMarkup =
    focusabilityControls === "active-descendant"
      ? '<section aria-label="Active descendant example"><div id="plans" role="listbox" aria-label="Plans" aria-activedescendant="plan-free" tabindex="0"><div id="plan-free" role="option" tabindex="-1">Free</div><div id="plan-pro" role="option" tabindex="-1">Pro</div><div id="plan-team" role="option" tabindex="-1">Team</div></div></section><script>{const listbox=document.querySelector("#plans");const options=[...listbox.querySelectorAll("[role=option]")];listbox.addEventListener("keydown",event=>{const direction=event.key==="ArrowDown"?1:event.key==="ArrowUp"?-1:0;if(!direction)return;event.preventDefault();const current=options.findIndex(option=>option.id===listbox.getAttribute("aria-activedescendant"));const next=(current+direction+options.length)%options.length;listbox.setAttribute("aria-activedescendant",options[next].id)})}</script>'
      : focusabilityControls
        ? '<section aria-label="Focus examples"><a id="no-destination" role="link">No destination</a><a id="destination" href="#account">Destination</a><label for="plan-select">Plan</label><select id="plan-select"><option>Free</option><option>Pro</option></select><div id="views" role="tablist" aria-label="Views"><button id="summary-tab" role="tab" tabindex="0">Summary tab</button><button id="history-tab" role="tab" tabindex="-1">History tab</button><button id="nameless-tab" role="tab" tabindex="-1"></button></div></section>' +
          (focusabilityControls === "working"
            ? '<script>{const tabs=[...document.querySelectorAll("#views>[role=tab]")];document.querySelector("#views").addEventListener("keydown",event=>{const direction=event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:0;if(!direction)return;event.preventDefault();const current=tabs.indexOf(document.activeElement);const next=(current+direction+tabs.length)%tabs.length;tabs.forEach((tab,index)=>{tab.tabIndex=index===next?0:-1});tabs[next].focus()})}</script>'
            : "")
        : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#eef2ff;color:#172033;font:16px system-ui}header{background:#18264a;color:white;padding:18px 28px}nav a{color:white;margin-right:16px}main{max-width:900px;margin:30px auto;padding:24px;background:white;border-radius:16px}h1{font-size:32px}h2{font-size:22px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{padding:18px;border:1px solid #ccd3e1;border-radius:12px}button{padding:10px 18px;background:#3157d5;color:white;border:0;border-radius:8px}
</style></head><body><header><nav aria-label="Primary"><a href="#account">Accounts</a></nav></header><main id="account" data-testid="account-state" data-pm-state="primary"><header><h1>Account overview</h1></header><section aria-labelledby="summary"><h2 id="summary">Summary</h2><div class="cards"><article class="card"><h2>Usage</h2><p>Stable product evidence.</p></article><article class="card"><h2>Plan</h2><p>Professional tier.</p></article></div><button>Save changes</button>${focusabilityMarkup}</section>${descendantOverlay}</main>${external}${overlay}${late}${webSocket}${persistentWorkerScript}</body></html>`;
  return {
    root,
    url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    outputPath: path.join(root, "capture.png"),
    verificationPath: path.join(root, "verification.png"),
    stateAssertion: assertion(),
  };
}

function runBrowserCapture(fixture, allowedOrigins = []) {
  return runCaptureProbe({
    browserPath: installedBrowser,
    url: fixture.url,
    expectedUrl: fixture.url,
    viewport: { width: 1024, height: 600 },
    stateAssertion: fixture.stateAssertion,
    allowedOrigins,
    readinessTimeoutMs: 15_000,
    settleMs: 200,
    outputPath: fixture.outputPath,
    verificationPath: fixture.verificationPath,
  });
}

test(
  "browser probe acquires one same-page screenshot, AX tree, and DOM snapshot",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture();
    try {
      const result = runBrowserCapture(fixture);
      assert.equal(result.schema_version, 2);
      assert.equal(result.page.final_url.origin, "data:");
      assert.equal(result.page.final_url.pathname, "");
      assert.equal(
        result.page.final_url.full_url_sha256,
        crypto.createHash("sha256").update(new URL(fixture.url).href).digest("hex")
      );
      assert.equal(JSON.stringify(result).includes("<!doctype html>"), false);
      assert.ok(result.page.target_id);
      assert.ok(result.page.main_frame_id);
      assert.ok(result.page.loader_id);
      assert.equal(result.dom_observations.viewport.inner_width, 1024);
      assert.equal(
        result.accessibility_observations.landmarks.filter((item) => item.role === "banner").length,
        1
      );
      assert.equal(
        result.accessibility_observations.landmarks.filter((item) => item.role === "main").length,
        1
      );
      assert.ok(
        result.accessibility_observations.controls.some(
          (item) => item.role === "button" && item.name === "Save changes"
        )
      );
      assert.ok(fs.statSync(fixture.outputPath).size > 1024);
      assert.ok(fs.statSync(fixture.verificationPath).size > 1024);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "browser focus evidence rejects a statically tabbable composite without arrow navigation",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture({ focusabilityControls: "broken" });
    try {
      const result = runBrowserCapture(fixture);
      const controls = result.accessibility_observations.controls;
      const byLocator = new Map(controls.map((item) => [item.locator, item]));
      assert.equal(byLocator.get("button#summary-tab").focus_context, "document");
      assert.equal(byLocator.get("button#history-tab").focus_context, "document");
      assert.equal(byLocator.get("button#nameless-tab").focus_context, "document");
      const audit = normalizeRawAudit(
        {
          schema_version: 1,
          kind: "accessibility-tree",
          subject_id: "account-detail",
          commit: "a".repeat(40),
          capture_ids: ["capture-account-primary-desktop-r1"],
          observations: result.accessibility_observations,
        },
        { path: ".pm/test/raw-a11y.json", sha256: "b".repeat(64) }
      );
      assert.equal(audit.checks.focus_order, false);
      assert.ok(
        audit.findings.some(
          (item) => item.code === "not-keyboard-reachable" && item.locator === "button#history-tab"
        )
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "browser focus evidence follows native tab stops and observed roving keyboard ownership",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture({ focusabilityControls: "working" });
    try {
      const result = runBrowserCapture(fixture);
      const controls = result.accessibility_observations.controls;
      const byLocator = new Map(controls.map((item) => [item.locator, item]));
      assert.equal(byLocator.get("a#no-destination").tab_index, -1);
      assert.equal(byLocator.get("a#no-destination").focus_context, "document");
      assert.equal(byLocator.get("a#destination").tab_index, 0);
      assert.equal(byLocator.get("a#destination").focus_context, "document");
      assert.equal(byLocator.get("select#plan-select").tab_index, 0);
      assert.equal(byLocator.get("select#plan-select").focus_context, "document");
      assert.equal(byLocator.get("button#summary-tab").tab_index, 0);
      assert.equal(byLocator.get("button#summary-tab").focus_context, "document");
      assert.equal(byLocator.get("button#history-tab").tab_index, -1);
      assert.equal(byLocator.get("button#history-tab").focus_context, "composite");
      assert.equal(byLocator.get("button#nameless-tab").name, "");
      assert.equal(byLocator.get("button#nameless-tab").focus_context, "composite");
      const options = controls.filter((item) => item.role === "option");
      assert.ok(options.length >= 1);
      assert.ok(options.every((item) => item.focus_context === "composite"));

      const normalize = (observations) =>
        normalizeRawAudit(
          {
            schema_version: 1,
            kind: "accessibility-tree",
            subject_id: "account-detail",
            commit: "a".repeat(40),
            capture_ids: ["capture-account-primary-desktop-r1"],
            observations,
          },
          { path: ".pm/test/raw-a11y.json", sha256: "b".repeat(64) }
        );
      const completeAudit = normalize(result.accessibility_observations);
      assert.equal(completeAudit.checks.focus_order, false);
      assert.equal(completeAudit.checks.names, false);
      assert.ok(
        completeAudit.findings.some(
          (item) =>
            item.code === "missing-accessible-name" && item.locator === "button#nameless-tab"
        )
      );
      const reachableAudit = normalize({
        ...result.accessibility_observations,
        controls: controls.filter((item) => item.locator !== "a#no-destination"),
      });
      assert.equal(reachableAudit.checks.focus_order, true);
      assert.equal(reachableAudit.checks.names, false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "browser focus evidence accepts observed aria-activedescendant navigation",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture({ focusabilityControls: "active-descendant" });
    try {
      const result = runBrowserCapture(fixture);
      const controls = result.accessibility_observations.controls;
      const byLocator = new Map(controls.map((item) => [item.locator, item]));
      for (const locator of ["div#plan-free", "div#plan-pro", "div#plan-team"]) {
        assert.equal(byLocator.get(locator).tab_index, -1);
        assert.equal(byLocator.get(locator).focus_context, "composite");
      }
      const audit = normalizeRawAudit(
        {
          schema_version: 1,
          kind: "accessibility-tree",
          subject_id: "account-detail",
          commit: "a".repeat(40),
          capture_ids: ["capture-account-primary-desktop-r1"],
          observations: result.accessibility_observations,
        },
        { path: ".pm/test/raw-a11y.json", sha256: "b".repeat(64) }
      );
      assert.equal(audit.checks.focus_order, true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "capture CLI publishes a closed trusted evidence bundle after keyboard probing",
  { skip: browserSkip },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capture-cli-"));
    const { server, port } = await startLoopbackWebSocketServer(root);
    try {
      execFileSync("git", ["init", "-q"], { cwd: root });
      execFileSync("git", ["config", "user.name", "PM Test"], { cwd: root });
      execFileSync("git", ["config", "user.email", "pm-test@example.invalid"], { cwd: root });
      fs.writeFileSync(path.join(root, "source.txt"), "trusted capture source\n");
      execFileSync("git", ["add", "source.txt"], { cwd: root });
      execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: root });
      const commit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      const routePath = ".pm/dev-sessions/cli-test/design-critique/route.json";
      const assertionPath =
        ".pm/dev-sessions/cli-test/design-critique/state-assertions/account-primary-desktop.json";
      const outputDir =
        ".pm/dev-sessions/cli-test/design-critique/round-1/capture-account-primary-desktop-r1";
      const routeValue = route(commit);
      routeValue.source.base_commit = commit;
      routeValue.subjects[0].surface = "/capture";
      fs.mkdirSync(path.join(root, path.dirname(assertionPath)), { recursive: true });
      fs.writeFileSync(path.join(root, routePath), `${JSON.stringify(routeValue, null, 2)}\n`);
      fs.writeFileSync(path.join(root, assertionPath), `${JSON.stringify(assertion(), null, 2)}\n`);
      const url = `http://127.0.0.1:${port}/capture?directSocket=0`;
      const child = spawn(
        process.execPath,
        [
          path.join(__dirname, "../scripts/design-critique-capture.js"),
          "--root",
          root,
          "--route",
          routePath,
          "--subject",
          "account-detail",
          "--coverage",
          "account-primary-desktop",
          "--capture",
          "capture-account-primary-desktop-r1",
          "--url",
          url,
          "--expect-url",
          url,
          "--state-assertion",
          assertionPath,
          "--width",
          "1024",
          "--height",
          "600",
          "--out-dir",
          outputDir,
          "--browser",
          installedBrowser,
          "--settle-ms",
          "100",
          "--json",
        ],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
      );
      const executed = await waitForChildResult(child);
      assert.equal(executed.code, 0, executed.stderr);
      const result = JSON.parse(executed.stdout);
      assert.equal(result.ok, true);
      assert.equal(result.manifest.path, `${outputDir}/capture.json`);
      const raw = JSON.parse(
        fs.readFileSync(path.join(root, outputDir, "accessibility-tree-raw.json"), "utf8")
      );
      assert.ok(raw.observations.controls.every((control) => control.focus_context));
    } finally {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "browser helper fails closed when the declarative state assertion is false",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture();
    try {
      fixture.stateAssertion = assertion("error");
      assert.throws(
        () => runBrowserCapture(fixture),
        /state marker does not establish the routed state/
      );
      assert.equal(fs.existsSync(fixture.outputPath), false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "browser helper blocks unexpected network origins without publishing evidence",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture({ externalRequest: true });
    try {
      assert.throws(() => runBrowserCapture(fixture), /network policy violation/);
      assert.equal(fs.existsSync(fixture.outputPath), false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "browser helper blocks a disallowed WebSocket before its loopback handshake",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-websocket-policy-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const pageOrigin = `http://127.0.0.1:${port}`;
    const fixture = createBrowserFixture();
    fixture.url = `${pageOrigin}/capture`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    assert.throws(() => runBrowserCapture(fixture, [pageOrigin]), /network policy violation/);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.deepEqual(JSON.parse(fs.readFileSync(statsPath, "utf8")), {
      handshakes: 0,
      frames: 0,
    });
    assert.equal(fs.existsSync(fixture.outputPath), false);
  }
);

test(
  "browser helper blocks a Worker-created WebSocket before its loopback handshake",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-worker-websocket-policy-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const fixture = createBrowserFixture();
    const pageOrigin = `http://127.0.0.1:${port}`;
    fixture.url = `${pageOrigin}/capture?directSocket=0&workerSocket=1`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    assert.throws(() => runBrowserCapture(fixture, [pageOrigin]), /network policy violation/);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.deepEqual(JSON.parse(fs.readFileSync(statsPath, "utf8")), {
      handshakes: 0,
      frames: 0,
    });
    assert.equal(fs.existsSync(fixture.outputPath), false);
  }
);

test(
  "browser helper permits an explicitly allowed Worker-created WebSocket",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-worker-websocket-allowed-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const pageOrigin = `http://127.0.0.1:${port}`;
    const socketOrigin = `ws://127.0.0.1:${port}`;
    const fixture = createBrowserFixture();
    fixture.url = `${pageOrigin}/capture?directSocket=0&workerSocket=1`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    const result = runBrowserCapture(fixture, [pageOrigin, socketOrigin]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(JSON.parse(fs.readFileSync(statsPath, "utf8")), {
      handshakes: 1,
      frames: 0,
    });
    assert.ok(result.network.observed_origins.includes(socketOrigin));
  }
);

test(
  "browser helper recursively blocks a nested Worker WebSocket before its loopback handshake",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-nested-worker-websocket-policy-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const fixture = createBrowserFixture();
    const pageOrigin = `http://127.0.0.1:${port}`;
    fixture.url = `${pageOrigin}/capture?directSocket=0&nestedWorkerSocket=1`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    assert.throws(() => runBrowserCapture(fixture, [pageOrigin]), /network policy violation/);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.deepEqual(JSON.parse(fs.readFileSync(statsPath, "utf8")), {
      handshakes: 0,
      frames: 0,
    });
    assert.equal(fs.existsSync(fixture.outputPath), false);
  }
);

test(
  "browser helper permits an explicitly allowed nested Worker WebSocket",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-nested-worker-websocket-allowed-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const pageOrigin = `http://127.0.0.1:${port}`;
    const socketOrigin = `ws://127.0.0.1:${port}`;
    const fixture = createBrowserFixture();
    fixture.url = `${pageOrigin}/capture?directSocket=0&nestedWorkerSocket=1`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    const result = runBrowserCapture(fixture, [pageOrigin, socketOrigin]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(JSON.parse(fs.readFileSync(statsPath, "utf8")), {
      handshakes: 1,
      frames: 0,
    });
    assert.ok(result.network.observed_origins.includes(socketOrigin));
  }
);

test(
  "browser helper reaches readiness with a benign persistent Worker",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture({ persistentWorker: true });
    try {
      const result = runBrowserCapture(fixture);
      assert.equal(result.assertion_passed, true);
      assert.equal(fs.existsSync(fixture.outputPath), true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "browser helper blocks a SharedWorker-created WebSocket before its loopback handshake",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-shared-worker-websocket-policy-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const pageOrigin = `http://127.0.0.1:${port}`;
    const fixture = createBrowserFixture();
    fixture.url = `${pageOrigin}/capture?directSocket=0&sharedWorker=1`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    assert.throws(() => runBrowserCapture(fixture, [pageOrigin]), /network policy violation/);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.deepEqual(JSON.parse(fs.readFileSync(statsPath, "utf8")), {
      handshakes: 0,
      frames: 0,
    });
    assert.equal(fs.existsSync(fixture.outputPath), false);
  }
);

test(
  "browser helper permits an explicitly allowed SharedWorker WebSocket",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-shared-worker-websocket-allowed-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const pageOrigin = `http://127.0.0.1:${port}`;
    const socketOrigin = `ws://127.0.0.1:${port}`;
    const fixture = createBrowserFixture();
    fixture.url = `${pageOrigin}/capture?directSocket=0&sharedWorker=1`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    const result = runBrowserCapture(fixture, [pageOrigin, socketOrigin]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(JSON.parse(fs.readFileSync(statsPath, "utf8")), {
      handshakes: 1,
      frames: 0,
    });
    assert.ok(result.network.observed_origins.includes(socketOrigin));
  }
);

test(
  "browser helper terminates a ServiceWorker before its loopback WebSocket handshake",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-service-worker-websocket-policy-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const pageOrigin = `http://127.0.0.1:${port}`;
    const fixture = createBrowserFixture();
    fixture.url = `${pageOrigin}/capture?directSocket=0&serviceWorker=1`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    const result = runBrowserCapture(fixture, [pageOrigin]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.deepEqual(JSON.parse(fs.readFileSync(statsPath, "utf8")), {
      handshakes: 0,
      frames: 0,
    });
    assert.equal(result.assertion_passed, true);
    assert.equal(fs.existsSync(fixture.outputPath), true);
  }
);

test(
  "browser helper permits an explicitly allowed WebSocket and records its schemeful origin",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-websocket-allowed-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const pageOrigin = `http://127.0.0.1:${port}`;
    const socketOrigin = `ws://127.0.0.1:${port}`;
    const fixture = createBrowserFixture();
    fixture.url = `${pageOrigin}/capture?frameDelay=0`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    const result = runBrowserCapture(fixture, [pageOrigin, socketOrigin]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
    assert.equal(stats.handshakes, 1);
    assert.ok(stats.frames >= 1);
    assert.deepEqual(result.network.allowed_origins, [pageOrigin, socketOrigin]);
    assert.ok(result.network.observed_origins.includes(socketOrigin));
  }
);

test(
  "browser helper treats a late allowed WebSocket frame as atomic-capture drift",
  { skip: browserSkip },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-websocket-late-frame-"));
    const { server, statsPath, port } = await startLoopbackWebSocketServer(root);
    t.after(async () => {
      await stopChild(server);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const pageOrigin = `http://127.0.0.1:${port}`;
    const socketOrigin = `ws://127.0.0.1:${port}`;
    const fixture = createBrowserFixture();
    fixture.url = `${pageOrigin}/capture?frameDelay=350`;
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    assert.throws(() => runBrowserCapture(fixture, [pageOrigin, socketOrigin]), /atomic capture/);
    const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
    assert.equal(stats.handshakes, 1);
    assert.ok(stats.frames >= 1);
    assert.equal(fs.existsSync(fixture.outputPath), false);
  }
);

test(
  "browser helper rejects a state marker hidden beneath a full-page overlay",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture({ occluded: true });
    try {
      assert.throws(() => runBrowserCapture(fixture), /fully occluded/);
      assert.equal(fs.existsSync(fixture.outputPath), false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "browser helper rejects a state marker covered by its own descendant overlay",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture({ descendantOccluded: true });
    try {
      assert.throws(() => runBrowserCapture(fixture), /covered by a positioned descendant/);
      assert.equal(fs.existsSync(fixture.outputPath), false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "browser helper catches a network request in the final settle window",
  { skip: browserSkip },
  () => {
    const fixture = createBrowserFixture({ lateRequest: true });
    try {
      assert.throws(() => runBrowserCapture(fixture), /network policy violation|atomic capture/);
      assert.equal(fs.existsSync(fixture.outputPath), false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);
