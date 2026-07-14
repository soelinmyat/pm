#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const projectFiles = require("./lib/project-file");
const { readProjectInput } = projectFiles;
const { MAX_HTML_BYTES, MAX_JSON_BYTES } = require("./lib/review-limits");
const { expectedReviewPath, reviewPathContext } = require("./lib/review-paths");
const { changeAnchorText } = require("./lib/review-contract");

function renderReviewReport(options) {
  const root = fs.realpathSync(path.resolve(options.root || process.cwd()));
  const loadedReport = projectFile(root, options.reportPath, "report");
  const reportPath = loadedReport.path;
  const bytes = loadedReport.bytes;
  const report = JSON.parse(bytes.toString("utf8"));
  const outputPath = projectOutputPath(root, options.outputPath, "output");
  const relativeReport = path.relative(root, reportPath).split(path.sep).join("/");
  const relativeOutput = path.relative(root, outputPath).split(path.sep).join("/");
  const pathContext = reviewPathContext(report.target?.path, report.review_round, report.run_id);
  const reviewRoot = pathContext.evidenceRoot;
  const reportStage = path.basename(relativeReport) === "draft-report.json" ? "draft" : "final";
  const expectedReport = expectedReviewPath(reviewRoot, report.review_round, "report", {
    outcome: report.outcome,
    stage: reportStage,
    canonicalRoot: pathContext.canonicalRoot,
  });
  const expectedHuman = expectedReviewPath(reviewRoot, report.review_round, "human", {
    outcome: report.outcome,
    stage: reportStage,
    canonicalRoot: pathContext.canonicalRoot,
  });
  if (relativeReport !== expectedReport)
    throw new Error(`report path must equal ${expectedReport}`);
  if (relativeOutput !== expectedHuman)
    throw new Error(`human report path must equal ${expectedHuman}`);
  if (report.human_report?.path !== relativeOutput)
    throw new Error("report.human_report.path must equal the requested output path");
  if (
    report.generator?.name !== "pm:review" ||
    !/^\d+\.\d+\.\d+$/.test(report.generator?.version || "")
  )
    throw new Error("report.generator must bind pm:review to an exact semantic version");
  const evidence = [report.target, ...(report.results || []), report.decisions]
    .filter(Boolean)
    .map((item) => ({ path: item.path, sha256: `sha256:${item.sha256}` }));
  const metadata = {
    schema_version: 1,
    id: `report:${artifactSlug(report.run_id)}`,
    kind: "report",
    slug: artifactSlug(report.run_id),
    lifecycle: "reviewed",
    title: "Source Review Report",
    generated_at: report.checked_at,
    generator: structuredClone(report.generator),
    source: { path: relativeReport, sha256: `sha256:${digest(bytes)}` },
    evidence,
  };
  const templatePath =
    options.templatePath ||
    path.join(__dirname, "..", "references", "templates", "review-report.html");
  let html = fs.readFileSync(templatePath, "utf8");
  html = html.replace(
    /<script id="pm-artifact" type="application\/json">[\s\S]*?<\/script>/,
    `<script id="pm-artifact" type="application/json">${escapeScriptJson(metadata)}</script>`
  );
  const required = report.coverage?.required || [];
  const completed = new Set(report.coverage?.completed || []);
  const notApplicable = new Set(report.coverage?.not_applicable || []);
  const lensCards = [...required, ...notApplicable]
    .map(
      (lens) =>
        `<article class="card"><strong>${escapeHtml(lens)}</strong><p>${
          notApplicable.has(lens)
            ? "Not applicable — routed before dispatch."
            : completed.has(lens)
              ? "Complete — current structured verdict received."
              : "Missing — review cannot pass."
        }</p></article>`
    )
    .join("");
  const findings = (report.findings || []).length
    ? report.findings.map(findingCard).join("")
    : '<p class="muted">No findings in the current review round.</p>';
  const disagreements = (report.unresolved_disagreements || []).length
    ? `<div class="evidence">Unresolved: ${report.unresolved_disagreements
        .map((id) => `<code>${escapeHtml(id)}</code>`)
        .join(", ")}</div>`
    : '<p class="muted">No unresolved reviewer disagreement.</p>';
  const handoffs = `<div class="grid"><article class="card"><strong>Design Critique</strong><p>${handoffList(
    report.handoffs?.design_critique
  )}</p></article><article class="card"><strong>QA</strong><p>${handoffList(
    report.handoffs?.qa
  )}</p></article><article class="card"><strong>Auto-fix eligible</strong><p>${handoffList(
    report.auto_fix_eligible
  )}</p></article></div>`;
  const replacements = {
    PLUGIN_VERSION: report.generator.version,
    TITLE: "Source Review Report",
    SUMMARY: `Evidence-bound review of ${report.source?.commit || "unknown commit"} against ${report.source?.base_ref || "unknown base"}.`,
    OUTCOME: report.outcome,
    ROUND: String(report.review_round),
    BLOCKER_COUNT: String((report.blockers || []).length),
    COVERAGE: `${completed.size}/${required.length}`,
    TOP_ISSUE_SHA256: digest(Buffer.from(report.top_issue || "")),
    TOP_ISSUE: report.top_issue,
    NEXT_ACTION_SHA256: digest(Buffer.from(report.next_action || "")),
    NEXT_ACTION: report.next_action,
    LENS_CARDS: lensCards,
    FINDINGS: findings,
    DISAGREEMENTS: disagreements,
    HANDOFFS: handoffs,
    METHOD:
      "Target-bound logical lenses, adaptive read-only reviewers, deterministic identity, retained signals, explicit disagreement, and bounded fix rounds.",
    COMMIT: report.source?.commit || "",
    COMMIT_SHA256: digest(Buffer.from(report.source?.commit || "")),
    BASE_REF: report.source?.base_ref || "",
    BASE_COMMIT: report.source?.base_commit || "",
    REMOTE_PUSH_URL_SHA256: report.source?.remote_push_url_sha256 || "",
    BASE_SHA256: digest(
      Buffer.from(
        `${report.source?.base_ref || ""}:${report.source?.base_commit || ""}:${report.source?.remote_push_url_sha256 || ""}`
      )
    ),
  };
  const slots = [...html.matchAll(/{{([A-Z0-9_]+)}}/g)].map((match) => match[1]);
  const unknown = slots.filter((name) => !Object.hasOwn(replacements, name));
  if (unknown.length > 0)
    throw new Error(
      `review report template contains unresolved tokens: ${[...new Set(unknown)].join(", ")}`
    );
  const rawHtml = new Set(["LENS_CARDS", "FINDINGS", "DISAGREEMENTS", "HANDOFFS"]);
  html = html.replace(/{{([A-Z0-9_]+)}}/g, (_, name) =>
    rawHtml.has(name) ? String(replacements[name]) : escapeHtml(replacements[name])
  );
  let publication;
  try {
    publication = projectFiles.writeProjectTextAtomic(root, options.outputPath, html, {
      fileMode: 0o600,
      directoryMode: 0o700,
      replace: !(reportStage === "final" && report.outcome !== "passed"),
      maxBytes: MAX_HTML_BYTES,
    });
  } catch (error) {
    if (/EEXIST|file exists/i.test(error.message))
      throw new Error("refusing to overwrite immutable non-passing human report");
    throw error;
  }
  return {
    path: relativeOutput,
    sha256: digest(Buffer.from(html)),
    bytes: Buffer.byteLength(html),
    ...(!publication.directory_synced
      ? {
          directory_synced: false,
          directory_sync_error: publication.directory_sync_error,
        }
      : {}),
  };
}

