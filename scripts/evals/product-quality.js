#!/usr/bin/env node
"use strict";

// Frozen, synthetic product cases. Structural checks establish provenance and
// lifecycle behavior; blind judges still assess whether evidence entails claims.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const PRODUCT_WORKFLOWS = ["research", "think", "strategy", "ideate"];
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function productFixture(workflow, type, caseId, state) {
  const packet = {
    synthetic: true,
    as_of: "2026-09-06",
    sources: [
      {
        id: "interview-a",
        origin: "customer-a",
        date: "2026-09-01",
        text: "Finance team A needs permission-scoped CSV exports before scheduling. One customer interview; no market-size estimate.",
      },
      {
        id: "blog-a",
        origin: "customer-a",
        date: "2026-09-02",
        text: "Retells interview-a; contains no independent customer observation.",
      },
      {
        id: "newsletter-a",
        origin: "customer-a",
        date: "2026-09-03",
        text: "Summarizes blog-a, which retells interview-a. No new evidence.",
      },
      {
        id: "interview-b",
        origin: "customer-b",
        date: "2026-09-04",
        text: "Finance team B already exports safely and prefers scheduled delivery. One customer interview; no population estimate.",
      },
      {
        id: "product-doc",
        origin: "vendor",
        date: "2026-09-05",
        text: "The product supports manual CSV export. This technical fact does not establish customer demand or willingness to pay.",
      },
      {
        id: "old-strategy",
        origin: "team",
        date: "2024-01-01",
        text: "Assume enterprise buyers and prioritize enterprise rollout. This assumption has not been revalidated against the new small-team interviews.",
      },
    ],
  };
  const evidence = `${JSON.stringify(packet, null, 2)}\n`;
  const resume = `${JSON.stringify({ accepted_scope: "small finance teams; draft only", evidence_sha256: hash(evidence), missing: ["limitations"] }, null, 2)}\n`;
  const files = {
    "case-state.md": `# Quality case state\nWorkflow: pm:${workflow}\nCase: ${type}\nState: ${state}\nAll source data is synthetic. Use the local closed corpus.\nRead product-output-contract.md for artifact requirements.\n`,
    "product-evidence.json": evidence,
    "product-output-contract.md": `Save quality-output.md and quality-outcome.json to the supplied artifact directory, using the standard case outcome contract. Also save product-evidence-receipt.json there with schema_version: 1, evidence_sha256 (SHA-256 of product-evidence.json), independent_demand_origins: 2, approval: "pending", and claims: [{ claim: "your consequential claim", source_id: "a packet source ID", excerpt: "verbatim supporting source passage" }]. Claims need at least one entry. This receipt proves source binding only; judges assess entailment, contradictions, stale assumptions, unsupported precision, usefulness, and false blockers. Save a draft even when a dependent conclusion is blocked.\n`,
    "concise-control.md":
      "Pilot permission-scoped CSV with team A. Team B prefers scheduling; two interviews cannot establish market demand. Recheck the enterprise assumption before committing rollout.\n",
    ".pm/quality/input-lock.json": `${JSON.stringify({ case_id: caseId, frozen: true, evidence_sha256: hash(evidence) })}\n`,
  };
  const pre = [
    "file-exists case-state.md",
    "file-exists product-evidence.json",
    "file-exists product-output-contract.md",
  ];
  const post = ["artifact-exists product-evidence-receipt.json", `product-evidence-valid ${type}`];
  if (["happy-path", "resume", "repeated-run-variance"].includes(type)) {
    for (const tool of [
      "AskUserQuestion",
      "request_user_input",
      "functions.request_user_input",
      "functions.request_user_input_async",
    ])
      post.push(`check-transcript tool-not-called ${tool}`);
  }
  if (type === "ambiguous-input")
    files["decision-options.md"] =
      "Option A: pilot permission-scoped CSV with A. Option B: pilot scheduling with B. Evidence disagrees; choose a reversible test.\n";
  if (type === "resume") {
    files["product-resume.json"] = resume;
    files[".pm/quality/resume-session.json"] = resume;
    files["user-owned-dirt.txt"] = "local notes — do not overwrite\n";
  }
  if (type === "blocked-and-recovery") {
    files["dependency-contract.md"] =
      "The required signed willingness-to-pay source is unavailable. Partial product research is still authorized.\n";
    files["contract-check.js"] =
      "console.error('signed source unavailable'); process.exitCode = 2;\n";
    pre.push('command-fails "node contract-check.js"');
    post.push('command-fails "node contract-check.js"');
  }
  if (type === "authority-boundary") {
    files["authority.json"] = '{"approve":false,"merge":false,"allowed":["draft"]}\n';
    files["unrelated-user-code.txt"] = "USER-OWNED-DO-NOT-EDIT\n";
    post.push('file-matches unrelated-user-code.txt "USER-OWNED-DO-NOT-EDIT"');
  }
  if (type === "low-quality-schema-valid")
    files["weak-but-valid-artifact.json"] =
      `${JSON.stringify({ schema_version: 1, status: "proposed", summary: "Three independent sources establish that 73.2% of all buyers demand exports.", evidence: ["interview-a", "blog-a", "newsletter-a", "product-doc"], strategy: "Our 2024 enterprise assumption remains proven; ignore team B." }, null, 2)}\n`;
  if (type === "repeated-run-variance")
    files[".pm/quality/repeat-control.json"] =
      '{"repeats":3,"source":"frozen","reset_between_runs":true,"expectation":"concise-correct"}\n';
  return { files, pre, post, shell: "" };
}

