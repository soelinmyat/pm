"use strict";

// Scripted writer for the canonical Dev gate manifest. A passed row is derived
// only from the session's recorded phase evidence at the worktree HEAD, the
// gate's own checker is rerun, and the candidate manifest must pass
// dev-gate-check for that gate before anything is written. Agents call this
// instead of hand-editing gates.json.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { currentEvidenceRecords } = require("./workflow-runtime/records");
const { resolveGateEvidenceContract } = require("./dev-session-schema");

// Gate names and statuses come from the checker so the writer can never
// accept a row the checker rejects. Required lazily: the checker is heavy and
// tests inject their own deps.
function gateVocabulary() {
  const { DEFAULT_REQUIRED_GATES, VALID_STATUSES } = require("../dev-gate-check");
  return { names: new Set(DEFAULT_REQUIRED_GATES), statuses: VALID_STATUSES };
}

function defaultDeps() {
  const gateCheck = require("../dev-gate-check");
  return {
    head: (root) => gateCheck.currentGitCommit(root),
    resolveContext: (input) => gateCheck.resolveEnforcementContext(input),
    checkManifest: gateCheck.checkGateManifest,
    checkDesignCritique: (options) =>
      require("../design-critique-check").checkDesignCritique(options),
    validateQa: gateCheck.validateCanonicalQaDeliveryEvidence,
  };
}

function gateError(message) {
  return new Error(message);
}

function formatIssues(issues) {
  return issues
    .slice(0, 5)
    .map((item) => `${item.path}: ${item.message}`)
    .join("; ");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

// The session must be the canonical one inside its own worktree, so every
// artifact path the row records resolves from the same project root the
// delivery checker uses.
function resolveSessionLayout(sessionPath, session) {
  const worktree = session?.source?.worktree;
  if (typeof worktree !== "string" || !path.isAbsolute(worktree))
    throw gateError("gate writes require a session with an absolute source.worktree");
  const expected = path.join(worktree, ".pm", "dev-sessions", String(session.slug), "session.json");
  let root;
  let resolvedSession;
  try {
    root = fs.realpathSync(worktree);
    resolvedSession = fs.realpathSync(sessionPath);
  } catch (error) {
    throw gateError(`gate writes require the canonical session ${expected}: ${error.message}`);
  }
  if (
    resolvedSession !== path.join(root, ".pm", "dev-sessions", String(session.slug), "session.json")
  )
    throw gateError(`gate writes require the canonical session ${expected}`);
  const sessionDir = path.dirname(resolvedSession);
  return {
    root,
    sessionDir,
    sessionRel: toPosix(path.relative(root, resolvedSession)),
    sessionDirRel: toPosix(path.relative(root, sessionDir)),
    manifestPath: path.join(sessionDir, "gates.json"),
  };
}

function projectRelative(root, file) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw gateError(`artifact ${file} is outside the project root`);
  return toPosix(relative);
}

