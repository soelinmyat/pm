"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const checkScript = path.join(repoRoot, "scripts", "rfc-sidecar-check.js");

const { validateRfcSidecar, parseArgs } = require("../scripts/rfc-sidecar-check.js");

// ---------------------------------------------------------------------------
// RFC sidecar validator (Phase D3)
//
// RFCs get a structured JSON sidecar at {pm_dir}/backlog/rfcs/{slug}.json so
// machine consumers stop grepping the human-render HTML. These tests pin the
// schema-v2 contract the validator enforces.
// ---------------------------------------------------------------------------

function issueRow(overrides = {}) {
  return { num: 1, title: "Add sidecar validator", size: "M", test_hooks: [], ...overrides };
}

function testStrategy(overrides = {}) {
  return {
    test_levels: "Layer 1 unit tests for the validator",
    new_infrastructure: "None beyond node --test",
    regression_surface: "existing rfc-parser tests must stay green",
    verification_commands: "node --test tests/*.test.js",
    open_questions: "None",
    ...overrides,
  };
}

function sidecar(overrides = {}) {
  return {
    schema_version: 2,
    slug: "rfc-structured-artifacts",
    title: "RFC structured artifacts",
    size: "M",
    status: "draft",
    issues: [issueRow()],
    test_strategy: testStrategy(),
    ...overrides,
  };
}

function messages(result) {
  return result.issues.map((i) => i.message).join("\n");
}

