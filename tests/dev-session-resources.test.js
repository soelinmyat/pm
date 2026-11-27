"use strict";

// Every path these tests register, remove or sweep is created by the tests in
// temporary directories. Nothing here runs close or the sweep against a real
// repository or session.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const {
  buildContext,
  closeLedger,
  validateResources,
} = require("../scripts/lib/dev-session-resources");
const { createSession, validateSession } = require("../scripts/lib/dev-session-schema");

const CLI = path.resolve(__dirname, "..", "scripts", "dev-session.js");
let Ajv2020 = null;
let addFormats = null;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch {
  // Optional dev dependency.
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-resources-")));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  git(root, ["add", "README.md", ".gitignore"]);
  git(root, ["commit", "-m", "fixture"]);
  const scratchRoots = [];
  return {
    root,
    run(args, options = {}) {
      return spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        ...options,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: path.join(root, ".test-config"),
          PM_EXECUTION_POLICY_FILE: "",
          ...options.env,
        },
      });
    },
    init(slug) {
      const result = this.run(["init", "--slug", slug, "--source-dir", root, "--json"]);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).session_path;
    },
    scratch(prefix = "pm-res-scratch-") {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
      scratchRoots.push(dir);
      return dir;
    },
    cleanup() {
      for (const dir of scratchRoots) fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function add(repo, sessionPath, extra, options) {
  return repo.run(
    ["resource-add", "--session", sessionPath, "--created-by", "test", ...extra, "--json"],
    options
  );
}

function addOk(repo, sessionPath, extra, options) {
  const result = add(repo, sessionPath, extra, options);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).resource;
}

