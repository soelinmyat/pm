"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
test(
  "failed Chromium launch reports bounded categories and reclaims only its owned profile",
  { skip: process.platform === "win32" && "POSIX executable fixture" },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "capture-launch-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const browser = path.join(root, "chromium");
    fs.writeFileSync(
      browser,
      '#!/bin/sh\nfor arg in "$@"; do case "$arg" in --user-data-dir=*) printf "%s\\n" "${arg#--user-data-dir=}" > "$PM_CAPTURE_PROFILE_RESULT";; esac; done\nprintf "%s\\n" "pthread_create: Resource temporarily unavailable private-fixture-path" >&2\nexit 17\n',
      { mode: 0o700 }
    );
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "../scripts/design-critique-capture-probe.js")],
      {
        input: JSON.stringify({ browserPath: browser, allowedOrigins: [], stateAssertion: {} }),
        encoding: "utf8",
        env: { ...process.env, PM_CAPTURE_PROFILE_RESULT: path.join(root, "profile.txt") },
        timeout: 5000,
      }
    );
    assert.equal(result.status, 1);
    assert.equal(
      fs.existsSync(fs.readFileSync(path.join(root, "profile.txt"), "utf8").trim()),
      false
    );
    assert.equal(fs.existsSync(browser), true);
    assert.match(
      result.stderr,
      /port-file; exit=17; signal=none; spawn=none; hints=thread_resource/
    );
    assert.doesNotMatch(result.stderr, /private-fixture-path/);
  }
);
test("missing Chromium executable fails promptly with a structured spawn category", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "../scripts/design-critique-capture-probe.js")],
    {
      input: JSON.stringify({
        browserPath: path.join(os.tmpdir(), `no-chromium-${process.pid}`),
        allowedOrigins: [],
        stateAssertion: {},
      }),
      encoding: "utf8",
      timeout: 5000,
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /spawn=ENOENT/);
  assert.doesNotMatch(result.stderr, /Unhandled 'error'/);
});