function makeTmpSidecar(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rfc-sidecar-"));
  const file = path.join(dir, "some-slug.json");
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return {
    file,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("rfc sidecar checker accepts a well-formed schema-v2 sidecar", () => {
  const result = validateRfcSidecar(sidecar());
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("rfc sidecar checker accepts every valid issue size", () => {
  const result = validateRfcSidecar(
    sidecar({
      issues: ["XS", "S", "M", "L", "XL"].map((size, index) =>
        issueRow({ num: index + 1, title: `Issue ${index + 1}`, size })
      ),
    })
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("rfc sidecar checker rejects a non-object sidecar", () => {
  for (const bad of [null, [], "str", 3]) {
    const result = validateRfcSidecar(bad);
    assert.equal(result.ok, false);
    assert.match(messages(result), /must be an object/);
  }
});

test("rfc sidecar checker rejects a schema_version other than 2", () => {
  const result = validateRfcSidecar(sidecar({ schema_version: 1 }));
  assert.equal(result.ok, false);
  assert.match(messages(result), /schema_version must equal 2/);
});

test("rfc sidecar checker rejects a missing or empty issues array", () => {
  const empty = validateRfcSidecar(sidecar({ issues: [] }));
  assert.equal(empty.ok, false);
  assert.match(messages(empty), /issues must be a non-empty array/);

  const notArray = validateRfcSidecar(sidecar({ issues: { num: 1 } }));
  assert.equal(notArray.ok, false);
  assert.match(messages(notArray), /issues must be a non-empty array/);
});

test("rfc sidecar checker rejects duplicate issue numbers", () => {
  const result = validateRfcSidecar(
    sidecar({ issues: [issueRow({ num: 1 }), issueRow({ num: 1, title: "Second" })] })
  );
  assert.equal(result.ok, false);
  assert.match(messages(result), /duplicate issue num 1/);
});

test("rfc sidecar checker rejects non-positive or non-integer issue numbers", () => {
  for (const num of [0, -1, 1.5, "1"]) {
    const result = validateRfcSidecar(sidecar({ issues: [issueRow({ num })] }));
    assert.equal(result.ok, false, `num=${num}`);
    assert.match(messages(result), /num must be a positive integer/);
  }
});

test("rfc sidecar checker rejects empty issue titles", () => {
  for (const title of ["", "   ", null, 5]) {
    const result = validateRfcSidecar(sidecar({ issues: [issueRow({ title })] }));
    assert.equal(result.ok, false, `title=${JSON.stringify(title)}`);
    assert.match(messages(result), /title must be a non-empty string/);
  }
});

test("rfc sidecar checker rejects issue sizes outside XS/S/M/L/XL", () => {
  for (const size of ["XXL", "medium", "", 2]) {
    const result = validateRfcSidecar(sidecar({ issues: [issueRow({ size })] }));
    assert.equal(result.ok, false, `size=${JSON.stringify(size)}`);
    assert.match(messages(result), /size must be one of/);
  }
});

test("rfc sidecar checker rejects issue test_hooks that are not arrays", () => {
  const result = validateRfcSidecar(sidecar({ issues: [issueRow({ test_hooks: "AC-1" })] }));
  assert.equal(result.ok, false);
  assert.match(messages(result), /test_hooks must be an array/);
});

test("rfc sidecar checker rejects a non-object test_strategy", () => {
  const result = validateRfcSidecar(sidecar({ test_strategy: "later" }));
  assert.equal(result.ok, false);
  assert.match(messages(result), /test_strategy must be an object/);
});

test("rfc sidecar checker requires all five test_strategy fields to be non-empty strings", () => {
  const fields = [
    "test_levels",
    "new_infrastructure",
    "regression_surface",
    "verification_commands",
    "open_questions",
  ];
  for (const field of fields) {
    const missing = validateRfcSidecar(
      sidecar({ test_strategy: testStrategy({ [field]: undefined }) })
    );
    assert.equal(missing.ok, false, `missing ${field}`);
    assert.match(
      messages(missing),
      new RegExp(`test_strategy\\.${field} must be a non-empty string`)
    );

    const blank = validateRfcSidecar(sidecar({ test_strategy: testStrategy({ [field]: "  " }) }));
    assert.equal(blank.ok, false, `blank ${field}`);
    assert.match(
      messages(blank),
      new RegExp(`test_strategy\\.${field} must be a non-empty string`)
    );
  }
});

test("rfc sidecar checker reports the sidecar path in issue locations", () => {
  const result = validateRfcSidecar(sidecar({ schema_version: 9 }), "pm/backlog/rfcs/x.json");
  assert.equal(result.issues[0].file, "pm/backlog/rfcs/x.json");
});

test("rfc sidecar checker CLI parses --sidecar and --json", () => {
  const parsed = parseArgs(["--sidecar", "pm/backlog/rfcs/x.json", "--json"]);
  assert.equal(parsed.sidecarPath, "pm/backlog/rfcs/x.json");
  assert.equal(parsed.json, true);
});

test("rfc sidecar checker CLI rejects unknown arguments and missing values", () => {
  assert.throws(() => parseArgs(["--sidecar"]), /--sidecar requires a value/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument --bogus/);
});

test("rfc sidecar checker CLI exits zero on a valid sidecar", () => {
  const tmp = makeTmpSidecar(sidecar());
  try {
    const result = spawnSync(process.execPath, [checkScript, "--sidecar", tmp.file, "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  } finally {
    tmp.cleanup();
  }
});

test("rfc sidecar checker CLI exits non-zero on an invalid sidecar", () => {
  const tmp = makeTmpSidecar(sidecar({ schema_version: 1, issues: [] }));
  try {
    const result = spawnSync(process.execPath, [checkScript, "--sidecar", tmp.file, "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.match(output.issues.map((i) => i.message).join("\n"), /schema_version must equal 2/);
  } finally {
    tmp.cleanup();
  }
});

test("rfc sidecar checker CLI exits non-zero when the sidecar cannot be read", () => {
  const result = spawnSync(
    process.execPath,
    [checkScript, "--sidecar", "/tmp/pm-rfc-sidecar-does-not-exist.json", "--json"],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0);
  assert.match(
    JSON.parse(result.stdout)
      .issues.map((i) => i.message)
      .join("\n"),
    /unable to read/
  );
});