function close(repo, sessionPath, extra = [], options) {
  const result = repo.run(["close", "--session", sessionPath, ...extra, "--json"], options);
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function completeSession(repo, sessionPath) {
  const session = readJson(sessionPath);
  session.phase = "retro";
  session.routing.required_phases = ["retro"];
  session.routing.required_gates = [];
  fs.writeFileSync(sessionPath, JSON.stringify(session));
  const resultPath = path.join(repo.root, `${session.slug}-retro.json`);
  fs.writeFileSync(
    resultPath,
    JSON.stringify({
      schema_version: 1,
      run_id: session.run_id,
      phase: "retro",
      attempt: 1,
      status: "passed",
      summary: "Retro complete",
      commit: null,
      files_changed: [],
      evidence: [{ kind: "retro", command: "retro", exit_code: 0, artifact: null }],
      blocker: null,
      runtime: { provider: "inline", model: "test", reasoning: "high" },
    })
  );
  const recorded = repo.run(["record", "--session", sessionPath, "--result", resultPath, "--json"]);
  assert.equal(recorded.status, 0, recorded.stderr);
  return JSON.parse(recorded.stdout);
}

function startDetachedSleep(seconds = 60) {
  // The shell exits at once, so the sleep is reparented and never lingers as
  // an unreaped child of this test process.
  const pid = Number(
    execFileSync("sh", ["-c", `sleep ${seconds} >/dev/null 2>&1 & echo $!`], {
      encoding: "utf8",
    }).trim()
  );
  assert.ok(pid > 1);
  return pid;
}

function alive(pid) {
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  const stat = (result.stdout || "").trim();
  return stat !== "" && !stat.startsWith("Z");
}

function waitDead(pid) {
  for (let i = 0; i < 100 && alive(pid); i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return !alive(pid);
}

function killQuietly(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

function entry(overrides = {}) {
  return {
    id: "res_0123456789abcdef",
    kind: "directory",
    removal: "remove-directory",
    path: path.join(os.tmpdir(), "pm-dev-example"),
    created_by: "implementation",
    created_at: "2026-11-27T00:00:00.000Z",
    label: null,
    status: "registered",
    removed_at: null,
    last_close: null,
    ...overrides,
  };
}

test("the ledger schema accepts typed entries and rejects free-form or malformed ones", () => {
  const repo = makeRepo();
  try {
    const session = createSession({ slug: "schema", sourceDir: repo.root });
    assert.deepEqual(validateSession(session), [], "a session without a ledger stays valid");
    assert.equal(Object.hasOwn(session, "resources"), false, "new sessions carry no ledger");

    const valid = [
      entry(),
      entry({
        id: "res_1123456789abcdef",
        kind: "worktree",
        removal: "git-worktree-remove",
        path: path.join(repo.root, ".worktrees", "x"),
        branch: "feat/x",
      }),
      (() => {
        const value = entry({
          id: "res_2123456789abcdef",
          kind: "process",
          removal: "terminate-process",
          pid: 4242,
          started_at: "Fri Nov 27 10:00:00 2026",
          command: "node server.js",
          status: "gone",
          removed_at: "2026-11-27T01:00:00.000Z",
          last_close: {
            at: "2026-11-27T01:00:00.000Z",
            outcome: "gone",
            reason: "has exited",
            bytes_freed: 0,
          },
        });
        delete value.path;
        return value;
      })(),
      (() => {
        const value = entry({
          id: "res_3123456789abcdef",
          kind: "database",
          removal: "declared-teardown",
          identifier: "app_test_42",
          teardown: "drop-test-db",
        });
        delete value.path;
        return value;
      })(),
    ];
    const withLedger = { ...session, resources: valid };
    assert.deepEqual(validateSession(withLedger), []);

    const invalid = {
      "unknown kind": [entry({ kind: "docker-image" })],
      "free-form command": [entry({ command: "rm -rf /" })],
      "removal does not match kind": [entry({ removal: "declared-teardown" })],
      "relative path": [entry({ path: "tmp/x" })],
      "unnormalized path": [entry({ path: "/tmp/a/../b" })],
      "duplicate ids": [entry(), entry({ path: "/tmp/other" })],
      "removed without removed_at": [entry({ status: "removed" })],
      "registered with removed_at": [entry({ removed_at: "2026-11-27T00:00:00.000Z" })],
      "bad last_close outcome": [
        entry({
          last_close: {
            at: "2026-11-27T00:00:00.000Z",
            outcome: "deleted",
            reason: "x",
            bytes_freed: 0,
          },
        }),
      ],
      "pid one": [
        (() => {
          const value = entry({
            kind: "process",
            removal: "terminate-process",
            pid: 1,
            started_at: "x",
            command: "init",
          });
          delete value.path;
          return value;
        })(),
      ],
      "option-like identifier": [
        (() => {
          const value = entry({
            kind: "database",
            removal: "declared-teardown",
            identifier: "--all",
            teardown: "drop",
          });
          delete value.path;
          return value;
        })(),
      ],
      "not an array": { not: "array" },
    };
    for (const [name, resources] of Object.entries(invalid)) {
      const errors = [];
      validateResources(resources, errors);
      assert.ok(errors.length > 0, `${name} must be rejected`);
      assert.ok(validateSession({ ...session, resources }).length > 0, `${name} via session`);
    }

    if (Ajv2020 && addFormats) {
      const schema = readJson(
        path.resolve(__dirname, "..", "skills", "dev", "references", "dev-session.schema.json")
      );
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      assert.equal(validate(session), true, JSON.stringify(validate.errors));
      assert.equal(validate(withLedger), true, JSON.stringify(validate.errors));
      for (const name of [
        "unknown kind",
        "free-form command",
        "removal does not match kind",
        "relative path",
        "pid one",
        "option-like identifier",
        "not an array",
      ]) {
        assert.equal(validate({ ...session, resources: invalid[name] }), false, name);
      }
    }
  } finally {
    repo.cleanup();
  }
});

test("registration refuses paths outside the allowed roots or protected by the run", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("register");
    const scratch = repo.scratch();
    const target = path.join(scratch, "build");
    fs.mkdirSync(target);
    const fakeHome = repo.scratch("pm-res-home-");

    const refusals = {
      "symlink path": (() => {
        const link = path.join(scratch, "link");
        fs.symlinkSync(target, link, "dir");
        return [link, /symlink/];
      })(),
      "symlink escape": (() => {
        const escape = path.join(scratch, "escape");
        fs.symlinkSync(repo.root, escape, "dir");
        return [escape, /symlink/];
      })(),
      "dot-dot into the repository": [
        `${scratch}/../${path.basename(repo.root)}`,
        /repository root/,
      ],
      "dot-dot below the repository": [
        `${scratch}/../${path.basename(repo.root)}/.git/..`,
        /repository root/,
      ],
      "symlinked parent into the repository": (() => {
        const escape = path.join(scratch, "via-parent");
        fs.symlinkSync(repo.root, escape, "dir");
        return [path.join(escape, ".git"), /git worktree of this repository/];
      })(),
      "symlinked parent out of the temporary roots": (() => {
        const escape = path.join(scratch, "via-usr");
        fs.symlinkSync("/usr", escape, "dir");
        return [path.join(escape, "bin"), /outside the allowed temporary roots/];
      })(),
      "repository root": [repo.root, /repository root/],
      "inside the repository": [path.join(repo.root, ".git"), /git worktree of this repository/],
      "session evidence folder": [path.dirname(sessionPath), /evidence folder|PM state/],
      "home directory": [fakeHome, /home directory/],
      "temporary root itself": [
        fs.realpathSync(os.tmpdir()),
        /home directory|repository root|temporary root/,
      ],
      "outside the temporary roots": ["/usr", /outside the allowed temporary roots/],
      "filesystem root": ["/", /filesystem root/],
      "shared cache": (() => {
        const cache = path.join(scratch, "node_modules");
        fs.mkdirSync(cache);
        return [cache, /shared cache/];
      })(),
    };
    for (const [name, [candidate, pattern]] of Object.entries(refusals)) {
      const result = add(repo, sessionPath, ["--kind", "directory", "--path", candidate], {
        env: { HOME: fakeHome },
      });
      assert.equal(result.status, 3, `${name}: ${result.stdout}${result.stderr}`);
      assert.match(result.stderr, pattern, name);
    }
    const fromInside = add(repo, sessionPath, ["--kind", "directory", "--path", target], {
      cwd: target,
    });
    assert.equal(fromInside.status, 3, fromInside.stderr);
    assert.match(fromInside.stderr, /running from/);
    assert.equal(readJson(sessionPath).resources, undefined, "refusals write nothing");

    const registered = addOk(repo, sessionPath, ["--kind", "directory", "--path", target]);
    assert.equal(registered.path, target);
    assert.equal(registered.removal, "remove-directory");
    assert.equal(registered.status, "registered");
    const again = addOk(repo, sessionPath, ["--kind", "directory", "--path", target]);
    assert.equal(again.id, registered.id, "registration is idempotent");
    assert.equal(readJson(sessionPath).resources.length, 1);

    const listed = repo.run(["resources", "--session", sessionPath, "--json"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(
      JSON.parse(listed.stdout).resources.map((item) => item.id),
      [registered.id]
    );

    const freeForm = repo.run([
      "resource-add",
      "--session",
      sessionPath,
      "--created-by",
      "test",
      "--kind",
      "directory",
      "--path",
      target,
      "--teardown",
      "rm",
    ]);
    assert.equal(freeForm.status, 2, "built-in kinds take no teardown");
    const missingTarget = repo.run([
      "resource-add",
      "--session",
      sessionPath,
      "--created-by",
      "test",
      "--kind",
      "database",
    ]);
    assert.equal(missingTarget.status, 2);
  } finally {
    repo.cleanup();
  }
});

test("close removes directories, reports bytes, never follows symlinks and is idempotent", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("close-dirs");
    const scratch = repo.scratch();
    const outside = repo.scratch("pm-res-outside-");
    fs.writeFileSync(path.join(outside, "keep.txt"), "must survive");
    fs.writeFileSync(path.join(scratch, "a.bin"), Buffer.alloc(4096));
    fs.mkdirSync(path.join(scratch, "nested"));
    fs.writeFileSync(path.join(scratch, "nested", "b.txt"), "0123456789");
    fs.symlinkSync(outside, path.join(scratch, "outside-link"), "dir");
    addOk(repo, sessionPath, ["--kind", "directory", "--path", scratch]);

    const swapped = repo.scratch();
    addOk(repo, sessionPath, ["--kind", "directory", "--path", swapped]);
    fs.rmSync(swapped, { recursive: true });
    fs.symlinkSync(outside, swapped, "dir");

    const before = fs.readFileSync(sessionPath, "utf8");
    const dry = close(repo, sessionPath, ["--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(dry.report.dry_run, true);
    assert.deepEqual(
      dry.report.entries.map((item) => item.outcome),
      ["would-remove", "refused"]
    );
    assert.equal(dry.report.entries[0].bytes, 4106);
    assert.ok(fs.existsSync(path.join(scratch, "a.bin")), "dry run removes nothing");
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before, "dry run writes nothing");

    const closed = close(repo, sessionPath);
    assert.equal(closed.status, 7, closed.stderr);
    assert.equal(closed.report.bytes_freed, 4106);
    assert.deepEqual(
      closed.report.entries.map((item) => item.outcome),
      ["removed", "refused"]
    );
    assert.match(closed.report.entries[1].reason, /symlink/);
    assert.equal(fs.existsSync(scratch), false);
    assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "must survive");
    assert.equal(closed.report.remaining.length, 1);
    const ledger = readJson(sessionPath).resources;
    assert.equal(ledger[0].status, "removed");
    assert.equal(ledger[0].last_close.bytes_freed, 4106);
    assert.equal(ledger[1].status, "registered");
    assert.equal(ledger[1].last_close.outcome, "refused");

    fs.rmSync(swapped);
    const rerun = close(repo, sessionPath);
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.deepEqual(
      rerun.report.entries.map((item) => item.outcome),
      ["already-closed", "gone"]
    );
    assert.equal(rerun.report.bytes_freed, 0);
    const third = close(repo, sessionPath);
    assert.equal(third.status, 0);
    assert.deepEqual(
      third.report.entries.map((item) => item.outcome),
      ["already-closed", "already-closed"]
    );
  } finally {
    repo.cleanup();
  }
});

test("close removes clean worktrees, preserves dirty ones and never deletes a branch", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("close-worktrees");
    const worktrees = {};
    for (const name of ["clean", "modified", "untracked", "ahead", "pmstate"]) {
      const target = path.join(repo.root, ".worktrees", name);
      git(repo.root, ["worktree", "add", "-q", target, "-b", `feat/${name}`]);
      worktrees[name] = fs.realpathSync(target);
    }
    fs.appendFileSync(path.join(worktrees.modified, "README.md"), "edit\n");
    fs.writeFileSync(path.join(worktrees.untracked, "new.txt"), "new\n");
    fs.writeFileSync(path.join(worktrees.ahead, "work.txt"), "work\n");
    git(worktrees.ahead, ["add", "work.txt"]);
    git(worktrees.ahead, ["commit", "-qm", "unsaved work"]);
    fs.mkdirSync(path.join(worktrees.pmstate, ".pm", "dev-sessions", "x"), { recursive: true });
    fs.writeFileSync(path.join(worktrees.pmstate, ".pm", "dev-sessions", "x", "report.json"), "{}");

    const notWorktree = path.join(repo.root, ".worktrees", "plain");
    fs.mkdirSync(notWorktree);
    const plain = add(repo, sessionPath, ["--kind", "worktree", "--path", notWorktree]);
    assert.equal(plain.status, 3);
    assert.match(plain.stderr, /not a linked worktree/);
    const main = add(repo, sessionPath, ["--kind", "worktree", "--path", repo.root]);
    assert.equal(main.status, 3);
    assert.match(main.stderr, /repository root/);

    for (const name of Object.keys(worktrees)) {
      const registered = addOk(repo, sessionPath, [
        "--kind",
        "worktree",
        "--path",
        worktrees[name],
      ]);
      assert.equal(registered.branch, `feat/${name}`);
    }
    const fromInside = close(repo, sessionPath, ["--dry-run"], { cwd: worktrees.clean });
    assert.equal(fromInside.report.entries[0].outcome, "refused");
    assert.match(fromInside.report.entries[0].reason, /running from/);

    const closed = close(repo, sessionPath);
    assert.equal(closed.status, 7, closed.stderr);
    const byPath = Object.fromEntries(closed.report.entries.map((item) => [item.target, item]));
    assert.equal(byPath[worktrees.clean].outcome, "removed");
    assert.ok(byPath[worktrees.clean].bytes > 0);
    assert.equal(fs.existsSync(worktrees.clean), false);
    assert.match(byPath[worktrees.modified].reason, /uncommitted or untracked/);
    assert.match(byPath[worktrees.modified].reason, /README\.md/);
    assert.match(byPath[worktrees.untracked].reason, /new\.txt/);
    assert.match(byPath[worktrees.ahead].reason, /1 commit/);
    assert.match(byPath[worktrees.pmstate].reason, /PM state/);
    for (const name of ["modified", "untracked", "ahead", "pmstate"]) {
      assert.equal(byPath[worktrees[name]].outcome, "preserved", name);
      assert.ok(fs.existsSync(worktrees[name]), `${name} is preserved`);
    }
    const branches = git(repo.root, ["branch", "--format=%(refname:short)"]).split("\n");
    for (const name of Object.keys(worktrees)) {
      assert.ok(branches.includes(`feat/${name}`), `branch feat/${name} remains`);
    }
    assert.ok(
      fs.existsSync(path.join(worktrees.pmstate, ".pm", "dev-sessions", "x", "report.json"))
    );
  } finally {
    repo.cleanup();
  }
});

