"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { resolveBrowser, runCaptureProbe } = require("../scripts/design-critique-capture");
const { focusIndicatorRegions } = require("../scripts/design-critique-capture-probe");
const { inspectPngVisualBytes, visualDifference } = require("../scripts/lib/media-inspect");
let browser;
try {
  browser = resolveBrowser();
} catch {
  // Capability absence remains an explicit skip.
}
const skip = process.env.PM_SKIP_BROWSER_TESTS || (!browser && "Chromium is unavailable");

test("native keyboard inset ring regions contain its actual changed pixels", { skip }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-inset-focus-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const html =
    '<!doctype html><html lang="en"><style>body{font:16px Arial;margin:32px}a{display:inline-block;padding:8px 16px;color:navy;border:3px solid gray;outline:2px solid transparent;outline-offset:2px}a:focus-visible{box-shadow:inset 0 0 0 2px teal}</style><main id="fixture" data-pm-state="primary"><h1>Review the submitted inspection</h1><p>Return to the forms register after checking the answers.</p><a id="back" href="#register">Back to forms</a></main></html>';
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const config = {
    browserPath: browser,
    url,
    expectedUrl: url,
    allowedOrigins: [],
    viewport: { width: 1024, height: 600 },
    readinessTimeoutMs: 5000,
    settleMs: 200,
    stateAssertion: {
      schema_version: 2,
      subject_id: "compatibility",
      coverage_id: "compatibility-primary-desktop",
      state: "primary",
      state_marker: {
        locator: { by: "id", value: "fixture" },
        attribute: "data-pm-state",
        value: "primary",
      },
      all: [{ locator: { by: "id", value: "back" }, expect: { kind: "visible" } }],
    },
  };
  const run = (name, focused) => {
    const assertion = structuredClone(config.stateAssertion);
    if (focused) {
      assertion.before_capture = [{ kind: "tab", count: 1, reverse: false }];
      assertion.all.push({ locator: { by: "id", value: "back" }, expect: { kind: "focused" } });
    }
    const outputPath = path.join(root, `${name}.png`);
    const result = runCaptureProbe({
      ...config,
      stateAssertion: assertion,
      outputPath,
      verificationPath: path.join(root, `${name}-verification.png`),
    });
    return { result, bytes: fs.readFileSync(outputPath) };
  };
  const before = run("before", false),
    after = run("after", true);
  const control =
    after.result.assertion_visibility.checks.find((row) => row.label === "all[0]") ||
    after.result.assertion_visibility.checks[1];
  const bands = control.focus_indicator_regions;
  assert.equal(bands.length, 4, "native inset style must produce bounded indicator regions");
  const changed = bands.filter((region) => {
    const diff = visualDifference(
      inspectPngVisualBytes(before.bytes, region),
      inspectPngVisualBytes(after.bytes, region)
    );
    return diff.distance >= 0.005 && diff.changedTileRatio >= 0.03;
  });
  assert.ok(changed.length >= 2, "at least two native bands must sample the visible inset ring");
});

const prior = {
  "outline-style": "none",
  "outline-width": "0px",
  "outline-offset": "0px",
  "outline-color": "rgb(0, 0, 0)",
  "box-shadow": "none",
  "border-top-width": "0px",
  "border-bottom-width": "0px",
  "border-left-width": "0px",
  "border-right-width": "0px",
};
const node = { backendNodeId: 1, layout: { bounds: [20, 20, 80, 40] } };
const metrics = { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 160, clientHeight: 100 } };
function regions(shadow, before = prior, extra = {}) {
  const after = { ...prior, ...extra, "box-shadow": shadow };
  return focusIndicatorRegions(node, (n, key) => after[key], before, metrics);
}
test("inset focus geometry excludes the interior and ignores unchanged decoration", () => {
  const shadow = "rgb(0, 128, 128) 0px 0px 0px 2px inset";
  const expected = [
    { x: 20, y: 20, width: 80, height: 2 },
    { x: 20, y: 58, width: 80, height: 2 },
    { x: 20, y: 22, width: 2, height: 36 },
    { x: 98, y: 22, width: 2, height: 36 },
  ];
  assert.deepEqual(regions(shadow), expected);
  assert.deepEqual(regions(shadow, { ...prior, "box-shadow": shadow }), []);
  const decoration = "rgb(0, 0, 0) 0px 10px 15px -3px";
  assert.deepEqual(
    regions(`${decoration}, ${shadow}`, { ...prior, "box-shadow": decoration }),
    expected
  );
});
for (const shadow of [
  "rgb(0, 128, 128) 0px 0px 0px 17px inset",
  "rgb(0, 128, 128) 0px 0px 0px 0px inset",
  "rgb(0, 128, 128) 0px 0px 0px -2px inset",
  "rgb(0, 128, 128) 1px 0px 0px 2px inset",
  "rgb(0, 128, 128) 0px 0px 1px 2px inset",
  "rgb(0, 128, 128) 0px 0px -1px 2px inset",
  "rgb(0, 128, 128) 0px 0px 0px bogus inset",
]) {
  test(`unsupported inset geometry cannot grant regions: ${shadow}`, () =>
    assert.deepEqual(regions(shadow), []));
}
test("native border widths bound inset bands without including the center", () => {
  const bands = regions("rgb(0, 128, 128) 0px 0px 0px 2px inset", prior, {
    "border-top-width": "3px",
    "border-bottom-width": "3px",
    "border-left-width": "3px",
    "border-right-width": "3px",
  });
  assert.equal(bands[0]?.height, 5);
  assert.deepEqual(
    regions("rgb(0, 128, 128) 0px 0px 0px 2px inset", prior, { "border-top-width": "20px" }),
    []
  );
});

