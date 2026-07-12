#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
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
    { stdio: "ignore" }
  );
  let client = null;
  try {
    const portFile = path.join(profileDir, "DevToolsActivePort");
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(portFile)) {
      if (browser.exitCode !== null || Date.now() >= deadline)
        throw new Error("Chromium did not expose a debugging endpoint");
      await sleep(25);
    }
    const port = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
    let targets = [];
    while (targets.length === 0 && Date.now() < deadline) {
      targets = await requestJson(`http://127.0.0.1:${port}/json/list`).catch(() => []);
      if (targets.length === 0) await sleep(25);
    }
    const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
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
    while (Date.now() < deadline) {
      const state = await client.send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      if (state.result?.value === "complete") break;
      await sleep(25);
    }
    const evaluated = await client.send("Runtime.evaluate", {
      expression: config.expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluated.exceptionDetails) throw new Error("browser probe expression failed");
    process.stdout.write(`${JSON.stringify(evaluated.result?.value)}\n`);
  } finally {
    if (client) client.close();
    browser.kill("SIGKILL");
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