test("close signals only the registered process and treats a reused or stale pid as gone", () => {
  if (process.platform === "win32") return;
  const repo = makeRepo();
  const pids = [];
  try {
    const sessionPath = repo.init("close-processes");
    for (const pid of [1, process.pid]) {
      const refused = add(repo, sessionPath, ["--kind", "process", "--pid", String(pid)]);
      assert.equal(refused.status, 3, `pid ${pid}`);
    }
    const running = startDetachedSleep();
    const stale = startDetachedSleep();
    const reused = startDetachedSleep();
    pids.push(running, stale, reused);
    const registered = addOk(repo, sessionPath, ["--kind", "process", "--pid", String(running)]);
    assert.ok(registered.started_at);
    assert.match(registered.command, /sleep/);
    addOk(repo, sessionPath, ["--kind", "process", "--pid", String(stale)]);
    addOk(repo, sessionPath, ["--kind", "process", "--pid", String(reused)]);
    process.kill(stale, "SIGKILL");
    assert.ok(waitDead(stale));
    const session = readJson(sessionPath);
    session.resources[2].started_at = "Thu Jan  1 00:00:00 1970";
    fs.writeFileSync(sessionPath, JSON.stringify(session));

    const dry = close(repo, sessionPath, ["--dry-run"]);
    assert.deepEqual(
      dry.report.entries.map((item) => item.outcome),
      ["would-remove", "gone", "gone"]
    );
    assert.ok(alive(running), "dry run sends no signal");

    const closed = close(repo, sessionPath);
    assert.equal(closed.status, 0, closed.stderr);
    assert.deepEqual(
      closed.report.entries.map((item) => item.outcome),
      ["removed", "gone", "gone"]
    );
    assert.match(closed.report.entries[2].reason, /different process/);
    assert.ok(waitDead(running), "the registered process was stopped");
    assert.ok(alive(reused), "a pid whose identity changed is never signalled");
  } finally {
    for (const pid of pids) killQuietly(pid);
    repo.cleanup();
  }
});

