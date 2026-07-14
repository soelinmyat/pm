#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeTextAtomic } = require("./lib/atomic-file.js");
const {
  readProposal,
  proposalBytesHash,
  proposalContentHash,
  resolveProposalPaths,
} = require("./lib/proposal-schema.js");

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
  const version = options.version || readVersion();
  return {
    html: renderHtml(proposal, { sourcePath, sourceSha256, contentSha256, version }),
    markdown: renderMarkdown(proposal, { sourcePath, sourceSha256, contentSha256 }),
    source_sha256: sourceSha256,
    content_sha256: contentSha256,
  };
}

function renderHtml(proposal, identity) {
  const css = referenceCss();
  const lifecycle = proposal.lifecycle;
  const approval =
    lifecycle === "approved"
      ? "Approved"
      : lifecycle === "reviewed"
        ? "Reviewed · approval pending"
        : "Draft";
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
      proposal.edge_cases.map((item) => `${item.scenario}: ${item.expected_behavior}`).join(" • "),
    ],
    ["Design requirements", listText(proposal.design_requirements, "requirement")],
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
    section(
      "flow",
      "VII",
      "Design Requirements",
      listHtml(proposal.design_requirements.map((item) => item.requirement))
    ),
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
  <header class="masthead"><span class="masthead-id">${h(proposal.id)}</span><div class="masthead-meta"><span class="status-mark" data-pm-lifecycle>${h(approval)}</span><span>Revision ${proposal.revision}</span><span>Priority ${h(proposal.priority)}</span><span>Size ${h(proposal.size)}</span></div></header>
  <div class="title-block"><h1>${h(proposal.title)}</h1><p class="lede">${h(proposal.outcome)}</p></div>
  <div class="tldr"><dl><dt>For</dt><dd>${h(proposal.audience.map((item) => item.name).join(", "))}</dd><dt>What</dt><dd>${h(proposal.decision_brief.recommendation)}</dd><dt>Why now</dt><dd>${h(proposal.decision_brief.why_now)}</dd></dl></div>
  <section class="decision-brief" id="decision-brief"><h2><span class="sec-num">00</span>Decision Brief</h2><p>${h(proposal.decision_brief.recommendation)}</p></section>
  <section class="execution-contract" id="execution-contract"><div class="execution-contract-label">Execution Contract</div>${tableHtml(["Field", "Contract"], contractRows)}</section>
  <nav class="toc" aria-label="Proposal sections">${tocHtml()}</nav>
  <div id="appendix">${sections}</div>
  <p class="closing">${lifecycle === "approved" ? `Approved for technical design. Run <code>pm:rfc ${h(proposal.slug)}</code>.` : "Approval is still required before technical design."}</p>
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
prd: "proposals/${proposal.slug}.html"
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

### Open decisions
${proposal.open_decisions.length ? mdList(proposal.open_decisions, "question") : "- None"}

## Reader

[Open the generated proposal](proposals/${proposal.slug}.html). Lifecycle: **${proposal.lifecycle}** · revision **${proposal.revision}** · semantic content \`${identity.contentSha256}\`.
`;
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
    const rendered = renderProposal(source.proposal, {
      sourceBytes: source.bytes,
      sourcePath: path
        .relative(projectRoot, path.resolve(options.proposal))
        .split(path.sep)
        .join("/"),
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
function listHtml(items) {
  return `<ul>${items.map((item) => `<li>${h(item)}</li>`).join("")}</ul>`;
}
function section(id, numeral, title, body) {
  return `<section id="${id}"><h2><span class="sec-num">${numeral}</span>${h(title)}</h2>${body}</section>`;
}
function tableHtml(headers, rows) {
  return `<table><thead><tr>${headers.map((item) => `<th>${h(item)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((item) => `<td>${h(item)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function evidenceHtml(proposal) {
  return proposal.evidence
    .map(
      (item) =>
        `<div class="annotation"><span class="annotation-label">${h(item.kind)} · ${h(item.path)}</span><p>${h(item.summary)}</p></div>`
    )
    .join("");
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
  const rows = proposal.question_reviews.map((item) => [item.question, item.outcome]);
  rows.push([
    "Approval",
    proposal.lifecycle === "approved"
      ? "Exact-byte audit required and verified by proposal-check"
      : "Pending explicit user decision",
  ]);
  return `${tableHtml(["Question", "Outcome"], rows)}<p>Revision ${proposal.revision}. Semantic content <code>${h(identity.contentSha256)}</code>.</p>`;
}
function tocHtml() {
  return [
    ["problem", "I", "Problem"],
    ["jtbd", "II", "Users & JTBD"],
    ["usecases", "III", "Acceptance"],
    ["scope", "IV", "Scope"],
    ["requirements", "V", "Requirements"],
    ["edge", "VI", "Edge cases"],
    ["flow", "VII", "Design"],
    ["competitive", "VIII", "Alternatives"],
    ["feasibility", "IX", "Risks"],
    ["open-q", "X", "Decisions"],
    ["metrics", "XI", "Metrics"],
    ["status", "XII", "Status"],
  ]
    .map(([id, n, label]) => `<a href="#${id}"><span class="toc-num">${n}</span>${label}</a>`)
    .join("");
}

if (require.main === module) process.exitCode = main();
module.exports = { parseArgs, renderProposal, renderHtml, renderMarkdown, main };
