"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
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
  nodeVisibleInViewport,
  verifyAssertionHitTargets,
} = require("../scripts/design-critique-capture-probe");

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
  assert.throws(() => validateViewport("narrow", 319, 480), /outside its accepted range/);
  assert.throws(() => validateViewport("tablet", 768, 599), /at least 600/);
  assert.throws(() => validateViewport("desktop", 1023, 800), /outside its accepted range/);
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

  assert.ok(styleReads <= count * 8, `expected linear style reads, observed ${styleReads}`);
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

function createBrowserFixture({
  externalRequest = false,
  occluded = false,
  descendantOccluded = false,
  lateRequest = false,
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#eef2ff;color:#172033;font:16px system-ui}header{background:#18264a;color:white;padding:18px 28px}nav a{color:white;margin-right:16px}main{max-width:900px;margin:30px auto;padding:24px;background:white;border-radius:16px}h1{font-size:32px}h2{font-size:22px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{padding:18px;border:1px solid #ccd3e1;border-radius:12px}button{padding:10px 18px;background:#3157d5;color:white;border:0;border-radius:8px}
</style></head><body><header><nav aria-label="Primary"><a href="#account">Accounts</a></nav></header><main id="account" data-testid="account-state" data-pm-state="primary"><header><h1>Account overview</h1></header><section aria-labelledby="summary"><h2 id="summary">Summary</h2><div class="cards"><article class="card"><h2>Usage</h2><p>Stable product evidence.</p></article><article class="card"><h2>Plan</h2><p>Professional tier.</p></article></div><button>Save changes</button></section>${descendantOverlay}</main>${external}${overlay}${late}</body></html>`;
  return {
    root,
    url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    outputPath: path.join(root, "capture.png"),
    verificationPath: path.join(root, "verification.png"),
    stateAssertion: assertion(),
  };
}

function runBrowserCapture(fixture) {
  return runCaptureProbe({
    browserPath: installedBrowser,
    url: fixture.url,
    expectedUrl: fixture.url,
    viewport: { width: 1024, height: 600 },
    stateAssertion: fixture.stateAssertion,
    allowedOrigins: [],
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