test("project resources need a declared teardown and one failure never stops the others", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("close-teardown");
    const scratch = repo.scratch();
    addOk(repo, sessionPath, ["--kind", "directory", "--path", scratch]);
    const db = addOk(repo, sessionPath, [
      "--kind",
      "database",
      "--identifier",
      "app_test_7",
      "--teardown",
      "drop-db",
    ]);
    assert.equal(db.removal, "declared-teardown");
    addOk(repo, sessionPath, [
      "--kind",
      "account",
      "--identifier",
      "qa-user@example.com",
      "--teardown",
      "delete-account",
    ]);

    const undeclared = close(repo, sessionPath, ["--dry-run"]);
    assert.deepEqual(
      undeclared.report.entries.map((item) => item.outcome),
      ["would-remove", "no-teardown", "no-teardown"]
    );
    assert.match(undeclared.report.entries[1].reason, /no declared teardown/);

    const marker = path.join(repo.root, "teardown-calls.txt");
    const script = path.join(repo.root, "teardown.js");
    fs.writeFileSync(
      script,
      [
        "const fs = require('node:fs');",
        `fs.appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + ' ' + process.env.PM_RESOURCE_KIND + '\\n');`,
        "if (process.argv[2] === 'fail') process.exit(9);",
      ].join("\n")
    );
    fs.mkdirSync(path.join(repo.root, ".pm"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.root, ".pm", "config.json"),
      JSON.stringify({
        dev: {
          teardown: {
            "drop-db": { kind: "database", command: [process.execPath, script, "drop", "{id}"] },
            "delete-account": {
              kind: "account",
              command: [process.execPath, script, "fail", "{id}"],
            },
          },
        },
      })
    );
    const dry = close(repo, sessionPath, ["--dry-run"]);
    assert.deepEqual(
      dry.report.entries.map((item) => item.outcome),
      ["would-remove", "would-remove", "would-remove"]
    );
    assert.equal(fs.existsSync(marker), false, "dry run runs no teardown");

    const closed = close(repo, sessionPath);
    assert.equal(closed.status, 7, closed.stderr);
    assert.deepEqual(
      closed.report.entries.map((item) => item.outcome),
      ["removed", "removed", "failed"]
    );
    assert.match(closed.report.entries[2].reason, /exited with 9/);
    assert.equal(fs.existsSync(scratch), false, "the failure did not stop the directory");
    assert.equal(
      fs.readFileSync(marker, "utf8"),
      "drop app_test_7 database\nfail qa-user@example.com account\n"
    );
    const ledger = readJson(sessionPath).resources;
    assert.deepEqual(
      ledger.map((item) => item.status),
      ["removed", "removed", "registered"]
    );

    const config = readJson(path.join(repo.root, ".pm", "config.json"));
    config.dev.teardown["delete-account"].kind = "database";
    fs.writeFileSync(path.join(repo.root, ".pm", "config.json"), JSON.stringify(config));
    const mismatched = close(repo, sessionPath);
    assert.equal(mismatched.report.entries[2].outcome, "refused");
    assert.match(mismatched.report.entries[2].reason, /declared for database/);
  } finally {
    repo.cleanup();
  }
});

