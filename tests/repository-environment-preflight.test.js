"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  verifyEnvironment,
  validateProbeDeclaration,
  keyedIdentity,
  redactText,
  satisfies,
} = require("../scripts/repository-environment-preflight");

function basePlan(overrides = {}) {
  return {
    expectations: {
      runtimes: [{ name: "node", constraint: "24.4.1", source: ".nvmrc", scope: "local" }],
      probes: [],
    },
    environment_identity: { path_digest: "old", allowlisted_env_digest: "old" },
    ...overrides,
  };
}

test("missing declared Node 24.4.1 blocks even when PATH resolves Node 20", () => {
  const result = verifyEnvironment(basePlan(), {
    resolveRuntime: () => ({
      found: true,
      path: "/usr/bin/node",
      realpath: "/usr/bin/node",
      version: "20.19.0",
      manager: "path",
    }),
    env: { PATH: "/usr/bin" },
  });
  assert.equal(result.status, "blocked");
  assert.match(result.issues[0].message, /24\.4\.1/);
  assert.match(result.issues[0].message, /20\.19\.0/);
});

test("intersects ranges and blocks conflicting declarations with all sources", () => {
  const plan = basePlan({
    expectations: {
      runtimes: [
        { name: "node", constraint: ">=24 <25", source: ".nvmrc", scope: "local" },
        { name: "node", constraint: "^20.0.0", source: "package.json#engines", scope: "local" },
      ],
      probes: [],
    },
  });
  const result = verifyEnvironment(plan, {
    resolveRuntime: () => ({ found: true, path: "/node", realpath: "/node", version: "24.4.1" }),
    env: {},
  });
  assert.equal(result.status, "blocked");
  assert.match(result.issues[0].message, /\.nvmrc/);
  assert.match(result.issues[0].message, /package\.json/);
});

test("CI-only declarations do not constrain local delivery", () => {
  const plan = basePlan({
    expectations: {
      runtimes: [
        { name: "node", constraint: "24", source: ".github/workflows/ci.yml", scope: "ci" },
      ],
      probes: [],
    },
  });
  assert.equal(
    verifyEnvironment(plan, {
      resolveRuntime: () => ({ found: true, path: "/node", realpath: "/node", version: "20.0.0" }),
      env: {},
    }).status,
    "unverified"
  );
});

test("absent declarations are unverified rather than guessed", () => {
  const result = verifyEnvironment(basePlan({ expectations: { runtimes: [], probes: [] } }), {
    env: {},
  });
  assert.equal(result.status, "unverified");
});

test("candidate-authored probes and bypass policy cannot self-authorize", () => {
  const plan = basePlan({
    expectations: {
      runtimes: [],
      probes: [
        {
          adapter: "postgres-identity-v1",
          provenance: "candidate",
          expected: { database: "prod" },
        },
      ],
    },
  });
  const result = verifyEnvironment(plan, { env: {}, probeRunner: () => ({ database: "prod" }) });
  assert.equal(result.status, "blocked");
  assert.match(result.issues[0].message, /protected|approved|authenticated/);
});

test("rejects shell, destructive, interactive, unknown, and malformed probe declarations", () => {
  for (const declaration of [
    { adapter: "shell", command: "rm -rf /" },
    { adapter: "postgres-identity-v1", interactive: true },
    { adapter: "postgres-identity-v1", query: "DROP DATABASE x" },
    { adapter: "postgres-identity-v1", extra: true },
    { adapter: "postgres-identity-v1", provenance: "authenticated", expected: {} },
  ])
    assert.throws(() => validateProbeDeclaration(declaration), /probe/i);
});

test("wrong Postgres target, timeout, oversized output, probe failure, and secret output block redacted", () => {
  const plan = basePlan({
    expectations: {
      runtimes: [],
      probes: [
        {
          adapter: "postgres-identity-v1",
          provenance: "authenticated",
          expected: { database: "cleanlog_test", server: "local" },
        },
      ],
    },
  });
  const wrong = verifyEnvironment(plan, {
    env: {},
    identityKey: Buffer.alloc(32, 8),
    resolveProbeExecutable: () => ({
      found: true,
      path: "/usr/bin/psql",
      realpath: "/usr/bin/psql",
      version: "16.2",
    }),
    probeRunner: () => ({ database: "production", server: "remote" }),
  });
  assert.equal(wrong.status, "blocked");
  const failed = verifyEnvironment(plan, {
    env: {},
    identityKey: Buffer.alloc(32, 8),
    resolveProbeExecutable: () => ({
      found: true,
      path: "/usr/bin/psql",
      realpath: "/usr/bin/psql",
      version: "16.2",
    }),
    probeRunner: () => {
      const error = new Error("password=hunter2 postgresql://u:secret@db/x");
      error.code = "ETIMEDOUT";
      throw error;
    },
  });
  assert.equal(failed.status, "blocked");
  assert.doesNotMatch(JSON.stringify(failed), /hunter2|secret@/);
  const huge = verifyEnvironment(plan, {
    env: {},
    identityKey: Buffer.alloc(32, 8),
    resolveProbeExecutable: () => ({
      found: true,
      path: "/usr/bin/psql",
      realpath: "/usr/bin/psql",
      version: "16.2",
    }),
    probeRunner: () => ({ database: "x".repeat(9000), server: "local" }),
  });
  assert.equal(huge.status, "blocked");
});

