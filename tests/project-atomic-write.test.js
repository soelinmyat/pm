"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  writeProjectJsonAtomic,
  writeProjectTextAtomic,
} = require("../scripts/lib/project-atomic-write");

const writerModule = path.join(__dirname, "..", "scripts", "lib", "project-atomic-write.js");

test("project writer atomically replaces or exclusively creates inside anchored directories", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeProjectJsonAtomic(root, ".pm/review/report.json", { version: 1 }, { fileMode: 0o600 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".pm/review/report.json"))), {
    version: 1,
  });
  writeProjectTextAtomic(root, ".pm/review/report.json", "replacement", { fileMode: 0o600 });
  assert.equal(fs.readFileSync(path.join(root, ".pm/review/report.json"), "utf8"), "replacement");
  assert.throws(
    () =>
      writeProjectTextAtomic(root, ".pm/review/report.json", "forbidden", {
        replace: false,
      }),
    /EEXIST|file exists/i
  );
});

test("project writer rejects an ancestor swap before its child anchors the root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-race-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "review"));
  fs.writeFileSync(path.join(outside, "report.json"), "outside-sentinel");
  assert.throws(
    () =>
      writeProjectTextAtomic(root, "review/report.json", "unsafe", {
        beforeSpawn() {
          fs.renameSync(path.join(root, "review"), path.join(root, "review-original"));
          fs.symlinkSync(outside, path.join(root, "review"), "dir");
        },
      }),
    /not a real directory/
  );
  assert.equal(fs.readFileSync(path.join(outside, "report.json"), "utf8"), "outside-sentinel");
});

test("anchored rename stays in the opened directory when its project path is swapped", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-commit-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-commit-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "review"));
  fs.writeFileSync(path.join(outside, "report.html"), "outside-sentinel");
  const script = `
    const fs = require("node:fs");
    const path = require("node:path");
    const [root, outside, writer] = process.argv.slice(1);
    const { writeFromAnchoredRoot } = require(writer);
    process.chdir(root);
    writeFromAnchoredRoot("review/report.html", Buffer.from("inside-report"), {
      beforeCommit() {
        fs.renameSync(path.join(root, "review"), path.join(root, "review-original"));
        fs.symlinkSync(outside, path.join(root, "review"), "dir");
      },
    });
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, outside, writerModule], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(outside, "report.html"), "utf8"), "outside-sentinel");
  assert.equal(
    fs.readFileSync(path.join(root, "review-original", "report.html"), "utf8"),
    "inside-report"
  );
});
