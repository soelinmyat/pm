"use strict";
const path = require("node:path");
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { validateProposal, executionContract } = require("./proposal-schema");
const { scoreProposal } = require("../proposal-quality-check");
const { validateRfcSidecar } = require("../rfc-sidecar-check");
const { rfcIssuesToDevWorkUnits } = require("./rfc-work-units");
const { createProjectRootAnchor, readProjectInput } = require("./project-file");
const { DIMENSION_NAMES, assessRisk, routeDevWork } = require("./dev-risk");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const equal = isDeepStrictEqual;
function validateSourceEntries(entries, immutable, requireRfc = true) {
  if (!Array.isArray(entries) || entries.length < (requireRfc ? 3 : 1) || entries.length > 100)
    throw new Error("Complete native bundle required");
  const paths = new Set();
  for (const entry of entries) {
    if (
      !entry ||
      Object.keys(entry).some(
        (key) =>
          !(
            immutable
              ? ["path", "revision", "knowledge_version_id", "content_hash", "role"]
              : ["path", "content_hash", "role"]
          ).includes(key)
      ) ||
      typeof entry.path !== "string" ||
      !entry.path.startsWith("pm/") ||
      entry.path.includes("\\") ||
      entry.path.split("/").some((part) => !part || part === "." || part === "..") ||
      !/^[a-f0-9]{64}$/.test(entry.content_hash) ||
      (immutable &&
        (!Number.isSafeInteger(entry.revision) ||
          entry.revision < 1 ||
          !Number.isSafeInteger(entry.knowledge_version_id) ||
          entry.knowledge_version_id < 1)) ||
      !["proposal", "rfc", "supporting"].includes(entry.role) ||
      paths.has(entry.path)
    )
      throw new Error("Invalid immutable native bundle entry");
    paths.add(entry.path);
  }
  for (const role of requireRfc ? ["proposal", "rfc"] : ["proposal"])
    if (entries.filter((item) => item.role === role).length !== 1)
      throw new Error(`Exactly one native ${role} required`);
}
function validateEntries(entries) {
  validateSourceEntries(entries, true);
}
function validateAuthoringEntries(entries) {
  validateSourceEntries(entries, true, false);
  if (entries.filter((entry) => entry.role === "rfc").length > 1)
    throw new Error("At most one authoring RFC required");
}
function readContract(native, slug) {
  validateEntries(native.entries);
  return readDocumentContract(native, slug);
}
function readDraftContract(draft, slug, stage = "rfc") {
  // Drafts use the same validators without fabricating remote revisions or
  // knowledge-version IDs. This validation creates no approval authority.
  if (!["groom", "rfc"].includes(stage))
    throw new Error("Explicit product authoring stage required");
  validateSourceEntries(draft.entries, false, stage === "rfc");
  if (stage === "groom" && draft.entries.some((entry) => entry.role === "rfc"))
    throw new Error("Groom publishes product scope before technical design");
  return readDocumentContract(draft, slug, stage);
}
function readDocumentContract(native, slug, stage = "rfc") {
  const anchor = createProjectRootAnchor(native.snapshot_root);
  const documents = new Map();
  let total = 0;
  for (const entry of native.entries) {
    const bytes = readProjectInput(native.snapshot_root, entry.path, 32 * 1024 * 1024, {
      projectRootAnchor: anchor,
      requireStablePath: true,
    }).bytes;
    total += bytes.length;
    if (total > 64 * 1024 * 1024 || sha(bytes) !== entry.content_hash)
      throw new Error("Pinned native document bytes changed");
    documents.set(entry.path, bytes);
  }
  const parse = (entry) => {
    const bytes = documents.get(entry?.path);
    if (!bytes || bytes.length > 2 * 1024 * 1024)
      throw new Error("Bound native JSON contract required within 2 MB");
    return JSON.parse(bytes.toString("utf8"));
  };
  const proposal = parse(native.entries.find((item) => item.role === "proposal"));
  if (!proposal.review_contract || !proposal.design_context)
    throw new Error("Current proposal review and design contracts required");
  const checked = validateProposal(proposal, {
    expectedSlug: slug,
    projectRoot: native.snapshot_root,
    requireCurrentPrototypeIdentity: true,
    requireExperienceClassification: true,
  });
  if (!checked.ok) throw new Error(`Native proposal invalid: ${checked.issues[0].message}`);
  if (!scoreProposal(proposal).quality_passed)
    throw new Error("Native proposal quality gate failed");
  if (proposal.open_decisions.some((item) => item.blocks_approval !== false))
    throw new Error("Resolve approval-blocking proposal decisions before native execution");
  const contract = executionContract(proposal);
  if (stage === "groom") return { contract };
  const rfc = parse(native.entries.find((item) => item.role === "rfc"));
  const rfcCheck = validateRfcSidecar(rfc, "native RFC", {
    expectedSlug: slug,
    expectedDesignContext: contract.design_context,
    repoRoot: native.snapshot_root,
    requireCurrentDesignContext: true,
  });
  if (!rfcCheck.ok || rfc.schema_version !== 3 || rfc.size !== contract.size)
    throw new Error(
      `Native RFC contract invalid: ${rfcCheck.issues[0]?.message || "schema/size mismatch"}`
    );
  const executionEntry = native.entries.find(
    (item) => item.role === "supporting" && item.path === native.execution_path
  );
  const execution = parse(executionEntry);
  const fields = ["schema_version", "kind", "risk", "ui_platform"];
  if (
    !equal(Object.keys(execution).sort(), fields.sort()) ||
    execution.schema_version !== 1 ||
    !["proposal", "task", "bug"].includes(execution.kind) ||
    !["web", "mobile", "mixed", "unknown"].includes(execution.ui_platform) ||
    !execution.risk ||
    !equal(Object.keys(execution.risk).sort(), [...DIMENSION_NAMES, "destructive_data"].sort())
  )
    throw new Error("Complete reviewed native execution/risk contract required");
  assessRisk(execution.risk); // Validate original types before deriving the UI minimum.
  // Current native bundle review is the human approval. Proposal lifecycle strings
  // and archived legacy decision files are source data, never approval authority.
  const facts = {
    kind: execution.kind,
    size: contract.size,
    risk: {
      ...execution.risk,
      ui: Math.max(execution.risk.ui, contract.design_context.ui_impact ? 1 : 0),
    },
    ui_platform: execution.ui_platform,
    reference: path.join(
      native.snapshot_root,
      native.entries.find((item) => item.role === "proposal").path
    ),
    acceptance_criteria: contract.acceptance_criteria.map(
      (item) => `${item.id}: Given ${item.given}, when ${item.when}, then ${item.then}`
    ),
    design_context: contract.design_context,
    work_units: rfcIssuesToDevWorkUnits(rfc, { repoRoot: native.snapshot_root }),
  };
  const route = routeDevWork(facts);
  return { facts, route, contract, rfc };
}
function validateTaskContract(session) {
  const checked = readContract(session.task.native, session.slug);
  const { facts, route } = checked;
  if (session.phase === "intake") return checked;
  if (
    session.task.size !== facts.size ||
    session.task.kind !== facts.kind ||
    !equal(session.task.design_context, facts.design_context) ||
    !equal(session.task.acceptance_criteria, facts.acceptance_criteria) ||
    !equal(session.task.risk, {
      ...route.risk.dimensions,
      destructive_data: route.risk.destructive_data,
    }) ||
    session.task.risk_tier !== route.risk_tier ||
    session.task.ui_platform !== facts.ui_platform ||
    !equal(session.routing.required_phases, route.required_phases) ||
    !equal(session.routing.required_gates, route.required_gates) ||
    session.routing.review_mode !== route.review_mode
  )
    throw new Error("Native execution contract or gate routing changed");
  const immutable = (units) =>
    units.map(({ id, title, depends_on, owns, contract }) => ({
      id,
      title,
      depends_on,
      owns,
      contract,
    }));
  if (!equal(immutable(session.task.work_units), immutable(facts.work_units)))
    throw new Error("Native work-unit contract changed; publish and review a new bundle");
  return checked;
}
module.exports = {
  sha,
  validateEntries,
  validateAuthoringEntries,
  readContract,
  readDraftContract,
  validateTaskContract,
};
