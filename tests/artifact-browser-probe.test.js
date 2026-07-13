"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROBE = path.resolve(__dirname, "../scripts/artifact-browser-probe.js");

function writePreload(root) {
  const preload = path.join(root, "fake-cdp-preload.js");
  fs.writeFileSync(
    preload,
    `"use strict";
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");
const http = require("node:http");
const realKill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (pid < 0) {
    if (process.env.PM_TEST_GROUP_KILL) fs.writeFileSync(process.env.PM_TEST_GROUP_KILL, String(pid));
    return true;
  }
  return realKill(pid, signal);
};
childProcess.spawn = (_executable, args) => {
  const profile = args.find((arg) => arg.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(require("node:path").join(profile, "DevToolsActivePort"), "12345\\n");
  const browser = new EventEmitter();
  browser.pid = 424242;
  browser.exitCode = null;
  browser.kill = () => { browser.exitCode = 0; return true; };
  return browser;
};
http.request = (url, _options, callback) => {
  const request = new EventEmitter();
  request.end = () => {
    process.nextTick(() => {
      const response = new EventEmitter();
      response.setEncoding = () => {};
      callback(response);
      process.nextTick(() => {
        const payload = String(url).includes("/json/new")
          ? { type: "page", webSocketDebuggerUrl: "ws://fake" }
          : [{ type: "page", webSocketDebuggerUrl: "ws://fake" }];
        response.emit("data", JSON.stringify(payload));
        response.emit("end");
      });
    });
  };
  return request;
};
global.WebSocket = class FakeWebSocket {
  constructor() {
    this.listeners = new Map();
    process.nextTick(() => this.emit("open", {}));
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  emit(type, event) { const listener = this.listeners.get(type); if (listener) listener(event); }
  send(raw) {
    const message = JSON.parse(raw);
    const result = message.method === "Runtime.evaluate" && message.params.expression === "document.readyState"
      ? { result: { value: process.env.PM_TEST_READY ? "complete" : "loading" } }
      : message.method === "Page.captureScreenshot"
        ? { data: Buffer.from("capture-bytes").toString("base64") }
      : {};
    process.nextTick(() => this.emit("message", { data: JSON.stringify({ id: message.id, result }) }));
  }
  close() {}
};
`
  );
  return preload;
}

function probeConfig(root, extra = {}) {
  const htmlPath = path.join(root, "report.html");
  fs.writeFileSync(htmlPath, "<!doctype html><main><h1>Report</h1></main>");
  return {
    browserPath: "/fake/chromium",
    htmlPath,
    viewport: { width: 800, height: 600 },
    expression: "document.title",
    ...extra,
  };
}

test("canonical probe fails closed when document readiness never completes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-browser-readiness-"));
  try {
    const preload = writePreload(root);
    const result = spawnSync(process.execPath, ["--require", preload, PROBE], {
      input: JSON.stringify(probeConfig(root, { readinessTimeoutMs: 50 })),
      encoding: "utf8",
      timeout: 2_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /did not reach complete readiness/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("terminating the helper kills its detached Chromium process group", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-browser-cleanup-"));
  try {
    const preload = writePreload(root);
    const killMarker = path.join(root, "group-kill");
    const helper = spawn(process.execPath, ["--require", preload, PROBE], {
      env: { ...process.env, PM_TEST_GROUP_KILL: killMarker },
      stdio: ["pipe", "pipe", "pipe"],
    });
    helper.stdin.end(JSON.stringify(probeConfig(root)));
    await new Promise((resolve) => setTimeout(resolve, 150));
    helper.kill("SIGTERM");
    const exit = await new Promise((resolve) =>
      helper.once("exit", (code, signal) => resolve({ code, signal }))
    );
    assert.ok(exit.code !== 0 || exit.signal, "helper should terminate on SIGTERM");
    assert.equal(fs.readFileSync(killMarker, "utf8"), "-424242");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("capture publication refuses a symlink destination", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-browser-symlink-"));
  try {
    const preload = writePreload(root);
    const outside = path.join(root, "outside.png");
    const outputPath = path.join(root, "capture.png");
    fs.writeFileSync(outside, "unchanged");
    fs.symlinkSync(outside, outputPath);
    const result = spawnSync(process.execPath, ["--require", preload, PROBE], {
      input: JSON.stringify(
        probeConfig(root, { action: "screenshot", outputPath, readinessTimeoutMs: 50 })
      ),
      encoding: "utf8",
      timeout: 2_000,
      env: { ...process.env, PM_TEST_READY: "1" },
    });
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(outside, "utf8"), "unchanged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