test("close runs on interrupted and completed sessions and respects a live lock", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("close-outcomes");
    const scratch = repo.run(["scratch", "--session", sessionPath, "--json"]);
    assert.equal(scratch.status, 0, scratch.stderr);
    const allocated = JSON.parse(scratch.stdout);
    assert.equal(allocated.resource.kind, "directory");
    assert.equal(allocated.resource.created_by, "dev-session scratch");
    assert.equal(allocated.resource.path, fs.realpathSync(allocated.directory));
    const later = repo.scratch();
    addOk(repo, sessionPath, ["--kind", "directory", "--path", later]);

    const lockPath = `${sessionPath}.lock`;
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid }));
    const locked = close(repo, sessionPath);
    assert.equal(locked.status, 3);
    assert.ok(fs.existsSync(allocated.directory), "a locked session is not touched");
    fs.rmSync(lockPath, { recursive: true });

    const interrupted = close(repo, sessionPath, ["--dry-run"]);
    assert.equal(interrupted.status, 0, interrupted.stderr);
    assert.equal(interrupted.report.session_status, "active");

    const completed = completeSession(repo, sessionPath);
    assert.equal(completed.session.resources.length, 2, "the ledger moves with the archive");
    const viaPointer = close(repo, sessionPath);
    assert.equal(viaPointer.status, 0, viaPointer.stderr);
    assert.equal(viaPointer.report.session_path, completed.session_path);
    assert.equal(viaPointer.report.session_status, "complete");
    assert.equal(fs.existsSync(allocated.directory), false);
    assert.equal(fs.existsSync(later), false);
    assert.deepEqual(
      readJson(completed.session_path).resources.map((item) => item.status),
      ["removed", "removed"]
    );
  } finally {
    repo.cleanup();
  }
});

