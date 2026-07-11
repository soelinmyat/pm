#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { hashTree } = require("./stage.js");
const { parseFrontmatter } = require("../kb-frontmatter.js");

const REQUIRED_CASE_TYPES = [
  "happy-path",
  "ambiguous-input",
  "resume",
  "blocked-and-recovery",
  "authority-boundary",
  "low-quality-schema-valid",
  "repeated-run-variance",
];
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_REF_PATTERN = /^evals\/quality\/[a-zA-Z0-9._/-]+$/;
const BEHAVIORAL_STATUSES = new Set(["pass", "fail", "skip", "indeterminate"]);
const SUBSTANTIAL_WORKFLOWS = ["groom", "rfc", "dev", "review", "design-critique", "ship"];
const MAX_ARTIFACTS_PER_CANDIDATE = 4;
const MAX_CANDIDATE_JUDGE_BYTES = 20 * 1024;
const MAX_PACKET_ESTIMATED_TOKENS = 48_000;

function validateQualitySuite(suite) {
  const issues = [];
  if (!plainObject(suite)) return invalid("quality suite must be an object");
  if (suite.schema_version !== 1) issues.push("schema_version must equal 1");
  if (!SAFE_REF_PATTERN.test(String(suite.rubric_ref || ""))) {
    issues.push("rubric_ref must be a safe evals/quality path");
  }
  if (!Number.isInteger(suite.minimum_repeats) || suite.minimum_repeats < 3) {
    issues.push("minimum_repeats must be an integer of at least 3");
  }

  const profileIds = new Set();
  if (!Array.isArray(suite.profiles) || suite.profiles.length < 2) {
    issues.push("at least two model profiles are required");
  } else {
    for (const [index, profile] of suite.profiles.entries()) {
      const where = `profiles[${index}]`;
      if (!slug(profile && profile.id)) issues.push(`${where} profile id is required`);
      if (profileIds.has(profile && profile.id)) issues.push(`duplicate profile ${profile.id}`);
      profileIds.add(profile && profile.id);
      if (!profile || !["codex", "claude"].includes(profile.adapter)) {
        issues.push(`${where} adapter must be codex or claude`);
      }
      if (!nonempty(profile && profile.model)) issues.push(`${where} profile model is required`);
      if (!nonempty(profile && profile.effort)) issues.push(`${where} profile effort is required`);
    }
  }

  const workflowIds = new Set();
  const globalCaseIds = new Set();
  const scenarioRefs = new Set();
  if (!Array.isArray(suite.workflows) || suite.workflows.length === 0) {
    issues.push("at least one workflow is required");
  } else {
    for (const [index, workflow] of suite.workflows.entries()) {
      const where = `workflows[${index}]`;
      if (!slug(workflow && workflow.id)) issues.push(`${where} workflow id is required`);
      if (workflowIds.has(workflow && workflow.id))
        issues.push(`duplicate workflow ${workflow.id}`);
      workflowIds.add(workflow && workflow.id);
      const cases = Array.isArray(workflow && workflow.cases) ? workflow.cases : [];
      const caseIds = new Set();
      const types = new Set();
      for (const [caseIndex, item] of cases.entries()) {
        const caseWhere = `${where}.cases[${caseIndex}]`;
        if (!slug(item && item.id)) issues.push(`${caseWhere} id is required`);
        if (caseIds.has(item && item.id)) issues.push(`duplicate case ${item.id}`);
        caseIds.add(item && item.id);
        if (globalCaseIds.has(item && item.id)) issues.push(`duplicate global case ${item.id}`);
        globalCaseIds.add(item && item.id);
        if (!REQUIRED_CASE_TYPES.includes(item && item.type)) {
          issues.push(`${caseWhere} has unknown case type ${item && item.type}`);
        }
        if (types.has(item && item.type)) {
          issues.push(`${where} duplicates case type ${item.type}`);
        }
        types.add(item && item.type);
        if (!SAFE_REF_PATTERN.test(String((item && item.prompt_ref) || ""))) {
          issues.push(`${caseWhere} prompt_ref must be a safe evals/quality path`);
        }
        if (!slug(item && item.scenario_ref)) {
          issues.push(`${caseWhere} scenario_ref is required`);
        } else if (scenarioRefs.has(item.scenario_ref)) {
          issues.push(`${caseWhere} reuses scenario_ref ${item.scenario_ref}`);
        } else {
          scenarioRefs.add(item.scenario_ref);
        }
        if (!HASH_PATTERN.test(String((item && item.scenario_contract_hash) || ""))) {
          issues.push(`${caseWhere} scenario_contract_hash is required`);
        }
      }
      for (const type of REQUIRED_CASE_TYPES) {
        if (type === "authority-boundary" && workflow && workflow.authority_boundary === false) {
          continue;
        }
        if (!types.has(type)) issues.push(`${where} missing required case type ${type}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

function validateRubric(rubric) {
  const issues = [];
  if (!plainObject(rubric)) return invalid("rubric must be an object");
  if (rubric.schema_version !== 1) issues.push("schema_version must equal 1");
  if (
    typeof rubric.disagreement_threshold !== "number" ||
    rubric.disagreement_threshold <= 0 ||
    rubric.disagreement_threshold > 4
  ) {
    issues.push("disagreement_threshold must be greater than 0 and at most 4");
  }
  const ids = new Set();
  if (!Array.isArray(rubric.dimensions) || rubric.dimensions.length === 0) {
    issues.push("at least one rubric dimension is required");
  } else {
    for (const [index, dimension] of rubric.dimensions.entries()) {
      const where = `dimensions[${index}]`;
      if (!slug(dimension && dimension.id)) issues.push(`${where} id is required`);
      if (ids.has(dimension && dimension.id)) issues.push(`duplicate dimension ${dimension.id}`);
      ids.add(dimension && dimension.id);
      if (!nonempty(dimension && dimension.label)) issues.push(`${where} label is required`);
      if (typeof (dimension && dimension.weight) !== "number" || dimension.weight <= 0) {
        issues.push(`${where} weight must be positive`);
      }
      for (const anchor of [1, 3, 5]) {
        if (!nonempty(dimension && dimension.anchors && dimension.anchors[anchor])) {
          issues.push(`${where} anchor ${anchor} is required`);
        }
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

function validateQualityTree(rootDir = process.cwd()) {
  const issues = [];
  const suitePath = path.join(rootDir, "evals", "quality", "suite.json");
  if (!fs.existsSync(suitePath)) {
    return invalid("missing evals/quality/suite.json");
  }
  let suite;
  try {
    suite = JSON.parse(fs.readFileSync(suitePath, "utf8"));
  } catch (error) {
    return invalid(`quality suite is invalid JSON: ${error.message}`);
  }
  issues.push(...validateQualitySuite(suite).issues);
  const foundWorkflows = new Set((suite.workflows || []).map((workflow) => workflow.id));
  for (const workflow of SUBSTANTIAL_WORKFLOWS) {
    if (!foundWorkflows.has(workflow)) issues.push(`missing substantial workflow ${workflow}`);
  }

  const rubricPath = path.resolve(rootDir, String(suite.rubric_ref || ""));
  let rubric = null;
  if (!inside(rootDir, rubricPath) || !fs.existsSync(rubricPath)) {
    issues.push(`missing rubric file ${suite.rubric_ref || "(unset)"}`);
  } else {
    try {
      rubric = JSON.parse(fs.readFileSync(rubricPath, "utf8"));
      issues.push(...validateRubric(rubric).issues);
    } catch (error) {
      issues.push(`quality rubric is invalid JSON: ${error.message}`);
    }
  }

  for (const workflow of suite.workflows || []) {
    for (const item of workflow.cases || []) {
      const promptPath = path.resolve(rootDir, String(item.prompt_ref || ""));
      if (!inside(rootDir, promptPath) || !fs.existsSync(promptPath)) {
        issues.push(`missing prompt file ${item.prompt_ref || "(unset)"} for ${item.id}`);
        continue;
      }
      const prompt = fs.readFileSync(promptPath, "utf8");
      const heading = `## ${item.type}`;
      if (!prompt.split(/\r?\n/).some((line) => line.trim() === heading)) {
        issues.push(`${item.prompt_ref} missing case heading ${heading} for ${item.id}`);
      }
      const scenarioDir = path.join(rootDir, "evals", "scenarios", String(item.scenario_ref || ""));
      if (
        !inside(path.join(rootDir, "evals", "scenarios"), scenarioDir) ||
        !fs.existsSync(scenarioDir)
      ) {
        issues.push(`missing scenario ${item.scenario_ref || "(unset)"} for ${item.id}`);
      } else if (item.scenario_contract_hash !== hashTree(scenarioDir).hash) {
        issues.push(`scenario contract hash mismatch for ${item.id}`);
      } else {
        const story = parseFrontmatter(fs.readFileSync(path.join(scenarioDir, "story.md"), "utf8"));
        const tags = new Set(Array.isArray(story.data.tags) ? story.data.tags : []);
        for (const tag of [workflow.id, item.type, "quality-evaluation"]) {
          if (!tags.has(tag)) issues.push(`scenario ${item.scenario_ref} missing tag ${tag}`);
        }
      }
    }
  }
  const resultsDir = path.join(rootDir, "evals", "quality", "results");
  if (rubric && fs.existsSync(resultsDir)) {
    for (const entry of fs.readdirSync(resultsDir).sort()) {
      if (!entry.endsWith(".json")) continue;
      const resultPath = path.join(resultsDir, entry);
      try {
        issues.push(
          ...validateQualityScorecard(
            JSON.parse(fs.readFileSync(resultPath, "utf8")),
            suite,
            rubric
          ).issues.map((message) => `${path.relative(rootDir, resultPath)}: ${message}`)
        );
      } catch (error) {
        issues.push(`${path.relative(rootDir, resultPath)} is invalid JSON: ${error.message}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

function validateQualityScorecard(scorecard, suite, rubric) {
  const issues = [];
  if (!plainObject(scorecard)) return invalid("scorecard must be an object");
  if (scorecard.schema_version !== 1) issues.push("schema_version must equal 1");
  const statuses = new Set([
    "quality-scored",
    "behavioral-failure",
    "behavioral-uncertain",
    "not-scorable",
  ]);
  if (!statuses.has(scorecard.overall_status)) issues.push("invalid overall_status");
  for (const field of [
    "total_candidates",
    "eligible_candidates",
    "behavioral_failures",
    "behavioral_uncertain",
  ]) {
    if (!Number.isInteger(scorecard[field]) || scorecard[field] < 0) {
      issues.push(`${field} must be a non-negative integer`);
    }
  }
  if (
    scorecard.total_candidates !==
    scorecard.eligible_candidates + scorecard.behavioral_failures + scorecard.behavioral_uncertain
  ) {
    issues.push("candidate counts do not add up");
  }
  const workflow = (suite.workflows || []).find((item) => item.id === scorecard.workflow);
  if (!workflow) issues.push(`unknown scorecard workflow ${scorecard.workflow}`);
  else if (!workflow.cases.some((item) => item.id === scorecard.case_id)) {
    issues.push(`unknown scorecard case ${scorecard.case_id}`);
  }
  if (!/^qp-[a-f0-9]{20}$/.test(String(scorecard.packet_id || ""))) {
    issues.push("invalid scorecard packet_id");
  }
  const profileIds = new Set((suite.profiles || []).map((item) => item.id));
  const dimensionIds = new Set((rubric.dimensions || []).map((item) => item.id));
  for (const [id, profile] of Object.entries(scorecard.profiles || {})) {
    if (!profileIds.has(id)) issues.push(`unknown scorecard profile ${id}`);
    if (!numberBetween(profile.mean, 1, 5)) issues.push(`${id} mean must be 1-5`);
    if (!Number.isInteger(profile.repeats) || profile.repeats < 1) {
      issues.push(`${id} repeats must be a positive integer`);
    } else if (
      Boolean(profile.variance && profile.variance.claimable) !==
      profile.repeats >= suite.minimum_repeats
    ) {
      issues.push(`${id} variance claimable does not match repeat count`);
    }
    if (!plainObject(profile.latency) || !numberAtLeast(profile.latency.mean_ms, 0)) {
      issues.push(`${id} latency.mean_ms must be non-negative`);
    }
    const foundDimensions = new Set(Object.keys(profile.dimensions || {}));
    for (const dimension of dimensionIds) {
      if (!foundDimensions.has(dimension)) issues.push(`${id} missing dimension ${dimension}`);
    }
    for (const [dimension, value] of Object.entries(profile.dimensions || {})) {
      if (!dimensionIds.has(dimension)) issues.push(`${id} unknown dimension ${dimension}`);
      if (!numberBetween(value.coverage, 0, 1)) {
        issues.push(`${id}.${dimension} coverage must be 0-1`);
      } else if (value.coverage === 0) {
        if (value.mean !== null)
          issues.push(`${id}.${dimension} mean must be null at zero coverage`);
      } else if (!numberBetween(value.mean, 1, 5)) {
        issues.push(`${id}.${dimension} mean must be 1-5 when covered`);
      }
    }
  }
  if (
    scorecard.quality_winner !== null &&
    !Object.prototype.hasOwnProperty.call(scorecard.profiles || {}, scorecard.quality_winner)
  ) {
    issues.push("quality_winner must name a scored profile or be null");
  }
  if (
    scorecard.observed_leader !== null &&
    !Object.prototype.hasOwnProperty.call(scorecard.profiles || {}, scorecard.observed_leader)
  ) {
    issues.push("observed_leader must name a scored profile or be null");
  }
  if (scorecard.behavioral_failures > 0 && scorecard.quality_winner !== null) {
    issues.push("behavioral failures require a null quality_winner");
  }
  const wins = Object.values((scorecard.pairwise && scorecard.pairwise.wins) || {}).reduce(
    (total, value) => total + value,
    0
  );
  if (!scorecard.pairwise || scorecard.pairwise.total !== wins + scorecard.pairwise.ties) {
    issues.push("pairwise totals do not add up");
  }
  if (scorecard.pairwise) {
    for (const [id, value] of Object.entries(scorecard.pairwise.wins || {})) {
      if (!profileIds.has(id) || !Number.isInteger(value) || value < 0) {
        issues.push(`invalid pairwise wins for ${id}`);
      }
    }
  }
  if (
    !Array.isArray(scorecard.judges) ||
    new Set(scorecard.judges).size !== scorecard.judges.length
  ) {
    issues.push("judges must be a unique array");
  }
  const expectedStatus =
    scorecard.behavioral_failures > 0
      ? "behavioral-failure"
      : scorecard.behavioral_uncertain > 0
        ? "behavioral-uncertain"
        : scorecard.eligible_candidates > 0
          ? "quality-scored"
          : "not-scorable";
  if (scorecard.overall_status !== expectedStatus) {
    issues.push(`overall_status must be ${expectedStatus} for the candidate counts`);
  }
  const profileCount = Object.keys(scorecard.profiles || {}).length;
  if (scorecard.overall_status === "quality-scored") {
    if (
      scorecard.eligible_candidates === 0 ||
      scorecard.behavioral_failures !== 0 ||
      scorecard.behavioral_uncertain !== 0
    ) {
      issues.push("quality-scored requires eligible candidates and no behavioral exclusions");
    }
    if (profileCount < 2 || !scorecard.pairwise || scorecard.pairwise.total < 1) {
      issues.push("quality-scored requires at least two profiles and pairwise comparisons");
    }
    if (!Array.isArray(scorecard.judges) || scorecard.judges.length === 0) {
      issues.push("quality-scored requires at least one judge");
    }
  }
  if (scorecard.overall_status === "behavioral-failure" && scorecard.behavioral_failures === 0) {
    issues.push("behavioral-failure requires at least one failure");
  }
  if (scorecard.overall_status === "behavioral-uncertain" && scorecard.behavioral_uncertain === 0) {
    issues.push("behavioral-uncertain requires at least one uncertain candidate");
  }
  if (
    scorecard.overall_status === "not-scorable" &&
    (scorecard.eligible_candidates !== 0 || profileCount !== 0)
  ) {
    issues.push("not-scorable requires zero eligible candidates and no profiles");
  }
  if (scorecard.overall_status !== "quality-scored" && scorecard.quality_winner !== null) {
    issues.push("non-scored status requires a null quality_winner");
  }
  if (scorecard.adjudication_required && scorecard.quality_winner !== null) {
    issues.push("adjudication-required scorecards cannot declare a quality_winner");
  }
  if (scorecard.quality_winner !== null) {
    const claimable = Object.values(scorecard.profiles || {}).every(
      (profile) => profile.variance && profile.variance.claimable
    );
    if (!claimable) issues.push("quality_winner requires minimum repeat sufficiency");
  }
  if (!plainObject(scorecard.evaluation_identity)) {
    issues.push("evaluation_identity is required");
  } else {
    for (const field of [
      "source_hash",
      "scenario_hash",
      "quality_case_hash",
      "rubric_hash",
      "evaluation_design_hash",
    ]) {
      if (!HASH_PATTERN.test(String(scorecard.evaluation_identity[field] || ""))) {
        issues.push(`evaluation_identity.${field} must be a sha256 hash`);
      }
    }
  }
  const serialized = JSON.stringify(scorecard);
  if (/\/Users\/|\/home\//.test(serialized))
    issues.push("scorecard contains an absolute user path");
  if (/(api[_-]?key|access[_-]?token|refresh[_-]?token)/i.test(serialized)) {
    issues.push("scorecard appears to contain credential material");
  }
  return { ok: issues.length === 0, issues };
}

function loadQualityCase(rootDir, caseId) {
  const suitePath = path.join(rootDir, "evals", "quality", "suite.json");
  const suite = JSON.parse(fs.readFileSync(suitePath, "utf8"));
  assertValid(validateQualitySuite(suite), "quality suite");
  const matches = [];
  for (const workflow of suite.workflows) {
    for (const item of workflow.cases) {
      if (item.id === caseId) matches.push({ workflow, item });
    }
  }
  if (matches.length !== 1) throw new Error(`quality case ${caseId} was not found exactly once`);
  const found = matches[0];
  const markdown = fs.readFileSync(path.resolve(rootDir, found.item.prompt_ref), "utf8");
  const prompt = extractCasePrompt(markdown, found.item.type);
  if (!prompt) throw new Error(`prompt section ## ${found.item.type} is empty or missing`);
  return {
    id: found.item.id,
    workflow: found.workflow.id,
    type: found.item.type,
    prompt_ref: found.item.prompt_ref,
    prompt,
    prompt_hash: `sha256:${digest(prompt)}`,
    scenario_ref: found.item.scenario_ref,
    scenario_contract_hash: found.item.scenario_contract_hash,
  };
}

function loadQualityProfile(rootDir, profileId) {
  const suite = JSON.parse(
    fs.readFileSync(path.join(rootDir, "evals", "quality", "suite.json"), "utf8")
  );
  assertValid(validateQualitySuite(suite), "quality suite");
  const matches = suite.profiles.filter((item) => item.id === profileId);
  if (matches.length !== 1)
    throw new Error(`quality profile ${profileId} was not found exactly once`);
  return { ...matches[0] };
}

function extractCasePrompt(markdown, type) {
  const lines = String(markdown).split(/\r?\n/);
  const heading = `## ${type}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return "";
  const output = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    output.push(lines[index]);
  }
  return output.join("\n").trim();
}

function buildBlindPacket({ candidates, rubric, scenario, salt }) {
  assertValid(validateRubric(rubric), "rubric");
  if (!nonempty(salt)) throw new Error("blind packet salt is required");
  if (!plainObject(scenario) || !nonempty(scenario.workflow) || !nonempty(scenario.case_id)) {
    throw new Error("scenario workflow and case_id are required");
  }
  const scenarioPromptHash = `sha256:${digest(String(scenario.prompt || ""))}`;
  const eligible = [];
  const excluded = [];
  for (const [index, item] of (candidates || []).entries()) {
    const validation = validateCandidate(item);
    if (!validation.ok)
      throw new Error(`candidate ${index} invalid: ${validation.issues.join("; ")}`);
    if (item.behavioral.status !== "pass") {
      excluded.push({ index, reason: `behavioral-${item.behavioral.status}` });
    } else {
      if (item.quality_case_hash !== scenarioPromptHash) {
        throw new Error(`candidate ${index} quality_case_hash does not match scenario prompt`);
      }
      eligible.push({ item, index });
    }
  }
  if (eligible.length < 2)
    throw new Error("at least two behaviorally eligible candidates are required");
  const comparisonIdentities = new Set(
    eligible.map(({ item }) =>
      [item.release, item.source_hash, item.behavioral.scenario_hash].join("::")
    )
  );
  if (comparisonIdentities.size !== 1) {
    throw new Error("eligible candidates must share release, source_hash, and scenario_hash");
  }

  const packetId = `qp-${digest(
    JSON.stringify({
      workflow: scenario.workflow,
      case_id: scenario.case_id,
      hashes: eligible.map(({ item }) => item.artifacts.map((artifact) => artifact.sha256)),
      salt,
    })
  ).slice(0, 20)}`;
  const identities = identityTerms(candidates || []);
  const keyCandidates = {};
  const blindCandidates = eligible.map(({ item, index }) => {
    const id = `candidate-${digest(`${salt}:${packetId}:${index}:${item.source_hash}`).slice(0, 12)}`;
    keyCandidates[id] = {
      candidate_index: index,
      candidate_sha256: `sha256:${digest(JSON.stringify(item))}`,
      profile_id: item.profile.id,
      repeat: item.repeat,
      behavioral_status: item.behavioral.status,
      artifact_ref: item.behavioral.artifact_ref,
    };
    if (item.artifacts.length > MAX_ARTIFACTS_PER_CANDIDATE) {
      throw new Error(`candidate ${index} exceeds ${MAX_ARTIFACTS_PER_CANDIDATE} judge artifacts`);
    }
    const candidateBytes = item.artifacts.reduce(
      (total, artifact) => total + Buffer.byteLength(artifact.content),
      0
    );
    if (candidateBytes > MAX_CANDIDATE_JUDGE_BYTES) {
      throw new Error(`candidate ${index} exceeds ${MAX_CANDIDATE_JUDGE_BYTES} byte judge budget`);
    }
    const blindArtifacts = item.artifacts.map((artifact) => {
      const content = redactIdentity(artifact.content, identities);
      return {
        name: neutralName(redactIdentity(artifact.name, identities)),
        media_type: artifact.media_type,
        sha256: `sha256:${digest(content)}`,
        content,
      };
    });
    keyCandidates[id].artifact_hashes = item.artifacts.map((artifact, artifactIndex) => ({
      name: artifact.name,
      source_sha256: artifact.sha256,
      blind_sha256: blindArtifacts[artifactIndex].sha256,
    }));
    return {
      id,
      artifacts: blindArtifacts,
    };
  });
  blindCandidates.sort((left, right) => left.id.localeCompare(right.id));
  const pairwisePlan = [];
  for (let leftIndex = 0; leftIndex < blindCandidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < blindCandidates.length; rightIndex += 1) {
      const left = blindCandidates[leftIndex].id;
      const right = blindCandidates[rightIndex].id;
      const leftKey = keyCandidates[left];
      const rightKey = keyCandidates[right];
      if (leftKey.profile_id !== rightKey.profile_id && leftKey.repeat === rightKey.repeat) {
        pairwisePlan.push({ left, right });
      }
    }
  }
  if (pairwisePlan.length === 0) {
    throw new Error("eligible candidates require at least one matched cross-profile repeat");
  }

  const packet = {
    $schema: "https://pm-plugin.local/evals/quality-packet.schema.json",
    schema_version: 1,
    packet_id: packetId,
    instructions: [
      "Judge only the supplied scenario and artifacts; do not infer or identify the generating model.",
      "Score every rubric dimension from 1 to 5, or use not_applicable with artifact-grounded evidence.",
      "Complete every pair in pairwise_plan and return strict JSON only, using exactly the response_contract keys and nesting.",
    ],
    response_contract: {
      format: "strict-json",
      top_level: {
        $schema: "https://pm-plugin.local/evals/quality-judgment.schema.json",
        schema_version: 1,
        packet_id: packetId,
        view_id: "judge packet view ID exactly as supplied",
        view_sha256: "judge packet view hash exactly as supplied",
        judge: "operator-assigned unique opaque judge ID",
        candidates: "array<candidate_row>",
        pairwise: "array<pairwise_row>",
      },
      candidate_row: {
        id: "candidate ID exactly as supplied",
        dimensions: "array<dimension_row> with one row for every rubric dimension",
        summary: "concise artifact-grounded assessment",
      },
      dimension_row: {
        dimension: "rubric dimension id exactly as supplied",
        score: "integer 1-5 or the string not_applicable",
        evidence: "specific evidence from the supplied artifact",
      },
      pairwise_row: {
        left: "left candidate ID exactly as listed in pairwise_plan",
        right: "right candidate ID exactly as listed in pairwise_plan",
        preference: "left candidate ID, right candidate ID, or tie",
        reason: "artifact-grounded comparison reason",
      },
      additional_properties: false,
    },
    scenario: {
      workflow: scenario.workflow,
      case_id: scenario.case_id,
      prompt: redactIdentity(String(scenario.prompt || ""), identities),
    },
    rubric,
    candidates: blindCandidates,
    pairwise_plan: pairwisePlan,
    view_id: null,
    view_sha256: null,
    allowed_view_ids: [],
    estimated_tokens: 0,
  };
  const allowedViewIds = [0, 1].map(
    (index) => `view-${digest(`${salt}:${packetId}:view:${index}`).slice(0, 12)}`
  );
  packet.allowed_view_ids = allowedViewIds;
  packet.view_id = allowedViewIds[0];
  packet.estimated_tokens = estimateTokens(JSON.stringify(packet));
  if (packet.estimated_tokens > MAX_PACKET_ESTIMATED_TOKENS) {
    throw new Error(
      `blind packet estimate ${packet.estimated_tokens} exceeds ${MAX_PACKET_ESTIMATED_TOKENS} token budget`
    );
  }
  const baseCandidateOrder = [...packet.candidates]
    .sort((left, right) =>
      digest(`${salt}:${packetId}:position:${left.id}`).localeCompare(
        digest(`${salt}:${packetId}:position:${right.id}`)
      )
    )
    .map((item) => item.id);
  const judgePackets = allowedViewIds.map((viewId, index) =>
    counterbalancedPacket(packet, viewId, salt, index, baseCandidateOrder)
  );
  for (const view of judgePackets) {
    view.view_sha256 = packetViewHash(view);
    view.estimated_tokens = estimateTokens(JSON.stringify(view));
  }
  for (const [index, view] of judgePackets.entries()) {
    assertValid(validateBlindPacket(view), `blind packet view ${index + 1}`);
  }
  return {
    packet: judgePackets[0],
    judgePackets,
    key: {
      schema_version: 1,
      packet_id: packetId,
      candidates: keyCandidates,
      views: judgePackets.map((view) => ({
        view_id: view.view_id,
        sha256: view.view_sha256,
      })),
      excluded,
    },
    excluded,
  };
}

function validateBlindPacket(packet) {
  const issues = [];
  if (!plainObject(packet)) return invalid("blind packet must be an object");
  if (packet.schema_version !== 1) issues.push("schema_version must equal 1");
  if (!/^qp-[a-f0-9]{20}$/.test(String(packet.packet_id || ""))) {
    issues.push("invalid packet_id");
  }
  if (!/^view-[a-f0-9]{12}$/.test(String(packet.view_id || ""))) {
    issues.push("invalid view_id");
  }
  if (
    !Array.isArray(packet.allowed_view_ids) ||
    !packet.allowed_view_ids.includes(packet.view_id) ||
    new Set(packet.allowed_view_ids).size !== packet.allowed_view_ids.length
  ) {
    issues.push("allowed_view_ids must be unique and contain view_id");
  }
  if (packet.view_sha256 !== packetViewHash(packet)) {
    issues.push("view_sha256 does not authenticate this packet view");
  }
  if (
    !Number.isInteger(packet.estimated_tokens) ||
    packet.estimated_tokens < 1 ||
    packet.estimated_tokens > MAX_PACKET_ESTIMATED_TOKENS
  ) {
    issues.push("estimated_tokens exceeds the judge budget");
  }
  issues.push(...validateRubric(packet.rubric).issues);
  if (
    !plainObject(packet.scenario) ||
    !slug(packet.scenario.workflow) ||
    !slug(packet.scenario.case_id)
  ) {
    issues.push("scenario workflow and case_id are required");
  }
  if (!Array.isArray(packet.instructions) || packet.instructions.length < 3) {
    issues.push("at least three judge instructions are required");
  }
  if (!plainObject(packet.response_contract)) issues.push("response_contract is required");
  const ids = new Set();
  if (!Array.isArray(packet.candidates) || packet.candidates.length < 2) {
    issues.push("at least two blind candidates are required");
  } else {
    for (const [index, candidate] of packet.candidates.entries()) {
      const where = `candidates[${index}]`;
      if (!/^candidate-[a-f0-9]{12}$/.test(String(candidate && candidate.id))) {
        issues.push(`${where} has invalid blind id`);
      }
      if (ids.has(candidate && candidate.id)) issues.push(`duplicate blind id ${candidate.id}`);
      ids.add(candidate && candidate.id);
      if (!Array.isArray(candidate && candidate.artifacts) || candidate.artifacts.length === 0) {
        issues.push(`${where} must contain artifacts`);
        continue;
      }
      for (const [artifactIndex, artifact] of candidate.artifacts.entries()) {
        const artifactWhere = `${where}.artifacts[${artifactIndex}]`;
        if (!HASH_PATTERN.test(String(artifact.sha256 || "")))
          issues.push(`${artifactWhere} invalid sha256`);
        if (typeof artifact.content !== "string")
          issues.push(`${artifactWhere} content is required`);
        else if (artifact.sha256 !== `sha256:${digest(artifact.content)}`) {
          issues.push(`${artifactWhere} sha256 does not match content`);
        }
      }
    }
  }
  const expectedPairs = unorderedPairs(packet.candidates.map((item) => item.id));
  const plannedPairs = new Set();
  if (!Array.isArray(packet.pairwise_plan) || packet.pairwise_plan.length === 0) {
    issues.push("pairwise_plan must contain at least one comparison");
  } else {
    for (const [index, pair] of packet.pairwise_plan.entries()) {
      const key = pairKey(pair && pair.left, pair && pair.right);
      if (!expectedPairs.has(key))
        issues.push(`pairwise_plan[${index}] has unknown or self comparison`);
      if (plannedPairs.has(key))
        issues.push(`pairwise_plan[${index}] duplicates comparison ${key}`);
      plannedPairs.add(key);
    }
  }
  const serialized = JSON.stringify(packet).toLowerCase();
  for (const leaked of ["codex", "claude", "openai", "anthropic", "gpt", "opus"]) {
    if (serialized.includes(leaked)) issues.push(`blind packet contains identity term ${leaked}`);
  }
  return { ok: issues.length === 0, issues };
}

function validateCandidate(candidate) {
  const issues = [];
  if (!plainObject(candidate)) return invalid("candidate must be an object");
  if (candidate.schema_version !== 1) issues.push("schema_version must equal 1");
  for (const field of ["workflow", "case_id", "case_type", "release"]) {
    if (!nonempty(candidate[field])) issues.push(`${field} is required`);
  }
  if (!HASH_PATTERN.test(String(candidate.quality_case_hash || ""))) {
    issues.push("invalid quality_case_hash");
  }
  if (!HASH_PATTERN.test(String(candidate.source_hash || ""))) issues.push("invalid source_hash");
  if (!plainObject(candidate.behavioral)) issues.push("behavioral result is required");
  else {
    if (!BEHAVIORAL_STATUSES.has(candidate.behavioral.status)) {
      issues.push(`invalid behavioral status ${candidate.behavioral.status}`);
    }
    if (!/^runs\/[a-zA-Z0-9.-]+$/.test(String(candidate.behavioral.artifact_ref || ""))) {
      issues.push("invalid behavioral artifact_ref");
    }
    if (!HASH_PATTERN.test(String(candidate.behavioral.scenario_hash || ""))) {
      issues.push("invalid behavioral scenario_hash");
    }
  }
  if (!plainObject(candidate.profile) || !slug(candidate.profile.id))
    issues.push("profile is required");
  if (
    !plainObject(candidate.runtime) ||
    !Number.isInteger(candidate.runtime.duration_ms) ||
    candidate.runtime.duration_ms < 0
  ) {
    issues.push("runtime.duration_ms must be a non-negative integer");
  }
  if (!Number.isInteger(candidate.repeat) || candidate.repeat < 1) {
    issues.push("repeat must be a positive integer");
  }
  if (!Array.isArray(candidate.artifacts) || candidate.artifacts.length === 0) {
    issues.push("at least one artifact is required");
  } else {
    for (const [index, artifact] of candidate.artifacts.entries()) {
      if (!plainObject(artifact)) {
        issues.push(`artifacts[${index}] must be an object`);
        continue;
      }
      if (!nonempty(artifact.name) || /[\\/]/.test(artifact.name)) {
        issues.push(`artifacts[${index}] name must be a basename`);
      }
      if (!nonempty(artifact.media_type)) issues.push(`artifacts[${index}] media_type is required`);
      if (!HASH_PATTERN.test(String(artifact.sha256 || ""))) {
        issues.push(`artifacts[${index}] has invalid sha256`);
      }
      if (typeof artifact.content !== "string")
        issues.push(`artifacts[${index}] content is required`);
      if (
        typeof artifact.content === "string" &&
        HASH_PATTERN.test(String(artifact.sha256 || "")) &&
        artifact.sha256 !== `sha256:${digest(artifact.content)}`
      ) {
        issues.push(`artifacts[${index}] sha256 does not match content`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

function validateJudgment(judgment, packet) {
  const issues = [];
  const packetValidation = validateBlindPacket(packet);
  if (!packetValidation.ok) {
    issues.push(...packetValidation.issues.map((message) => `packet: ${message}`));
    return { ok: false, issues };
  }
  if (!plainObject(judgment)) return invalid("judgment must be an object");
  rejectUnknownKeys(
    judgment,
    new Set([
      "$schema",
      "schema_version",
      "packet_id",
      "view_id",
      "view_sha256",
      "judge",
      "candidates",
      "pairwise",
    ]),
    "judgment",
    issues
  );
  if (judgment.schema_version !== 1) issues.push("schema_version must equal 1");
  if (judgment.$schema !== "https://pm-plugin.local/evals/quality-judgment.schema.json") {
    issues.push("invalid judgment $schema");
  }
  if (judgment.packet_id !== packet.packet_id) issues.push("packet_id does not match packet");
  if (judgment.view_id !== packet.view_id)
    issues.push("view_id does not match the supplied judge view");
  if (judgment.view_sha256 !== packet.view_sha256) {
    issues.push("view_sha256 does not match the authenticated judge view");
  }
  if (!nonempty(judgment.judge)) issues.push("judge is required");
  const candidateIds = packet.candidates.map((item) => item.id);
  const dimensionIds = packet.rubric.dimensions.map((item) => item.id);
  const rows = new Map();
  const candidateRows = Array.isArray(judgment.candidates) ? judgment.candidates : [];
  if (!Array.isArray(judgment.candidates)) issues.push("candidates must be an array");
  for (const [index, row] of candidateRows.entries()) {
    const where = `candidates[${index}]`;
    rejectUnknownKeys(row, new Set(["id", "dimensions", "summary"]), where, issues);
    if (!plainObject(row)) continue;
    if (!candidateIds.includes(row.id)) issues.push(`${where} has unknown candidate ${row.id}`);
    if (rows.has(row.id)) issues.push(`duplicate judgment for ${row.id}`);
    rows.set(row.id, row);
    const found = new Set();
    const dimensionRows = Array.isArray(row.dimensions) ? row.dimensions : [];
    if (!Array.isArray(row.dimensions)) issues.push(`${where}.dimensions must be an array`);
    for (const [dimensionIndex, value] of dimensionRows.entries()) {
      const dimensionWhere = `${where}.dimensions[${dimensionIndex}]`;
      rejectUnknownKeys(value, new Set(["dimension", "score", "evidence"]), dimensionWhere, issues);
      if (!plainObject(value)) continue;
      if (!dimensionIds.includes(value.dimension)) {
        issues.push(`${dimensionWhere} has unknown dimension ${value.dimension}`);
      }
      if (found.has(value.dimension))
        issues.push(`${where} duplicate dimension ${value.dimension}`);
      found.add(value.dimension);
      if (!(value.score === "not_applicable" || integerBetween(value.score, 1, 5))) {
        issues.push(`${dimensionWhere} score must be 1-5 or not_applicable`);
      }
      if (!nonempty(value.evidence)) issues.push(`${dimensionWhere} evidence is required`);
    }
    for (const id of dimensionIds) {
      if (!found.has(id)) issues.push(`${where} missing dimension ${id}`);
    }
    if (
      dimensionRows.length > 0 &&
      dimensionRows.every((value) => value && value.score === "not_applicable")
    ) {
      issues.push(`${where} must score at least one applicable dimension`);
    }
    if (!nonempty(row.summary)) issues.push(`${where} summary is required`);
  }
  for (const id of candidateIds) {
    if (!rows.has(id)) issues.push(`missing judgment for ${id}`);
  }

  const expectedPairs = new Set(
    packet.pairwise_plan.map((row) => orderedPairKey(row.left, row.right))
  );
  const foundPairs = new Set();
  const pairwiseRows = Array.isArray(judgment.pairwise) ? judgment.pairwise : [];
  if (!Array.isArray(judgment.pairwise)) issues.push("pairwise must be an array");
  for (const [index, row] of pairwiseRows.entries()) {
    const where = `pairwise[${index}]`;
    rejectUnknownKeys(row, new Set(["left", "right", "preference", "reason"]), where, issues);
    if (!plainObject(row)) continue;
    const key = orderedPairKey(row.left, row.right);
    if (!expectedPairs.has(key)) issues.push(`${where} has unknown or self comparison`);
    if (foundPairs.has(key)) issues.push(`${where} duplicates comparison ${key}`);
    foundPairs.add(key);
    if (![row.left, row.right, "tie"].includes(row.preference)) {
      issues.push(`${where} preference must name left, right, or tie`);
    }
    if (!nonempty(row.reason)) issues.push(`${where} reason is required`);
  }
  for (const key of expectedPairs) {
    if (!foundPairs.has(key)) issues.push(`missing pairwise comparison ${key}`);
  }
  return { ok: issues.length === 0, issues };
}

function validatePrivateKey(key, packet, candidates) {
  const issues = [];
  if (!plainObject(key) || key.schema_version !== 1)
    return invalid("private key schema_version must equal 1");
  if (key.packet_id !== packet.packet_id)
    issues.push("private key packet_id does not match packet");
  const viewMapping = (key.views || []).find((item) => item.view_id === packet.view_id);
  if (!viewMapping || viewMapping.sha256 !== packet.view_sha256) {
    issues.push("private key does not authenticate the supplied packet view");
  }
  const packetById = new Map((packet.candidates || []).map((item) => [item.id, item]));
  const keyIds = Object.keys(key.candidates || {}).sort();
  const packetIds = [...packetById.keys()].sort();
  if (JSON.stringify(keyIds) !== JSON.stringify(packetIds)) {
    issues.push("private key candidate coverage does not match packet");
  }
  const indexes = new Set();
  for (const id of packetIds) {
    const mapping = key.candidates && key.candidates[id];
    if (!plainObject(mapping)) continue;
    if (!Number.isInteger(mapping.candidate_index) || !candidates[mapping.candidate_index]) {
      issues.push(`${id} references missing candidate`);
      continue;
    }
    if (indexes.has(mapping.candidate_index)) issues.push(`${id} reuses candidate_index`);
    indexes.add(mapping.candidate_index);
    const candidate = candidates[mapping.candidate_index];
    const checks = [
      ["profile_id", candidate.profile.id],
      ["repeat", candidate.repeat],
      ["behavioral_status", candidate.behavioral.status],
      ["artifact_ref", candidate.behavioral.artifact_ref],
      ["candidate_sha256", `sha256:${digest(JSON.stringify(candidate))}`],
    ];
    for (const [field, expected] of checks) {
      if (mapping[field] !== expected) issues.push(`${id} ${field} does not match candidate`);
    }
    const blind = packetById.get(id);
    const hashes = Array.isArray(mapping.artifact_hashes) ? mapping.artifact_hashes : [];
    if (hashes.length !== candidate.artifacts.length || hashes.length !== blind.artifacts.length) {
      issues.push(`${id} artifact coverage does not match`);
      continue;
    }
    for (let index = 0; index < hashes.length; index += 1) {
      if (hashes[index].name !== candidate.artifacts[index].name)
        issues.push(`${id} artifact ${index} name does not match`);
      if (hashes[index].source_sha256 !== candidate.artifacts[index].sha256)
        issues.push(`${id} artifact ${index} source hash does not match`);
      if (hashes[index].blind_sha256 !== blind.artifacts[index].sha256)
        issues.push(`${id} artifact ${index} blind hash does not match`);
    }
  }
  return { ok: issues.length === 0, issues };
}

function aggregateQualityResults({
  candidates,
  packet,
  packets = [packet],
  key,
  rubric,
  judgments,
  minimumRepeats = 3,
}) {
  assertValid(validateRubric(rubric), "rubric");
  if (packets.length !== judgments.length) {
    throw new Error("one authenticated packet view is required per judgment");
  }
  for (const [index, view] of packets.entries()) {
    if (
      view.packet_id !== packet.packet_id ||
      view.scenario.workflow !== packet.scenario.workflow ||
      view.scenario.case_id !== packet.scenario.case_id
    ) {
      throw new Error(`packet view ${index + 1} does not belong to the same evaluation`);
    }
    assertValid(validatePrivateKey(key, view, candidates), `private key view ${index + 1}`);
  }
  const judgeIds = judgments.map((item) => item && item.judge);
  if (new Set(judgeIds).size !== judgeIds.length) {
    throw new Error("judgments must use unique judge identifiers");
  }
  const viewIds = judgments.map((item) => item && item.view_id);
  if (new Set(viewIds).size !== viewIds.length) {
    throw new Error("judgments must use unique counterbalanced view identifiers");
  }
  const authenticatedViews = new Map((key.views || []).map((item) => [item.view_id, item.sha256]));
  if (judgments.some((item) => authenticatedViews.get(item.view_id) !== item.view_sha256)) {
    throw new Error("judgment references an unauthenticated packet view");
  }
  for (const [index, item] of judgments.entries()) {
    assertValid(validateJudgment(item, packets[index]), `judgment ${index}`);
  }
  const candidateByBlind = new Map();
  for (const [blindId, mapping] of Object.entries(key.candidates || {})) {
    candidateByBlind.set(blindId, candidates[mapping.candidate_index]);
  }
  const scoresByBlind = new Map();
  const dimensionsByBlind = new Map();
  const disagreement = [];
  let exactAgreement = 0;
  let withinOneAgreement = 0;
  let agreementPairs = 0;
  for (const blindId of packet.candidates.map((item) => item.id)) {
    const judgeScores = judgments.map((item) =>
      scoreJudgmentRow(
        item.candidates.find((row) => row.id === blindId),
        rubric
      )
    );
    scoresByBlind.set(blindId, mean(judgeScores.map((item) => item.weighted)));
    const dimensionScores = {};
    for (const dimension of rubric.dimensions) {
      const evaluations = judgments.map((judgment) => {
        const row = judgment.candidates.find((candidate) => candidate.id === blindId);
        const value = row.dimensions.find((entry) => entry.dimension === dimension.id);
        return {
          judge: judgment.judge,
          score: value.score,
          evidence: value.evidence,
          summary: row.summary,
        };
      });
      const values = evaluations
        .map((evaluation) => evaluation.score)
        .filter((value) => typeof value === "number");
      dimensionScores[dimension.id] = {
        mean: mean(values),
        applicable: values.length,
        possible: judgments.length,
      };
      if (
        values.length > 1 &&
        Math.max(...values) - Math.min(...values) >= rubric.disagreement_threshold
      ) {
        disagreement.push({
          candidate: blindId,
          dimension: dimension.id,
          range: Math.max(...values) - Math.min(...values),
          scores: values,
          evaluations,
        });
      }
      for (let left = 0; left < values.length; left += 1) {
        for (let right = left + 1; right < values.length; right += 1) {
          agreementPairs += 1;
          if (values[left] === values[right]) exactAgreement += 1;
          if (Math.abs(values[left] - values[right]) <= 1) withinOneAgreement += 1;
        }
      }
    }
    dimensionsByBlind.set(blindId, dimensionScores);
  }

  const grouped = {};
  for (const [blindId, score] of scoresByBlind.entries()) {
    const item = candidateByBlind.get(blindId);
    const id = item.profile.id;
    if (!grouped[id])
      grouped[id] = {
        scores: [],
        durations: [],
        repeats: new Set(),
        passed: 0,
        total: 0,
        dimensions: {},
      };
    grouped[id].scores.push(score);
    grouped[id].durations.push(item.runtime.duration_ms);
    grouped[id].repeats.add(item.repeat);
    grouped[id].passed += item.behavioral.status === "pass" ? 1 : 0;
    grouped[id].total += 1;
    for (const dimension of rubric.dimensions) {
      if (!grouped[id].dimensions[dimension.id]) {
        grouped[id].dimensions[dimension.id] = { values: [], applicable: 0, possible: 0 };
      }
      const found = dimensionsByBlind.get(blindId)[dimension.id];
      if (typeof found.mean === "number")
        grouped[id].dimensions[dimension.id].values.push(found.mean);
      grouped[id].dimensions[dimension.id].applicable += found.applicable;
      grouped[id].dimensions[dimension.id].possible += found.possible;
    }
  }
  const profiles = {};
  for (const [id, group] of Object.entries(grouped)) {
    profiles[id] = {
      mean: round(mean(group.scores)),
      median: round(median(group.scores)),
      minimum: round(Math.min(...group.scores)),
      maximum: round(Math.max(...group.scores)),
      repeats: group.repeats.size,
      behavioral_pass_rate: group.total === 0 ? null : group.passed / group.total,
      latency: {
        mean_ms: round(mean(group.durations)),
        median_ms: round(median(group.durations)),
        minimum_ms: Math.min(...group.durations),
        maximum_ms: Math.max(...group.durations),
      },
      variance: {
        claimable: group.repeats.size >= minimumRepeats,
        range: round(Math.max(...group.scores) - Math.min(...group.scores)),
        standard_deviation: round(populationStandardDeviation(group.scores)),
      },
      dimensions: Object.fromEntries(
        Object.entries(group.dimensions).map(([dimension, values]) => [
          dimension,
          {
            mean: round(mean(values.values)),
            coverage: values.possible === 0 ? 0 : round(values.applicable / values.possible),
          },
        ])
      ),
    };
  }

  const pairwise = { total: 0, wins: {}, ties: 0 };
  for (const item of judgments) {
    for (const comparison of item.pairwise) {
      pairwise.total += 1;
      if (comparison.preference === "tie") {
        pairwise.ties += 1;
      } else {
        const winner = candidateByBlind.get(comparison.preference).profile.id;
        pairwise.wins[winner] = (pairwise.wins[winner] || 0) + 1;
      }
    }
  }
  return {
    profiles,
    pairwise,
    disagreement,
    adjudication_required: disagreement.length > 0,
    judge_agreement: {
      flagged_dimensions: disagreement.length,
      candidate_dimensions: packet.candidates.length * rubric.dimensions.length,
      adjudication_pass_rate:
        packet.candidates.length * rubric.dimensions.length === 0
          ? null
          : round(1 - disagreement.length / (packet.candidates.length * rubric.dimensions.length)),
      exact_agreement_rate: agreementPairs === 0 ? null : round(exactAgreement / agreementPairs),
      within_one_agreement_rate:
        agreementPairs === 0 ? null : round(withinOneAgreement / agreementPairs),
      comparison_count: agreementPairs,
    },
    behavioral: {
      total: candidates.length,
      eligible: candidates.filter((item) => item.behavioral.status === "pass").length,
      excluded: candidates.filter((item) => item.behavioral.status !== "pass").length,
    },
  };
}

function buildScorecard({ candidates, aggregate }) {
  const eligible = candidates.filter((item) => item.behavioral.status === "pass");
  const failures = candidates.filter((item) => item.behavioral.status === "fail");
  const uncertain = candidates.filter((item) =>
    ["skip", "indeterminate"].includes(item.behavioral.status)
  );
  let winner = null;
  let observedLeader = null;
  if (eligible.length > 0) {
    const ranked = Object.entries(aggregate.profiles || {})
      .filter(([, value]) => typeof value.mean === "number")
      .sort((left, right) => right[1].mean - left[1].mean);
    if (ranked.length > 0 && (ranked.length === 1 || ranked[0][1].mean > ranked[1][1].mean)) {
      observedLeader = ranked[0][0];
      const repeatSufficient = ranked.every(([, profile]) => profile.variance.claimable);
      if (!aggregate.adjudication_required && repeatSufficient) winner = observedLeader;
    }
  }
  return {
    schema_version: 1,
    overall_status:
      failures.length > 0
        ? "behavioral-failure"
        : uncertain.length > 0
          ? "behavioral-uncertain"
          : eligible.length > 0
            ? "quality-scored"
            : "not-scorable",
    total_candidates: candidates.length,
    eligible_candidates: eligible.length,
    behavioral_failures: failures.length,
    behavioral_uncertain: uncertain.length,
    quality_winner: failures.length > 0 ? null : winner,
    observed_leader: failures.length > 0 ? null : observedLeader,
    adjudication_required: Boolean(aggregate.adjudication_required),
    judge_agreement: aggregate.judge_agreement || null,
    profiles: aggregate.profiles || {},
    pairwise: aggregate.pairwise || { total: 0, wins: {}, ties: 0 },
  };
}

function compareQualityScorecards(baseline, current) {
  if (baseline.workflow !== current.workflow || baseline.case_id !== current.case_id) {
    return { comparable: false, reason: "workflow-or-case-mismatch" };
  }
  for (const field of [
    "source_hash",
    "scenario_hash",
    "quality_case_hash",
    "rubric_hash",
    "evaluation_design_hash",
  ]) {
    if (
      !baseline.evaluation_identity ||
      !current.evaluation_identity ||
      baseline.evaluation_identity[field] !== current.evaluation_identity[field]
    ) {
      return { comparable: false, reason: `${field.replace(/_hash$/, "")}-mismatch` };
    }
  }
  const profiles = {};
  for (const [id, currentProfile] of Object.entries(current.profiles || {})) {
    const baselineProfile = baseline.profiles && baseline.profiles[id];
    if (!baselineProfile) continue;
    const dimensions = {};
    for (const [dimension, currentValue] of Object.entries(currentProfile.dimensions || {})) {
      const baselineValue = baselineProfile.dimensions && baselineProfile.dimensions[dimension];
      if (
        typeof currentValue.mean === "number" &&
        typeof (baselineValue && baselineValue.mean) === "number"
      ) {
        dimensions[dimension] = round(currentValue.mean - baselineValue.mean);
      }
    }
    profiles[id] = {
      mean_delta:
        typeof currentProfile.mean === "number" && typeof baselineProfile.mean === "number"
          ? round(currentProfile.mean - baselineProfile.mean)
          : null,
      dimensions,
    };
  }
  return {
    comparable: true,
    profiles,
    eligible_candidates_delta:
      (current.eligible_candidates || 0) - (baseline.eligible_candidates || 0),
    behavioral_failures_delta:
      (current.behavioral_failures || 0) - (baseline.behavioral_failures || 0),
    winner_changed: baseline.quality_winner !== current.quality_winner,
    baseline_winner: baseline.quality_winner || null,
    current_winner: current.quality_winner || null,
    repeat_count_changed:
      JSON.stringify(
        Object.fromEntries(
          Object.entries(baseline.profiles || {}).map(([id, value]) => [id, value.repeats])
        )
      ) !==
      JSON.stringify(
        Object.fromEntries(
          Object.entries(current.profiles || {}).map(([id, value]) => [id, value.repeats])
        )
      ),
    judge_count_delta: (current.judges || []).length - (baseline.judges || []).length,
  };
}

function scoreJudgmentRow(row, rubric) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const dimension of rubric.dimensions) {
    const value = row.dimensions.find((item) => item.dimension === dimension.id);
    if (typeof value.score !== "number") continue;
    weightedTotal += value.score * dimension.weight;
    weightTotal += dimension.weight;
  }
  return { weighted: weightTotal === 0 ? null : weightedTotal / weightTotal };
}

function identityTerms(candidates) {
  const terms = new Set(["codex", "claude", "openai", "anthropic", "gpt", "opus"]);
  for (const item of candidates) {
    for (const value of [
      item.profile && item.profile.id,
      item.profile && item.profile.adapter,
      item.profile && item.profile.model,
    ]) {
      if (nonempty(value)) {
        terms.add(value.toLowerCase());
        terms.add(value.toLowerCase().replaceAll("-", " "));
      }
    }
  }
  return [...terms].sort((left, right) => right.length - left.length);
}

function redactIdentity(value, terms) {
  let output = String(value);
  for (const term of terms) {
    output = output.replace(new RegExp(escapeRegExp(term), "gi"), "[redacted-model-identity]");
  }
  return output;
}

function neutralName(name) {
  return String(name).replace(/(codex|claude|openai|anthropic|gpt)[-_ ]?/gi, "");
}

function counterbalancedPacket(packet, viewId, salt, viewIndex, baseCandidateOrder) {
  const view = JSON.parse(JSON.stringify(packet));
  view.view_id = viewId;
  const order = viewIndex % 2 === 0 ? baseCandidateOrder : [...baseCandidateOrder].reverse();
  const position = new Map(order.map((id, index) => [id, index]));
  view.candidates.sort((left, right) => position.get(left.id) - position.get(right.id));
  view.pairwise_plan = view.pairwise_plan
    .map((pair, index) => {
      const reverse = (viewIndex + index) % 2 === 1;
      return reverse ? { left: pair.right, right: pair.left } : pair;
    })
    .sort((left, right) =>
      digest(`${salt}:${viewId}:${pairKey(left.left, left.right)}`).localeCompare(
        digest(`${salt}:${viewId}:${pairKey(right.left, right.right)}`)
      )
    );
  view.estimated_tokens = estimateTokens(JSON.stringify({ ...view, estimated_tokens: 0 }));
  return view;
}

function estimateTokens(value) {
  return Math.ceil(Buffer.byteLength(String(value), "utf8") / 3);
}

function packetViewHash(packet) {
  const value = JSON.parse(JSON.stringify(packet));
  value.view_sha256 = null;
  value.estimated_tokens = 0;
  return `sha256:${digest(JSON.stringify(value))}`;
}

function unorderedPairs(ids) {
  const pairs = new Set();
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      pairs.add(pairKey(ids[left], ids[right]));
    }
  }
  return pairs;
}

function pairKey(left, right) {
  return [left, right].sort().join("::");
}

function orderedPairKey(left, right) {
  return `${left}::${right}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function populationStandardDeviation(values) {
  if (values.length === 0) return null;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values) {
  const usable = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return usable.length === 0
    ? null
    : usable.reduce((total, value) => total + value, 0) / usable.length;
}

function round(value) {
  return value === null ? null : Number(value.toFixed(3));
}

function assertValid(result, label) {
  if (!result.ok) throw new Error(`${label} invalid: ${result.issues.join("; ")}`);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function slug(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function integerBetween(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function numberBetween(value, minimum, maximum) {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function numberAtLeast(value, minimum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function invalid(message) {
  return { ok: false, issues: [message] };
}

function rejectUnknownKeys(value, allowed, where, issues) {
  if (!plainObject(value)) {
    issues.push(`${where} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${where} has unknown field ${key}`);
  }
}

function inside(rootDir, candidatePath) {
  const relative = path.relative(path.resolve(rootDir), candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

module.exports = {
  REQUIRED_CASE_TYPES,
  aggregateQualityResults,
  buildBlindPacket,
  buildScorecard,
  compareQualityScorecards,
  extractCasePrompt,
  loadQualityCase,
  loadQualityProfile,
  validateCandidate,
  validateBlindPacket,
  validateJudgment,
  validatePrivateKey,
  validateQualitySuite,
  validateQualityScorecard,
  validateQualityTree,
  validateRubric,
};