function findingCard(finding) {
  const evidence = (finding.evidence || [])
    .map((item) => `<code>${escapeHtml(item.ref)}</code>`)
    .join(" · ");
  const anchors = (finding.change_anchors || [])
    .map((anchor) => `<code>${escapeHtml(changeAnchorText(anchor))}</code>`)
    .join(" · ");
  const signals = (finding.signals || [])
    .map((signal) => {
      const differences = [];
      if (signal.issue !== finding.issue)
        differences.push(`<span><strong>Signal issue:</strong> ${escapeHtml(signal.issue)}</span>`);
      if (signal.fix !== finding.fix)
        differences.push(`<span><strong>Signal fix:</strong> ${escapeHtml(signal.fix)}</span>`);
      const signalAnchors = (signal.change_anchors || [])
        .map((anchor) => `<code>${escapeHtml(changeAnchorText(anchor))}</code>`)
        .join(" · ");
      return `<li>${escapeHtml(signal.reviewer_id)} · ${escapeHtml(
        signal.category
      )} · ${escapeHtml(signal.severity)} · ${signal.confidence}% · owner ${escapeHtml(
        signal.owner
      )} · disposition ${escapeHtml(signal.disposition)} · fix ${escapeHtml(
        signal.fix_kind
      )} · decision required ${signal.decision_required ? "yes" : "no"}${
        signalAnchors ? `<div><strong>Signal anchors:</strong> ${signalAnchors}</div>` : ""
      }${differences.length ? `<div>${differences.join(" ")}</div>` : ""}</li>`;
    })
    .join("");
  const decision = finding.decision
    ? `<p><strong>Decision:</strong> ${escapeHtml(finding.decision.action)} by ${escapeHtml(
        finding.decision.approver
      )} — ${escapeHtml(finding.decision.rationale)}</p>`
    : "<p><strong>Decision:</strong> No recorded decision.</p>";
  return `<article class="finding" data-review-finding-id="${escapeHtml(
    finding.id
  )}"><div class="finding-head"><span class="priority">${escapeHtml(
    finding.severity
  )} · ${finding.confidence}%</span><span>${escapeHtml(finding.owner)} · ${escapeHtml(
    finding.disposition
  )}</span></div><h3>${escapeHtml(finding.issue)}</h3><p><strong>Impact:</strong> ${escapeHtml(
    finding.impact
  )}</p><p><strong>Fix:</strong> ${escapeHtml(
    finding.fix
  )}</p><p><strong>Advisory verification plan (do not execute directly):</strong> <code>${escapeHtml(
    finding.verify
  )}</code></p><p><strong>Decision required:</strong> ${finding.decision_required ? "yes" : "no"}</p><p><strong>Disputed:</strong> ${finding.disputed ? "yes" : "no"}</p>${decision}<div class="evidence"><strong>Change anchors:</strong> ${anchors || "Legacy target — not required."}</div><div class="evidence"><strong>Evidence:</strong> ${evidence}</div><details open><summary>Reviewer signals</summary><ul>${signals}</ul></details></article>`;
}

function handoffList(values) {
  return (values || []).length
    ? values.map((value) => `<code>${escapeHtml(value)}</code>`).join(", ")
    : "None in this round.";
}

function artifactSlug(value) {
  const slug = String(value || "review")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return slug || "review";
}

function projectFile(root, relative, label) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes("..")
  )
    throw new Error(`${label} path must be project-relative`);
  try {
    return readProjectInput(root, relative, MAX_JSON_BYTES);
  } catch (error) {
    throw new Error(`${label} ${error.message}`);
  }
}

function projectOutputPath(root, relative, label) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`${label} path must be project-relative`);
  const absolute = path.resolve(root, relative);
  const relation = path.relative(root, absolute);
  if (relation === "" || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation))
    throw new Error(`${label} path escapes project root`);
  return absolute;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const out = {};
  const map = {
    "--root": "root",
    "--report": "reportPath",
    "--out": "outputPath",
    "--template": "templatePath",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = map[argv[index]];
    if (!key) throw new Error(`unknown argument ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argv[index - 1]} requires a value`);
    out[key] = value;
  }
  if (!out.reportPath || !out.outputPath) throw new Error("--report and --out are required");
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = renderReviewReport(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { artifactSlug, escapeHtml, renderReviewReport };