test("sessions without a ledger behave as before", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("no-ledger");
    const before = fs.readFileSync(sessionPath, "utf8");
    const closed = close(repo, sessionPath);
    assert.equal(closed.status, 0, closed.stderr);
    assert.deepEqual(closed.report.entries, []);
    assert.equal(closed.report.bytes_freed, 0);
    const listed = repo.run(["resources", "--session", sessionPath, "--json"]);
    assert.deepEqual(JSON.parse(listed.stdout).resources, []);
    const swept = repo.run(["sweep", "--session", sessionPath, "--json"]);
    assert.equal(swept.status, 0, swept.stderr);
    assert.deepEqual(JSON.parse(swept.stdout).sessions, []);
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before, "nothing rewrote the session");
    assert.equal(repo.run(["validate", "--session", sessionPath]).status, 0);
  } finally {
    repo.cleanup();
  }
});

test("the orphan sweep reports finished and abandoned sessions and skips active ones", () => {
  const repo = makeRepo();
  try {
    const finishedPath = repo.init("finished-run");
    const finishedDir = repo.scratch();
    const shared = repo.scratch();
    fs.writeFileSync(path.join(finishedDir, "out.bin"), Buffer.alloc(100));
    addOk(repo, finishedPath, ["--kind", "directory", "--path", finishedDir]);
    addOk(repo, finishedPath, ["--kind", "directory", "--path", shared]);
    const finished = completeSession(repo, finishedPath);

    const activePath = repo.init("active-run");
    const activeDir = repo.scratch();
    addOk(repo, activePath, ["--kind", "directory", "--path", activeDir]);
    addOk(repo, activePath, ["--kind", "directory", "--path", shared]);

    const abandonedPath = repo.init("abandoned-run");
    const abandonedDir = repo.scratch();
    addOk(repo, abandonedPath, ["--kind", "directory", "--path", abandonedDir]);
    const abandoned = readJson(abandonedPath);
    abandoned.created_at = "2026-01-01T00:00:00.000Z";
    abandoned.updated_at = "2026-01-01T00:00:00.000Z";
    abandoned.resources[0].created_at = "2026-01-01T00:00:00.000Z";
    fs.writeFileSync(abandonedPath, JSON.stringify(abandoned));

    const currentPath = repo.init("current-run");
    const currentDir = repo.scratch();
    addOk(repo, currentPath, ["--kind", "directory", "--path", currentDir]);

    const before = {
      finished: fs.readFileSync(finished.session_path, "utf8"),
      active: fs.readFileSync(activePath, "utf8"),
    };
    const report = repo.run(["sweep", "--session", currentPath, "--json"]);
    assert.equal(report.status, 0, report.stderr);
    const swept = JSON.parse(report.stdout);
    assert.equal(swept.dry_run, true, "the sweep reports by default");
    const bySlug = Object.fromEntries(swept.sessions.map((item) => [item.slug, item]));
    assert.equal(bySlug["current-run"], undefined, "the current session is never swept");
    assert.equal(bySlug["finished-run"].state, "finished");
    assert.equal(bySlug["abandoned-run"].state, "abandoned");
    assert.equal(bySlug["active-run"].state, "active");
    assert.deepEqual(
      bySlug["finished-run"].entries.map((item) => [item.target, item.outcome]),
      [
        [finishedDir, "would-remove"],
        [shared, "preserved"],
      ]
    );
    assert.match(bySlug["finished-run"].entries[1].reason, /active session active-run/);
    assert.deepEqual(
      bySlug["active-run"].entries.map((item) => item.outcome),
      ["skipped", "skipped"]
    );
    for (const dir of [finishedDir, shared, activeDir, abandonedDir, currentDir]) {
      assert.ok(fs.existsSync(dir), "report-only sweep removes nothing");
    }
    assert.equal(fs.readFileSync(finished.session_path, "utf8"), before.finished);
    assert.equal(fs.readFileSync(activePath, "utf8"), before.active);

    const removed = repo.run(["sweep", "--session", currentPath, "--remove", "--json"]);
    assert.equal(removed.status, 7, removed.stderr);
    const result = JSON.parse(removed.stdout);
    assert.equal(result.bytes_freed, 100);
    assert.equal(fs.existsSync(finishedDir), false);
    assert.equal(fs.existsSync(abandonedDir), false);
    assert.ok(fs.existsSync(shared), "a resource an active session uses is kept");
    assert.ok(fs.existsSync(activeDir));
    assert.ok(fs.existsSync(currentDir));
    assert.equal(fs.readFileSync(activePath, "utf8"), before.active);
    assert.deepEqual(
      readJson(finished.session_path).resources.map((item) => item.status),
      ["removed", "registered"]
    );
    assert.equal(readJson(abandonedPath).resources[0].status, "removed");

    const onDemand = repo.run(["sweep", "--source-dir", repo.root, "--json"]);
    assert.equal(onDemand.status, 0, onDemand.stderr);
    const remaining = JSON.parse(onDemand.stdout).sessions.find(
      (item) => item.slug === "finished-run"
    );
    assert.deepEqual(
      remaining.entries.map((item) => item.target),
      [shared]
    );
  } finally {
    repo.cleanup();
  }
});

