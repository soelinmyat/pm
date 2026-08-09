"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const {
  constraintsIntersect,
  defaultProbeRunner,
  verifyEnvironment,
  validateProbeDeclaration,
  keyedIdentity,
  redactText,
  satisfies,
} = require("../scripts/repository-environment-preflight");
const { stableObjectHmac } = require("../scripts/lib/stable-authentication");

test("constraint intersection is independent of comparator order", () => {
  assert.equal(
    constraintsIntersect([{ constraint: "<20 >=18" }, { constraint: "<20 >=19" }]),
    true
  );
});

test("runtime matching uses standard semver ranges including OR and x-ranges", () => {
  assert.equal(satisfies("20.1.0", "^18.18.0 || >=20.0.0"), true);
  assert.equal(satisfies("19.2.0", "^18.18.0 || >=20.0.0"), false);
  assert.equal(satisfies("20.7.1", "20.x"), true);
  assert.equal(
    constraintsIntersect([{ constraint: ">=18 <19 || >=20 <21" }, { constraint: ">=20.5 <21" }]),
    true
  );
  assert.equal(
    constraintsIntersect([{ constraint: ">=18 <19 || >=20 <21" }, { constraint: ">=19 <20" }]),
    false
  );
});

test("runtime range checks remain source-only in installed plugin copies", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../scripts/repository-environment-preflight.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /require\(["']semver["']\)/);
  assert.equal(satisfies("18.19.1", "18.18.0 - 18.20.0"), true);
  assert.equal(satisfies("18.21.0", "18.18.0 - 18.20.0"), false);
  assert.equal(satisfies("2.4.9", "~2.4"), true);
  assert.equal(satisfies("2.5.0", "~2.4"), false);
  assert.equal(satisfies("1.5.0", "~1.x"), true);
  assert.equal(satisfies("2.0.0", "~1.x"), false);
  assert.equal(satisfies("0.5.0", "~0.x"), true);
  assert.equal(satisfies("1.0.0", "~0.x"), false);
  assert.equal(satisfies("0.5.0", "^0"), true);
  assert.equal(satisfies("0.0.5", "^0.0"), true);
  assert.equal(satisfies("0.5.0", "^0.x"), true);
  assert.equal(satisfies("1.0.0", "^0.x"), false);
  assert.equal(satisfies("0.0.5", "^0.0.x"), true);
  assert.equal(satisfies("0.1.0", "^0.0.x"), false);
  assert.equal(satisfies("20.0.0-rc.1", ">=18 <21"), false);
  assert.equal(satisfies("1.2.3-beta.2", ">=1.2.3-beta.1 <2"), true);
  assert.equal(satisfies("1.3.0-beta.1", ">=1.2.3-beta.1 <2"), false);
  assert.equal(satisfies("1.2.3-01", "1.2.3-01"), false);
  assert.equal(satisfies("1.2.3-alpha..1", "1.2.3-alpha..1"), false);
  assert.equal(satisfies("1.2.3+build..x", "1.2.3+build..x"), false);
  assert.equal(satisfies("1.5.0", "1-alpha"), false);
  assert.equal(satisfies("1.2.0", "1.2-beta"), false);
  assert.equal(satisfies("1.5.0", "1.x-alpha"), false);
  assert.equal(satisfies("1.2.5", "1.2.x-alpha"), true);
  assert.equal(satisfies("1.2.5", "^1.2.x-alpha"), true);
  assert.equal(satisfies("1.2.5", "~1.2.x-alpha"), true);
  assert.equal(satisfies("1.2.5", ">=1.2.x-alpha"), true);
  assert.equal(satisfies("1.2.0-alpha", "1.2.x-alpha"), false);
  assert.equal(satisfies("1.2.0-alpha", "^1.2.x-alpha >=1.2.0-alpha"), false);
  assert.equal(satisfies("0.0.0", ">*"), false);
  assert.equal(satisfies("1.0.0", "<x"), false);
  assert.equal(satisfies("1.0.0", ">=*"), true);
  assert.equal(satisfies("1.5.0", ">* || >=1"), true);
  assert.equal(satisfies("1.2.3", "<x || 1.2.3"), true);
  assert.equal(satisfies("9007199254740992.0.0", "*"), false);
  assert.equal(satisfies("1.2.3-9007199254740992", ">1.2.3-9007199254740991"), true);
  assert.equal(satisfies("1.2.3-9007199254740992", ">1.2.3-9007199254740993"), false);
  assert.equal(satisfies("1.2.3-Z", "<1.2.3-a"), true);
  assert.equal(satisfies("2.0.0-alpha", "^1 <2.0.0-beta"), false);
  assert.equal(satisfies("1.0.0-alpha", ">=1.0.0-alpha <1.x"), false);
  assert.equal(satisfies("2.0.0-alpha", ">1.x <2.0.0-beta"), false);
  assert.equal(satisfies("1.4.0", ">= 1.2.3"), true);
  assert.equal(constraintsIntersect([{ constraint: "^0" }, { constraint: "0.5.x" }]), true);
  assert.equal(constraintsIntersect([{ constraint: "^0.0.x" }, { constraint: "^0.0.3" }]), true);
  assert.equal(
    constraintsIntersect([{ constraint: ">1.2.3-beta" }, { constraint: "<1.2.3-alpha" }]),
    false
  );
  assert.equal(
    constraintsIntersect([{ constraint: ">=1.2.3-alpha" }, { constraint: "<1.2.3-beta" }]),
    true
  );
  assert.equal(
    constraintsIntersect([{ constraint: ">1.2.3-beta" }, { constraint: "<1.2.3-beta.0" }]),
    false
  );
  assert.equal(
    constraintsIntersect([{ constraint: ">1.2.3-beta" }, { constraint: "<1.2.3-beta.0.0" }]),
    true
  );
  assert.equal(
    constraintsIntersect([{ constraint: ">=18 <19" }, { constraint: "18.1.0-beta.1" }]),
    false
  );
});

test("production preflight CLI passes the configured machine-local probe identity key", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-preflight-cli-probe-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const psql = path.join(root, "psql");
  fs.writeFileSync(
    psql,
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'psql 16.2'; else echo 'cleanlog_test|tester|local'; fi\n",
    { mode: 0o700 }
  );
  const planPath = path.join(root, "plan.json");
  fs.writeFileSync(
    planPath,
    JSON.stringify({
      expectations: {
        runtimes: [],
        probes: [
          {
            adapter: "postgres-identity-v1",
            provenance: "authenticated",
            expected: { database: "cleanlog_test", user: "tester", server: "local" },
          },
        ],
      },
    })
  );
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "../scripts/repository-environment-preflight.js"), "--plan", planPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH || ""}`,
        PM_REPOSITORY_IDENTITY_KEY: "machine-local-probe-key-32-bytes!",
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "verified");
});

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
  assert.doesNotMatch(JSON.stringify(wrong), /cleanlog_test|production|local|remote/);
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

test("Postgres process failures never expose connection identities", () => {
  const probe = {
    adapter: "postgres-identity-v1",
    provenance: "authenticated",
    expected: { database: "expected-db" },
  };
  assert.throws(
    () =>
      defaultProbeRunner(probe, {
        spawnSync: () => ({
          status: 2,
          stderr:
            'psql: connection to server "db.internal" (10.0.0.5) failed: database "secret-db" user "secret-user"',
        }),
      }),
    (error) => {
      assert.match(error.message, /probe process failed/);
      assert.doesNotMatch(error.message, /db\.internal|10\.0\.0\.5|secret-db|secret-user/);
      return true;
    }
  );
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

test("probe executable identity is resolved once per adapter", () => {
  const probe = {
    adapter: "postgres-identity-v1",
    provenance: "authenticated",
    expected: { database: "test" },
  };
  let resolutions = 0;
  const result = verifyEnvironment(
    basePlan({ expectations: { runtimes: [], probes: [probe, probe] } }),
    {
      env: {},
      identityKey: Buffer.alloc(32, 9),
      resolveProbeExecutable: () => {
        resolutions += 1;
        return {
          found: true,
          path: "/shim/psql",
          realpath: "/opt/pgsql/16/bin/psql",
          version: "16.2",
        };
      },
      probeRunner: () => ({ database: "test" }),
    }
  );
  assert.equal(result.status, "verified");
  assert.equal(resolutions, 1);
  assert.equal(result.identity.probe_executables.length, 1);
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
    one,
    stableObjectHmac({ database: "cleanlog", server: "local" }, Buffer.alloc(32, 7))
  );
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
