"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { verifyRfcApproval } = require("../scripts/lib/rfc-approval-audit");
const {
  completeAmendment,
  completeApprovedRun,
  makeRfcRepo,
  twoIssues,
} = require("./helpers/rfc-run-fixture");

const SLUG = "audit-lineage";

test("a v1 approval verifies against its completed run with a single-hop lineage", () => {
  const repo = makeRfcRepo();
  try {
    const approved = completeApprovedRun(repo, SLUG, { issues: twoIssues() });
    const sidecarPath = path.join(repo.root, `${SLUG}.json`);
    const verified = verifyRfcApproval({ sidecarPath, slug: SLUG, archiveRepoRoot: repo.root });
    assert.equal(verified.approval.schema_version, 1);
    assert.equal(verified.archived.run_id, approved.runId);
    assert.equal(verified.artifact_repo_root, fs.realpathSync(repo.root));
    assert.deepEqual(
      verified.lineage.map((hop) => hop.run_id),
      [approved.runId]
    );
    assert.match(verified.approval_sha256, /^sha256:[0-9a-f]{64}$/);
  } finally {
    repo.cleanup();
  }
});

test("a v2 amendment approval walks its owns-only lineage back to the bound sidecar", () => {
  const repo = makeRfcRepo();
  try {
    const approved = completeApprovedRun(repo, SLUG, { issues: twoIssues() });
    const sidecarPath = path.join(repo.root, `${SLUG}.json`);
    const boundHash = verifyRfcApproval({
      sidecarPath,
      slug: SLUG,
      archiveRepoRoot: repo.root,
    }).sidecar_sha256;
    const amendment = completeAmendment(repo, approved.archivePath, {
      issues: "2",
      reason: "Issue 2 must also update the README",
      mutate: (sidecar) => sidecar.issues[1].owns.push("README.md"),
    });
    const verified = verifyRfcApproval({
      sidecarPath,
      slug: SLUG,
      archiveRepoRoot: repo.root,
      lineageTo: boundHash,
    });
    assert.equal(verified.approval.schema_version, 2);
    assert.equal(verified.sidecar_sha256, amendment.sidecarHash);
    assert.deepEqual(verified.lineage, [
      { run_id: amendment.runId, sidecar_sha256: amendment.sidecarHash },
      { run_id: approved.runId, sidecar_sha256: boundHash },
    ]);
    assert.throws(
      () =>
        verifyRfcApproval({
          sidecarPath,
          slug: SLUG,
          archiveRepoRoot: repo.root,
          lineageTo: `sha256:${"a".repeat(64)}`,
        }),
      /does not descend from the bound sidecar/
    );
  } finally {
    repo.cleanup();
  }
});

test("lineage verification fails closed on a missing prior run or an uncommitted audit", () => {
  const repo = makeRfcRepo();
  try {
    const approved = completeApprovedRun(repo, SLUG, { issues: twoIssues() });
    const sidecarPath = path.join(repo.root, `${SLUG}.json`);
    const boundHash = verifyRfcApproval({
      sidecarPath,
      slug: SLUG,
      archiveRepoRoot: repo.root,
    }).sidecar_sha256;
    completeAmendment(repo, approved.archivePath, {
      issues: "2",
      reason: "Issue 2 must also update the README",
      mutate: (sidecar) => sidecar.issues[1].owns.push("README.md"),
    });
    const approvalPath = sidecarPath.replace(/\.json$/, ".approval.json");
    const committedBytes = fs.readFileSync(approvalPath);
    fs.writeFileSync(approvalPath, `${JSON.stringify(JSON.parse(committedBytes))}\n\n`);
    assert.throws(
      () => verifyRfcApproval({ sidecarPath, slug: SLUG, archiveRepoRoot: repo.root }),
      /differs from the committed approval audit/
    );
    fs.writeFileSync(approvalPath, committedBytes);
    const priorDir = path.dirname(approved.archivePath);
    const parked = `${priorDir}.parked`;
    fs.renameSync(priorDir, parked);
    assert.throws(
      () =>
        verifyRfcApproval({
          sidecarPath,
          slug: SLUG,
          archiveRepoRoot: repo.root,
          lineageTo: boundHash,
        }),
      new RegExp(`${approved.runId} has no matching completed RFC run`)
    );
    fs.renameSync(parked, priorDir);
  } finally {
    repo.cleanup();
  }
});
