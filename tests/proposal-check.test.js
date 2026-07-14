"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(__dirname, "fixtures", "proposals", "strong-v1.json");
const legacyPath = path.join(__dirname, "fixtures", "proposals", "legacy-proposal.md");
const checker = path.join(root, "scripts", "proposal-check.js");
const {
  canonicalStringify,
  proposalContentHash,
  proposalBytesHash,
  validateProposal,
  validateApproval,
  buildApproval,
  validateRevisionTransition,
  executionContract,
  resolveProposalPaths,
  readProposal,
  readApprovedProposal,
} = require("../scripts/lib/proposal-schema.js");

function fixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function messages(result) {
  return result.issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n");
}

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-proposal-"));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("schema-v1 fixture is a strict executable proposal", () => {
  const result = validateProposal(fixture());
  assert.equal(result.ok, true, messages(result));
  const contract = executionContract(fixture());
  assert.equal(contract.slug, "structured-groom");
  assert.deepEqual(
    contract.requirements.map((item) => item.id),
    ["req:approval"]
  );
  assert.equal(contract.approval_required, true);
  assert.equal(Object.isFrozen(contract), true);
});

test("public validators return structured failures for malformed values", () => {
  for (const malformed of [null, [], "proposal", 7]) {
    const result = validateProposal(malformed);
    assert.equal(result.ok, false);
    assert.match(messages(result), /must be an object/);
  }
  const transition = validateRevisionTransition(null, fixture());
  assert.equal(transition.ok, false);
  assert.match(messages(transition), /must be an object/);
  const approval = validateApproval(null, {}, { bytes: Buffer.from("x") });
  assert.equal(approval.ok, false);
  assert.match(messages(approval), /valid proposal/);
});

test("schema is closed at every object boundary", () => {
  const cases = [
    ["top", (p) => (p.surprise = true)],
    ["source", (p) => (p.source.surprise = true)],
    ["nested row", (p) => (p.requirements[0].surprise = true)],
    ["handoff", (p) => (p.handoff.surprise = true)],
  ];
  for (const [name, mutate] of cases) {
    const proposal = fixture();
    mutate(proposal);
    const result = validateProposal(proposal);
    assert.equal(result.ok, false, name);
    assert.match(messages(result), /unknown field surprise/);
  }
});

test("identity, enums, timestamps, and required executable arrays fail closed", () => {
  const cases = [
    [(p) => (p.id = "other"), /id must equal proposal:structured-groom/],
    [(p) => (p.slug = "../escape"), /canonical slug/],
    [(p) => (p.lifecycle = "proposed"), /lifecycle must be/],
    [(p) => (p.revision = 0), /revision must be a positive integer/],
    [(p) => (p.created_at = "today"), /created_at.*ISO-8601/],
    [(p) => (p.updated_at = "2026-07-13T00:00:00.000Z"), /must not predate created_at/],
    [(p) => (p.priority = "urgent"), /priority must be/],
    [(p) => (p.size = "Medium"), /size must be/],
    [(p) => (p.confidence = "certain"), /confidence must be/],
    [(p) => (p.evidence[0].observed_at = "yesterday"), /ISO-8601/],
    [(p) => (p.requirements = []), /requirements must be a non-empty array/],
    [(p) => (p.scope.non_goals = []), /non_goals must be a non-empty array/],
    [(p) => (p.acceptance_criteria = []), /acceptance_criteria must be a non-empty array/],
  ];
  for (const [mutate, pattern] of cases) {
    const proposal = fixture();
    mutate(proposal);
    const result = validateProposal(proposal);
    assert.equal(result.ok, false, messages(result));
    assert.match(messages(result), pattern);
  }
});

