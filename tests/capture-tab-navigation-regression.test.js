"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { resolveBrowser, runCaptureProbe } = require("../scripts/design-critique-capture");
for (const mode of ["restore", "missing-selection", "wrong-route"]) {
  test(`URL-backed tabs: ${mode}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-tab-restore-"));
    const html = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><main data-testid="state" data-pm-state="ready"><h1>Tabs</h1><button>Before</button><div role="tablist" aria-label="Views"><button id="first" role="tab" tabindex="0" ${mode === "missing-selection" ? "" : 'aria-selected="true"'}>First</button><button id="second" role="tab" tabindex="-1" aria-selected="false">Second</button></div><button>After</button></main><script>
   const tabs=[...document.querySelectorAll('[role=tab]')];
   function select(i){tabs.forEach((t,n)=>{t.tabIndex=n===i?0:-1;t.setAttribute('aria-selected',String(n===i))});history.replaceState(null,'','?tab='+i);tabs[i].focus()}
   document.querySelector('[role=tablist]').addEventListener('keydown',e=>{if(e.key.startsWith('Arrow')){e.preventDefault();select(1)}else if(e.key==='Enter'){e.preventDefault();${mode === "wrong-route" ? "history.replaceState(null,'','/other')" : "select(tabs.indexOf(document.activeElement))"}}});
  </script></body></html>`;
    const server = spawn(
      process.execPath,
      [
        "-e",
        "const http=require('node:http');const s=http.createServer((q,r)=>r.end(process.argv[1]));s.listen(0,'127.0.0.1',()=>console.log(s.address().port))",
        html,
      ],
      { stdio: ["ignore", "pipe", "inherit"] }
    );
    try {
      const [data] = await once(server.stdout, "data");
      const origin = `http://127.0.0.1:${String(data).trim()}`;
      const url = origin + "/?tab=0";
      const run = () =>
        runCaptureProbe({
          browserPath: resolveBrowser(),
          url,
          expectedUrl: url,
          viewport: { width: 1024, height: 600 },
          allowedOrigins: [origin],
          readinessTimeoutMs: 15000,
          settleMs: 200,
          outputPath: path.join(root, "capture.png"),
          verificationPath: path.join(root, "verify.png"),
          stateAssertion: {
            schema_version: 2,
            subject_id: "tabs",
            coverage_id: "tabs-ready",
            state: "ready",
            state_marker: {
              locator: { by: "test-id", value: "state" },
              attribute: "data-pm-state",
              value: "ready",
            },
            all: [
              { locator: { by: "role-name", value: "tab:First" }, expect: { kind: "visible" } },
            ],
          },
        });
      if (mode === "restore") {
        const result = run();
        assert.equal(result.assertion_passed, true);
        assert.ok(
          result.accessibility_observations.controls.some(
            (c) => c.locator === "button#second" && c.focus_context === "composite"
          )
        );
      } else assert.throws(run, /navigation drift/);
    } finally {
      server.kill();
      await once(server, "exit");
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
