"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { once } = require("node:events");
const {
  resolveBrowser,
  runCaptureProbe,
  validateMeaningfulVisual,
  captureProductUi,
} = require("../scripts/design-critique-capture");
const { inspectPngVisualBytes } = require("../scripts/lib/media-inspect");
let browser;
try {
  browser = resolveBrowser();
} catch {
  /* Explicit environment skip. */
}
const skip = process.env.PM_SKIP_BROWSER_TESTS || (!browser && "Chromium is unavailable");

async function sparseLoading(t, { blankIndicator = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-sparse-loading-"));
  const html = `<!doctype html><html lang="en"><head><title>Schedule</title><link rel="icon" href="data:,"><style>body{margin:24px;background:white;color:#202020;font-family:Arial}h1{margin:0;font-size:28px;line-height:36px;width:200px}p{font-size:14px}.spinner{margin:80px auto 0;width:32px;height:32px;border:3px solid #999;border-top-color:#222;border-radius:50%;box-sizing:border-box}${blankIndicator ? ".spinner{border-color:white}" : ""}</style></head><body><main><h1 id="heading" data-pm-state="loading">Schedule</h1><p>Schedule and manage shifts</p><div id="loading" role="status" aria-label="Loading..." class="spinner"></div></main><script>fetch('/slow')</script></body></html>`;
  const server = spawn(
    process.execPath,
    [
      "-e",
      `const http=require('node:http');const s=http.createServer((req,res)=>{if(req.url==='/slow')return;res.setHeader('content-type','text/html');res.end(${JSON.stringify(html)});});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  t.after(() => {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [data] = await once(server.stdout, "data");
  const url = `http://127.0.0.1:${Number(String(data).trim())}/`;
  const config = {
    browserPath: browser,
    url,
    expectedUrl: url,
    allowedOrigins: [new URL(url).origin],
    viewport: { width: 768, height: 1024 },
    readinessTimeoutMs: 5000,
    settleMs: 200,
    outputPath: path.join(root, "capture.png"),
    verificationPath: path.join(root, "verification.png"),
    stateAssertion: {
      schema_version: 2,
      subject_id: "schedule",
      coverage_id: "schedule-loading-tablet",
      state: "loading",
      state_marker: {
        locator: { by: "id", value: "heading" },
        attribute: "data-pm-state",
        value: "loading",
      },
      all: [
        { locator: { by: "role-name", value: "status:Loading..." }, expect: { kind: "visible" } },
      ],
    },
  };
  const probe = runCaptureProbe(config);
  const bytes = fs.readFileSync(config.outputPath);
  return { root, config, probe, bytes, decoded: inspectPngVisualBytes(bytes) };
}

test(
  "genuine sparse tablet loading validates unchanged full PNG through native heading and indicator content",
  { skip },
  async (t) => {
    const { config, probe, bytes, decoded } = await sparseLoading(t);
    assert.ok(
      decoded.meaningfulPixelRatio < 0.01,
      "fixture must reproduce viewport density rejection"
    );
    assert.ok(probe.network.pending_at_capture.length > 0);
    const expectedContent = probe.assertion_visibility.checks.map((check) => ({
      region: check.visual_bounds,
      visual_metrics: validateMeaningfulVisual(inspectPngVisualBytes(bytes, check.visual_bounds)),
    }));
    const inflate = zlib.inflateSync;
    let decodes = 0;
    t.mock.method(zlib, "inflateSync", (...args) => {
      decodes++;
      return inflate(...args);
    });
    const metrics = validateMeaningfulVisual(decoded, {
      state: config.stateAssertion.state,
      visibility: probe.assertion_visibility,
      bytes,
    });
    assert.equal(decodes, 1, "reuse one full PNG decode for both native regions");
    assert.deepEqual(metrics.loading_content.nodes, expectedContent);
    t.mock.restoreAll();
    assert.equal(
      metrics.meaningful_pixel_ratio,
      decoded.meaningfulPixelRatio,
      "retain full viewport metrics"
    );
    assert.equal(metrics.loading_content.policy, "native-heading-and-loading-content-v1");
    assert.equal(inspectPngVisualBytes(bytes).pixelSha256, decoded.pixelSha256);
  }
);

test(
  "sparse loading cannot authorize missing native semantics, tiny or outside regions, other states or mismatched full pixels",
  { skip },
  async (t) => {
    const { probe, bytes, decoded } = await sparseLoading(t);
    const valid = { state: "loading", visibility: probe.assertion_visibility, bytes };
    for (const mutate of [
      (value) => {
        value.state = "primary";
      },
      (value) => {
        delete value.visibility.checks[0].native_role;
        delete value.visibility.checks[0].native_name_present;
      },
      (value) => {
        value.visibility.checks[0].native_name_present = false;
      },
      (value) => {
        value.visibility.checks[1].native_role = "generic";
      },
      (value) => {
        value.visibility.checks[1].native_name_present = false;
      },
      (value) => {
        value.visibility.checks[1].visual_bounds.width = 1;
      },
      (value) => {
        value.visibility.checks[1].visual_bounds.height = 1;
      },
      (value) => {
        value.visibility.checks[1].visual_bounds.width = 1024;
      },
      (value) => {
        value.visibility.checks[1].asserted_backend_node_id =
          value.visibility.checks[0].asserted_backend_node_id;
      },
      (value) => {
        value.visibility.checks[1].visual_bounds = { ...value.visibility.checks[0].visual_bounds };
        value.visibility.checks[1].x = value.visibility.checks[0].x;
        value.visibility.checks[1].y = value.visibility.checks[0].y;
      },
    ]) {
      const changed = { ...valid, visibility: structuredClone(valid.visibility) };
      mutate(changed);
      assert.throws(() => validateMeaningfulVisual(decoded, changed), /meaningful|visual_bounds/);
    }
    assert.throws(
      () => validateMeaningfulVisual({ ...decoded, pixelSha256: "a".repeat(64) }, valid),
      /do not match/
    );
  }
);

test(
  "a native named status with blank pixels cannot borrow the heading pixels",
  { skip },
  async (t) => {
    const { probe, bytes, decoded } = await sparseLoading(t, { blankIndicator: true });
    assert.throws(
      () =>
        validateMeaningfulVisual(decoded, {
          state: "loading",
          visibility: probe.assertion_visibility,
          bytes,
        }),
      /meaningful pixels/
    );
  }
);

test(
  "trusted capture publishes a full sparse loading bundle with native and regional bindings",
  { skip },
  async (t) => {
    const { root, config } = await sparseLoading(t);
    const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.name", "PM Test"]);
    git(["config", "user.email", "pm-test@example.invalid"]);
    fs.writeFileSync(path.join(root, "source.txt"), "Sparse loading source fixture\n");
    git(["add", "source.txt"]);
    git(["commit", "-q", "-m", "fixture"]);
    const commit = git(["rev-parse", "HEAD"]).trim();
    const base = ".pm/dev-sessions/sparse-loading/design-critique";
    const routePath = `${base}/route.json`,
      assertionPath = `${base}/state-assertions/schedule-loading-tablet.json`;
    fs.mkdirSync(path.join(root, base, "state-assertions"), { recursive: true });
    fs.writeFileSync(path.join(root, assertionPath), JSON.stringify(config.stateAssertion));
    fs.writeFileSync(
      path.join(root, routePath),
      JSON.stringify({
        schema_version: 2,
        run_id: "dc_sparse_loading",
        created_at: new Date().toISOString(),
        mode: "product-ui",
        source: {
          commit,
          base_ref: "origin/main",
          base_commit: commit,
          diff_sha256: crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
        },
        subjects: [{ id: "schedule", title: "Schedule", surface: "/", platform: "web" }],
        coverage: [
          {
            id: "schedule-loading-tablet",
            subject_id: "schedule",
            state: "loading",
            viewport: "tablet",
            required: true,
            reason: "Regression for sparse initial loading",
          },
        ],
      })
    );
    const result = captureProductUi({
      root,
      routePath,
      subjectId: "schedule",
      coverageId: "schedule-loading-tablet",
      captureId: "capture-schedule-loading-tablet-r1",
      url: config.url,
      expectedUrl: config.url,
      assertionPath,
      width: 768,
      height: 1024,
      outputDir: `${base}/round-1/capture-schedule-loading-tablet-r1`,
      browserPath: browser,
      readinessTimeoutMs: 5000,
      settleMs: 200,
      allowedOrigins: [],
    });
    assert.equal(result.ok, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, result.manifest.path), "utf8"));
    const retained = fs.readFileSync(path.join(root, manifest.capture.path));
    assert.equal(inspectPngVisualBytes(retained).pixelSha256, manifest.capture.pixel_sha256);
    assert.equal(manifest.capture.width, 768);
    assert.equal(manifest.capture.height, 1024);
    assert.equal(manifest.capture.visual_metrics.loading_content.nodes.length, 2);
    assert.equal(manifest.page.state_assertion.visibility.checks[0].native_role, "heading");
    assert.equal(manifest.page.state_assertion.visibility.checks[1].native_role, "status");
  }
);
