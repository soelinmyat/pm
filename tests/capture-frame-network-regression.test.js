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
  /* Explicit browser capability limitation, matching the existing native suites. */
}
const skip = process.env.PM_SKIP_BROWSER_TESTS || (!browser && "Chromium is unavailable");

async function fixture(t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-frame-network-test-"));
  const server = spawn(
    process.execPath,
    [
      "-e",
      `
    const http = require('node:http');
    const scenario = ${JSON.stringify(scenario)};
    let frameOrigin;
    const frameServer = http.createServer((req, res) => {
      if (req.url === '/slow') return;
      const work = scenario === 'blob'
        ? 'const script=document.createElement("script");script.src=URL.createObjectURL(new Blob(["window.blobLoaded=true"],{type:"text/javascript"}));script.onload=()=>parent.postMessage("ready","*");document.head.append(script);'
        : scenario === 'pending'
          ? 'fetch("/slow");parent.postMessage("ready","*");'
          : 'parent.postMessage("ready","*");';
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html lang="en"><head><title>Child context</title></head><body><p>Child frame content</p><script>'+work+'</script></body></html>');
    });
    frameServer.listen(0, '127.0.0.1', () => {
      frameOrigin = 'http://localhost:'+frameServer.address().port;
      const appServer = http.createServer((req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><html lang="en"><head><title>Frame capture</title><link rel="icon" href="data:,"></head><body><main id="content" data-pm-state="primary"><h1>Saved checklist review</h1><p>Review the saved checklist and return to your work.</p></main><script>addEventListener("message",event=>{if(event.origin==='+JSON.stringify(frameOrigin)+'&&event.data==="ready")document.getElementById("content").setAttribute("data-frame-ready","true")});</script><iframe hidden src="'+frameOrigin+'/frame"></iframe></body></html>');
      });
      appServer.listen(0, '127.0.0.1', () => console.log(JSON.stringify({url:'http://127.0.0.1:'+appServer.address().port+'/',frameOrigin})));
    });
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  t.after(() => {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let setupError = "";
  server.stderr.on("data", (bytes) => {
    setupError += String(bytes).slice(0, 2000);
  });
  const [data] = await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(([code]) => {
      throw new Error(`Fixture server exited ${code}: ${setupError}`);
    }),
  ]);
  const { url, frameOrigin } = JSON.parse(String(data).trim());
  return {
    browserPath: browser,
    url,
    expectedUrl: url,
    allowedOrigins: [new URL(url).origin, frameOrigin],
    viewport: { width: 1024, height: 600 },
    readinessTimeoutMs: 5000,
    settleMs: 200,
    outputPath: path.join(root, "capture.png"),
    verificationPath: path.join(root, "verification.png"),
    stateAssertion: {
      schema_version: 2,
      subject_id: "checklists",
      coverage_id: "checklists-primary-desktop",
      state: "primary",
      state_marker: {
        locator: { by: "id", value: "content" },
        attribute: "data-pm-state",
        value: "primary",
      },
      all: [
        { locator: { by: "id", value: "content" }, expect: { kind: "visible" } },
        {
          locator: { by: "id", value: "content" },
          expect: { kind: "attribute-equals", name: "data-frame-ready", value: "true" },
        },
      ],
    },
  };
}

test(
  "settles a cross-origin iframe document completed in its child session",
  { skip },
  async (t) => {
    const result = runCaptureProbe(await fixture(t, "document"));
    assert.equal(result.assertion_passed, true);
    assert.deepEqual(result.network.pending_at_capture, []);
    assert.ok(
      result.network.requests.some(
        (r) => r.resource_type === "Document" && r.origin.includes("localhost")
      )
    );
  }
);

test("settles an in-memory blob script in a cross-origin iframe", { skip }, async (t) => {
  const result = runCaptureProbe(await fixture(t, "blob"));
  assert.equal(result.assertion_passed, true);
  assert.deepEqual(result.network.pending_at_capture, []);
});

test("keeps a real outstanding iframe fetch blocking primary capture", { skip }, async (t) => {
  const config = await fixture(t, "pending");
  assert.throws(() => runCaptureProbe(config), /network-idle readiness/);
});
