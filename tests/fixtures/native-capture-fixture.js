"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { resolveBrowser, runCaptureProbe } = require("../../scripts/design-critique-capture");
let browser;
try {
  browser = resolveBrowser();
} catch {
  /* Native capability limitation is explicit below. */
}
const skip = process.env.PM_SKIP_BROWSER_TESTS || (!browser && "Chromium is unavailable");
function capture(t, html, all, beforeCapture = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-native-compatibility-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const assertion = {
    schema_version: 2,
    subject_id: "compatibility",
    coverage_id: "compatibility-primary-desktop",
    state: "primary",
    state_marker: {
      locator: { by: "id", value: "fixture" },
      attribute: "data-pm-state",
      value: "primary",
    },
    all,
  };
  if (beforeCapture.length) assertion.before_capture = beforeCapture;
  return runCaptureProbe({
    browserPath: browser,
    url,
    expectedUrl: url,
    allowedOrigins: [],
    viewport: { width: 1024, height: 600 },
    readinessTimeoutMs: 5000,
    settleMs: 200,
    outputPath: path.join(root, "capture.png"),
    verificationPath: path.join(root, "verification.png"),
    stateAssertion: assertion,
  });
}
module.exports = { capture, skip };
