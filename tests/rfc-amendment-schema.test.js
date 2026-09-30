"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
let Ajv2020;
let addFormats;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
const { approvalTransitionDigest, validateSession } = require("../scripts/lib/rfc-session-schema");
const {
  completeAmendment,
  completeApprovedRun,
  makeRfcRepo,
} = require("./helpers/rfc-run-fixture");

const SLUG = "amendment-schema";
const REFERENCES = path.join(__dirname, "..", "skills", "rfc", "references");

function twoIssues() {
  return [1, 2].map((num) => ({
    num,
    title: `Issue ${num}`,
    size: "S",
    depends_on: num === 1 ? [] : [1],
    owns: [num === 1 ? "README.md" : "src/two.js"],
    acceptance_criteria: [`AC-${num}`],
    approach: `Implement issue ${num}.`,
    verification_commands: ["node --test"],
    test_hooks: [`AC-${num}`],
  }));
}

function amendedRepo() {
  const repo = makeRfcRepo();
  const approved = completeApprovedRun(repo, SLUG, { issues: twoIssues() });
  const approvalRel = `${SLUG}.approval.json`;
  const v1Audit = JSON.parse(
    execFileSync("git", ["show", `HEAD:${approvalRel}`], { cwd: repo.root, encoding: "utf8" })
  );
  const amendment = completeAmendment(repo, approved.archivePath, {
    issues: "2",
    reason: "Issue 2 must also update the README",
    mutate: (sidecar) => sidecar.issues[1].owns.push("README.md"),
  });
  return {
    repo,
    approved,
    amendment,
    v1Audit,
    v2Audit: JSON.parse(fs.readFileSync(path.join(repo.root, approvalRel), "utf8")),
    original: JSON.parse(fs.readFileSync(approved.archivePath, "utf8")),
    amended: JSON.parse(fs.readFileSync(amendment.archivePath, "utf8")),
  };
}

function compile(name) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(REFERENCES, name), "utf8")));
}

test("legacy archives without an amendment field keep validating and keep their v1 digest", () => {
  const fixture = amendedRepo();
  try {
    const legacy = structuredClone(fixture.original);
    delete legacy.amendment;
    assert.deepEqual(validateSession(legacy), []);
    assert.equal(fixture.original.amendment, null);
    assert.equal(approvalTransitionDigest(legacy), approvalTransitionDigest(fixture.original));
    assert.equal(
      approvalTransitionDigest(fixture.original),
      fixture.v1Audit.approval_transition_sha256
    );
    assert.deepEqual(validateSession(fixture.amended), []);
    assert.equal(fixture.amended.amendment.of_run_id, fixture.approved.runId);
  } finally {
    fixture.repo.cleanup();
  }
});

test(
  "published RFC schemas accept v1 and v2 approvals and amendment sessions exactly as runtime does",
  { skip: !Ajv2020 && "Ajv 2020 dev dependency is not installed in this snapshot" },
  () => {
    const fixture = amendedRepo();
    try {
      const approval = compile("rfc-approval.schema.json");
      assert.equal(approval(fixture.v1Audit), true, JSON.stringify(approval.errors));
      assert.equal(approval(fixture.v2Audit), true, JSON.stringify(approval.errors));
      assert.equal(fixture.v2Audit.schema_version, 2);
      assert.equal(fixture.v2Audit.amends.run_id, fixture.approved.runId);
      assert.equal(approval({ ...fixture.v1Audit, amends: fixture.v2Audit.amends }), false);
      const { amends: _amends, ...v2WithoutLineage } = fixture.v2Audit;
      assert.equal(approval(v2WithoutLineage), false);
      assert.equal(approval({ ...fixture.v2Audit, amended_issue_nums: [] }), false);

      const session = compile("rfc-session.schema.json");
      const legacy = structuredClone(fixture.original);
      delete legacy.amendment;
      for (const [label, value] of [
        ["original", fixture.original],
        ["legacy", legacy],
        ["amended", fixture.amended],
      ]) {
        assert.equal(session(value), true, `${label}: ${JSON.stringify(session.errors)}`);
      }
      const extraField = structuredClone(fixture.amended);
      extraField.amendment.approved_by = "someone";
      assert.equal(session(extraField), false);
      assert.ok(validateSession(extraField).some((entry) => entry.path.startsWith("$.amendment")));
      const unsorted = structuredClone(fixture.amended);
      unsorted.amendment.amended_issue_nums = [];
      assert.equal(session(unsorted), false);
      assert.ok(validateSession(unsorted).some((entry) => entry.path.startsWith("$.amendment")));
    } finally {
      fixture.repo.cleanup();
    }
  }
);
