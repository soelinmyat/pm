#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { stable, digest } = require("./lib/repository-gate-plan-schema");

const ALLOWED_PROBE_KEYS = new Set([
  "adapter",
  "provenance",
  "expected",
  "timeout_ms",
  "working_directory",
]);
const ALLOWED_EXPECTED = new Set(["database", "server", "user"]);

function redactText(value) {
  return String(value)
    .replace(/(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s]+/gi, "[REDACTED_DSN]")
    .replace(/(password\s*=\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(token|secret|credential)(\s*[=:]\s*)[^\s]+/gi, "$1$2[REDACTED]");
}

function validateProbeDeclaration(probe) {
  if (!probe || typeof probe !== "object" || Array.isArray(probe))
    throw new Error("probe must be an object");
  if (probe.adapter !== "postgres-identity-v1") throw new Error("probe adapter is not supported");
  if (!["protected", "protected-base", "approved", "authenticated"].includes(probe.provenance))
    throw new Error("probe requires protected, approved, or authenticated provenance");
  for (const key of Object.keys(probe))
    if (!ALLOWED_PROBE_KEYS.has(key)) throw new Error(`probe field ${key} is not allowed`);
  if (
    !probe.expected ||
    typeof probe.expected !== "object" ||
    Array.isArray(probe.expected) ||
    Object.keys(probe.expected).length === 0
  )
    throw new Error("probe expected identity is required");
  for (const key of Object.keys(probe.expected))
    if (
      !ALLOWED_EXPECTED.has(key) ||
      typeof probe.expected[key] !== "string" ||
      probe.expected[key].length > 256
    )
      throw new Error(`probe expected field ${key} is invalid`);
  if (
    probe.timeout_ms !== undefined &&
    (!Number.isInteger(probe.timeout_ms) || probe.timeout_ms < 1 || probe.timeout_ms > 5000)
  )
    throw new Error("probe timeout is invalid");
  return true;
}

function parseVersion(input) {
  const found = String(input || "").match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return found ? [Number(found[1]), Number(found[2] || 0), Number(found[3] || 0)] : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
function satisfies(versionText, constraintText) {
  const version = parseVersion(versionText);
  if (!version) return false;
  const constraint = String(constraintText || "")
    .trim()
    .replace(/^v/, "");
  if (!constraint || constraint === "*") return true;
  if (/^\d+(?:\.\d+){0,2}$/.test(constraint)) {
    const expected = parseVersion(constraint);
    const parts = constraint.split(".").length;
    return version.slice(0, parts).every((x, i) => x === expected[i]);
  }
  return constraint.split(/\s+/).every((part) => {
    const match = part.match(/^(>=|<=|>|<|\^|~)?(\d+(?:\.\d+){0,2})$/);
    if (!match) return false;
    const op = match[1] || "=",
      target = parseVersion(match[2]),
      order = cmp(version, target);
    if (op === ">=") return order >= 0;
    if (op === "<=") return order <= 0;
    if (op === ">") return order > 0;
    if (op === "<") return order < 0;
    if (op === "^") return version[0] === target[0] && order >= 0;
    if (op === "~") return version[0] === target[0] && version[1] === target[1] && order >= 0;
    return order === 0;
  });
}

function constraintsIntersect(constraints) {
  if (constraints.length < 2) return true;
  const candidates = [];
  for (const item of constraints) {
    const v = parseVersion(item.constraint);
    if (v)
      for (let patch = Math.max(0, v[2] - 1); patch <= v[2] + 2; patch++)
        candidates.push(`${v[0]}.${v[1]}.${patch}`);
  }
  return candidates.some((candidate) =>
    constraints.every((x) => satisfies(candidate, x.constraint))
  );
}

function defaultResolveRuntime(name, env) {
  const which = childProcess.spawnSync(process.platform === "win32" ? "where" : "which", [name], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: 2000,
  });
  if (which.status !== 0 || !which.stdout.trim())
    return { found: false, path: null, realpath: null, version: null, manager: null };
  const runtimePath = which.stdout.trim().split(/\r?\n/)[0];
  const version = childProcess.spawnSync(runtimePath, ["--version"], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: 2000,
    maxBuffer: 8192,
  });
  return {
    found: version.status === 0,
    path: runtimePath,
    realpath: fs.realpathSync(runtimePath),
    version: String(version.stdout || version.stderr)
      .trim()
      .replace(/^v/, ""),
    manager: "path",
  };
}

