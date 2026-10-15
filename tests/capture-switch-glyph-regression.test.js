"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { domObservations } = require("../scripts/design-critique-capture-probe");

const styles = ["display", "visibility", "opacity", "font-size", "font-weight"];
const metrics = {
  cssLayoutViewport: { clientWidth: 400, clientHeight: 300 },
  cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 400, clientHeight: 300 },
  cssContentSize: { width: 400, height: 300 },
};
function node(index, parentIndex, nodeName, bounds, font, attributes = {}) {
  return {
    index,
    parentIndex,
    backendNodeId: index + 1,
    nodeName,
    attributes,
    layout: { bounds, styles: ["block", "visible", "1", `${font}px`, "400"] },
  };
}
function switches() {
  return [
    node(0, -1, "main", [0, 0, 400, 300], 16),
    node(1, 0, "button", [10, 10, 36, 20], 13, {
      role: "switch",
      class: "switch",
      "aria-checked": "false",
    }),
    node(2, 0, "button", [60, 10, 36, 20], 15, {
      role: "switch",
      class: "switch",
      "aria-checked": "false",
    }),
  ];
}
const inspect = (model) => domObservations(model, metrics, styles).consistency;

test("fixed textless switches ignore unused inherited typography", () => {
  const model = switches();
  assert.deepEqual(inspect(model), []);
  model.push(node(3, 1, "span", [12, 12, 16, 16], 13), node(4, 2, "span", [62, 12, 16, 16], 15));
  assert.deepEqual(inspect(model), []);
});
test("switch font-driven or fixed glyph geometry differences remain observable", () => {
  const model = switches();
  model.push(node(3, 1, "svg", [12, 12, 16, 16], 13), node(4, 2, "svg", [62, 12, 18, 18], 15));
  assert.ok(inspect(model).some((finding) => /geometry/.test(finding.detail)));
  model[4].layout.bounds = [62, 12, 16, 16];
  assert.deepEqual(inspect(model), []);
  model[2].layout.bounds[2] = 38;
  assert.ok(inspect(model).some((finding) => /geometry/.test(finding.detail)));
});
for (const textNode of ["#text", "text", "::before"]) {
  for (const wrapper of ["direct", "contents", "missing-layout"]) {
    test(`switch ${textNode} retains typography through ${wrapper}`, () => {
      const model = switches();
      if (wrapper === "direct") {
        model.push(
          node(3, 1, textNode, [12, 12, 10, 13], 13),
          node(4, 2, textNode, [62, 12, 10, 15], 15)
        );
      } else {
        model.push(node(3, 1, "span", [0, 0, 0, 0], 13), node(4, 2, "span", [0, 0, 0, 0], 15));
        for (const wrappingNode of [model[3], model[4]]) {
          if (wrapper === "missing-layout") wrappingNode.layout = null;
          else wrappingNode.layout.styles[0] = "contents";
        }
        model.push(
          node(5, 3, textNode, [12, 12, 10, 13], 13),
          node(6, 4, textNode, [62, 12, 10, 15], 15)
        );
      }
      assert.ok(inspect(model).some((finding) => /font-size/.test(finding.detail)));
    });
  }
}
test("switch opacity variance remains observable", () => {
  const model = switches();
  model[2].layout.styles[2] = "0.5";
  assert.ok(inspect(model).some((finding) => /opacity/.test(finding.detail)));
});

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
  /* Explicit capability limitation below. */
}
const skip = process.env.PM_SKIP_BROWSER_TESTS || (!browser && "Chromium is unavailable");
async function fixture(t, scenario, overrideHtml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-switch-glyph-"));
  const text = scenario === "text" ? "ON" : "";
  const glyphSize = scenario === "font-driven" ? "1em" : "16px";
  const pseudo = scenario === "generated-text" ? '.switch::before{content:"ON"}' : "";
  const html = `<!doctype html><html lang="en"><head><title>Notification switches</title><link rel="icon" href="data:,"><style>body{font:16px sans-serif;padding:32px}h1{font-size:24px}main{max-width:640px}.row{display:flex;align-items:center;gap:16px;padding:16px 0}.switch{position:relative;width:36px;height:20px;padding:0;border:0;border-radius:10px;background:#444;color:white}.thumb{position:absolute;left:2px;top:2px;width:${glyphSize};height:${glyphSize};border-radius:8px;background:white}${pseudo}</style></head><body><main id="switches" data-pm-state="primary"><h1>Notification preferences</h1><p>Choose which updates appear in your notifications.</p><div class="row"><label for="category">Category updates</label><button id="category" class="switch" role="switch" aria-checked="false" style="font-size:15px"><span class="thumb"></span>${text}</button></div><div class="row"><label for="event">Event updates</label><button id="event" class="switch" role="switch" aria-checked="false" style="font-size:13px"><span class="thumb"></span>${text}</button></div></main></body></html>`;
  const server = spawn(
    process.execPath,
    [
      "-e",
      `const http=require('node:http');const html=${JSON.stringify(overrideHtml || html)};const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html)});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port+'/'));`,
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
  const [bytes] = await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(([code]) => {
      throw new Error(`Fixture server exited ${code}: ${setupError}`);
    }),
  ]);
  const url = String(bytes).trim();
  return {
    browserPath: browser,
    url,
    expectedUrl: url,
    allowedOrigins: [new URL(url).origin],
    viewport: { width: 1280, height: 800 },
    readinessTimeoutMs: 5000,
    settleMs: 200,
    outputPath: path.join(root, "capture.png"),
    verificationPath: path.join(root, "verification.png"),
    stateAssertion: {
      schema_version: 2,
      subject_id: "notification-switches",
      coverage_id: "notification-switches-primary-desktop",
      state: "primary",
      state_marker: {
        locator: { by: "id", value: "switches" },
        attribute: "data-pm-state",
        value: "primary",
      },
      all: [
        {
          locator: { by: "role-name", value: "switch:Category updates" },
          expect: { kind: "visible" },
        },
      ],
    },
  };
}
test(
  "native snapshot ignores unused inherited fonts on equal textless switch glyphs",
  { skip },
  async (t) => {
    const result = runCaptureProbe(await fixture(t, "fixed"));
    assert.equal(result.assertion_passed, true);
    assert.deepEqual(result.dom_observations.consistency, []);
  }
);
for (const scenario of ["text", "font-driven", "generated-text"]) {
  test(`native snapshot retains rendered switch ${scenario} differences`, { skip }, async (t) => {
    const result = runCaptureProbe(await fixture(t, scenario));
    const findings = result.dom_observations.consistency;
    assert.ok(
      findings.some((finding) =>
        new RegExp(scenario === "font-driven" ? "geometry" : "font-size").test(finding.detail)
      ),
      JSON.stringify(findings)
    );
  });
}

