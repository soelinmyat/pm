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
  proposalReviewCoverage,
  deriveApprovalDecision,
  validateProposal,
  validateCurrentProposalEvidence,
  validateApproval,
  buildApproval,
  validateRevisionTransition,
  executionContract,
  resolveProposalPaths,
  readProposal,
  readApprovedProposal,
} = require("../scripts/lib/proposal-schema.js");
const { buildPrototypeIdentity } = require("../scripts/lib/dev-work-units.js");
const {
  bindCurrentReviewContract,
  materializeProposalSources,
  reviewRowForTier,
} = require("./helpers/groom-review-fixture.js");

function fixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function designContext(overrides = {}) {
  return {
    design_requirements: ["Show lifecycle, revision, approval state, and open decisions visibly."],
    ui_impact: true,
    prototype: null,
    critical_states: ["draft", "reviewed", "approved", "stale approval"],
    experience_invariants: [
      "Reviewers can identify the current decision state before inspecting implementation detail.",
    ],
    visual_invariants: ["Lifecycle and approval state remain visible at narrow widths."],
    ...overrides,
  };
}

function messages(result) {
  return result.issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n");
}

const FULL_REVIEW_IDS = [
  "problem-evidence",
  "scope",
  "acceptance",
  "experience",
  "feasibility",
  "reversal",
];

function bindReviewContract(proposal, questionIds = FULL_REVIEW_IDS) {
  proposal.review_contract = {
    session_id: proposal.source.session_id,
    tier: "full",
    required_question_ids: [...questionIds],
  };
  proposal.question_reviews = questionIds.map((questionId, index) =>
    reviewRowForTier("full", questionId, index)
  );
  return proposal;
}

function buildCurrentApproval(proposal, bytes, { approvedBy, approvedAt }) {
  const decision = deriveApprovalDecision(proposal, { approvedBy, approvedAt });
  return buildApproval(proposal, bytes, {
    approvedBy,
    approvedAt,
    decisionId: decision.id,
    decisionSha256: decision.sha256,
  });
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

test("proposal execution contract preserves one closed design context", () => {
  const proposal = fixture();
  proposal.design_context = designContext();
  const result = validateProposal(proposal);
  assert.equal(result.ok, true, messages(result));
  assert.deepEqual(executionContract(proposal).design_context, proposal.design_context);

  proposal.design_context.design_requirements[0] = "A different requirement.";
  assert.match(messages(validateProposal(proposal)), /must match design_requirements/i);
});

test("bounded proposal reads recompute prototype hashes from repository bytes", () => {
  const project = tmpProject();
  try {
    const prototypePath = "pm/backlog/wireframes/structured-groom.html";
    const absolutePrototype = path.join(project.dir, prototypePath);
    fs.mkdirSync(path.dirname(absolutePrototype), { recursive: true });
    fs.writeFileSync(absolutePrototype, "<main>approved prototype</main>\n");
    const prototypeHash = `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolutePrototype))
      .digest("hex")}`;
    const proposal = fixture();
    proposal.design_context = designContext({
      prototype: { path: prototypePath, sha256: prototypeHash },
    });
    const proposalPath = path.join(
      project.dir,
      "pm",
      "backlog",
      "proposals",
      "structured-groom.json"
    );
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);

    assert.equal(
      readProposal(proposalPath, { projectRoot: project.dir }).proposal.slug,
      proposal.slug
    );
    fs.writeFileSync(absolutePrototype, "<main>drifted prototype</main>\n");
    assert.throws(
      () => readProposal(proposalPath, { projectRoot: project.dir }),
      /prototype.*sha256.*does not match repository bytes/i
    );
  } finally {
    project.cleanup();
  }
});