const { capture } = require("./fixtures/native-capture-fixture");
test("native transparent inset plus two edge beacons cannot supply focus bands", { skip }, (t) => {
  const html =
    '<!doctype html><html lang="en"><style>body{font:16px Arial;margin:32px}button{position:relative;display:block;box-sizing:border-box;width:80px;height:40px;outline:none;border:0;background:white}button:focus-visible{box-shadow:inset 0 0 0 2px transparent}button:focus-visible::before,button:focus-visible::after{content:"";position:absolute;left:4px;width:2px;height:2px;background:black}button:focus-visible::before{top:0}button:focus-visible::after{bottom:0}</style><main id="fixture" data-pm-state="primary"><h1>Review submitted inspection answers</h1><p>Return to the register after checking the report.</p><button id="back">Return</button></main></html>';
  const result = capture(
    t,
    html,
    [
      { locator: { by: "id", value: "back" }, expect: { kind: "visible" } },
      { locator: { by: "id", value: "back" }, expect: { kind: "focused" } },
    ],
    [{ kind: "tab", count: 1, reverse: false }]
  );
  assert.deepEqual(
    result.assertion_visibility.checks[1].focus_indicator_regions,
    [],
    "transparent inset styling must not grant regions despite genuine Tab and two tiny edge beacons"
  );
});
test("unsupported inset decoration preserves independently visible outer outline", () => {
  const before = {
    "outline-style": "none",
    "outline-width": "0px",
    "outline-offset": "0px",
    "outline-color": "rgb(0, 0, 0)",
    "box-shadow": "none",
  };
  const after = {
    ...before,
    "outline-style": "solid",
    "outline-width": "2px",
    "outline-color": "rgb(0, 0, 255)",
    "box-shadow": "rgba(0, 0, 0, 0.1) 0px 1px 2px 0px inset",
  };
  const node = { backendNodeId: 1, layout: { bounds: [20, 20, 80, 40] } },
    metrics = { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 160, clientHeight: 100 } };
  const expected = focusIndicatorRegions(
    node,
    (n, k) => (k === "box-shadow" ? "none" : after[k]),
    before,
    metrics
  );
  assert.equal(expected.length, 4);
  assert.deepEqual(
    focusIndicatorRegions(node, (n, k) => after[k], before, metrics),
    expected
  );
});

for (const color of ["rgba(0, 0, 0, 0)", "rgb(0 0 0 / 0%)", "color(srgb 0 0 0 / 0)"]) {
  test(`transparent inset ${color} cannot supply geometry`, () =>
    assert.deepEqual(regions(`${color} 0px 0px 0px 2px inset`), []));
}

for (const inset of [
  "rgba(0, 0, 0, 0) 0px 0px 0px 2px inset",
  "rgb(0, 0, 0) 0px 0px 2px 0px inset",
  "rgb(0, 0, 0) 0px 0px 0px 17px inset",
  "rgb(0, 0, 0) 0px 0px 0px bogus inset",
]) {
  test(`unsupported inset preserves valid outer shadow: ${inset}`, () => {
    const outer = "rgb(0, 0, 255) 0px 0px 0px 2px";
    assert.deepEqual(regions(`${inset}, ${outer}`), regions(outer));
    assert.deepEqual(regions(`${outer}, ${inset}`), regions(outer));
  });
}