test("stable IDs are unique and references resolve to the right collection", () => {
  const duplicate = fixture();
  duplicate.requirements.push({ ...duplicate.requirements[0] });
  assert.match(messages(validateProposal(duplicate)), /duplicate id req:approval/);

  const globalDuplicate = fixture();
  globalDuplicate.evidence[0].id = "req:approval";
  assert.match(
    messages(validateProposal(globalDuplicate)),
    /stable ids must be globally unique: req:approval/
  );

  const wrongNamespace = fixture();
  wrongNamespace.requirements[0].id = "evidence:not-a-requirement";
  wrongNamespace.acceptance_criteria[0].requirement_ids = ["evidence:not-a-requirement"];
  assert.match(messages(validateProposal(wrongNamespace)), /requirements ids must start with req:/);

  const badAudience = fixture();
  badAudience.jobs_to_be_done[0].audience_ids = ["audience:missing"];
  assert.match(messages(validateProposal(badAudience)), /unknown audience id audience:missing/);

  const badRequirement = fixture();
  badRequirement.acceptance_criteria[0].requirement_ids = ["req:missing"];
  assert.match(messages(validateProposal(badRequirement)), /unknown requirement id req:missing/);

  const badReview = fixture();
  badReview.question_reviews[0].evidence_refs = ["evidence:missing"];
  assert.match(messages(validateProposal(badReview)), /unknown evidence id evidence:missing/);
});

test("project paths and citations reject traversal, absolute paths, URLs, controls, and symlink escapes", () => {
  for (const unsafe of [
    "../secret",
    "/tmp/secret",
    "C:\\secret",
    "https://example.com/x",
    "pm/x\u0000.md",
  ]) {
    const proposal = fixture();
    proposal.evidence[0].path = unsafe;
    assert.match(messages(validateProposal(proposal)), /project-relative path/);
  }

  const project = tmpProject();
  try {
    fs.mkdirSync(path.join(project.dir, "pm", "backlog", "proposals"), { recursive: true });
    fs.symlinkSync(os.tmpdir(), path.join(project.dir, "pm", "backlog", "proposals", "linked"));
    assert.throws(
      () =>
        readProposal(path.join(project.dir, "pm/backlog/proposals/linked/escape.json"), {
          projectRoot: project.dir,
        }),
      /symlink|bounded/
    );
  } finally {
    project.cleanup();
  }
});

test("content hashing is deterministic, semantic, and revision-sensitive", () => {
  const proposal = fixture();
  const reordered = Object.fromEntries(Object.entries(proposal).reverse());
  assert.equal(proposalContentHash(proposal), proposalContentHash(reordered));
  assert.equal(canonicalStringify(proposal), canonicalStringify(reordered));

  proposal.lifecycle = "reviewed";
  assert.equal(
    proposalContentHash(proposal),
    proposalContentHash(fixture()),
    "lifecycle alone is not substantive"
  );
  proposal.revision += 1;
  assert.notEqual(proposalContentHash(proposal), proposalContentHash(fixture()));
  proposal.requirements[0].statement += " Exactly.";
  assert.notEqual(proposalContentHash(proposal), proposalContentHash(fixture()));
});

