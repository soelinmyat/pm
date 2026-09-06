"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readProjectInput } = require("./project-file");
const { MAX_HTML_BYTES, MAX_JSON_BYTES } = require("./review-limits");

const POLICY = "bounded-review-content-v1";
const TEMPLATE = path.join(__dirname, "../../references/templates/review-report.html");
const RENDERER = path.join(__dirname, "../review-report.js");
// A report about presentation machinery must exercise responsive captures and
// print. Check both sides of renames; unknown source inventories never qualify.
const PRESENTATION_PATH =
  /(?:^|\/)(?:templates?|styles?|css|renderers?|presentation)(?:\/|[.-])|(?:review-report|review-presentation|review-contract|review-limits|artifact-|media-inspect|dev-gate-check)|\.(?:html?|css|scss|sass|less|svg|tsx|jsx|vue|svelte)$/i;

function reviewPresentationPolicy({ report, target }) {
  const full = (reason) => ({ mode: "full", policy: POLICY, reason });
  if (
    target?.schema_version !== 2 ||
    target?.relevance_policy !== "changed-hunk-anchor-v1" ||
    target?.generator?.name !== "pm:review" ||
    report?.schema_version !== 1 ||
    report?.generator?.name !== "pm:review" ||
    JSON.stringify(report.generator) !== JSON.stringify(target.generator) ||
    JSON.stringify(report.source) !== JSON.stringify(target.source)
  )
    return full("unknown or legacy source contract");
  if (
    !Array.isArray(target.changed_files) ||
    target.changed_files.length === 0 ||
    target.changed_files.some(
      (row) =>
        typeof row?.path !== "string" ||
        [row.path, row.old_path].filter(Boolean).some((name) => PRESENTATION_PATH.test(name))
    )
  )
    return full("presentation changes or unknown changed-file inventory");
  if (
    !Array.isArray(target.lenses) ||
    target.lenses.some(
      (lens) =>
        lens.applicable && !["bug", "edge", "reuse", "quality", "efficiency"].includes(lens.name)
    )
  )
    return full("design, security, or unknown review risk");
  if (
    report.outcome !== "passed" ||
    !Array.isArray(report.findings) ||
    report.findings.length > 2 ||
    !Array.isArray(report.blockers) ||
    report.blockers.length !== 0 ||
    !Array.isArray(report.unresolved_disagreements) ||
    report.unresolved_disagreements.length !== 0
  )
    return full("non-passing or complex findings");
  if (
    report.findings.some(
      (finding) =>
        !["low", "medium"].includes(finding.severity) ||
        finding.disputed !== false ||
        finding.decision_required !== false ||
        finding.decision !== null
    )
  )
    return full("finding requires full presentation review");
  // Bound all variable content, including retained signals, evidence and paths.
  // Long unbroken identifiers and markup-like payloads route to full evidence;
  // escaping and current browser fit checks still apply to every compact report.
  const strings = [];
  const visit = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(report);
  if (
    strings.reduce((sum, value) => sum + value.length, 0) > 12_000 ||
    strings.some(
      (value) =>
        value.length > 1000 ||
        /\S{161}|[<>]/u.test(value) ||
        [...value].some((char) => char.charCodeAt(0) < 32 && !"\t\n\r".includes(char))
    )
  )
    return full("variable content exceeds compact fit budget");
  return {
    mode: "compact",
    policy: POLICY,
    reason: "bounded plain report without presentation or high-risk changes",
  };
}

// This binds presentation only. The delivery gate separately validates the
// complete canonical Review evidence, source and lens results as before.
function readReviewPresentation(root, htmlPath) {
  const relative = path.relative(root, path.resolve(htmlPath)).split(path.sep).join("/");
  const html = readProjectInput(root, relative, MAX_HTML_BYTES);
  const inspected = require("../artifact-check").inspectHtmlArtifact(html.bytes, {
    expectedKind: "report",
  });
  if (!inspected.ok)
    throw new Error(
      `review HTML structural check failed: ${inspected.issues.map((item) => item.message).join("; ")}`
    );
  const source = inspected.metadata?.source;
  const loaded = readProjectInput(root, source?.path, MAX_JSON_BYTES);
  if (source.sha256 !== `sha256:${digest(loaded.bytes)}`)
    throw new Error("review HTML source binding drifted");
  const report = JSON.parse(loaded.bytes.toString("utf8"));
  const targetFile = readProjectInput(root, report.target?.path, MAX_JSON_BYTES);
  if (report.target.sha256 !== digest(targetFile.bytes))
    throw new Error("review target binding drifted");
  const target = JSON.parse(targetFile.bytes.toString("utf8"));
  const policy = reviewPresentationPolicy({ report, target });
  if (policy.mode === "compact") {
    if (report.human_report?.path !== relative) throw new Error("review HTML path binding drifted");
    const canonical = require("../review-report").renderReviewHtml(
      report,
      loaded.bytes,
      source.path
    );
    if (html.bytes.toString("utf8") !== canonical)
      return { mode: "full", policy: POLICY, reason: "custom or modified report HTML" };
  }
  return {
    ...policy,
    report: { path: source.path, sha256: digest(loaded.bytes) },
    target: { path: report.target.path, sha256: digest(targetFile.bytes) },
    renderer_sha256: digest(fs.readFileSync(RENDERER)),
    template_sha256: digest(fs.readFileSync(TEMPLATE)),
  };
}

function validateCompactReviewPresentation(root, htmlPath, presentation) {
  const current = readReviewPresentation(root, htmlPath);
  if (current.mode !== "compact" || JSON.stringify(current) !== JSON.stringify(presentation))
    throw new Error(
      "compact presentation policy or bound report/target/renderer/template inputs drifted"
    );
  return current;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

module.exports = {
  POLICY,
  readReviewPresentation,
  reviewPresentationPolicy,
  validateCompactReviewPresentation,
};
