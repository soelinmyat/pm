"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  resolveBrowser,
  runCaptureProbe,
  validateStateAssertion,
  validateFileLabelBaseline,
} = require("../scripts/design-critique-capture");

const { hasNativeFocusBandChange } = require("../scripts/lib/native-focus-pixels");
const { createPngRegionInspector } = require("../scripts/lib/media-inspect");

function fileLabelAssertion() {
  return {
    schema_version: 2,
    subject_id: "file-upload",
    coverage_id: "file-upload-focus-desktop",
    state: "focus",
    state_marker: {
      locator: { by: "id", value: "upload-zone" },
      attribute: "data-pm-state",
      value: "focus",
    },
    focus_label: {
      policy: "native-file-input-label-v1",
      control: { by: "id", value: "upload-input" },
      label: { by: "id", value: "upload-zone" },
    },
    before_capture: [{ kind: "tab", count: 1, reverse: false }],
    all: [
      {
        locator: { by: "id", value: "upload-input" },
        expect: { kind: "focused" },
      },
      {
        locator: { by: "id", value: "upload-zone" },
        expect: { kind: "visible" },
      },
    ],
  };
}

test("native file-label assertion binds a focused input and visible associated label", () => {
  const value = fileLabelAssertion();
  assert.equal(validateStateAssertion(value), value);
});

// Intercept the actual helper's first screenshot protocol call in this test
// process only. The real browser emits native drift events; no production hook
// or modified page response is added to the shipped acquisition path.
function instrumentBaselineProbe(directory, mutation) {
  assert.ok(["dom", "stylesheet", "network", "pixels"].includes(mutation));
  const original = path.resolve(__dirname, "../scripts/design-critique-capture-probe.js");
  const injection = `
const originalConnect = connect;
connect = async (url) => {
  const client = await originalConnect(url), send = client.send.bind(client);
  const sheets = []; let screenshots = 0;
  client.on("CSS.styleSheetAdded", (event) => sheets.push(event.header.styleSheetId));
  client.send = async (method, params = {}, sessionId = null) => {
    if (method !== "Page.captureScreenshot" || ++screenshots !== 1)
      return send(method, params, sessionId);
    const mutation = ${JSON.stringify(mutation)};
    let restore = async () => {};
    if (mutation === "dom") {
      await send("Runtime.evaluate", {expression: 'document.body.setAttribute("data-baseline-transient", "1")'});
      restore = () => send("Runtime.evaluate", {expression: 'document.body.removeAttribute("data-baseline-transient")'});
    } else if (mutation === "stylesheet") {
      const styleSheetId = sheets[0];
      if (!styleSheetId) throw Error("Test stylesheet unavailable");
      const {text} = await send("CSS.getStyleSheetText", {styleSheetId});
      await send("CSS.setStyleSheetText", {styleSheetId, text: text + "\\n#upload-zone{border-color:rgb(255,0,0)}"});
      restore = () => send("CSS.setStyleSheetText", {styleSheetId, text});
    } else if (mutation === "network") {
      await send("Runtime.evaluate", {expression: 'fetch("data:text/plain,baseline-reference-probe").then(r => r.text())', awaitPromise: true});
    } else {
      await send("Emulation.setEmulatedMedia", {features: [{name: "prefers-color-scheme", value: "dark"}]});
      restore = () => send("Emulation.setEmulatedMedia", {features: [{name: "prefers-color-scheme", value: "light"}]});
    }
    try { return await send(method, params, sessionId); }
    finally { await restore(); }
  };
  return client;
};
`;
  const wrapper = path.join(directory, "instrumented-baseline-probe.cjs");
  fs.writeFileSync(
    wrapper,
    `const fs = require("node:fs"), Module = require("node:module"), path = require("node:path");
const original = ${JSON.stringify(original)};
const source = fs.readFileSync(original, "utf8");
const entry = "if (require.main === module)";
if (source.split(entry).length !== 2) throw Error("Test probe entry drifted");
const compiled = new Module(original);
compiled.filename = original;
compiled.paths = Module._nodeModulePaths(path.dirname(original));
compiled._compile(source.replace(entry, ${JSON.stringify(injection)} + "\\nif (true)"), original);
`,
    { mode: 0o600 }
  );
  return wrapper;
}

