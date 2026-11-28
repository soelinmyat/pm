"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MiB = 1024 * 1024;
const fileLimit = 64 * MiB;
const archiveLimit = 256 * MiB;
const derivedOutputs = new Set([
  "Build",
  "Index.noindex",
  "ModuleCache.noindex",
  "CompilationCache.noindex",
  "SDKStatCaches.noindex",
]);

// Read metadata only. A symlink in historical evidence can point outside the session.
function inspectSessionStorage(root) {
  const report = { bytes: 0, files: 0, oversized: false, generated: [], largest: [] };
  const directories = [""];
  while (directories.length) {
    const directory = directories.pop();
    const inDerivedData =
      path.basename(directory) === "DerivedData" ||
      path.basename(path.dirname(directory)) === "DerivedData";
    const entries = fs.readdirSync(path.join(root, directory), { withFileTypes: true });
    const cluster =
      entries.some((e) => e.isFile() && e.name === "PG_VERSION") &&
      entries.some((e) => e.isDirectory() && e.name === "base") &&
      entries.some((e) => e.isDirectory() && e.name === "global");
    if (cluster && report.generated.length < 10) report.generated.push(directory || ".");
    for (const entry of entries) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          report.generated.length < 10 &&
          (entry.name === "node_modules" || (inDerivedData && derivedOutputs.has(entry.name)))
        ) {
          report.generated.push(relative);
        }
        directories.push(relative);
      } else if (entry.isFile()) {
        const size = fs.lstatSync(path.join(root, relative)).size;
        report.bytes += size;
        report.files++;
        if (size >= fileLimit) report.oversized = true;
        if (report.largest.length < 5 || size > report.largest.at(-1).bytes) {
          report.largest.push({ path: relative, bytes: size });
          report.largest.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
          report.largest.length = Math.min(5, report.largest.length);
        }
      }
    }
  }
  report.oversized ||= report.bytes >= archiveLimit;
  return report;
}

// Sum regular file sizes under a directory without following symlinks.
function measureBytes(root) {
  let bytes = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) {
        try {
          bytes += fs.lstatSync(child).size;
        } catch {
          // Removed while measuring.
        }
      }
    }
  }
  return bytes;
}

// The first `.git` file or directory under root, as a path relative to root,
// or null. A `.git` entry marks a checkout or linked worktree whose
// uncommitted work a recursive removal would destroy. Symlinks are not
// followed. A folder that cannot be read counts as holding one. With
// ignoreRootGit, the root's own `.git` (a linked worktree's file) is skipped
// and only checkouts nested below it count.
function gitCheckoutWithin(root, { ignoreRootGit = false } = {}) {
  const pending = [""];
  while (pending.length) {
    const relative = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      return relative || ".";
    }
    for (const entry of entries) {
      const child = path.join(relative, entry.name);
      if (entry.name === ".git") {
        if (ignoreRootGit && relative === "") continue;
        return child;
      }
      if (entry.isDirectory()) pending.push(child);
    }
  }
  return null;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Remove the generated folders inspectSessionStorage reports. Only those
// classes are removed, never the session folder itself, never a folder that
// holds a path the session references as evidence, and never a database
// cluster whose server is still running. Everything kept stays in the
// inspection so completion still blocks on it.
function cleanGeneratedSessionData(root, { referenced = [] } = {}) {
  const rootReal = fs.realpathSync(root);
  const removed = [];
  const kept = new Map();
  for (let pass = 0; pass < 1000; pass++) {
    const candidates = inspectSessionStorage(root)
      .generated.filter((relative) => relative !== "." && !kept.has(relative))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    if (!candidates.length) break;
    let progressed = false;
    for (const relative of candidates) {
      const absolute = path.join(root, relative);
      if (removed.some((item) => isWithin(path.join(root, item.path), absolute))) continue;
      const reason = generatedRefusal(absolute, path.join(rootReal, relative), referenced);
      if (reason) {
        kept.set(relative, reason);
        continue;
      }
      const bytes = measureBytes(absolute);
      fs.rmSync(absolute, { recursive: true, maxRetries: 2 });
      removed.push({ path: relative, bytes });
      progressed = true;
    }
    if (!progressed) break;
  }
  removed.sort((a, b) => a.path.localeCompare(b.path));
  return { removed, kept: [...kept].map(([relative, reason]) => ({ path: relative, reason })) };
}

function generatedRefusal(absolute, expectedReal, referenced) {
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    return "cannot be inspected";
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return "is not a plain directory";
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    return "cannot be resolved";
  }
  if (real !== expectedReal) return "resolves outside the session";
  const evidence = referenced.find((candidate) => isWithin(absolute, candidate));
  if (evidence) return `holds evidence the session references: ${evidence}`;
  const checkout = gitCheckoutWithin(absolute);
  if (checkout)
    return `contains a git checkout, or a folder that cannot be checked for one, at ${checkout}`;
  try {
    const pid = Number(
      fs.readFileSync(path.join(absolute, "postmaster.pid"), "utf8").split("\n")[0]
    );
    if (Number.isSafeInteger(pid) && pid > 1) {
      try {
        process.kill(pid, 0);
        return `a database server (pid ${pid}) is still running on it`;
      } catch (error) {
        if (error.code === "EPERM") return `a database server (pid ${pid}) is still running on it`;
      }
    }
  } catch {
    // No server pid file.
  }
  return null;
}

module.exports = {
  cleanGeneratedSessionData,
  gitCheckoutWithin,
  inspectSessionStorage,
  measureBytes,
};
