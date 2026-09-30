"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { resolveBrowser, runCaptureProbe } = require("../scripts/design-critique-capture");
let browser;
try {
  browser = resolveBrowser();
} catch {
  /* Explicit skip without Chromium. */
}
const skip = process.env.PM_SKIP_BROWSER_TESTS || (!browser && "Chromium is unavailable");

async function fixture(
  t,
  { state = "loading", method = "GET", type = "fetch", busy = true, external = false } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loading-test-"));
  const server = spawn(
    process.execPath,
    [
      "-e",
      `
    const http = require('node:http');
    const server = http.createServer((req,res) => {
      if (req.url === '/slow') { /* Genuine pending response, closed during cleanup. */ return; }
      res.setHeader('content-type','text/html');
      res.end(${JSON.stringify(`<!doctype html><html lang="en"><head><title>Loading test</title><link rel="icon" href="data:,"></head><body><main id="content" data-pm-state="${state}" aria-busy="${busy}"><h1>Saved checklists</h1><p>Loading saved submissions</p></main><script>${type === "image" ? 'const image=new Image(); image.src="/slow"; document.body.append(image);' : `fetch('${external ? "http://127.0.0.1:1/blocked" : "/slow"}', {method: '${method}'}).then(() => {const el=document.getElementById('content'); el.setAttribute('aria-busy','false'); el.setAttribute('data-pm-state','primary'); el.textContent='Loaded';});`}</script></body></html>`)});
    }); server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  t.after(() => {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [data] = await once(server.stdout, "data");
  const url = `http://127.0.0.1:${Number(String(data).trim())}/`;
  return {
    browserPath: browser,
    url,
    expectedUrl: url,
    allowedOrigins: [new URL(url).origin],
    viewport: { width: 1024, height: 600 },
    readinessTimeoutMs: 5000,
    settleMs: 200,
    outputPath: path.join(root, "capture.png"),
    verificationPath: path.join(root, "verification.png"),
    stateAssertion: {
      schema_version: 2,
      subject_id: "submissions",
      coverage_id: `submissions-${state}-desktop`,
      state,
      state_marker: {
        locator: { by: "id", value: "content" },
        attribute: "data-pm-state",
        value: state,
      },
      all: [
        { locator: { by: "id", value: "content" }, expect: { kind: "visible" } },
        {
          locator: { by: "id", value: "content" },
          expect: { kind: "attribute-equals", name: "aria-busy", value: "true" },
        },
      ],
    },
  };
}

test(
  "captures genuine loading while a read-only fetch remains outstanding",
  { skip },
  async (t) => {
    const result = runCaptureProbe(await fixture(t));
    assert.equal(result.assertion_passed, true);
    assert.ok(result.network.pending_at_capture.length > 0);
    for (const sequence of result.network.pending_at_capture) {
      const request = result.network.requests.find((row) => row.sequence === sequence);
      assert.equal(request.method, "GET");
      assert.equal(request.resource_type, "Fetch");
    }
  }
);
for (const options of [{ state: "primary" }, { method: "POST" }, { type: "image" }]) {
  test(
    `rejects pending requests outside loading read-only fetch: ${JSON.stringify(options)}`,
    { skip },
    async (t) => {
      const config = await fixture(t, options);
      assert.throws(() => runCaptureProbe(config), /readiness/);
    }
  );
}

const {
  pendingRequestsReady,
  validatePendingAtCapture,
} = require("../scripts/lib/capture-loading-readiness");
test("loading readiness rejects unknown, write and document requests", () => {
  const ids = new Set(["request"]);
  for (const request of [
    undefined,
    { method: "POST", resource_type: "Fetch" },
    { method: "GET", resource_type: "Document" },
  ]) {
    assert.equal(pendingRequestsReady("loading", ids, new Map([["request", request]])), false);
  }
  assert.equal(
    pendingRequestsReady(
      "loading",
      ids,
      new Map([["request", { method: "HEAD", resource_type: "XHR" }]])
    ),
    true
  );
  assert.equal(
    pendingRequestsReady(
      "primary",
      ids,
      new Map([["request", { method: "GET", resource_type: "Fetch" }]])
    ),
    false
  );
});
test("pending capture evidence requires loading and exact read-only ledger references", () => {
  const records = [{ sequence: 1, method: "GET", resource_type: "Fetch" }];
  assert.doesNotThrow(() => validatePendingAtCapture([1], records, "loading"));
  assert.doesNotThrow(() => validatePendingAtCapture(undefined, records, "primary"));
  for (const pending of [[2], [1, 1], [-1], ["1"], {}, null])
    assert.throws(
      () => validatePendingAtCapture(pending, records, "loading"),
      /pending_at_capture/
    );
  assert.throws(
    () => validatePendingAtCapture([1], records, "primary"),
    /only permitted for loading/
  );
  assert.throws(
    () => validatePendingAtCapture([1], [{ ...records[0], method: "POST" }], "loading"),
    /read-only/
  );
});

for (const options of [{ busy: false }, { external: true }]) {
  test(
    `loading still enforces semantic guards and origins: ${JSON.stringify(options)}`,
    { skip },
    async (t) => {
      const config = await fixture(t, options);
      assert.throws(() => runCaptureProbe(config), /assertion|network policy violation/);
    }
  );
}