function loadManifest(manifestPath, session) {
  if (!fs.existsSync(manifestPath))
    return {
      schema_version: 1,
      run_id: session.run_id,
      size: session.task?.size ?? null,
      kind: session.task?.kind ?? null,
      gates: [],
    };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw gateError(`cannot read existing gate manifest: ${error.message}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw gateError("existing gate manifest must be an object");
  if (manifest.schema_version !== 1)
    throw gateError("existing gate manifest schema_version must equal 1");
  if (manifest.run_id !== session.run_id)
    throw gateError(
      `existing gate manifest run_id ${manifest.run_id} does not match session run ${session.run_id}`
    );
  if (!Array.isArray(manifest.gates))
    throw gateError("existing gate manifest gates must be an array");
  return manifest;
}

// Returns the passing records for the gate's evidence phase at HEAD, and
// whether they were reached through recertification.
function currentPassingEvidence(session, name, head) {
  const contract = resolveGateEvidenceContract(name);
  const phaseEvidence = session.evidence?.[contract.phase];
  const records = currentEvidenceRecords(phaseEvidence, head) || [];
  const passing = records.filter(
    (record) => record?.exit_code === 0 && record.kind === contract.kind
  );
  if (passing.length === 0)
    throw gateError(
      `no passing ${contract.kind} evidence for ${contract.phase} at HEAD ${head}; record or recertify it first`
    );
  return {
    contract,
    phaseEvidence,
    records,
    passing,
    recertified: phaseEvidence.commit !== head,
  };
}

function reviewRowFields(layout) {
  const reviewDir = path.join(layout.sessionDir, "review");
  const reportPath = path.join(reviewDir, "report.json");
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    throw gateError(
      `review gate requires ${projectRelative(layout.root, reportPath)}: ${error.message}`
    );
  }
  const lenses = Array.isArray(report?.coverage?.completed) ? [...report.coverage.completed] : [];
  if (report?.human_report === null) {
    return {
      artifact: `${layout.sessionDirRel}/review/report.json`,
      evidence_kind: "review-report-v1",
      report_sha256: sha256(fs.readFileSync(reportPath)),
      lenses,
    };
  }
  const renderManifest = path.join(reviewDir, "renders", "manifest.json");
  let renderBytes;
  try {
    renderBytes = fs.readFileSync(renderManifest);
  } catch (error) {
    throw gateError(`review gate requires its render manifest: ${error.message}`);
  }
  return {
    artifact: `${layout.sessionDirRel}/review/report.html`,
    evidence_kind: "review-report-v1",
    render_manifest: `${layout.sessionDirRel}/review/renders/manifest.json`,
    render_manifest_sha256: sha256(renderBytes),
    lenses,
  };
}

// The critique chain is always rerun. A fresh critique is checked at HEAD
// against the base the enforcement context already resolved. A recertified
// critique is bound to the commit it captured, so it is rerun at that commit
// without the HEAD-bound Git identity checks. It gets no base commit: the
// route's own base is the only record of it, so comparing the two proves nothing.
function designCritiqueRowFields(layout, head, context, evidence, deps) {
  const base = `${layout.sessionDirRel}/design-critique`;
  const paths = {
    root: layout.root,
    routePath: `${base}/route.json`,
    capturesPath: `${base}/captures.json`,
    reportPath: `${base}/report.json`,
  };
  const options = evidence.recertified
    ? {
        ...paths,
        commit: evidence.phaseEvidence.commit,
        baseRef: context.authoritativeBaseRef,
        verifyGit: false,
      }
    : {
        ...paths,
        commit: head,
        baseRef: context.authoritativeBaseRef,
        baseCommit: context.authoritativeBaseCommit,
        verifyRemote: false,
      };
  const result = deps.checkDesignCritique(options);
  if (!result?.ok)
    throw gateError(`design-critique check failed: ${formatIssues(result?.issues || [])}`);
  return { artifact: `${base}/report.html` };
}

function qaRowFields(layout, session, evidence, head, manifestPath, deps) {
  const issues = [];
  deps.validateQa(session, evidence.records, head, manifestPath, issues);
  if (issues.length > 0) throw gateError(`QA check failed: ${formatIssues(issues)}`);
  const report = evidence.passing.find((record) => typeof record.artifact === "string");
  return { artifact: projectRelative(layout.root, report.artifact) };
}

function evidenceArtifact(layout, evidence) {
  const withArtifact = evidence.passing.find(
    (record) =>
      typeof record.artifact === "string" &&
      record.artifact.trim() !== "" &&
      fs.existsSync(path.resolve(layout.root, record.artifact.split("#")[0]))
  );
  if (withArtifact) {
    try {
      return projectRelative(layout.root, withArtifact.artifact);
    } catch {
      // Evidence outside the project falls back to the session anchor below.
    }
  }
  return `${layout.sessionRel}#evidence.${evidence.contract.phase}`;
}

function validateRequest({ name, status, reason, artifact }) {
  const vocabulary = gateVocabulary();
  if (!vocabulary.names.has(name))
    throw Object.assign(gateError(`unknown gate ${name}`), { invalidInput: true });
  if (!vocabulary.statuses.has(status))
    throw Object.assign(gateError(`invalid gate status ${status}`), { invalidInput: true });
  if (status === "passed" && (reason || artifact))
    throw Object.assign(
      gateError("a passed gate derives its artifact from evidence; omit --reason and --artifact"),
      { invalidInput: true }
    );
  if (status !== "passed" && !String(reason || "").trim())
    throw Object.assign(gateError(`--reason is required for a ${status} gate`), {
      invalidInput: true,
    });
}

// Builds and validates the candidate manifest without writing it.
function planGateWrite(request, deps = defaultDeps()) {
  const { sessionPath, session, name } = request;
  const status = request.status || "passed";
  const reason = request.reason || "";
  validateRequest({ name, status, reason, artifact: request.artifact });
  const layout = resolveSessionLayout(sessionPath, session);
  const head = deps.head(layout.root);
  const now = request.now || new Date().toISOString();
  const manifest = loadManifest(layout.manifestPath, session);
  // Passed and skipped rows are judged against the authoritative delivery
  // base. Recording a failure must work offline and on a detached HEAD, and
  // no checker reads the base for those rows.
  const enforce = status === "passed" || status === "skipped";
  const context = deps.resolveContext({
    cwd: layout.root,
    session,
    enforce,
    currentCommit: head,
    remote: session.source?.delivery_remote,
  });

  let row;
  if (status === "passed") {
    const evidence = currentPassingEvidence(session, name, head);
    let fields;
    if (name === "review") fields = reviewRowFields(layout);
    else if (name === "design-critique")
      fields = designCritiqueRowFields(layout, head, context, evidence, deps);
    else if (name === "qa")
      fields = qaRowFields(layout, session, evidence, head, layout.manifestPath, deps);
    else fields = { artifact: evidenceArtifact(layout, evidence) };
    row = {
      name,
      status,
      commit: evidence.recertified ? evidence.phaseEvidence.commit : head,
      artifact: fields.artifact,
      reason: "",
      checked_at: now,
      ...(evidence.recertified ? { verified_commit: head, verified_at: now } : {}),
    };
    for (const [key, value] of Object.entries(fields)) if (key !== "artifact") row[key] = value;
  } else {
    row = {
      name,
      status,
      commit: head,
      artifact: request.artifact ? projectRelative(layout.root, request.artifact) : "",
      reason: reason.trim(),
      checked_at: now,
    };
  }

  const gates = manifest.gates.filter((gate) => gate?.name !== name);
  const index = manifest.gates.findIndex((gate) => gate?.name === name);
  if (index === -1) gates.push(row);
  else gates.splice(index, 0, row);
  const candidate = { ...manifest, gates };

  const result = deps.checkManifest(candidate, {
    currentCommit: head,
    currentBranch: context.currentBranch,
    manifestPath: layout.manifestPath,
    artifactRoot: layout.root,
    requiredGates: [name],
    changedFiles: context.changedFiles,
    runId: session.run_id,
    canonicalSession: session,
    requireSessionBinding: true,
    authoritativeBaseRef: context.authoritativeBaseRef,
    authoritativeBaseCommit: context.authoritativeBaseCommit,
    authoritativePushUrlSha256: context.authoritativePushUrlSha256,
    reviewEvidenceMode: "enforce",
  });
  // A recorded failure is the requested outcome, not a reason to refuse it.
  const expectedOutcome = `required gate ${name} is ${status}`;
  const issues = (result?.issues || []).filter(
    (item) => !(status !== "passed" && status !== "skipped" && item.message === expectedOutcome)
  );
  if (issues.length > 0)
    throw gateError(`gate ${name} failed dev-gate-check: ${formatIssues(issues)}`);
  return { manifestPath: layout.manifestPath, manifest: candidate, row };
}

module.exports = { planGateWrite };