test("completion removes misplaced generated data but never referenced evidence", () => {
  const repo = makeRepo();
  try {
    const sessionPath = repo.init("auto-clean");
    const activeDir = path.dirname(sessionPath);
    const outside = repo.scratch("pm-res-outside-");
    fs.writeFileSync(path.join(outside, "keep.txt"), "outside");
    const modules = path.join(activeDir, "qa", "node_modules");
    fs.mkdirSync(path.join(modules, "pkg", "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(modules, "pkg", "index.js"), "x".repeat(50));
    fs.symlinkSync(outside, path.join(modules, "linked"), "dir");
    const derived = path.join(activeDir, "qa", "DerivedData", "App-abcd", "Build");
    fs.mkdirSync(derived, { recursive: true });
    fs.writeFileSync(path.join(derived, "object.o"), "y".repeat(25));
    const evidenceBuild = path.join(activeDir, "native", "DerivedData", "Build");
    fs.mkdirSync(evidenceBuild, { recursive: true });
    fs.writeFileSync(path.join(evidenceBuild, "crash.log"), "evidence");
    fs.writeFileSync(path.join(activeDir, "review.log"), "review evidence\n");
    fs.writeFileSync(
      path.join(activeDir, "gates.json"),
      JSON.stringify({
        gates: [
          { artifact: ".pm/dev-sessions/auto-clean/review.log" },
          { artifact: ".pm/dev-sessions/auto-clean/native/DerivedData/Build/crash.log" },
        ],
      })
    );

    const session = readJson(sessionPath);
    session.phase = "retro";
    session.routing.required_phases = ["retro"];
    session.routing.required_gates = [];
    fs.writeFileSync(sessionPath, JSON.stringify(session));
    const resultPath = path.join(repo.root, "retro.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        run_id: session.run_id,
        phase: "retro",
        attempt: 1,
        status: "passed",
        summary: "Retro complete",
        commit: null,
        files_changed: [],
        evidence: [{ kind: "retro", command: "retro", exit_code: 0, artifact: null }],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high" },
      })
    );
    const record = ["record", "--session", sessionPath, "--result", resultPath, "--json"];
    const blocked = repo.run(record);
    assert.equal(blocked.status, 3, blocked.stderr);
    assert.match(blocked.stderr, /native[/\\]DerivedData[/\\]Build/);
    assert.match(blocked.stderr, /evidence/);
    assert.ok(fs.existsSync(path.join(evidenceBuild, "crash.log")), "evidence is kept");
    assert.equal(fs.existsSync(modules), false, "disposable generated data is removed");
    assert.equal(fs.existsSync(path.dirname(derived)), true);
    assert.equal(fs.existsSync(derived), false);
    assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "outside");

    const gates = readJson(path.join(activeDir, "gates.json"));
    gates.gates.pop();
    fs.writeFileSync(path.join(activeDir, "gates.json"), JSON.stringify(gates));
    fs.mkdirSync(path.join(activeDir, "tools", "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(activeDir, "tools", "node_modules", "x.js"), "z".repeat(10));
    const recorded = repo.run(record);
    assert.equal(recorded.status, 0, recorded.stderr);
    const output = JSON.parse(recorded.stdout);
    assert.deepEqual(
      output.storage_cleanup.map((item) => [item.path, item.bytes]),
      [
        [path.join("native", "DerivedData", "Build"), 8],
        [path.join("tools", "node_modules"), 10],
      ]
    );
    const archiveDir = path.dirname(output.session_path);
    assert.equal(fs.readFileSync(path.join(archiveDir, "review.log"), "utf8"), "review evidence\n");
    assert.equal(fs.existsSync(path.join(archiveDir, "tools", "node_modules")), false);
  } finally {
    repo.cleanup();
  }
});

test("close refuses path and teardown removals when the session's repository is missing", () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-res-norepo-")));
  try {
    const missingRepo = path.join(scratch, "gone-repo");
    const target = path.join(scratch, "build");
    fs.mkdirSync(target);
    const ctx = buildContext({
      session: { source: { repo_root: missingRepo } },
      sessionPath: path.join(missingRepo, ".pm", "dev-sessions", "x", "session.json"),
    });
    const database = entry({
      id: "res_1123456789abcdef",
      kind: "database",
      removal: "declared-teardown",
      identifier: "app_test",
      teardown: "drop-db",
    });
    delete database.path;
    const outcome = closeLedger([entry({ path: target }), database], ctx);
    assert.deepEqual(
      outcome.report.entries.map((item) => item.outcome),
      ["refused", "refused"]
    );
    assert.match(outcome.report.entries[0].reason, /repository is missing/);
    assert.ok(fs.existsSync(target));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