function nativeFileLabelProbe(variant = "working", mutation = null) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-file-label-focus-"));
  const input = `<input id="upload-input" type="${variant === "wrong-type" ? "text" : "file"}" aria-label="Supporting document"${variant === "disabled" ? " disabled" : ""}>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#eef2ff;color:#172033;font:16px system-ui}
  header{padding:24px;background:#18264a;color:white}main{margin:24px auto;padding:24px;max-width:900px;background:white}
  button{padding:12px 20px}#upload-zone{position:relative;display:flex;flex-direction:column;justify-content:center;align-items:center;width:500px;height:140px;margin-top:24px;border:2px dashed #64748b}
  #upload-zone:focus-within{outline:3px solid ${variant === "transparent-ring" ? "transparent" : variant === "background-ring" ? "white" : "#155e75"};outline-offset:3px}
  ${variant === "no-ring" ? "#upload-zone:focus-within{outline:none}" : ""}
  ${variant === "transparent-shadow" ? "#upload-zone:focus-within{outline:none;box-shadow:0 0 0 3px transparent}" : ""}
  ${variant === "shifted-label" ? "#upload-zone:focus-within{margin-left:1px}" : ""}
  @media(prefers-color-scheme:dark){#upload-zone{box-shadow:0 0 0 4px #a028a0}}
  ${variant === "tiny-label" ? "#upload-zone{width:20px;height:10px}" : ""}
  ${variant === "offscreen" ? "#upload-zone{position:absolute;left:-2000px}" : ""}
  #upload-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  </style></head><body><header><h1>Supporting evidence</h1></header><main>
  <h2>Complete the site review</h2><p>Choose the supporting document after writing your observations.</p>
  <button type="button" id="before-upload">Before upload</button>
  ${variant === "external-caption" ? '<label for="upload-input">Evidence reference</label>' : ""}
  ${variant === "foreign-label" ? input : ""}
  <label id="upload-zone" for="${variant === "wrong-for" ? "foreign-input" : "upload-input"}" data-pm-state="focus"><span>Supporting document</span><span>Choose a file up to ten megabytes</span>${variant === "foreign-label" ? "" : input}</label>
  ${variant === "duplicate-id" ? '<input id="upload-input" type="file">' : ""}
  <button type="button">After upload</button>
  ${variant === "covered" ? '<div style="position:fixed;inset:0;background:black;z-index:999">Actual covering overlay</div>' : ""}
  </main><script>document.getElementById("${variant === "already-focused" ? "upload-input" : "before-upload"}").focus()</script></body></html>`;
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  try {
    const assertion = fileLabelAssertion();
    if (variant === "unfocused") assertion.before_capture[0].count = 2;
    if (variant === "already-focused") assertion.before_capture[0].count = 3;
    const result = runCaptureProbe(
      {
        browserPath: resolveBrowser(),
        url,
        expectedUrl: url,
        viewport: { width: 1024, height: 600 },
        stateAssertion: validateStateAssertion(assertion),
        allowedOrigins: [],
        readinessTimeoutMs: 15_000,
        settleMs: 200,
        outputPath: path.join(directory, "capture.png"),
        verificationPath: path.join(directory, "verification.png"),
        focusBaselinePath: path.join(directory, "focus-baseline.png"),
        focusBaselineVerificationPath: path.join(directory, "focus-baseline-verification.png"),
      },
      mutation ? { probePath: instrumentBaselineProbe(directory, mutation) } : {}
    );
    validateFileLabelBaseline(result.focus_baseline, result.page);
    const bands = result.assertion_visibility.checks.find(
      (check) => check.label === "state marker"
    ).focus_indicator_regions;
    return {
      result,
      screenshotBytes: fs.statSync(path.join(directory, "capture.png")).size,
      bandChange: hasNativeFocusBandChange(
        createPngRegionInspector(fs.readFileSync(path.join(directory, "focus-baseline.png"))),
        createPngRegionInspector(fs.readFileSync(path.join(directory, "capture.png"))),
        bands
      ),
    };
  } catch (error) {
    if (mutation)
      for (const name of [
        "capture.png",
        "verification.png",
        "focus-baseline.png",
        "focus-baseline-verification.png",
      ])
        assert.equal(
          fs.existsSync(path.join(directory, name)),
          false,
          `${name} must be discarded after acquisition failure`
        );
    throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

for (const variant of ["working", "external-caption"]) {
  test(`native file-label focus retains keyboard entry and measured focus bands: ${variant}`, () => {
    const { result, screenshotBytes, bandChange } = nativeFileLabelProbe(variant);
    const label = result.assertion_visibility.checks.find(
      (check) => check.label === "state assertion clause 2"
    );
    assert.ok(label.focus_indicator_regions.length >= 2);
    assert.ok(label.visual_bounds.width >= 32 && label.visual_bounds.height >= 20);
    assert.ok(screenshotBytes > 0);
    assert.equal(result.focus_baseline.target.control_focused, false);
    assert.equal(result.focus_baseline.focused_target.control_focused, true);
    assert.equal(
      result.focus_baseline.target.label_backend_node_id,
      label.asserted_backend_node_id
    );
    assert.ok(Number(result.focus_baseline.screenshot.size) > 0);
    assert.equal(bandChange, true);
  });
}

for (const variant of [
  "wrong-for",
  "wrong-type",
  "foreign-label",
  "duplicate-id",
  "disabled",
  "unfocused",
  "tiny-label",
  "offscreen",
  "covered",
  "no-ring",
  "transparent-ring",
  "transparent-shadow",
  "already-focused",
  "shifted-label",
]) {
  test(`native file-label focus rejects invalid actual Chromium evidence: ${variant}`, () => {
    assert.throws(
      () => nativeFileLabelProbe(variant),
      /native file label|fully occluded|expected focus|state marker must be visibly rendered/
    );
  });
}

for (const variant of [
  "unknown-policy",
  "no-tab",
  "missing-focus",
  "missing-visible",
  "wrong-marker",
  "role-locator",
  "extra-key",
]) {
  test(`native file-label assertion rejects an unbound claim: ${variant}`, () => {
    const value = fileLabelAssertion();
    if (variant === "unknown-policy") value.focus_label.policy = "arbitrary-owner";
    if (variant === "no-tab") delete value.before_capture;
    if (variant === "missing-focus") value.all.shift();
    if (variant === "missing-visible") value.all.pop();
    if (variant === "wrong-marker") value.focus_label.label.value = "unrelated-label";
    if (variant === "role-locator") value.focus_label.control.by = "role-name";
    if (variant === "extra-key") value.focus_label.regions = [];
    assert.throws(() => validateStateAssertion(value), /focus_label|unknown field/);
  });
}

// Opaque colors still need actual pixel change: CSS declarations alone do not
// establish a visible focus indicator against a matching painted background.
test("native file-label rejects background-colored bands using actual Chromium pixels", () => {
  const { bandChange } = nativeFileLabelProbe("background-ring");
  assert.equal(bandChange, false);
});

for (const mutation of ["dom", "stylesheet", "network", "pixels"]) {
  test(`native file-label baseline rejects restored transient acquisition drift: ${mutation}`, () => {
    assert.throws(
      () => nativeFileLabelProbe("working", mutation),
      /atomic capture|baseline.*pixels changed/
    );
  });
}
