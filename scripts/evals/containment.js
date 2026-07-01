"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_RESOURCES = {
  setupTimeoutMs: 60_000,
  preTimeoutMs: 30_000,
  adapterTimeoutMs: 600_000,
  postTimeoutMs: 60_000,
  pids: 64,
  memoryBytes: 1024 * 1024 * 1024,
  cpuCores: 2,
  writableBytes: 256 * 1024 * 1024,
  outputBytes: 2 * 1024 * 1024,
};

function validateArtifactName(name) {
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, reason: "empty artifact name" };
  }
  if (path.isAbsolute(name) || name.includes("\\") || name.includes("/")) {
    return { ok: false, reason: "artifact paths must be single safe filenames" };
  }
  if (name === "." || name === ".." || name.includes("..")) {
    return { ok: false, reason: "artifact name must not contain dot segments" };
  }
  return { ok: true };
}

function inspectArtifact(filePath, opts = {}) {
  const maxBytes = opts.maxBytes || 1024 * 1024;
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return { ok: false, reason: "missing artifact" };
  }
  if (!stat.isFile()) return { ok: false, reason: "artifact is not a regular file" };
  if (stat.nlink > 1) return { ok: false, reason: "hard link rejected" };
  if (stat.size > maxBytes) return { ok: false, reason: "artifact too large" };
  return { ok: true, size: stat.size };
}

function buildSandboxPlan({ runDir, network = "disabled", adapter = "stub" }) {
  return {
    runtime: "docker-or-podman",
    adapter,
    runDir,
    network,
    mounts: [
      { source: "runtime/pm", target: "runtime/pm", readonly: true },
      { source: "scenario", target: "scenario", readonly: true },
      { source: "workdir", target: "workdir", readonly: false },
      { source: "home", target: "home", readonly: false },
      { source: "xdg-cache", target: "xdg-cache", readonly: false },
      { source: "xdg-config", target: "xdg-config", readonly: false },
      { source: "xdg-data", target: "xdg-data", readonly: false },
      { source: "tmp", target: "tmp", readonly: false },
      { source: "artifacts", target: "artifacts", readonly: false },
    ],
    resources: { ...DEFAULT_RESOURCES },
  };
}

function sanitizeResourceBreach({ type, phase }) {
  return {
    reason: "resource-limit",
    detail: `${type || "resource breach"} in ${phase || "unknown"}`,
  };
}

module.exports = {
  DEFAULT_RESOURCES,
  validateArtifactName,
  inspectArtifact,
  buildSandboxPlan,
  sanitizeResourceBreach,
};