test("reviewed and approved lifecycle require review bound to current revision and content", () => {
  const reviewed = fixture();
  reviewed.lifecycle = "reviewed";
  const result = validateProposal(reviewed);
  assert.equal(result.ok, false);
  assert.match(messages(result), /review must be passed/);

  reviewed.review = {
    status: "passed",
    revision: reviewed.revision,
    content_sha256: proposalContentHash(reviewed),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  assert.equal(validateProposal(reviewed).ok, true, messages(validateProposal(reviewed)));
  reviewed.requirements[0].statement += " Changed.";
  assert.match(messages(validateProposal(reviewed)), /review content hash does not match/);
  reviewed.revision += 1;
  assert.match(messages(validateProposal(reviewed)), /review revision does not match/);

  const staleDraft = fixture();
  staleDraft.review = {
    status: "passed",
    revision: 1,
    content_sha256: proposalContentHash(staleDraft),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  staleDraft.requirements[0].statement += " Stale.";
  assert.match(messages(validateProposal(staleDraft)), /review content hash does not match/);
});

test("revision transition hook separates lifecycle changes from substantive revisions", () => {
  const previous = fixture();
  const reviewed = structuredClone(previous);
  reviewed.lifecycle = "reviewed";
  reviewed.review = {
    status: "passed",
    revision: 1,
    content_sha256: proposalContentHash(reviewed),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  assert.equal(validateRevisionTransition(previous, reviewed).ok, true);

  const silentEdit = structuredClone(previous);
  silentEdit.requirements[0].statement += " Changed without revision.";
  assert.match(
    messages(validateRevisionTransition(previous, silentEdit)),
    /substantive changes require revision 2/
  );

  const revised = structuredClone(previous);
  revised.revision = 2;
  revised.updated_at = "2026-07-14T02:30:00.000Z";
  revised.requirements[0].statement += " Changed with revision.";
  assert.equal(
    validateRevisionTransition(previous, revised).ok,
    true,
    messages(validateRevisionTransition(previous, revised))
  );

  const staleReview = structuredClone(reviewed);
  staleReview.revision = 2;
  staleReview.requirements[0].statement += " Changed.";
  assert.match(
    messages(validateRevisionTransition(reviewed, staleReview)),
    /return to draft with pending review/
  );

  const skipped = structuredClone(previous);
  skipped.revision = 3;
  skipped.requirements[0].statement += " Changed.";
  assert.match(messages(validateRevisionTransition(previous, skipped)), /revision 2/);
});

test("post-approval lifecycle advances monotonically without invalidating semantic approval", () => {
  const approved = fixture();
  approved.lifecycle = "approved";
  approved.review = {
    status: "passed",
    revision: 1,
    content_sha256: proposalContentHash(approved),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  let previous = approved;
  for (const lifecycle of ["planned", "in-progress", "done"]) {
    const next = structuredClone(previous);
    next.lifecycle = lifecycle;
    next.updated_at = new Date(Date.parse(next.updated_at) + 60_000).toISOString();
    const result = validateRevisionTransition(previous, next);
    assert.equal(result.ok, true, messages(result));
    assert.equal(result.substantive_change, false);
    previous = next;
  }
  const backwards = structuredClone(previous);
  backwards.lifecycle = "planned";
  assert.match(messages(validateRevisionTransition(previous, backwards)), /not allowed/);
  const silentReopen = structuredClone(previous);
  silentReopen.lifecycle = "draft";
  silentReopen.review = {
    status: "pending",
    revision: null,
    content_sha256: null,
    completed_at: null,
  };
  assert.match(
    messages(validateRevisionTransition(previous, silentReopen)),
    /substantive revision/
  );
});

test("approval binds canonical identity, lifecycle, revision, semantic content, and exact bytes", () => {
  const proposal = fixture();
  proposal.lifecycle = "approved";
  proposal.review = {
    status: "passed",
    revision: proposal.revision,
    content_sha256: proposalContentHash(proposal),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  const bytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  const approval = buildApproval(proposal, bytes, {
    approvedBy: "user:owner",
    approvedAt: "2026-07-14T03:00:00.000Z",
    decisionId: "groom-decision-01",
    decisionSha256: `sha256:${"2".repeat(64)}`,
  });
  assert.equal(
    validateApproval(proposal, approval, {
      bytes,
      expectedDecision: {
        id: "groom-decision-01",
        sha256: `sha256:${"2".repeat(64)}`,
      },
    }).ok,
    true
  );
  assert.equal(approval.proposal_sha256, proposalBytesHash(bytes));

  const reformatted = Buffer.from(JSON.stringify(proposal));
  assert.match(
    messages(validateApproval(proposal, approval, { bytes: reformatted })),
    /exact proposal bytes/
  );
  const revised = structuredClone(proposal);
  revised.revision += 1;
  assert.match(messages(validateApproval(revised, approval, { bytes })), /revision/);
  assert.match(
    messages(validateApproval({ ...proposal, lifecycle: "reviewed" }, approval, { bytes })),
    /approved lifecycle/
  );
  assert.match(
    messages(
      validateApproval(
        proposal,
        { ...approval, approved_at: "2026-07-14T01:00:00.000Z" },
        { bytes }
      )
    ),
    /cannot predate review completion/
  );
  assert.match(
    messages(
      validateApproval(proposal, approval, {
        bytes,
        expectedDecision: { id: "other", sha256: `sha256:${"2".repeat(64)}` },
      })
    ),
    /session approval decision/
  );
  assert.throws(
    () =>
      buildApproval(proposal, bytes, { approvedBy: "  ", approvedAt: "2026-07-14T03:00:00.000Z" }),
    /approvedBy/
  );
});

test("approval schema rejects unknown fields and forged hashes", () => {
  const proposal = fixture();
  proposal.lifecycle = "approved";
  proposal.review = {
    status: "passed",
    revision: 1,
    content_sha256: proposalContentHash(proposal),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  const bytes = Buffer.from(JSON.stringify(proposal));
  const approval = buildApproval(proposal, bytes, {
    approvedBy: "user:owner",
    approvedAt: "2026-07-14T03:00:00.000Z",
  });
  assert.match(
    messages(validateApproval(proposal, { ...approval, surprise: true }, { bytes })),
    /unknown field surprise/
  );
  assert.match(
    messages(
      validateApproval(
        proposal,
        { ...approval, content_sha256: `sha256:${"0".repeat(64)}` },
        { bytes }
      )
    ),
    /content hash/
  );
});

test("approved reader preserves trust after lifecycle-only downstream transitions", () => {
  const project = tmpProject();
  try {
    const proposal = fixture();
    proposal.lifecycle = "approved";
    proposal.review = {
      status: "passed",
      revision: 1,
      content_sha256: proposalContentHash(proposal),
      completed_at: "2026-07-14T02:00:00.000Z",
    };
    const paths = resolveProposalPaths(project.dir, proposal.slug);
    fs.mkdirSync(path.dirname(paths.json), { recursive: true });
    fs.writeFileSync(paths.json, `${JSON.stringify(proposal, null, 2)}\n`);
    const approval = buildApproval(proposal, fs.readFileSync(paths.json), {
      approvedBy: "user:owner",
      approvedAt: "2026-07-14T03:00:00.000Z",
      decisionId: "groom-approval:groom_test",
      decisionSha256: `sha256:${"4".repeat(64)}`,
    });
    fs.writeFileSync(paths.approval, `${JSON.stringify(approval, null, 2)}\n`);

    const unbound = { ...approval, decision_id: null, decision_sha256: null };
    fs.writeFileSync(paths.approval, `${JSON.stringify(unbound, null, 2)}\n`);
    assert.throws(
      () => readApprovedProposal(paths.json, { projectRoot: project.dir }),
      /bound Groom decision identity/
    );
    fs.writeFileSync(paths.approval, `${JSON.stringify(approval, null, 2)}\n`);

    const exact = readApprovedProposal(paths.json, { projectRoot: project.dir });
    assert.equal(exact.exactBytesCurrent, true);
    assert.equal(exact.approvalBasis, "exact-approved-bytes");

    proposal.lifecycle = "planned";
    proposal.updated_at = "2026-07-14T04:00:00.000Z";
    fs.writeFileSync(paths.json, `${JSON.stringify(proposal, null, 2)}\n`);
    const planned = readApprovedProposal(paths.json, { projectRoot: project.dir });
    assert.equal(planned.trustedApproval, true);
    assert.equal(planned.exactBytesCurrent, false);
    assert.equal(planned.approvalBasis, "approved-semantic-revision");

    proposal.requirements[0].statement += " Forged after approval.";
    fs.writeFileSync(paths.json, `${JSON.stringify(proposal, null, 2)}\n`);
    assert.throws(
      () => readApprovedProposal(paths.json, { projectRoot: project.dir }),
      /content hash/
    );
  } finally {
    project.cleanup();
  }
});

test("bounded reader validates canonical JSON and keeps legacy Markdown inspection-only", () => {
  const project = tmpProject();
  try {
    const paths = resolveProposalPaths(project.dir, "structured-groom");
    fs.mkdirSync(path.dirname(paths.json), { recursive: true });
    fs.copyFileSync(fixturePath, paths.json);
    const canonical = readProposal(paths.json, { projectRoot: project.dir });
    assert.equal(canonical.kind, "canonical-json");
    assert.equal(canonical.trustedApproval, false);
    assert.equal(canonical.proposal.slug, "structured-groom");
    assert.equal(canonical.bytesSha256, proposalBytesHash(fs.readFileSync(paths.json)));

    const legacyFile = path.join(project.dir, "pm", "backlog", "legacy-proposal.md");
    fs.copyFileSync(legacyPath, legacyFile);
    const legacy = readProposal(legacyFile, { projectRoot: project.dir, allowLegacy: true });
    assert.equal(legacy.kind, "legacy-markdown");
    assert.equal(legacy.trustedApproval, false);
    assert.equal(legacy.lifecycle, "proposed");
    assert.equal(legacy.title, "Legacy proposal");
    assert.match(legacy.body, /predates the canonical JSON contract/);
    assert.throws(
      () => readProposal(legacyFile, { projectRoot: project.dir }),
      /legacy compatibility/
    );
  } finally {
    project.cleanup();
  }
});

test("reader and path resolver enforce canonical slugs, project roots, regular files, and size limit", () => {
  const project = tmpProject();
  try {
    assert.throws(() => resolveProposalPaths(project.dir, "../escape"), /canonical slug/);
    assert.throws(() => readProposal("/tmp/outside.json", { projectRoot: project.dir }), /bounded/);
    const file = path.join(project.dir, "large.json");
    fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.throws(() => readProposal(file, { projectRoot: project.dir }), /2 MiB/);
  } finally {
    project.cleanup();
  }
});

test("CLI checks canonical proposal and optional approval with structured output", () => {
  const project = tmpProject();
  try {
    const proposal = fixture();
    proposal.lifecycle = "approved";
    proposal.review = {
      status: "passed",
      revision: 1,
      content_sha256: proposalContentHash(proposal),
      completed_at: "2026-07-14T02:00:00.000Z",
    };
    const proposalFile = path.join(project.dir, "pm/backlog/proposals/structured-groom.json");
    fs.mkdirSync(path.dirname(proposalFile), { recursive: true });
    fs.writeFileSync(proposalFile, `${JSON.stringify(proposal, null, 2)}\n`);
    const bytes = fs.readFileSync(proposalFile);
    const approval = buildApproval(proposal, bytes, {
      approvedBy: "user:owner",
      approvedAt: "2026-07-14T03:00:00.000Z",
      decisionId: "groom-decision-01",
      decisionSha256: `sha256:${"3".repeat(64)}`,
    });
    const approvalFile = proposalFile.replace(/\.json$/, ".approval.json");
    fs.writeFileSync(approvalFile, `${JSON.stringify(approval, null, 2)}\n`);

    const trusted = readApprovedProposal(proposalFile, { projectRoot: project.dir });
    assert.equal(trusted.trustedApproval, true);
    assert.equal(trusted.contract.slug, "structured-groom");

    const run = spawnSync(
      process.execPath,
      [
        checker,
        "--proposal",
        proposalFile,
        "--approval",
        approvalFile,
        "--project-root",
        project.dir,
        "--slug",
        "structured-groom",
        "--decision-id",
        "groom-decision-01",
        "--decision-sha256",
        `sha256:${"3".repeat(64)}`,
        "--json",
      ],
      { encoding: "utf8" }
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.content_sha256, proposalContentHash(proposal));
    assert.equal(result.proposal_sha256, proposalBytesHash(bytes));

    const mismatch = spawnSync(
      process.execPath,
      [
        checker,
        "--proposal",
        proposalFile,
        "--project-root",
        project.dir,
        "--slug",
        "wrong",
        "--json",
      ],
      { encoding: "utf8" }
    );
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stdout, /slug must equal wrong/);

    const plain = spawnSync(
      process.execPath,
      [
        checker,
        "--proposal",
        proposalFile,
        "--approval",
        approvalFile,
        "--project-root",
        project.dir,
      ],
      { encoding: "utf8" }
    );
    assert.equal(plain.status, 0, plain.stderr || plain.stdout);
    assert.match(plain.stdout, /Proposal check passed/);

    fs.unlinkSync(approvalFile);
    const crashWindow = spawnSync(
      process.execPath,
      [checker, "--proposal", proposalFile, "--project-root", project.dir, "--json"],
      { encoding: "utf8" }
    );
    assert.equal(crashWindow.status, 1);
    assert.match(crashWindow.stdout, /ENOENT/);
  } finally {
    project.cleanup();
  }
});

test("byte hash helper is exact and carries the sha256 prefix", () => {
  const bytes = Buffer.from("proposal bytes\n");
  const expected = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(proposalBytesHash(bytes), expected);
});
