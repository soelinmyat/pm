#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { stable, digest } = require("./lib/repository-gate-plan-schema");
const { stableObjectHmac } = require("./lib/stable-authentication");
const semverRange = require("./lib/semver-range");

const ALLOWED_PROBE_KEYS = new Set([
  "adapter",
  "provenance",
  "expected",
  "timeout_ms",
  "working_directory",
]);
const ALLOWED_EXPECTED = new Set(["database", "server", "user"]);
const EXECUTABLE_DISCOVERY_BUDGET_MS = 5000;

function redactText(value) {
  const redacted = String(value)
    .replace(/(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s]+/gi, "[REDACTED_DSN]")
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(password\s*=\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(token|secret|credential|api[_-]?key|auth)(\s*[=:]\s*)[^\s]+/gi, "$1$2[REDACTED]");
  return Buffer.from(redacted).subarray(0, 8188).toString("utf8");
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value))
    return value.slice(0, 64).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 64)
        .map(([key, item]) => [key, sanitizeDiagnosticValue(item, depth + 1)])
    );
  return value;
}

function validateProbeDeclaration(probe) {
  if (!probe || typeof probe !== "object" || Array.isArray(probe))
    throw new Error("probe must be an object");
  if (probe.adapter !== "postgres-identity-v1") throw new Error("probe adapter is not supported");
  if (probe.provenance !== "authenticated")
    throw new Error("probe requires authenticated provenance");
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

function satisfies(versionText, constraintText) {
  return semverRange.satisfies(versionText, constraintText);
}

function constraintsIntersect(constraints) {
  if (constraints.length < 2) return true;
  return semverRange.rangesIntersect(constraints.map((item) => item.constraint));
}

function resolveExecutableVersion(name, env, timeoutMs, options = {}) {
  const now = options.now || Date.now;
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const realpathSync = options.realpathSync || fs.realpathSync;
  const deadline = now() + Math.max(0, timeoutMs);
  const missing = (reason = "missing") => ({
    found: false,
    path: null,
    realpath: null,
    version: null,
    reason,
  });
  if (timeoutMs < 1) return missing("discovery-timeout");
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 8192,
  });
  if (which.error?.code === "ETIMEDOUT") return missing("discovery-timeout");
  if (which.status !== 0 || !which.stdout.trim()) return missing();
  const executablePath = which.stdout.trim().split(/\r?\n/)[0];
  let realpath;
  try {
    realpath = realpathSync(executablePath);
  } catch {
    return missing("identity-unavailable");
  }
  const remaining = deadline - now();
  if (remaining < 1) return missing("discovery-timeout");
  const version = spawnSync(realpath, ["--version"], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: remaining,
    maxBuffer: 8192,
  });
  if (version.error?.code === "ETIMEDOUT") return missing("discovery-timeout");
  try {
    if (realpathSync(executablePath) !== realpath) return missing("identity-drift");
  } catch {
    return missing("identity-drift");
  }
  return {
    found: version.status === 0,
    path: executablePath,
    realpath,
    version: String(version.stdout || version.stderr).trim(),
    reason: version.status === 0 ? null : "version-failed",
  };
}

function defaultResolveRuntime(name, env, options = {}) {
  const executable = resolveExecutableVersion(
    name,
    env,
    options.timeoutMs ?? EXECUTABLE_DISCOVERY_BUDGET_MS
  );
  return {
    ...executable,
    version: executable.version?.replace(/^v/, "") || null,
    manager: "path",
  };
}

