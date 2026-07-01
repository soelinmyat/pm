"use strict";

const { spawnSync } = require("node:child_process");

const CONTAINER_RUNTIMES = ["docker", "podman"];

function detectContainerRuntime(runtimes = CONTAINER_RUNTIMES) {
  for (const runtime of runtimes) {
    const result = spawnSync("sh", ["-c", `command -v ${runtime}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0) {
      return { ok: true, name: runtime, path: result.stdout.trim() };
    }
  }
  return { ok: false, reason: "sandbox-missing" };
}

function assertContainerRuntime(runtimes = CONTAINER_RUNTIMES) {
  const detected = detectContainerRuntime(runtimes);
  if (!detected.ok) {
    throw new Error(detected.reason);
  }
  return detected;
}

module.exports = {
  CONTAINER_RUNTIMES,
  detectContainerRuntime,
  assertContainerRuntime,
};