test("probe identity requires a machine-local secret and binds executable realpath/version", () => {
  const plan = basePlan({
    expectations: {
      runtimes: [],
      probes: [
        {
          adapter: "postgres-identity-v1",
          provenance: "authenticated",
          expected: { database: "test" },
        },
      ],
    },
  });
  const common = {
    env: {},
    resolveProbeExecutable: () => ({
      found: true,
      path: "/shim/psql",
      realpath: "/opt/pgsql/16/bin/psql",
      version: "16.2",
    }),
    probeRunner: () => ({ database: "test" }),
  };
  assert.equal(verifyEnvironment(plan, common).status, "blocked");
  const verified = verifyEnvironment(plan, { ...common, identityKey: Buffer.alloc(32, 9) });
  assert.equal(verified.status, "verified");
  assert.deepEqual(verified.identity.probe_executables, [
    {
      adapter: "postgres-identity-v1",
      path: "/shim/psql",
      realpath: "/opt/pgsql/16/bin/psql",
      version: "16.2",
    },
  ]);
});

test("caret constraints honor semver zero-major compatibility", () => {
  assert.equal(satisfies("0.2.9", "^0.2.3"), true);
  assert.equal(satisfies("0.3.0", "^0.2.3"), false);
  assert.equal(satisfies("1.0.0", "^0.2.3"), false);
});

test("redaction covers bearer and authorization values", () => {
  const redacted = redactText(
    `Authorization: Bearer abc token=xyz postgresql://u:p@db/prod ${"🧪".repeat(9000)}`
  );
  assert.doesNotMatch(redacted, /abc|xyz|u:p/);
  assert.ok(Buffer.byteLength(redacted) <= 8192);
});

test("runtime-controlled constraint, version, and path diagnostics are redacted and bounded", () => {
  const result = verifyEnvironment(
    basePlan({
      expectations: {
        runtimes: [
          {
            name: "node",
            constraint: "token=constraint-secret",
            source: "Authorization: Bearer source-secret",
            scope: "local",
          },
        ],
        probes: [],
      },
    }),
    {
      env: {},
      resolveRuntime: () => ({
        found: true,
        path: "/tmp/token=path-secret",
        realpath: "/tmp/token=real-secret",
        version: "Bearer version-secret",
      }),
    }
  );
  const output = JSON.stringify(result);
  assert.equal(result.status, "blocked");
  assert.doesNotMatch(
    output,
    /constraint-secret|source-secret|path-secret|real-secret|version-secret/
  );
  assert.ok(Buffer.byteLength(output) <= 8192);
});

test("keyed service identity is stable without persisting secrets", () => {
  const one = keyedIdentity({ database: "cleanlog", server: "local" }, Buffer.alloc(32, 7));
  const two = keyedIdentity({ server: "local", database: "cleanlog" }, Buffer.alloc(32, 7));
  assert.equal(one, two);
  assert.match(one, /^hmac-sha256:/);
  assert.doesNotMatch(one, /cleanlog|local/);
  assert.equal(
    redactText("postgresql://alice:secret@db/prod password=hunter2"),
    "[REDACTED_DSN] password=[REDACTED]"
  );
});

test("PATH, shim, or allowlisted env retarget after preflight blocks stale execution", () => {
  const first = verifyEnvironment(basePlan(), {
    resolveRuntime: () => ({
      found: true,
      path: "/shim/node",
      realpath: "/opt/node24",
      version: "24.4.1",
      manager: "mise",
    }),
    env: { PATH: "/shim", NODE_ENV: "test" },
  });
  assert.equal(first.status, "verified");
  const second = verifyEnvironment(
    { ...basePlan(), environment_identity: first.identity },
    {
      resolveRuntime: () => ({
        found: true,
        path: "/shim/node",
        realpath: "/opt/node20",
        version: "20.0.0",
        manager: "mise",
      }),
      env: { PATH: "/other", NODE_ENV: "production" },
      requireIdentity: first.identity,
    }
  );
  assert.equal(second.status, "blocked");
});