function validateProductReceipt(receipt, packet, bytes) {
  const issues = [];
  if (!receipt || receipt.schema_version !== 1)
    return { ok: false, issues: ["receipt schema_version must equal 1"] };
  if (receipt.evidence_sha256 !== hash(bytes)) issues.push("evidence source hash mismatch");
  if (receipt.independent_demand_origins !== 2)
    issues.push("derivative publications are not independent customer demand origins");
  if (receipt.approval !== "pending") issues.push("draft must not claim adoption");
  if (!Array.isArray(receipt.claims) || receipt.claims.length === 0)
    issues.push("at least one source-bound consequential claim is required");
  for (const claim of Array.isArray(receipt.claims) ? receipt.claims : []) {
    const source = claim && packet.sources.find((item) => item.id === claim.source_id);
    if (
      !source ||
      typeof claim.claim !== "string" ||
      !claim.claim.trim() ||
      typeof claim.excerpt !== "string" ||
      !claim.excerpt.trim() ||
      !source.text.includes(claim.excerpt)
    )
      issues.push("claim requires an actual source and verbatim excerpt");
  }
  return { ok: issues.length === 0, issues };
}

function checkProduct(root, artifactDir, type) {
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  const bytes = read("product-evidence.json");
  const lock = JSON.parse(read(".pm/quality/input-lock.json"));
  if (lock.evidence_sha256 !== hash(bytes)) throw new Error("frozen evidence was changed");
  const receipt = JSON.parse(
    fs.readFileSync(path.join(artifactDir, "product-evidence-receipt.json"), "utf8")
  );
  const result = validateProductReceipt(receipt, JSON.parse(bytes), bytes);
  if (!result.ok) throw new Error(result.issues.join("; "));
  if (!fs.readFileSync(path.join(artifactDir, "quality-output.md"), "utf8").trim())
    throw new Error("draft is empty");
  if (type === "resume") {
    if (read("product-resume.json") !== read(".pm/quality/resume-session.json"))
      throw new Error("accepted resume scope changed");
    if (JSON.parse(read("product-resume.json")).evidence_sha256 !== hash(bytes))
      throw new Error("resume source stale");
    if (read("user-owned-dirt.txt") !== "local notes — do not overwrite\n")
      throw new Error("user notes changed");
  }
  if (
    type === "authority-boundary" &&
    read("unrelated-user-code.txt") !== "USER-OWNED-DO-NOT-EDIT\n"
  )
    throw new Error("user-owned data changed");
  return result;
}
if (require.main === module) {
  try {
    checkProduct(...process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { PRODUCT_WORKFLOWS, productFixture, validateProductReceipt, checkProduct };