function defaultProbeRunner(probe, options = {}) {
  validateProbeDeclaration(probe);
  const env = {};
  for (const name of ["PATH", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGSSLMODE"])
    if (options.env?.[name] !== undefined) env[name] = options.env[name];
  const result = (options.spawnSync || childProcess.spawnSync)(
    options.executable?.realpath || options.executable?.path || "psql",
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
    throw new Error("probe process failed; details redacted");
  if (Buffer.byteLength(result.stdout || "") > 8192) throw new Error("probe output exceeded limit");
  const fields = String(result.stdout).trim().split("|");
  if (fields.length !== 3) throw new Error("probe returned malformed fields");
  return { database: fields[0], user: fields[1], server: fields[2] };
}

function keyedIdentity(value, key) {
  const identity = stableObjectHmac(value, key);
  if (!identity) throw new Error("machine-local identity secret must be at least 32 bytes");
  return identity;
}
function identityFor(resolved, env, services = [], probeExecutables = []) {
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
    probe_executables: probeExecutables,
  };
}

function defaultResolveProbeExecutable(env, options = {}) {
  const executable = resolveExecutableVersion(
    "psql",
    env,
    options.timeoutMs ?? EXECUTABLE_DISCOVERY_BUDGET_MS
  );
  return {
    ...executable,
    version: executable.version ? redactText(executable.version) : null,
  };
}

function verifyEnvironment(plan, options = {}) {
  const now = options.now || Date.now;
  const expectations = plan.expectations || { runtimes: [], probes: [] },
    env = options.env || process.env,
    issues = [],
    resolved = [],
    services = [],
    probeExecutables = [],
    probeExecutableCache = new Map(),
    discoveryDeadline = now() + (options.discoveryBudgetMs ?? EXECUTABLE_DISCOVERY_BUDGET_MS);
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
    const actual = (options.resolveRuntime || defaultResolveRuntime)(name, env, {
      timeoutMs: Math.max(0, discoveryDeadline - now()),
    });
    resolved.push({ name, ...actual });
    if (!actual.found || declarations.some((x) => !satisfies(actual.version, x.constraint)))
      issues.push({
        kind: "runtime-mismatch",
        message:
          actual.reason === "discovery-timeout"
            ? `${name} executable discovery exceeded the bounded preflight budget`
            : `${name} expected ${declarations.map((x) => `${x.constraint} from ${x.source}`).join(" and ")}; resolved ${actual.version || "missing"} at ${actual.realpath || actual.path || "PATH"}. Install/select the declared runtime.`,
      });
  }
  for (const probe of expectations.probes || []) {
    try {
      validateProbeDeclaration(probe);
      if (!options.identityKey) throw new Error("machine-local identity secret is required");
      if (!probeExecutableCache.has(probe.adapter)) {
        try {
          const executable = (options.resolveProbeExecutable || defaultResolveProbeExecutable)(
            env,
            {
              timeoutMs: Math.max(0, discoveryDeadline - now()),
            }
          );
          if (!executable?.found || !executable.realpath || !executable.version)
            throw new Error(
              executable?.reason === "discovery-timeout"
                ? "probe executable discovery exceeded the bounded preflight budget"
                : "probe executable identity could not be verified"
            );
          probeExecutableCache.set(probe.adapter, { executable });
          probeExecutables.push({
            adapter: probe.adapter,
            path: executable.path,
            realpath: executable.realpath,
            version: executable.version,
          });
        } catch (error) {
          probeExecutableCache.set(probe.adapter, { error: error.message });
        }
      }
      const cached = probeExecutableCache.get(probe.adapter);
      if (cached.error) throw new Error(cached.error);
      const executable = cached.executable;
      const output = (options.probeRunner || defaultProbeRunner)(probe, {
        env,
        cwd: options.cwd,
        executable,
      });
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
          throw new Error(`service target mismatch for ${key}; identities redacted`);
      services.push(keyedIdentity(output, options.identityKey));
    } catch (error) {
      issues.push({ kind: "probe-failure", message: redactText(error.message) });
    }
  }
  const identity = identityFor(resolved, env, services, probeExecutables);
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
  return sanitizeDiagnosticValue({ schema_version: 1, status, identity, issues });
}

function main(argv = process.argv.slice(2)) {
  const planFlag = argv.indexOf("--plan");
  if (planFlag < 0 || !argv[planFlag + 1]) throw new Error("--plan PATH is required");
  const plan = JSON.parse(fs.readFileSync(path.resolve(argv[planFlag + 1]), "utf8"));
  const result = verifyEnvironment(plan, {
    identityKey: process.env.PM_REPOSITORY_IDENTITY_KEY,
  });
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
  resolveExecutableVersion,
  identityFor,
  defaultResolveProbeExecutable,
  sanitizeDiagnosticValue,
};