test("current proposal reads bind every file in a multi-file prototype", () => {
  const project = tmpProject();
  try {
    const prefix = "pm/backlog/wireframes/structured-groom";
    const files = {
      [`${prefix}/index.html`]: '<a href="decision.html">Decision</a>\n',
      [`${prefix}/base.css`]: ".screen { display: grid; }\n",
      [`${prefix}/decision.html`]: '<section class="screen">Decision</section>\n',
      [`${prefix}/meta.json`]: `${JSON.stringify({
        slug: "structured-groom",
        screens: [
          {
            id: "decision",
            label: "Decision",
            file: "decision.html",
            states: ["populated"],
          },
        ],
      })}\n`,
    };
    for (const [relative, bytes] of Object.entries(files)) {
      const target = path.join(project.dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    const proposal = fixture();
    proposal.design_context = designContext({
      prototype: buildPrototypeIdentity(`${prefix}/index.html`, project.dir),
    });
    const proposalPath = path.join(project.dir, "pm/backlog/proposals/structured-groom.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);

    const source = readProposal(proposalPath, {
      projectRoot: project.dir,
      requireCurrentPrototypeIdentity: true,
      requireExperienceClassification: true,
    });
    assert.deepEqual(
      executionContract(source.proposal).design_context.prototype.manifest,
      proposal.design_context.prototype.manifest
    );

    fs.writeFileSync(path.join(project.dir, `${prefix}/decision.html`), "<main>drifted</main>\n");
    assert.throws(
      () =>
        readProposal(proposalPath, {
          projectRoot: project.dir,
          requireCurrentPrototypeIdentity: true,
          requireExperienceClassification: true,
        }),
      /prototype.*manifest.*decision\.html/i
    );
  } finally {
    project.cleanup();
  }
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

test("current review evidence is bound to retained source bytes and mechanically resolvable locators", () => {
  const project = tmpProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-proposal-evidence-outside-"));
  try {
    const proposal = bindCurrentReviewContract(fixture());
    materializeProposalSources(project.dir, proposal);
    const proposalPath = path.join(
      project.dir,
      "pm",
      "backlog",
      "proposals",
      `${proposal.slug}.json`
    );
    const sourcePath = path.join(project.dir, proposal.source.lineage[0].path);
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    const write = () => fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
    write();
    assert.equal(
      validateProposal(proposal, { projectRoot: project.dir }).ok,
      true,
      messages(validateProposal(proposal, { projectRoot: project.dir }))
    );
    assert.doesNotThrow(() => readProposal(proposalPath, { projectRoot: project.dir }));

    const preciseLocators = proposal.question_reviews.map((review) => review.evidence[0].locator);
    proposal.question_reviews.forEach((review, index) => {
      review.evidence[0].locator = index % 2 === 0 ? "the" : "ion";
    });
    write();
    assert.throws(
      () => readProposal(proposalPath, { projectRoot: project.dir }),
      /literal locator is too broad/i
    );
    proposal.question_reviews.forEach((review, index) => {
      review.evidence[0].locator = preciseLocators[index];
    });

    const preciseBytes = fs.readFileSync(sourcePath);
    const ambiguousBytes = Buffer.concat([
      preciseBytes,
      Buffer.from(
        "approval transition marker identifies reviewed lifecycle evidence\napproval transition marker identifies reviewed lifecycle evidence\n"
      ),
    ]);
    fs.writeFileSync(sourcePath, ambiguousBytes);
    proposal.source.lineage[0].sha256 = proposalBytesHash(ambiguousBytes);
    proposal.question_reviews[0].evidence[0].locator = "approval transition marker";
    write();
    assert.throws(
      () => readProposal(proposalPath, { projectRoot: project.dir }),
      /literal locator is ambiguous/i
    );
    fs.writeFileSync(sourcePath, preciseBytes);
    proposal.source.lineage[0].sha256 = proposalBytesHash(preciseBytes);
    proposal.question_reviews[0].evidence[0].locator = preciseLocators[0];

    const realHash = proposal.source.lineage[0].sha256;
    proposal.source.lineage[0].sha256 = `sha256:${"0".repeat(64)}`;
    write();
    assert.match(
      messages(validateProposal(proposal, { projectRoot: project.dir })),
      /does not match the retained source bytes/
    );
    proposal.source.lineage[0].sha256 = realHash;

    const realLocator = proposal.question_reviews[0].evidence[0].locator;
    proposal.question_reviews[0].evidence[0].locator = "F999-invented";
    write();
    assert.throws(
      () => readProposal(proposalPath, { projectRoot: project.dir }),
      /locator does not occur in the retained source/
    );
    proposal.question_reviews[0].evidence[0].locator = realLocator;

    const relevantBytes = fs.readFileSync(sourcePath);
    fs.rmSync(sourcePath);
    write();
    assert.throws(
      () => readProposal(proposalPath, { projectRoot: project.dir }),
      /retained evidence source does not exist/
    );
    fs.writeFileSync(sourcePath, relevantBytes);

    const irrelevantBytes = Buffer.from(
      "F1 Banana inventory and tropical weather totals.\nF2 Unrelated catering schedule and office paint colors.\n"
    );
    fs.writeFileSync(sourcePath, irrelevantBytes);
    proposal.source.lineage[0].sha256 = proposalBytesHash(irrelevantBytes);
    write();
    assert.throws(
      () => readProposal(proposalPath, { projectRoot: project.dir }),
      /does not connect the located source content to this review answer/
    );

    fs.writeFileSync(sourcePath, relevantBytes);
    proposal.source.lineage[0].sha256 = proposalBytesHash(relevantBytes);
    const target = path.join(outside, "evidence.md");
    fs.writeFileSync(target, relevantBytes);
    fs.rmSync(sourcePath);
    fs.symlinkSync(target, sourcePath);
    write();
    assert.throws(
      () => readProposal(proposalPath, { projectRoot: project.dir }),
      /must not use symlinks/
    );

    fs.rmSync(sourcePath);
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, "x");
    fs.writeFileSync(sourcePath, oversized);
    proposal.source.lineage[0].sha256 = proposalBytesHash(oversized);
    write();
    assert.throws(
      () => readProposal(proposalPath, { projectRoot: project.dir }),
      /exceeds the 8 MiB validation limit/
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    project.cleanup();
  }
});

test("Markdown heading locators preserve Unicode and canonical equivalence", () => {
  const cases = [
    { heading: "顧客調査", locator: "#顧客調査" },
    { heading: "Résumé", locator: "#Re\u0301sume\u0301" },
    { heading: "Re\u0301sume\u0301", locator: "#Résumé" },
  ];

  for (const { heading, locator } of cases) {
    const project = tmpProject();
    try {
      const proposal = bindCurrentReviewContract(fixture());
      for (const review of proposal.question_reviews) review.evidence[0].locator = locator;
      const source = proposal.source.lineage[0];
      const sourcePath = path.join(project.dir, source.path);
      const reviewText = proposal.question_reviews
        .map((review) => `${review.conclusion} ${review.rationale} ${review.evidence[0].relevance}`)
        .join("\n");
      const bytes = Buffer.from(`# ${heading}\n\n${reviewText}\n`);
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, bytes);
      source.sha256 = proposalBytesHash(bytes);

      const result = validateCurrentProposalEvidence(proposal, project.dir);
      assert.equal(result.ok, true, `${heading} -> ${locator}: ${messages(result)}`);
    } finally {
      project.cleanup();
    }
  }
});

test("current evidence records cannot cite a path outside hash-bound lineage", () => {
  const project = tmpProject();
  try {
    const proposal = bindCurrentReviewContract(fixture());
    materializeProposalSources(project.dir, proposal);
    proposal.evidence[0].path = "pm/research/unbound-source.md";
    const result = validateProposal(proposal, { projectRoot: project.dir });
    assert.equal(result.ok, false);
    assert.match(messages(result), /must reference an existing hash-bound source\.lineage path/);
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

test("bound review contracts require exact tier question IDs while legacy proposals stay explicit", () => {
  const reviewed = bindReviewContract(fixture());
  reviewed.lifecycle = "reviewed";
  reviewed.question_reviews = reviewed.question_reviews.slice(0, 1);
  reviewed.review = {
    status: "passed",
    revision: reviewed.revision,
    content_sha256: proposalContentHash(reviewed),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  const partial = validateProposal(reviewed);
  assert.equal(partial.ok, false);
  assert.match(messages(partial), /missing review question: scope/);
  assert.deepEqual(proposalReviewCoverage(reviewed).missing_question_ids, FULL_REVIEW_IDS.slice(1));

  bindReviewContract(reviewed);
  reviewed.review.content_sha256 = proposalContentHash(reviewed);
  assert.equal(validateProposal(reviewed).ok, true, messages(validateProposal(reviewed)));

  const mismatched = bindReviewContract(fixture());
  mismatched.review_contract.session_id = "groom_other";
  assert.match(messages(validateProposal(mismatched)), /must match source\.session_id/);

  const shortened = bindReviewContract(fixture(), ["problem-evidence"]);
  assert.match(
    messages(validateProposal(shortened)),
    /must exactly match the selected tier review question IDs/
  );
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

test("current approval decisions cannot be replaced with arbitrary well-formed identities", () => {
  const proposal = fixture();
  bindCurrentReviewContract(proposal);
  proposal.lifecycle = "approved";
  proposal.review = {
    status: "passed",
    revision: proposal.revision,
    content_sha256: proposalContentHash(proposal),
    completed_at: "2026-07-14T02:00:00.000Z",
  };
  const bytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  const approvalInput = {
    approvedBy: "user:owner",
    approvedAt: "2026-07-14T03:00:00.000Z",
  };
  assert.throws(
    () =>
      buildApproval(proposal, bytes, {
        ...approvalInput,
        decisionId: "groom-approval:untrusted-session",
        decisionSha256: `sha256:${"2".repeat(64)}`,
      }),
    /canonical Groom approval decision/i
  );
  const decision = deriveApprovalDecision(proposal, approvalInput);
  const approval = buildApproval(proposal, bytes, {
    ...approvalInput,
    decisionId: decision.id,
    decisionSha256: decision.sha256,
  });
  assert.equal(validateApproval(proposal, approval, { bytes }).ok, true);
  assert.match(
    messages(
      validateApproval(
        proposal,
        { ...approval, decision_sha256: `sha256:${"2".repeat(64)}` },
        { bytes }
      )
    ),
    /canonical Groom approval decision/i
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
    bindCurrentReviewContract(proposal);
    materializeProposalSources(project.dir, proposal);
    proposal.review.content_sha256 = proposalContentHash(proposal);
    const paths = resolveProposalPaths(project.dir, proposal.slug);
    fs.mkdirSync(path.dirname(paths.json), { recursive: true });
    fs.writeFileSync(paths.json, `${JSON.stringify(proposal, null, 2)}\n`);
    const approval = buildCurrentApproval(proposal, fs.readFileSync(paths.json), {
      approvedBy: "user:owner",
      approvedAt: "2026-07-14T03:00:00.000Z",
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
    assert.equal(exact.reviewContractBound, true);
    assert.equal(exact.compatibility, "current-review-contract");

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
    assert.equal(canonical.reviewContractBound, false);
    assert.equal(canonical.compatibility, "legacy-unbound-review-contract");

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

test("current proposal evidence rejects more than 64 retained source paths", () => {
  const project = tmpProject();
  try {
    const lineage = [];
    for (let index = 0; index < 65; index += 1) {
      const relative = `pm/evidence/source-${String(index).padStart(2, "0")}.txt`;
      const bytes = Buffer.from(`source ${index}\n`);
      const absolute = path.join(project.dir, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, bytes);
      lineage.push({
        id: `source:budget-${String(index).padStart(2, "0")}`,
        path: relative,
        sha256: proposalBytesHash(bytes),
      });
    }
    const result = validateCurrentProposalEvidence(
      { review_contract: {}, source: { lineage }, evidence: [], question_reviews: [] },
      project.dir
    );
    assert.equal(result.ok, false);
    assert.match(messages(result), /at most 64 retained evidence sources/i);
  } finally {
    project.cleanup();
  }
});

test("aggregate evidence budget counts hard-linked source paths independently", () => {
  const project = tmpProject();
  try {
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0x61);
    const lineage = [];
    const first = path.join(project.dir, "pm/evidence/hardlink-0.txt");
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.writeFileSync(first, bytes);
    for (let index = 0; index < 5; index += 1) {
      const relative = `pm/evidence/hardlink-${index}.txt`;
      const absolute = path.join(project.dir, relative);
      if (index > 0) fs.linkSync(first, absolute);
      lineage.push({
        id: `source:hardlink-${index}`,
        path: relative,
        sha256: proposalBytesHash(bytes),
      });
    }
    const result = validateCurrentProposalEvidence(
      { review_contract: {}, source: { lineage }, evidence: [], question_reviews: [] },
      project.dir
    );
    assert.equal(result.ok, false);
    assert.match(messages(result), /aggregate 32 MiB validation limit/i);
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
    bindCurrentReviewContract(proposal);
    materializeProposalSources(project.dir, proposal);
    proposal.review.content_sha256 = proposalContentHash(proposal);
    const proposalFile = path.join(project.dir, "pm/backlog/proposals/structured-groom.json");
    fs.mkdirSync(path.dirname(proposalFile), { recursive: true });
    fs.writeFileSync(proposalFile, `${JSON.stringify(proposal, null, 2)}\n`);
    const bytes = fs.readFileSync(proposalFile);
    const approval = buildCurrentApproval(proposal, bytes, {
      approvedBy: "user:owner",
      approvedAt: "2026-07-14T03:00:00.000Z",
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
        "--approved",
        "--proposal",
        proposalFile,
        "--approval",
        approvalFile,
        "--project-root",
        project.dir,
        "--slug",
        "structured-groom",
        "--decision-id",
        approval.decision_id,
        "--decision-sha256",
        approval.decision_sha256,
        "--json",
      ],
      { encoding: "utf8" }
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.content_sha256, proposalContentHash(proposal));
    assert.equal(result.proposal_sha256, proposalBytesHash(bytes));
    assert.equal(result.trusted_approval, true);

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

test("approved CLI mode rejects inspection-readable legacy and decisionless approvals", () => {
  const project = tmpProject();
  try {
    const proposal = fixture();
    proposal.lifecycle = "approved";
    proposal.review = {
      status: "passed",
      revision: proposal.revision,
      content_sha256: proposalContentHash(proposal),
      completed_at: "2026-07-14T02:00:00.000Z",
    };
    const proposalFile = path.join(project.dir, "pm/backlog/proposals/structured-groom.json");
    fs.mkdirSync(path.dirname(proposalFile), { recursive: true });
    fs.writeFileSync(proposalFile, `${JSON.stringify(proposal, null, 2)}\n`);
    const approvalFile = proposalFile.replace(/\.json$/, ".approval.json");
    fs.writeFileSync(
      approvalFile,
      `${JSON.stringify(
        buildApproval(proposal, fs.readFileSync(proposalFile), {
          approvedBy: "user:owner",
          approvedAt: "2026-07-14T03:00:00.000Z",
        }),
        null,
        2
      )}\n`
    );

    const inspection = spawnSync(
      process.execPath,
      [checker, "--proposal", proposalFile, "--project-root", project.dir, "--json"],
      { encoding: "utf8" }
    );
    assert.equal(inspection.status, 0, inspection.stderr || inspection.stdout);
    assert.equal(JSON.parse(inspection.stdout).compatibility, "legacy-unbound-review-contract");

    const strictLegacy = spawnSync(
      process.execPath,
      [checker, "--approved", "--proposal", proposalFile, "--project-root", project.dir, "--json"],
      { encoding: "utf8" }
    );
    assert.equal(strictLegacy.status, 1);
    assert.match(strictLegacy.stdout, /legacy-unbound-review-contract/i);

    bindCurrentReviewContract(proposal);
    materializeProposalSources(project.dir, proposal);
    proposal.review.content_sha256 = proposalContentHash(proposal);
    fs.writeFileSync(proposalFile, `${JSON.stringify(proposal, null, 2)}\n`);
    fs.writeFileSync(
      approvalFile,
      `${JSON.stringify(
        {
          ...buildCurrentApproval(proposal, fs.readFileSync(proposalFile), {
            approvedBy: "user:owner",
            approvedAt: "2026-07-14T03:00:00.000Z",
          }),
          decision_id: null,
          decision_sha256: null,
        },
        null,
        2
      )}\n`
    );
    const strictDecisionless = spawnSync(
      process.execPath,
      [checker, "--approved", "--proposal", proposalFile, "--project-root", project.dir, "--json"],
      { encoding: "utf8" }
    );
    assert.equal(strictDecisionless.status, 1);
    assert.match(strictDecisionless.stdout, /bound Groom decision identity/i);
  } finally {
    project.cleanup();
  }
});

test("byte hash helper is exact and carries the sha256 prefix", () => {
  const bytes = Buffer.from("proposal bytes\n");
  const expected = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(proposalBytesHash(bytes), expected);
});
