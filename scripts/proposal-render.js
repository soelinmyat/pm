#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeTextAtomic } = require("./lib/atomic-file.js");
const {
  readApprovedProposal,
  readProposal,
  proposalBytesHash,
  proposalContentHash,
  resolveProposalPaths,
} = require("./lib/proposal-schema.js");
const { lineagePathMatches } = require("./lib/product-reasoning-bindings.js");

function parseArgs(argv) {
  const options = { projectRoot: process.cwd(), pmDir: "pm", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (["--proposal", "--project-root", "--pm-dir", "--html", "--markdown"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[
        {
          "--proposal": "proposal",
          "--project-root": "projectRoot",
          "--pm-dir": "pmDir",
          "--html": "html",
          "--markdown": "markdown",
        }[arg]
      ] = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.proposal) throw new Error("--proposal is required");
  return options;
}

function renderProposal(proposal, options = {}) {
  const sourceBytes = Buffer.isBuffer(options.sourceBytes)
    ? options.sourceBytes
    : Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  const sourceSha256 = proposalBytesHash(sourceBytes);
  const contentSha256 = proposalContentHash(proposal);
  const sourcePath = options.sourcePath || `pm/backlog/proposals/${proposal.slug}.json`;
  const htmlPath = options.htmlPath || sourcePath.replace(/\.json$/i, ".html");
  const version = options.version || readVersion();
  const actuallyVerifiedApproval = approvalStateMatches(
    proposal,
    contentSha256,
    options.actuallyVerifiedApproval
  );
  return {
    html: renderHtml(proposal, {
      sourcePath,
      htmlPath,
      sourceSha256,
      contentSha256,
      version,
      actuallyVerifiedApproval,
    }),
    markdown: renderMarkdown(proposal, {
      sourcePath,
      sourceSha256,
      contentSha256,
      actuallyVerifiedApproval,
    }),
    source_sha256: sourceSha256,
    content_sha256: contentSha256,
  };
}

function renderHtml(proposal, identity) {
  const css = referenceCss();
  const lifecycle = proposal.lifecycle;
  const approval =
    {
      approved: "Lifecycle approved",
      planned: "Lifecycle approved · planned",
      "in-progress": "Lifecycle approved · in progress",
      done: "Lifecycle approved · done",
      reviewed: "Reviewed · approval pending",
      draft: "Draft",
    }[lifecycle] || lifecycle;
  const metadata = {
    schema_version: 1,
    id: proposal.id,
    kind: "proposal",
    slug: proposal.slug,
    lifecycle,
    title: proposal.title,
    generated_at: proposal.updated_at || proposal.created_at,
    generator: { name: "pm:groom", version: identity.version },
    source: { path: identity.sourcePath, sha256: identity.sourceSha256 },
    evidence: proposal.evidence.flatMap((entry) => {
      const lineage = proposal.source.lineage.find((source) => source.path === entry.path);
      return lineage ? [{ path: entry.path, sha256: lineage.sha256 }] : [];
    }),
  };
  const contractRows = [
    ["Scope", listText(proposal.scope.in_scope, "statement")],
    ["Non-goals", listText(proposal.scope.non_goals, "statement")],
    [
      "Acceptance criteria",
      proposal.acceptance_criteria
        .map((item) => `${item.given}; ${item.when}; ${item.then}`)
        .join(" • "),
    ],
    [
      "Edge cases",
      proposal.edge_cases
        .map((item) => `${sentenceStem(item.scenario)}: ${item.expected_behavior}`)
        .join(" • "),
    ],
    ["Design requirements", listText(proposal.design_requirements, "requirement")],
    ...(proposal.design_context
      ? [
          ["UI impact", uiImpactText(proposal.design_context)],
          ["Critical states", proposal.design_context.critical_states.join(" • ")],
          [
            "Experience invariants",
            arrayText(proposal.design_context.experience_invariants, "None declared"),
          ],
          ["Visual invariants", proposal.design_context.visual_invariants.join(" • ")],
          ["Prototype", prototypeIdentityText(proposal.design_context.prototype)],
        ]
      : []),
    [
      "Open decisions",
      proposal.open_decisions.length
        ? proposal.open_decisions.map((item) => item.question).join(" • ")
        : "None",
    ],
  ];
  const sections = [
    section(
      "problem",
      "I",
      "Problem & Context",
      `<p class="lead">${h(proposal.decision_brief.problem)}</p>${evidenceHtml(proposal)}`
    ),
    section("jtbd", "II", "Users & Job to be Done", jtbdHtml(proposal)),
    section("usecases", "III", "Requirements & Acceptance", requirementsHtml(proposal)),
    section("scope", "IV", "Scope", scopeHtml(proposal)),
    section("requirements", "V", "Functional Requirements", requirementsListHtml(proposal)),
    section(
      "edge",
      "VI",
      "Edge Cases & Constraints",
      tableHtml(
        ["Case", "Expected handling"],
        proposal.edge_cases.map((item) => [item.scenario, item.expected_behavior])
      )
    ),
    section("flow", "VII", "Design Requirements", designContextHtml(proposal)),
    section("competitive", "VIII", "Alternatives", alternativesHtml(proposal)),
    section("feasibility", "IX", "Risks & Feasibility", risksHtml(proposal)),
    section("open-q", "X", "Decisions", decisionsHtml(proposal)),
    section(
      "metrics",
      "XI",
      "Success Metrics",
      tableHtml(
        ["Metric", "Baseline", "Target", "Window"],
        proposal.success_metrics.map((item) => [
          item.metric,
          item.baseline,
          item.target,
          item.window,
        ])
      )
    ),
    section("status", "XII", "Review & Next Steps", statusHtml(proposal, identity)),
  ].join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${h(proposal.title)} — Product proposal</title>
<script id="pm-artifact" type="application/json">${safeJson(metadata)}</script>
<style>${css}</style>
</head>
<body data-proposal-revision="${proposal.revision}" data-content-sha256="${h(identity.contentSha256)}" data-source-sha256="${h(identity.sourceSha256)}">
<a class="skip-link" href="#content">Skip to content</a>
<main class="page" id="content">
  <header class="masthead"><span class="masthead-id">${h(proposal.id)}</span><div class="masthead-meta"><a class="status-mark" data-pm-lifecycle href="#decision-action" aria-label="${h(approval)}; go to decision status">${h(approval)}</a><span>Revision ${proposal.revision}</span><span>Priority ${h(proposal.priority)}</span><span>Size ${h(proposal.size)}</span></div></header>
  <div class="title-block"><h1>${h(proposal.title)}</h1><p class="lede">${h(proposal.outcome)}</p></div>
  ${prototypeHeroHtml(proposal, identity)}
  <div class="tldr"><dl><dt>For</dt><dd>${h(proposal.audience.map((item) => item.name).join(", "))}</dd><dt>What</dt><dd>${h(proposal.decision_brief.recommendation)}</dd><dt>Why now</dt><dd>${h(proposal.decision_brief.why_now)}</dd></dl></div>
  <section class="decision-brief" id="decision-brief"><h2><span class="sec-num">00</span>Decision Brief</h2><p>${h(proposal.decision_brief.recommendation)}</p></section>
  <section class="execution-contract" id="execution-contract"><div class="execution-contract-label">Execution Contract</div>${tableHtml(["Field", "Contract"], contractRows)}</section>
  ${decisionActionHtml(proposal, identity)}
  <details class="appendix-disclosure" open><summary><span>Detailed evidence &amp; delivery appendix</span><span class="appendix-disclosure-meta"><span class="appendix-disclosure-meta-open">12 sections · collapse to focus</span><span class="appendix-disclosure-meta-closed">12 sections · expand for evidence</span></span></summary><nav class="toc" aria-label="Proposal sections">${tocHtml()}</nav><div id="appendix">${sections}</div></details>
  <footer><span>Content ${h(identity.contentSha256.slice(0, 22))}…</span><span>Source revision ${proposal.revision}</span></footer>
</main>
</body>
</html>\n`;
}

function renderMarkdown(proposal, identity) {
  const status =
    {
      draft: "drafted",
      reviewed: "drafted",
      approved: "proposed",
      planned: "planned",
      "in-progress": "in-progress",
      done: "done",
    }[proposal.lifecycle] || "drafted";
  const date = (proposal.updated_at || proposal.created_at).slice(0, 10);
  const created = proposal.created_at.slice(0, 10);
  const researchRefs = proposal.evidence
    .filter((item) => item.kind === "research")
    .map((item) => item.path.replace(/^pm\//, ""));
  const ideaDecisionPath = `backlog/${proposal.slug}.decision.json`;
  const ideaOrigin = proposal.source.lineage.some((entry) =>
    lineagePathMatches(entry.path, ideaDecisionPath)
  );
  return `---
type: backlog
id: "${yaml(proposal.id)}"
title: "${yaml(proposal.title)}"
outcome: "${yaml(proposal.outcome)}"
status: ${status}
priority: ${proposal.priority}
labels:
${proposal.labels.map((label) => `  - "${yaml(label)}"`).join("\n")}
created: ${created}
updated: ${date}
${ideaOrigin ? `reasoning_version: 2\ndecision_brief: "${yaml(ideaDecisionPath)}"\n` : ""}prd: "proposals/${proposal.slug}.html"
rfc: null
kind: proposal
size: ${proposal.size}
ac_count: ${proposal.acceptance_criteria.length}
research_refs:${researchRefs.length ? `\n${researchRefs.map((entry) => `  - "${yaml(entry)}"`).join("\n")}` : " []"}
---

<!-- Generated from ${identity.sourcePath} · ${identity.sourceSha256} · revision ${proposal.revision}. Do not edit by hand. -->

# ${proposal.title}

${proposal.outcome}

## Decision Brief

**Problem.** ${proposal.decision_brief.problem}

**Recommendation.** ${proposal.decision_brief.recommendation}

**Why now.** ${proposal.decision_brief.why_now}

## Evidence & provenance

${evidenceMarkdown(proposal)}

### Source lineage

${proposal.source.lineage.map((item) => `- \`${item.id}\` — \`${item.path}\` · \`${item.sha256}\``).join("\n")}

## Execution Contract

### In scope
${mdList(proposal.scope.in_scope, "statement")}

### Non-goals
${mdList(proposal.scope.non_goals, "statement")}

### Requirements
${mdList(proposal.requirements, "statement")}

### Acceptance criteria
${proposal.acceptance_criteria.map((item, index) => `${index + 1}. **Given** ${item.given}, **when** ${item.when}, **then** ${item.then}.`).join("\n")}

### Edge cases
${proposal.edge_cases.map((item) => `- **${item.scenario}** — ${item.expected_behavior}`).join("\n")}

### Design requirements
${mdList(proposal.design_requirements, "requirement")}
${designContextMarkdown(proposal)}

### Open decisions
${proposal.open_decisions.length ? mdList(proposal.open_decisions, "question") : "- None"}

## Review answers

${reviewAnswersMarkdown(proposal)}

## Approval status

${approvalStatusMarkdown(proposal, identity)}

## Reader

[Open the generated proposal](proposals/${proposal.slug}.html). Lifecycle: **${proposal.lifecycle}** · revision **${proposal.revision}** · semantic content \`${identity.contentSha256}\`.
`;
}

function designContextHtml(proposal) {
  const requirements = listHtml(proposal.design_requirements.map((item) => item.requirement));
  const context = proposal.design_context;
  if (!context) return requirements;
  return `${requirements}
<h3>UI impact</h3><p>${h(uiImpactText(context))}</p>
<h3>Prototype</h3>${prototypeIdentityHtml(context.prototype)}
<h3>Critical states</h3>${listOrEmptyHtml(context.critical_states)}
<h3>Experience invariants</h3>${listOrEmptyHtml(context.experience_invariants)}
<h3>Visual invariants</h3>${listOrEmptyHtml(context.visual_invariants)}`;
}

function designContextMarkdown(proposal) {
  const context = proposal.design_context;
  if (!context) return "";
  return `

### UI impact
${uiImpactText(context)}

### Prototype
${prototypeIdentityMarkdown(context.prototype)}

### Critical states
${markdownListOrEmpty(context.critical_states)}

### Experience invariants
${markdownListOrEmpty(context.experience_invariants)}

### Visual invariants
${markdownListOrEmpty(context.visual_invariants)}`;
}

function approvalStateMatches(proposal, contentSha256, state) {
  return Boolean(
    state &&
    state.trustedApproval === true &&
    state.approval &&
    state.approval.revision === proposal.revision &&
    state.approval.content_sha256 === contentSha256
  );
}

function uiImpactText(context) {
  if (context.ui_impact === true) return "Visual UI change";
  if (context.ui_impact === false) return "No visual UI impact";
  return "Not declared (legacy proposal)";
}

function arrayText(items, emptyText) {
  return Array.isArray(items) && items.length ? items.join(" • ") : emptyText;
}

function listOrEmptyHtml(items) {
  return Array.isArray(items) && items.length ? listHtml(items) : "<p>None declared.</p>";
}

function markdownListOrEmpty(items) {
  return Array.isArray(items) && items.length
    ? items.map((item) => `- ${item}`).join("\n")
    : "- None declared.";
}

function prototypeIdentityText(prototype) {
  if (!prototype) return "None approved";
  if (!prototype.manifest) return `${prototype.path} · ${prototype.sha256}`;
  return `${prototype.path} · entry ${prototype.sha256} · tree ${prototype.manifest.tree_sha256} · ${prototype.manifest.files.length} bound files`;
}

function prototypeIdentityHtml(prototype) {
  if (!prototype) return "<p>No prototype approved.</p>";
  const entry = `<p><strong>Entry.</strong> <code>${h(prototype.path)}</code><br><strong>Entry SHA-256.</strong> <code>${h(prototype.sha256)}</code></p>`;
  if (!prototype.manifest) return entry;
  return `${entry}<p><strong>Bound tree.</strong> <code>${h(prototype.manifest.tree_sha256)}</code> · ${prototype.manifest.files.length} bound files</p>${tableHtml(
    ["Bound file", "SHA-256"],
    prototype.manifest.files.map((file) => [file.path, file.sha256])
  )}`;
}

function prototypeIdentityMarkdown(prototype) {
  if (!prototype) return "No prototype approved.";
  const entry = `- Entry: \`${prototype.path}\`\n- Entry SHA-256: \`${prototype.sha256}\``;
  if (!prototype.manifest) return entry;
  return `${entry}\n- Bound tree: \`${prototype.manifest.tree_sha256}\` · ${prototype.manifest.files.length} bound files\n${prototype.manifest.files.map((file) => `  - \`${file.path}\` · \`${file.sha256}\``).join("\n")}`;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`proposal-render: ${error.message}\n`);
    return 2;
  }
  try {
    const projectRoot = path.resolve(options.projectRoot);
    const source = readProposal(path.resolve(options.proposal), { projectRoot });
    if (source.kind !== "canonical-json")
      throw new Error(
        "legacy Markdown is inspection-only and cannot be rendered as canonical proposal output"
      );
    const paths = resolveProposalPaths(projectRoot, source.proposal.slug, options.pmDir);
    const htmlPath = options.html ? path.resolve(options.html) : paths.html;
    const markdownPath = options.markdown ? path.resolve(options.markdown) : paths.markdown;
    let actuallyVerifiedApproval = null;
    if (
      source.reviewContractBound &&
      ["approved", "planned", "in-progress", "done"].includes(source.proposal.lifecycle)
    ) {
      try {
        actuallyVerifiedApproval = readApprovedProposal(source.path, { projectRoot });
      } catch {
        actuallyVerifiedApproval = null;
      }
    }
    const rendered = renderProposal(source.proposal, {
      sourceBytes: source.bytes,
      sourcePath: path
        .relative(projectRoot, path.resolve(options.proposal))
        .split(path.sep)
        .join("/"),
      htmlPath: path.relative(projectRoot, htmlPath).split(path.sep).join("/"),
      actuallyVerifiedApproval,
    });
    writeTextAtomic(htmlPath, rendered.html, { fileMode: 0o644 });
    writeTextAtomic(markdownPath, rendered.markdown, { fileMode: 0o644 });
    const result = {
      ok: true,
      proposal: path.resolve(options.proposal),
      html: htmlPath,
      markdown: markdownPath,
      source_sha256: rendered.source_sha256,
      content_sha256: rendered.content_sha256,
      approval_verified: Boolean(actuallyVerifiedApproval),
    };
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Rendered proposal ${source.proposal.slug}\n`
    );
    return 0;
  } catch (error) {
    process.stderr.write(`proposal-render: ${error.message}\n`);
    return 1;
  }
}

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "plugin.config.json"), "utf8"))
      .version;
  } catch {
    return "unknown";
  }
}
function referenceCss() {
  const template = fs.readFileSync(
    path.resolve(__dirname, "..", "references", "templates", "proposal-reference.html"),
    "utf8"
  );
  const match = template.match(/<style>([\s\S]*?)<\/style>/i);
  if (!match) throw new Error("proposal reference template has no style block");
  return match[1];
}
function h(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
function yaml(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}
function mdList(items, field) {
  return items.map((item) => `- ${item[field]}`).join("\n");
}
function listText(items, field) {
  return items.map((item) => item[field]).join(" • ");
}
function sentenceStem(value) {
  return String(value ?? "")
    .trim()
    .replace(/[.:;!?]+$/, "");
}
function sentenceCase(value) {
  const text = String(value ?? "").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}
function listHtml(items) {
  return `<ul>${items.map((item) => `<li>${h(item)}</li>`).join("")}</ul>`;
}
function section(id, numeral, title, body) {
  return `<section id="${id}"><h2><span class="sec-num">${numeral}</span>${h(title)}</h2>${body}</section>`;
}
function tableHtml(headers, rows) {
  return `<table data-responsive="true" aria-label="${h(headers.join(" and "))}"><thead><tr>${headers.map((item) => `<th>${h(item)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((item, index) => `<td data-label="${h(headers[index] || "Value")}">${h(item)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function prototypeHeroHtml(proposal, identity) {
  const prototype = proposal.design_context?.prototype;
  if (!prototype) return "";
  const outputDirectory = path.posix.dirname(String(identity.htmlPath).replace(/\\/g, "/"));
  const href =
    path.posix.relative(outputDirectory, prototype.path) || path.posix.basename(prototype.path);
  const prototypeName = path.posix.basename(prototype.path, path.posix.extname(prototype.path));
  const criticalStates = proposal.design_context.critical_states.join(" · ");
  return `<figure class="hero-prototype">
    <div class="hero-prototype-header"><span class="hero-prototype-label">Bound interaction prototype</span><span class="hero-prototype-fig">Design evidence</span></div>
    <div class="hero-prototype-frame-wrap"><div class="hero-prototype-preview" role="group" aria-label="Prototype summary for ${h(proposal.title)}"><strong class="hero-prototype-title">${h(prototypeName)}</strong><span class="hero-prototype-summary">Open the approved flow and inspect every critical state.</span></div></div>
    <figcaption class="hero-prototype-footer"><span><span class="hero-prototype-screens-label">Critical states</span>${h(criticalStates)}</span><a class="hero-prototype-link" href="${h(encodeRepoHref(href))}" target="_blank" rel="noopener">Open prototype →</a></figcaption>
    <p class="hero-prototype-note">Source-bound to <code>${h(prototype.sha256)}</code>.</p>
  </figure>`;
}
function encodeRepoHref(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}
function evidenceHtml(proposal) {
  const lineageByPath = new Map(proposal.source.lineage.map((item) => [item.path, item]));
  const evidence = proposal.evidence
    .map((item) => {
      const lineage = lineageByPath.get(item.path);
      return `<div class="annotation"><span class="annotation-label">${h(item.id)} · ${h(item.kind)}</span><p>${h(item.summary)}</p><p><strong>Source.</strong> <code>${h(item.path)}</code><br><strong>Observed.</strong> ${h(item.observed_at)}${lineage ? `<br><strong>SHA-256.</strong> <code>${h(lineage.sha256)}</code>` : ""}</p></div>`;
    })
    .join("");
  const lineage = tableHtml(
    ["Lineage ID", "Retained source", "SHA-256"],
    proposal.source.lineage.map((item) => [item.id, item.path, item.sha256])
  );
  return `<h3>Evidence provenance</h3>${evidence}<h3>Source lineage</h3>${lineage}`;
}

function evidenceMarkdown(proposal) {
  const lineageByPath = new Map(proposal.source.lineage.map((item) => [item.path, item]));
  return proposal.evidence
    .map((item) => {
      const lineage = lineageByPath.get(item.path);
      return `- **${item.id} · ${item.kind}** — ${item.summary}\n  - Source: \`${item.path}\`\n  - Observed: ${item.observed_at}${lineage ? `\n  - SHA-256: \`${lineage.sha256}\`` : ""}`;
    })
    .join("\n");
}
function jtbdHtml(proposal) {
  return `${proposal.jobs_to_be_done.map((item) => `<div class="annotation annotation-jtbd"><span class="annotation-label">Job to be done</span><p>${h(item.situation)}, ${h(item.motivation)}, ${h(item.outcome)}</p></div>`).join("")}<div class="personas">${proposal.audience.map((item) => `<div class="persona"><div class="persona-tag">Audience</div><div class="persona-name">${h(item.name)}</div><p class="persona-desc">${h(item.description)}</p></div>`).join("")}</div>`;
}
function requirementsHtml(proposal) {
  return proposal.acceptance_criteria
    .map(
      (item, index) =>
        `<div class="usecase"><div class="usecase-title"><span class="usecase-num">${String(index + 1).padStart(2, "0")}</span>${h(item.id)}</div><dl><dt>Given</dt><dd>${h(item.given)}</dd><dt>When</dt><dd>${h(item.when)}</dd><dt>Then</dt><dd>${h(item.then)}</dd></dl></div>`
    )
    .join("");
}
function scopeHtml(proposal) {
  return `<div class="scope"><div class="scope-col"><div class="scope-col-label">In scope</div>${listHtml(proposal.scope.in_scope.map((item) => item.statement))}</div><div class="scope-col scope-col-out"><div class="scope-col-label">Non-goals</div>${listHtml(proposal.scope.non_goals.map((item) => item.statement))}</div></div>`;
}
function requirementsListHtml(proposal) {
  return listHtml(proposal.requirements.map((item) => `${item.statement} (${item.priority})`));
}
function alternativesHtml(proposal) {
  return proposal.alternatives.length
    ? tableHtml(
        ["Alternative", "Why not"],
        proposal.alternatives.map((item) => [item.name, item.reason_rejected])
      )
    : "<p>No material alternative retained.</p>";
}
function risksHtml(proposal) {
  return tableHtml(
    ["Risk", "Likelihood", "Impact", "Mitigation"],
    proposal.risks.map((item) => [item.risk, item.likelihood, item.impact, item.mitigation])
  );
}
function decisionsHtml(proposal) {
  const open = proposal.open_decisions
    .map(
      (item) =>
        `<div class="open-q"><div class="open-q-q">${h(item.question)}</div><p class="open-q-rec">${h(item.recommendation || "Decision required")}</p></div>`
    )
    .join("");
  const resolved = proposal.resolved_decisions
    .map(
      (item) =>
        `<div class="resolved-q"><div class="resolved-q-q">${h(item.question)}</div><div class="resolved-q-a">${h(item.decision)} — ${h(item.rationale)}</div></div>`
    )
    .join("");
  return `${open || "<p>No open product decisions.</p>"}<details><summary>Resolved decisions (${proposal.resolved_decisions.length})</summary><div class="resolved-list">${resolved}</div></details>`;
}
function statusHtml(proposal, identity) {
  const postApprovalLifecycle = ["approved", "planned", "in-progress", "done"].includes(
    proposal.lifecycle
  );
  const approval = postApprovalLifecycle
    ? identity.actuallyVerifiedApproval
      ? `Approval verified; current lifecycle ${proposal.lifecycle}`
      : `Lifecycle reports ${proposal.lifecycle}; a matching verified approval state was not supplied to this renderer`
    : proposal.lifecycle === "reviewed"
      ? "Pending explicit user decision"
      : "Review required before approval";
  const identityLabel = identity.actuallyVerifiedApproval
    ? "Verified approval identity"
    : "Required approval identity";
  return `<h3>Review answers</h3>${reviewAnswersHtml(proposal)}<h3>Approval</h3><p>${h(approval)}.</p><p>Revision ${proposal.revision}. ${identityLabel} <code>${h(identity.contentSha256)}</code>.</p>`;
}

function approvalStatusMarkdown(proposal, identity) {
  const postApprovalLifecycle = ["approved", "planned", "in-progress", "done"].includes(
    proposal.lifecycle
  );
  if (!postApprovalLifecycle) {
    return `Lifecycle: **${proposal.lifecycle}**. Approval audit: **not yet applicable**.`;
  }
  return identity.actuallyVerifiedApproval
    ? `Lifecycle: **${proposal.lifecycle}**. Approval audit: **verified for this exact proposal** at revision **${proposal.revision}** and content \`${identity.contentSha256}\`.`
    : `Lifecycle: **${proposal.lifecycle}**. A matching verified approval state was not supplied to this renderer; verify the sibling audit before relying on approval.`;
}

function reviewAnswersHtml(proposal) {
  if (!proposal.question_reviews.length) return "<p>No review answers recorded.</p>";
  return proposal.question_reviews
    .map((item) => {
      const evidence = Array.isArray(item.evidence)
        ? listHtml(
            item.evidence.map(
              (entry) => `${entry.evidence_id} · ${entry.locator} — ${entry.relevance}`
            )
          )
        : listHtml((item.evidence_refs || []).map((entry) => `Evidence reference: ${entry}`));
      const answer = Object.hasOwn(item, "conclusion")
        ? `<p class="open-q-rec"><strong>Conclusion.</strong> ${h(item.conclusion)}</p><p><strong>Rationale.</strong> ${h(item.rationale)}</p><p><strong>Confidence.</strong> ${h(sentenceCase(item.confidence))} · <strong>Outcome.</strong> ${h(sentenceCase(item.outcome))}</p>`
        : `<p class="open-q-rec"><strong>Outcome.</strong> ${h(sentenceCase(item.outcome))}</p><p>Legacy review record; no retained conclusion or rationale.</p>`;
      const finding = item.finding ? `<p><strong>Finding.</strong> ${h(item.finding)}</p>` : "";
      return `<article class="open-q"><div class="open-q-q">${h(item.question)}</div>${answer}<div><strong>Evidence.</strong>${evidence}</div>${finding}</article>`;
    })
    .join("");
}

function reviewAnswersMarkdown(proposal) {
  if (!proposal.question_reviews.length) return "No review answers recorded.";
  return proposal.question_reviews
    .map((item) => {
      const evidence = Array.isArray(item.evidence)
        ? item.evidence
            .map(
              (entry) => `  - \`${entry.evidence_id}\` · \`${entry.locator}\` — ${entry.relevance}`
            )
            .join("\n")
        : (item.evidence_refs || []).map((entry) => `  - \`${entry}\``).join("\n");
      if (!Object.hasOwn(item, "conclusion")) {
        return `### ${item.question}\n\n- **Outcome:** ${sentenceCase(item.outcome)}\n- **Evidence:**\n${evidence}\n- Legacy review record; no retained conclusion or rationale.`;
      }
      return `### ${item.question}\n\n- **Conclusion:** ${item.conclusion}\n- **Rationale:** ${item.rationale}\n- **Confidence:** ${sentenceCase(item.confidence)}\n- **Outcome:** ${sentenceCase(item.outcome)}\n- **Evidence:**\n${evidence}${item.finding ? `\n- **Finding:** ${item.finding}` : ""}`;
    })
    .join("\n\n");
}
function decisionActionHtml(proposal, identity) {
  const postApprovalLifecycle = ["approved", "planned", "in-progress", "done"].includes(
    proposal.lifecycle
  );
  let title;
  let guidance;
  if (postApprovalLifecycle && identity.actuallyVerifiedApproval) {
    title = "Approval is valid for this exact proposal";
    guidance = `Continue with <code>/pm:rfc ${h(proposal.slug)}</code> for technical design. Current lifecycle: <strong>${h(proposal.lifecycle)}</strong>.`;
  } else if (postApprovalLifecycle) {
    title = "Lifecycle is approved; approval verification is not shown";
    guidance = `Current lifecycle: <strong>${h(proposal.lifecycle)}</strong>. Verify the sibling approval audit before continuing with <code>/pm:rfc ${h(proposal.slug)}</code>.`;
  } else if (proposal.lifecycle === "reviewed") {
    title = "Your approval is the next step";
    guidance = `Return to the active PM conversation and reply <strong>“Approve this proposal for technical design”</strong>, or describe the changes you want. If you are reopening it later, resume <code>/pm:groom ${h(proposal.slug)}</code>.`;
  } else {
    title = "Review must finish before approval";
    guidance = `Resume <code>/pm:groom ${h(proposal.slug)}</code> to complete review or revise this draft. Draft status never implies approval.`;
  }
  const integrity = `Approval applies only to revision <strong>${proposal.revision}</strong> and content <code>${h(identity.contentSha256)}</code>. Any substantive edit makes that approval stale.`;
  return `<aside class="decision-action" id="decision-action" aria-label="Decision status"><div class="decision-action-label">Decision status</div><div class="decision-action-title">${title}</div><p>${guidance}</p><p class="decision-integrity">${integrity}</p></aside>`;
}
function tocHtml() {
  const groups = [
    [
      "Understand",
      [
        ["problem", "I", "Problem"],
        ["jtbd", "II", "Users & JTBD"],
      ],
    ],
    [
      "Define",
      [
        ["usecases", "III", "Acceptance"],
        ["scope", "IV", "Scope"],
        ["requirements", "V", "Requirements"],
        ["edge", "VI", "Edge cases"],
        ["flow", "VII", "Design"],
      ],
    ],
    [
      "Challenge",
      [
        ["competitive", "VIII", "Alternatives"],
        ["feasibility", "IX", "Risks"],
        ["open-q", "X", "Decisions"],
      ],
    ],
    [
      "Decide",
      [
        ["metrics", "XI", "Metrics"],
        ["status", "XII", "Status"],
      ],
    ],
  ];
  return groups
    .map(
      ([group, links]) =>
        `<div class="toc-group"><span class="toc-group-label">${group}</span>${links
          .map(([id, n, label]) => `<a href="#${id}"><span class="toc-num">${n}</span>${label}</a>`)
          .join("")}</div>`
    )
    .join("");
}

if (require.main === module) process.exitCode = main();
module.exports = { parseArgs, renderProposal, renderHtml, renderMarkdown, main };
