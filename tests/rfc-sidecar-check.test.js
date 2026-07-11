"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const checkScript = path.join(repoRoot, "scripts", "rfc-sidecar-check.js");

const {
  validateRfcSidecar,
  extractSidecarHash,
  sha256Hex,
  parseArgs,
} = require("../scripts/rfc-sidecar-check.js");

// ---------------------------------------------------------------------------
// RFC sidecar validator (Phase D3)
//
// RFCs get a structured JSON sidecar at {pm_dir}/backlog/rfcs/{slug}.json so
// machine consumers stop grepping the human-render HTML. These tests pin the
// schema-v3 executable contract, legacy v2 compatibility, the sidecar<->HTML
// hash binding, and the --slug cross-check.
// ---------------------------------------------------------------------------

function issueRow(overrides = {}) {
  return {
    num: 1,
    title: "Add sidecar validator",
    size: "M",
    depends_on: [],
    owns: ["scripts/rfc-sidecar-check.js"],
    acceptance_criteria: ["AC-1: Sidecars are validated"],
    approach: "Validate a closed machine-readable execution contract.",
    verification_commands: ["node --test tests/rfc-sidecar-check.test.js"],
    test_hooks: ["Test levels in scope -> AC-1"],
    ...overrides,
  };
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
    schema_version: 3,
    slug: "rfc-structured-artifacts",
    title: "RFC structured artifacts",
    size: "M",
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
    dir,
    file,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// --- schema happy path -----------------------------------------------------

test("rfc sidecar checker accepts a well-formed schema-v3 sidecar", () => {
  const result = validateRfcSidecar(sidecar());
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("rfc sidecar checker accepts every valid issue size and an empty test_hooks array", () => {
  const result = validateRfcSidecar(
    sidecar({
      issues: ["XS", "S", "M", "L", "XL"].map((size, index) =>
        issueRow({ num: index + 1, title: `Issue ${index + 1}`, size, test_hooks: [] })
      ),
    })
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

// --- top-level shape -------------------------------------------------------

test("rfc sidecar checker rejects a non-object sidecar", () => {
  for (const bad of [null, [], "str", 3]) {
    const result = validateRfcSidecar(bad);
    assert.equal(result.ok, false);
    assert.match(messages(result), /must be an object/);
  }
});

test("rfc sidecar checker retains the published schema-v2 compatibility path", () => {
  const legacy = sidecar({
    schema_version: 2,
    issues: [{ num: 1, title: "Legacy issue", size: "M", test_hooks: [] }],
  });
  assert.equal(validateRfcSidecar(legacy).ok, true);
});

test("rfc sidecar checker rejects an unsupported schema_version", () => {
  const result = validateRfcSidecar(sidecar({ schema_version: 1 }));
  assert.equal(result.ok, false);
  assert.match(messages(result), /schema_version must equal 2 or 3/);
});

test("rfc sidecar checker rejects unknown top-level fields (status is gone in v2)", () => {
  const withStatus = validateRfcSidecar(sidecar({ status: "draft" }));
  assert.equal(withStatus.ok, false);
  assert.match(messages(withStatus), /unknown field status/);

  const withJunk = validateRfcSidecar(sidecar({ execution_contract: {} }));
  assert.equal(withJunk.ok, false);
  assert.match(messages(withJunk), /unknown field execution_contract/);
});

test("rfc sidecar checker requires non-empty slug and title", () => {
  for (const field of ["slug", "title"]) {
    for (const bad of ["", "   ", null, 5]) {
      const result = validateRfcSidecar(sidecar({ [field]: bad }));
      assert.equal(result.ok, false, `${field}=${JSON.stringify(bad)}`);
      assert.match(messages(result), new RegExp(`${field} must be a non-empty string`));
    }
  }
});

test("rfc sidecar checker requires a canonical uppercase top-level size", () => {
  for (const bad of ["m", "  M ", "Medium", "", 2]) {
    const result = validateRfcSidecar(sidecar({ size: bad }));
    assert.equal(result.ok, false, `size=${JSON.stringify(bad)}`);
    assert.match(messages(result), /size must be one of/);
  }
});

test("schema-v3 ownership uses the same repo-relative contract as Dev", () => {
  for (const ownership of ["/tmp/file", "C:\\temp\\file", "../outside"]) {
    const result = validateRfcSidecar(sidecar({ issues: [issueRow({ owns: [ownership] })] }));
    assert.equal(result.ok, false, ownership);
    assert.match(messages(result), /repo-relative path pattern/);
  }
});

test("malformed schema-v3 ownership returns structured issues instead of throwing", () => {
  for (const owns of [42, {}, [42], ["README.md", null]]) {
    let result;
    assert.doesNotThrow(() => {
      result = validateRfcSidecar(sidecar({ issues: [issueRow({ owns })] }));
    });
    assert.equal(result.ok, false);
    assert.match(messages(result), /owns/);
    assert.doesNotMatch(messages(result), /trim is not a function/);
  }
});

// --- issues ----------------------------------------------------------------

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

test("rfc sidecar checker rejects issue titles with pipes, newlines, or control chars", () => {
  const bad = [
    "A | B",
    "line" + String.fromCharCode(10) + "x",
    "tab" + String.fromCharCode(9) + "x",
    "cr" + String.fromCharCode(13) + "x",
    "del" + String.fromCharCode(127) + "x",
  ];
  for (const title of bad) {
    const result = validateRfcSidecar(sidecar({ issues: [issueRow({ title })] }));
    assert.equal(result.ok, false, JSON.stringify(title));
    assert.match(messages(result), /title must not contain/);
  }
});

test("rfc sidecar checker rejects issue sizes outside canonical uppercase XS/S/M/L/XL", () => {
  for (const size of ["XXL", "medium", "m", "  m ", "", 2]) {
    const result = validateRfcSidecar(sidecar({ issues: [issueRow({ size })] }));
    assert.equal(result.ok, false, `size=${JSON.stringify(size)}`);
    assert.match(messages(result), /size must be one of/);
  }
});

test("rfc sidecar checker rejects test_hooks that are not arrays of non-empty strings", () => {
  const notArray = validateRfcSidecar(sidecar({ issues: [issueRow({ test_hooks: "AC-1" })] }));
  assert.equal(notArray.ok, false);
  assert.match(messages(notArray), /test_hooks must be an array/);

  const missing = validateRfcSidecar(sidecar({ issues: [issueRow({ test_hooks: undefined })] }));
  assert.equal(missing.ok, false);
  assert.match(messages(missing), /test_hooks must be an array/);

  for (const bad of [[""], ["   "], [123], [null]]) {
    const result = validateRfcSidecar(sidecar({ issues: [issueRow({ test_hooks: bad })] }));
    assert.equal(result.ok, false, `test_hooks=${JSON.stringify(bad)}`);
    assert.match(messages(result), /test_hooks\[0\] must be a non-empty string/);
  }
});

test("rfc sidecar checker requires an executable issue contract", () => {
  for (const field of [
    "depends_on",
    "owns",
    "acceptance_criteria",
    "approach",
    "verification_commands",
  ]) {
    const row = issueRow();
    delete row[field];
    const result = validateRfcSidecar(sidecar({ issues: [row] }));
    assert.equal(result.ok, false, field);
    assert.match(messages(result), new RegExp(field));
  }
  const unknown = validateRfcSidecar(
    sidecar({ issues: [issueRow({ implementation_guess: true })] })
  );
  assert.match(messages(unknown), /unknown issue field implementation_guess/);
});

test("rfc sidecar checker validates dependency references and cycles", () => {
  const missing = validateRfcSidecar(sidecar({ issues: [issueRow({ depends_on: [99] })] }));
  assert.match(messages(missing), /unknown dependency 99/);

  const cycle = validateRfcSidecar(
    sidecar({
      issues: [
        issueRow({ num: 1, depends_on: [2] }),
        issueRow({ num: 2, title: "Second", depends_on: [1], owns: ["second.js"] }),
      ],
    })
  );
  assert.match(messages(cycle), /dependencies contain a cycle/);
});

// --- test_strategy ---------------------------------------------------------

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

test("rfc sidecar checker rejects unknown test_strategy fields", () => {
  const result = validateRfcSidecar(sidecar({ test_strategy: testStrategy({ extra: "nope" }) }));
  assert.equal(result.ok, false);
  assert.match(messages(result), /unknown test_strategy field extra/);
});

// --- --slug cross-check ----------------------------------------------------

test("rfc sidecar checker cross-checks the sidecar slug against an expected slug", () => {
  const ok = validateRfcSidecar(sidecar(), "x.json", { expectedSlug: "rfc-structured-artifacts" });
  assert.equal(ok.ok, true, JSON.stringify(ok.issues, null, 2));

  const bad = validateRfcSidecar(sidecar(), "x.json", { expectedSlug: "some-other-slug" });
  assert.equal(bad.ok, false);
  assert.match(messages(bad), /slug must equal some-other-slug/);
});

// --- sidecar <-> HTML hash binding -----------------------------------------

test("extractSidecarHash pulls the sha256 attribute from HTML, null when absent", () => {
  const html = '<main class="content" data-schema-version="2" data-sidecar-hash="sha256:abc123">';
  assert.equal(extractSidecarHash(html), "sha256:abc123");
  assert.equal(extractSidecarHash('<main data-schema-version="2">'), null);
});

test("rfc sidecar checker flags a missing or mismatched data-sidecar-hash", () => {
  const s = sidecar();
  const hash = "sha256:" + sha256Hex(Buffer.from(JSON.stringify(s)));

  const match = validateRfcSidecar(s, "x.json", {
    htmlPath: "x.html",
    storedHash: hash,
    sidecarHash: hash,
  });
  assert.equal(match.ok, true, JSON.stringify(match.issues, null, 2));

  const missing = validateRfcSidecar(s, "x.json", {
    htmlPath: "x.html",
    storedHash: null,
    sidecarHash: hash,
  });
  assert.equal(missing.ok, false);
  assert.match(messages(missing), /HTML is missing data-sidecar-hash/);

  const mismatch = validateRfcSidecar(s, "x.json", {
    htmlPath: "x.html",
    storedHash: "sha256:deadbeef",
    sidecarHash: hash,
  });
  assert.equal(mismatch.ok, false);
  assert.match(messages(mismatch), /data-sidecar-hash mismatch/);
});

// --- reporting -------------------------------------------------------------

test("rfc sidecar checker reports the sidecar path in issue locations", () => {
  const result = validateRfcSidecar(sidecar({ schema_version: 9 }), "pm/backlog/rfcs/x.json");
  assert.equal(result.issues[0].file, "pm/backlog/rfcs/x.json");
});

// --- CLI -------------------------------------------------------------------

test("rfc sidecar checker CLI parses --sidecar, --html, --slug, and --json", () => {
  const parsed = parseArgs(["--sidecar", "a.json", "--html", "a.html", "--slug", "a", "--json"]);
  assert.equal(parsed.sidecarPath, "a.json");
  assert.equal(parsed.htmlPath, "a.html");
  assert.equal(parsed.expectedSlug, "a");
  assert.equal(parsed.json, true);
});

test("rfc sidecar checker CLI rejects unknown arguments and missing values", () => {
  assert.throws(() => parseArgs(["--sidecar"]), /--sidecar requires a value/);
  assert.throws(() => parseArgs(["--html"]), /--html requires a value/);
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

test("rfc sidecar checker CLI verifies the --html hash binding end-to-end", () => {
  const tmp = makeTmpSidecar(sidecar());
  try {
    const hash =
      "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(tmp.file)).digest("hex");
    const goodHtml = path.join(tmp.dir, "good.html");
    fs.writeFileSync(
      goodHtml,
      `<main data-schema-version="2" data-sidecar-hash="${hash}">x</main>`
    );
    const badHtml = path.join(tmp.dir, "bad.html");
    fs.writeFileSync(
      badHtml,
      '<main data-schema-version="2" data-sidecar-hash="sha256:0000">x</main>'
    );

    const good = spawnSync(
      process.execPath,
      [checkScript, "--sidecar", tmp.file, "--html", goodHtml, "--json"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(good.status, 0, good.stdout + good.stderr);

    const bad = spawnSync(
      process.execPath,
      [checkScript, "--sidecar", tmp.file, "--html", badHtml, "--json"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.notEqual(bad.status, 0);
    assert.match(
      JSON.parse(bad.stdout)
        .issues.map((i) => i.message)
        .join("\n"),
      /mismatch/
    );
  } finally {
    tmp.cleanup();
  }
});

test("rfc sidecar checker CLI enforces --slug", () => {
  const tmp = makeTmpSidecar(sidecar());
  try {
    const result = spawnSync(
      process.execPath,
      [checkScript, "--sidecar", tmp.file, "--slug", "wrong-slug", "--json"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.notEqual(result.status, 0);
    assert.match(
      JSON.parse(result.stdout)
        .issues.map((i) => i.message)
        .join("\n"),
      /slug must equal wrong-slug/
    );
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