test(
  "native snapshot compares identical switches at a nested scrollport edge",
  { skip },
  async (t) => {
    const controls = ["edge", "category", "event"]
      .map(
        (id, index) =>
          `<div class="row" style="top:${669 + index * 200}px"><label for="${id}">${id === "category" ? "Category updates" : id === "event" ? "Event updates" : "Earlier updates"}</label><button id="${id}" class="switch" role="switch" aria-checked="false"><span class="track"><span class="thumb"></span></span></button></div>`
      )
      .join("");
    const html = `<!doctype html><html lang="en"><head><title>Scrollport switches</title><link rel="icon" href="data:,"><style>body{margin:0;font:16px sans-serif}main{position:absolute;top:64px;bottom:0;width:100%;overflow:auto}.content{position:relative;height:1457px}.row{position:absolute;left:32px;display:flex;align-items:center;gap:16px}.switch{position:relative;width:44px;height:44px;padding:0;border:0;background:transparent}.track{position:absolute;left:4px;top:12px;width:36px;height:20px;background:#444;border-radius:10px}.thumb{position:absolute;left:18px;top:2px;width:16px;height:16px;background:white;border-radius:8px}</style></head><body><main id="switches" data-pm-state="primary"><div class="content"><h1>Notification preferences</h1>${controls}</div></main><script>document.querySelector('main').scrollTop=709</script></body></html>`;
    const result = runCaptureProbe(await fixture(t, "fixed", html));
    assert.equal(result.assertion_passed, true);
    assert.deepEqual(result.dom_observations.consistency, []);
  }
);
