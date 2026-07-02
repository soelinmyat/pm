"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildCronLine,
  buildLaunchdPlist,
  generate,
  launchdLabel,
  projectSlug,
  setKillSwitch,
} = require("../scripts/loop-install.js");

test("projectSlug and launchdLabel derive stable identifiers", () => {
  assert.equal(projectSlug("/Users/x/Projects/cleanlog-mono"), "cleanlog-mono");
  assert.equal(launchdLabel("/Users/x/My App!"), "com.pm.loop.my-app");
});

test("launchd plist embeds absolute paths, interval, and PATH env", () => {
  const plist = buildLaunchdPlist({
    projectDir: "/work/proj",
    workerScript: "/plugin/scripts/loop-worker.js",
    nodeBin: "/usr/local/bin/node",
    mode: "dev",
    intervalMinutes: 45,
    logPath: "/tmp/loop.log",
    pathEnv: "/usr/local/bin:/usr/bin",
  });
  assert.match(plist, /<string>com\.pm\.loop\.proj<\/string>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/plugin\/scripts\/loop-worker\.js<\/string>/);
  assert.match(plist, /<string>--project-dir<\/string>/);
  assert.match(plist, /<integer>2700<\/integer>/);
  assert.match(plist, /<key>PATH<\/key>/);
  assert.match(plist, /<string>\/usr\/local\/bin:\/usr\/bin<\/string>/);
});

test("cron line uses */N for sub-hour and hourly schedule above 60m", () => {
  const line30 = buildCronLine({
    projectDir: "/work/proj",
    workerScript: "/plugin/scripts/loop-worker.js",
    nodeBin: "/usr/bin/node",
    intervalMinutes: 30,
    logPath: "/tmp/loop.log",
    pathEnv: "/usr/bin",
  });
  assert.match(line30, /^\*\/30 \* \* \* \* /);
  assert.match(line30, /--project-dir \/work\/proj --mode dev >> \/tmp\/loop\.log 2>&1$/);

  const line120 = buildCronLine({
    projectDir: "/work/proj",
    workerScript: "/plugin/scripts/loop-worker.js",
    intervalMinutes: 120,
  });
  assert.match(line120, /^0 \*\/2 \* \* \* /);
});

test("generate picks launchd on darwin format and cron otherwise", () => {
  const mac = generate({ projectDir: "/p", mode: "dev", intervalMinutes: 30, format: "launchd" });
  assert.equal(mac.kind, "launchd");
  assert.match(mac.content, /<plist/);

  const linux = generate({ projectDir: "/p", mode: "dev", intervalMinutes: 30, format: "cron" });
  assert.equal(linux.kind, "cron");
  assert.match(linux.content, /^\*\/30/);
});

test("setKillSwitch writes and removes the STOP file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-install-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
  try {
    const stopped = setKillSwitch(pmDir, true);
    assert.equal(stopped.stopped, true);
    assert.ok(fs.existsSync(stopped.stopPath));

    const resumed = setKillSwitch(pmDir, false);
    assert.equal(resumed.stopped, false);
    assert.equal(fs.existsSync(resumed.stopPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
