"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeJsonAtomic, writeTextAtomic } = require("../scripts/lib/atomic-file");

test("shared atomic writers replace content with requested permissions and no residue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-atomic-file-"));
  try {
    const jsonPath = path.join(root, "nested", "state.json");
    writeJsonAtomic(jsonPath, { version: 1 }, { directoryMode: 0o700, fileMode: 0o600 });
    writeJsonAtomic(jsonPath, { version: 2 }, { directoryMode: 0o700, fileMode: 0o600 });
    assert.deepEqual(JSON.parse(fs.readFileSync(jsonPath, "utf8")), { version: 2 });
    assert.equal(fs.statSync(jsonPath).mode & 0o777, 0o600);

    const textPath = path.join(root, "nested", "report.txt");
    writeTextAtomic(textPath, "complete\n", { fileMode: 0o600 });
    assert.equal(fs.readFileSync(textPath, "utf8"), "complete\n");
    assert.deepEqual(
      fs.readdirSync(path.dirname(jsonPath)).filter((name) => name.includes(".tmp-")),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
