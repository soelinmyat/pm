"use strict";

const assert = require("node:assert/strict");
const {
  mkdtempSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const vm = require("node:vm");

const script = resolve("skills/dev/references/find-polluter.sh");

function isolationFixture(t, source, pattern = "tests/*.test.js") {
  const cwd = mkdtempSync(join(tmpdir(), "pm-polluter-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "tests"));
  if (source !== null) writeFileSync(join(cwd, "tests", "with space.test.js"), source);
  const pollution = join(cwd, "unwanted");
  const env = { ...process.env, POLLUTION_PATH: pollution };
  // A child node --test must start a runner, not inherit this runner's worker mode.
  delete env.NODE_TEST_CONTEXT;
  const run = (args = []) =>
    spawnSync("bash", [script, pollution, pattern, "--", process.execPath, "--test", ...args], {
      cwd,
      env,
      encoding: "utf8",
    });
  return { cwd, pollution, run };
}

test("pollution helper executes the selected test path, including spaces", (t) => {
  const f = isolationFixture(
    t,
    "require('node:fs').writeFileSync(process.env.POLLUTION_PATH, 'observed');"
  );
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(existsSync(f.pollution));
  assert.match(result.stdout, /with space\.test\.js/);
  assert.match(result.stdout, /FOUND POLLUTER/);
});

test("pollution helper reports an empty discovery as inconclusive", (t) => {
  const result = isolationFixture(t, null).run();
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /No matching test files/);
  assert.doesNotMatch(result.stdout, /all tests clean|No pollution observed/);
});

test("pollution helper does not convert a test execution failure into a clean result", (t) => {
  const result = isolationFixture(t, "require('node:assert/strict').equal(1, 2);").run();
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /INCONCLUSIVE/);
  assert.match(result.stdout, /AssertionError/);
});

test("pollution helper stops at pre-existing pollution without running the test", (t) => {
  const f = isolationFixture(t, "require('node:fs').writeFileSync('executed', 'yes');");
  writeFileSync(f.pollution, "baseline");
  assert.equal(f.run().status, 2);
  assert.equal(existsSync(join(f.cwd, "executed")), false);
});

test("pollution helper clean result requires actual successful execution", (t) => {
  const f = isolationFixture(t, "require('node:fs').writeFileSync('executed', 'yes');");
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(join(f.cwd, "executed")));
  assert.match(
    result.stdout,
    /No pollution observed after 1 successful single-file runner invocations/
  );
});

function documentedHelper(name) {
  const doc = readFileSync("skills/dev/references/qa-dom-assertions.md", "utf8");
  const block = doc
    .split("```javascript\n")
    .slice(1)
    .map((part) => part.split("```")[0])
    .find((part) => part.includes(`function ${name}(`));
  assert.ok(block, `Missing executable ${name} example`);
  return vm.runInNewContext(`${block}\n${name}`);
}

test("documented filter assertion rejects empty, partial, duplicate, wrong-status results", () => {
  const check = documentedHelper("matchesActiveFixture");
  const fixture = ["a", "b"];
  assert.equal(check([], fixture), false);
  assert.equal(check([{ id: "a", status: "Active" }], fixture), false);
  assert.equal(
    check(
      [
        { id: "a", status: "Active" },
        { id: "a", status: "Active" },
      ],
      fixture
    ),
    false
  );
  assert.equal(
    check(
      [
        { id: "a", status: "Inactive" },
        { id: "b", status: "Active" },
      ],
      fixture
    ),
    false
  );
  assert.equal(
    check(
      [
        { id: "b", status: "Active" },
        { id: "a", status: "Active" },
      ],
      fixture
    ),
    true
  );
  assert.equal(check([], []), true); // An explicitly empty fixture is a separate valid case.
});

test("documented sort assertion rejects vacuous, invalid-date, missing and reversed rows", () => {
  const check = documentedHelper("matchesDescendingFixture");
  const expected = ["new", "old"];
  const rows = [
    { id: "new", timestamp: 20 },
    { id: "old", timestamp: 10 },
  ];
  assert.equal(check([], expected), false);
  assert.equal(check(rows.slice(0, 1), expected), false);
  assert.equal(check([...rows].reverse(), expected), false);
  assert.equal(check([{ id: "new", timestamp: NaN }, rows[1]], expected), false);
  assert.equal(check(rows, expected), true);
});

test("documented rendered-state probe rejects absent, CSS hidden and ancestor hidden modal", () => {
  const check = documentedHelper("hasRenderedBox");
  const element = (styles = {}, parentElement = null) => ({
    parentElement,
    styles: { display: "block", visibility: "visible", opacity: "1", ...styles },
    hidden: false,
    getClientRects: () => [{ width: 100, height: 40 }],
  });
  const style = (el) => el.styles;
  assert.equal(check(null, style), false);
  assert.equal(check(element({ display: "none" }), style), false);
  assert.equal(check(element({ visibility: "hidden" }), style), false);
  assert.equal(check(element({}, element({ opacity: "0" })), style), false);
  assert.equal(check(element(), style), true);
});

test("pollution helper refuses a zero-exit name filter that executes no selected cases", (t) => {
  const f = isolationFixture(
    t,
    "require('node:test')('creates pollution', () => require('node:fs').writeFileSync(process.env.POLLUTION_PATH, 'body ran'));"
  );
  const result = f.run(["--test-name-pattern=unmatched"]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(existsSync(f.pollution), false);
  assert.match(result.stdout, /filtered runners/);
  assert.doesNotMatch(result.stdout, /No pollution observed/);
});

test("browser method preflight is reachable before Dev collection and Review rendering", () => {
  const reference = "references/browser-evidence-preflight.md";
  const preflight = readFileSync(reference, "utf8");
  for (const path of [
    "skills/dev/steps/02-intake.md",
    "skills/dev/steps/07-qa.md",
    "skills/dev/references/qa.md",
    "skills/dev/references/qa-dom-assertions.md",
    "skills/review/steps/01-target.md",
    "skills/review/steps/05-publish.md",
    "skills/review/references/evidence-contract.md",
  ]) {
    assert.ok(
      readFileSync(path, "utf8").includes(reference),
      `${path} must consume the shared contract`
    );
  }
  const qa = readFileSync("skills/dev/references/qa.md", "utf8");
  assert.ok(qa.indexOf(reference) < qa.indexOf("### 0b. Start servers"));
  const publish = readFileSync("skills/review/steps/05-publish.md", "utf8");
  assert.ok(publish.indexOf(reference) < publish.indexOf("artifact-render-check.js"));
  assert.match(preflight, /CUA is not a trusted route-schema-v2 producer/);
  assert.match(
    preflight,
    /browser unavailability is not permission to force structured or compact publication/
  );
  assert.match(preflight, /unchanged method, target, action scope, principal, and policy/);
  assert.match(preflight, /resume aid, not a grant of platform authorization/);
  assert.match(
    preflight,
    /source-thread request.*cannot override a platform rejection in the calling thread/s
  );
  assert.match(
    preflight,
    /This is method planning within existing authority, not a new PM approval gate/
  );
});