function defaultProbeRunner(probe, options = {}) {
  validateProbeDeclaration(probe);
  const env = {};
  for (const name of ["PATH", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGSSLMODE"])
    if (options.env?.[name] !== undefined) env[name] = options.env[name];
  const result = childProcess.spawnSync(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT current_database(), current_user, inet_server_addr()::text",
    ],
    {
      cwd: probe.working_directory || options.cwd,
      env,
      encoding: "utf8",
      shell: false,
      timeout: probe.timeout_ms || 3000,
      maxBuffer: 8192,
    }
  );
  if (result.error || result.status !== 0)
    throw new Error(redactText(result.error?.message || result.stderr || "probe failed"));
  if (Buffer.byteLength(result.stdout || "") > 8192) throw new Error("probe output exceeded limit");
  const fields = String(result.stdout).trim().split("|");
  if (fields.length !== 3) throw new Error("probe returned malformed fields");
  return { database: fields[0], user: fields[1], server: fields[2] };
}

function keyedIdentity(value, key) {
  return `hmac-sha256:${crypto
    .createHmac("sha256", key)
    .update(JSON.stringify(stable(value)))
    .digest("hex")}`;
}
function identityFor(resolved, env, services = []) {
  return {
    runtimes: resolved.map((x) => ({
      name: x.name,
      path: x.path,
      realpath: x.realpath,
      version: x.version,
      manager: x.manager || null,
    })),
    path_digest: digest(String(env.PATH || "")),
    allowlisted_env_digest: digest(
      Object.fromEntries(
        ["NODE_ENV", "BUNDLE_GEMFILE", "MISE_ENV"]
          .filter((k) => env[k] !== undefined)
          .map((k) => [k, env[k]])
      )
    ),
    services,
  };
}

function verifyEnvironment(plan, options = {}) {
  const expectations = plan.expectations || { runtimes: [], probes: [] },
    env = options.env || process.env,
    issues = [],
    resolved = [],
    services = [];
  const local = (expectations.runtimes || []).filter((x) => x.scope !== "ci");
  for (const name of [...new Set(local.map((x) => x.name))]) {
    const declarations = local.filter((x) => x.name === name);
    if (!constraintsIntersect(declarations)) {
      issues.push({
        kind: "constraint-conflict",
        message: `Conflicting ${name} declarations: ${declarations.map((x) => `${x.source} (${x.constraint})`).join(", ")}`,
      });
      continue;
    }
    const actual = (options.resolveRuntime || defaultResolveRuntime)(name, env);
    resolved.push({ name, ...actual });
    if (!actual.found || declarations.some((x) => !satisfies(actual.version, x.constraint)))
      issues.push({
        kind: "runtime-mismatch",
        message: `${name} expected ${declarations.map((x) => `${x.constraint} from ${x.source}`).join(" and ")}; resolved ${actual.version || "missing"} at ${actual.realpath || actual.path || "PATH"}. Install/select the declared runtime.`,
      });
  }
  for (const probe of expectations.probes || []) {
    try {
      validateProbeDeclaration(probe);
      const output = (options.probeRunner || defaultProbeRunner)(probe, { env, cwd: options.cwd });
      const json = JSON.stringify(output);
      if (Buffer.byteLength(json) > 8192) throw new Error("probe output exceeded limit");
      if (
        !output ||
        typeof output !== "object" ||
        Array.isArray(output) ||
        Object.keys(output).some((x) => !ALLOWED_EXPECTED.has(x) || typeof output[x] !== "string")
      )
        throw new Error("probe returned malformed fields");
      for (const [key, expected] of Object.entries(probe.expected))
        if (output[key] !== expected)
          throw new Error(
            `service target mismatch for ${key}: expected ${expected}, resolved ${output[key]}`
          );
      services.push(keyedIdentity(output, options.identityKey || Buffer.alloc(32, 0)));
    } catch (error) {
      issues.push({ kind: "probe-failure", message: redactText(error.message) });
    }
  }
  const identity = identityFor(resolved, env, services);
  if (
    options.requireIdentity &&
    JSON.stringify(stable(options.requireIdentity)) !== JSON.stringify(stable(identity))
  )
    issues.push({
      kind: "environment-drift",
      message: "Resolved runtime, shim, PATH, or allowlisted environment changed after preflight",
    });
  const status = issues.length
    ? "blocked"
    : local.length || (expectations.probes || []).length
      ? "verified"
      : "unverified";
  return { schema_version: 1, status, identity, issues };
}

function main(argv = process.argv.slice(2)) {
  const planFlag = argv.indexOf("--plan");
  if (planFlag < 0 || !argv[planFlag + 1]) throw new Error("--plan PATH is required");
  const plan = JSON.parse(fs.readFileSync(path.resolve(argv[planFlag + 1]), "utf8"));
  const result = verifyEnvironment(plan);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "blocked") process.exitCode = 1;
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${redactText(error.message)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  verifyEnvironment,
  validateProbeDeclaration,
  keyedIdentity,
  redactText,
  satisfies,
  constraintsIntersect,
  defaultProbeRunner,
  identityFor,
};
