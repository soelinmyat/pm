#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestJson(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http
      .request(url, { method }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
    request.end();
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result || {});
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function main() {
  const config = JSON.parse(fs.readFileSync(0, "utf8"));
  const readinessTimeoutMs =
    Number.isSafeInteger(config.readinessTimeoutMs) &&
    config.readinessTimeoutMs > 0 &&
    config.readinessTimeoutMs <= 10_000
      ? config.readinessTimeoutMs
      : 10_000;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-cdp-"));
  const browser = spawn(
    config.browserPath,
    [
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: "ignore", detached: process.platform !== "win32" }
  );
  let client = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (client) client.close();
    try {
      if (browser.exitCode === null) {
        if (process.platform === "win32") browser.kill("SIGKILL");
        else process.kill(-browser.pid, "SIGKILL");
      }
    } catch {
      // The browser may have exited between the state check and the kill.
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
  };
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.once(signal, () => {
      cleanup();
      process.exit(128 + (os.constants.signals[signal] || 0));
    });
  }
  try {
    const portFile = path.join(profileDir, "DevToolsActivePort");
    const endpointDeadline = Date.now() + 10_000;
    while (!fs.existsSync(portFile)) {
      if (browser.exitCode !== null || Date.now() >= endpointDeadline)
        throw new Error("Chromium did not expose a debugging endpoint");
      await sleep(25);
    }
    const port = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
    let targets = [];
    let target = await requestJson(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
      "PUT"
    ).catch(() => null);
    if (!target?.webSocketDebuggerUrl) target = null;
    const targetDeadline = Date.now() + 10_000;
    while (!target && Date.now() < targetDeadline) {
      targets = await requestJson(`http://127.0.0.1:${port}/json/list`).catch(() => []);
      target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (!target) await sleep(25);
    }
    if (!target) throw new Error("Chromium did not expose a page target");
    client = await connect(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: config.viewport.width,
      height: config.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Page.navigate", { url: pathToFileURL(config.htmlPath).href });
    const readinessDeadline = Date.now() + readinessTimeoutMs;
    let ready = false;
    while (Date.now() < readinessDeadline) {
      const state = await client.send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      if (state.result?.value === "complete") {
        ready = true;
        break;
      }
      await sleep(25);
    }
    if (!ready) throw new Error("canonical page did not reach complete readiness");
    if (config.action === "screenshot") {
      const captured = await client.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      if (!captured.data) throw new Error("browser did not return screenshot bytes");
      fs.writeFileSync(config.outputPath, Buffer.from(captured.data, "base64"), { mode: 0o600 });
      return;
    }
    if (config.action === "pdf") {
      await client.send("Emulation.setEmulatedMedia", { media: "print" });
      const printed = await client.send("Page.printToPDF", {
        displayHeaderFooter: false,
        printBackground: true,
      });
      if (!printed.data) throw new Error("browser did not return PDF bytes");
      fs.writeFileSync(config.outputPath, Buffer.from(printed.data, "base64"), { mode: 0o600 });
      return;
    }
    const evaluated = await client.send("Runtime.evaluate", {
      expression: config.expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluated.exceptionDetails) throw new Error("browser probe expression failed");
    process.stdout.write(`${JSON.stringify(evaluated.result?.value)}\n`);
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
