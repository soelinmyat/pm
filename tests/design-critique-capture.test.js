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
  resolveBrowser,
  runCaptureProbe,
  validateProbeResult,
  validateStateAssertion,
  validateViewport,
} = require("../scripts/design-critique-capture");

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
    schema_version: 1,
    all: [
      {
        locator: { by: "test-id", value: "account-state" },
        expect: { kind: "attribute-equals", name: "data-state", value },
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
        schema_version: 1,
        all: [
          {
            locator: { by: "selector", value: "body" },
            expect: { kind: "visible" },
          },
        ],
      }),
    /locator.by is invalid/
  );
  assert.doesNotThrow(() => validateStateAssertion(assertion()));
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
    schema_version: 1,
    page: {
      target_id: "target",
      main_frame_id: "frame",
      loader_id: "loader",
      final_url: plan.expectedUrl,
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
        { ...result, page: { ...result.page, final_url: `${plan.expectedUrl}?drift=1` } },
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
  const fixture = {
    schema_version: 1,
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
      requested_url: "http://127.0.0.1/",
      expected_url: "http://127.0.0.1/",
      final_url: "http://127.0.0.1/",
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
      state_assertion: { path: ".pm/example/assertion.json", sha256: "1".repeat(64), passed: true },
    },
    observation: {
      assurance_level: "same-cdp-page-session",
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
        browser_args_profile: "pm-product-ui-capture-v1",
        acquisition: "native-cdp-dom-ax-plus-two-pixel-stability-samples",
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

function createBrowserFixture({ externalRequest = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-trusted-capture-"));
  const external = externalRequest ? '<img src="https://example.invalid/tracker.png" alt="">' : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#eef2ff;color:#172033;font:16px system-ui}header{background:#18264a;color:white;padding:18px 28px}nav a{color:white;margin-right:16px}main{max-width:900px;margin:30px auto;padding:24px;background:white;border-radius:16px}h1{font-size:32px}h2{font-size:22px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{padding:18px;border:1px solid #ccd3e1;border-radius:12px}button{padding:10px 18px;background:#3157d5;color:white;border:0;border-radius:8px}
</style></head><body data-testid="account-state" data-state="primary"><header><nav aria-label="Primary"><a href="#account">Accounts</a></nav></header><main id="account"><header><h1>Account overview</h1></header><section aria-labelledby="summary"><h2 id="summary">Summary</h2><div class="cards"><article class="card"><h2>Usage</h2><p>Stable product evidence.</p></article><article class="card"><h2>Plan</h2><p>Professional tier.</p></article></div><button>Save changes</button></section></main>${external}</body></html>`;
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
      assert.equal(result.page.final_url, fixture.url);
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
        /state assertion clause 1 attribute did not match/
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
