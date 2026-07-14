#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { requireValue } = require("./lib/check-cli.js");
const { inspectHtmlArtifact } = require("./artifact-check.js");
const { renderProposal } = require("./proposal-render.js");
const {
  proposalBytesHash,
  readProposal,
  readApproval,
  resolveProposalPaths,
  validateApproval,
} = require("./lib/proposal-schema.js");

function parseArgs(argv) {
  const options = { json: false, allowLegacy: false, projectRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--legacy") options.allowLegacy = true;
    else if (arg === "--projections") options.projections = true;
    else if (
      [
        "--proposal",
        "--approval",
        "--project-root",
        "--slug",
        "--decision-id",
        "--decision-sha256",
      ].includes(arg)
    )
      options[
        {
          "--proposal": "proposal",
          "--approval": "approval",
          "--project-root": "projectRoot",
          "--slug": "slug",
          "--decision-id": "decisionId",
          "--decision-sha256": "decisionSha256",
        }[arg]
      ] = requireValue(argv, ++index, arg);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.proposal) throw new Error("--proposal is required");
  if (Boolean(options.decisionId) !== Boolean(options.decisionSha256))
    throw new Error("--decision-id and --decision-sha256 must be supplied together");
  return options;
}

function check(options) {
  try {
    const source = readProposal(options.proposal, {
      projectRoot: options.projectRoot,
      expectedSlug: options.slug,
      allowLegacy: options.allowLegacy,
    });
    if (source.kind === "legacy-markdown")
      return {
        ok: true,
        issues: [],
        kind: source.kind,
        trusted_approval: false,
        proposal_sha256: source.bytesSha256,
      };
    const result = {
      ok: true,
      issues: [],
      kind: source.kind,
      slug: source.proposal.slug,
      revision: source.proposal.revision,
      lifecycle: source.proposal.lifecycle,
      content_sha256: source.contentSha256,
      proposal_sha256: source.bytesSha256,
      approval_verified: false,
    };
    const approvalPath =
      options.approval ||
      (["approved", "planned", "in-progress", "done"].includes(source.proposal.lifecycle)
        ? source.path.replace(/\.json$/, ".approval.json")
        : null);
    if (approvalPath) {
      const approvalSource = readApproval(approvalPath, { projectRoot: options.projectRoot });
      const proposalSource = readProposal(options.proposal, {
        projectRoot: options.projectRoot,
        expectedSlug: options.slug,
      });
      const expectedApprovalPath = proposalSource.path.replace(/\.json$/, ".approval.json");
      if (approvalSource.path !== expectedApprovalPath)
        return {
          ...result,
          ok: false,
          issues: [
            {
              path: approvalSource.path,
              message: "approval audit must be the sibling of the canonical proposal",
            },
          ],
        };
      const approvalResult = validateApproval(source.proposal, approvalSource.approval, {
        bytes: proposalSource.bytes,
        path: approvalSource.path,
        expectedDecision: options.decisionId
          ? { id: options.decisionId, sha256: options.decisionSha256 }
          : undefined,
        allowLifecycleAdvance: true,
      });
      if (!approvalResult.ok) return { ...result, ok: false, issues: approvalResult.issues };
      result.approval_verified = true;
      result.exact_approved_bytes_current = approvalResult.exact_bytes_current;
      result.approval_basis = approvalResult.approval_basis;
    }
    if (options.projections) {
      const projection = validateProjections(source, options.projectRoot);
      if (!projection.ok) return { ...result, ok: false, issues: projection.issues };
      result.projections_verified = true;
      result.html_sha256 = projection.html_sha256;
      result.markdown_sha256 = projection.markdown_sha256;
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      issues: [{ path: options.proposal || "proposal", message: error.message }],
    };
  }
}

function validateProjections(source, projectRoot) {
  const paths = resolveProposalPaths(projectRoot, source.proposal.slug);
  const issues = [];
  if (!fs.existsSync(paths.html))
    issues.push({ path: paths.html, message: "generated HTML projection is missing" });
  if (!fs.existsSync(paths.markdown))
    issues.push({ path: paths.markdown, message: "generated Markdown projection is missing" });
  if (issues.length) return { ok: false, issues };
  const htmlBytes = fs.readFileSync(paths.html);
  const artifact = inspectHtmlArtifact(htmlBytes, { expectedKind: "proposal" });
  issues.push(
    ...artifact.issues.map((entry) => ({
      path: `${paths.html}:${entry.path}`,
      message: entry.message,
    }))
  );
  const expectedSourcePath = path
    .relative(fs.realpathSync(path.resolve(projectRoot)), source.path)
    .split(path.sep)
    .join("/");
  if (artifact.metadata) {
    if (artifact.metadata.source.path !== expectedSourcePath)
      issues.push({
        path: paths.html,
        message: "HTML source path does not match canonical proposal",
      });
    if (artifact.metadata.source.sha256 !== source.bytesSha256)
      issues.push({
        path: paths.html,
        message: "HTML source hash does not match canonical proposal bytes",
      });
    if (artifact.metadata.lifecycle !== source.proposal.lifecycle)
      issues.push({
        path: paths.html,
        message: "HTML lifecycle does not match canonical proposal",
      });
    if (
      artifact.metadata.slug !== source.proposal.slug ||
      artifact.metadata.title !== source.proposal.title
    )
      issues.push({ path: paths.html, message: "HTML identity does not match canonical proposal" });
  }
  const html = htmlBytes.toString("utf8");
  if (!html.includes(`data-proposal-revision="${source.proposal.revision}"`))
    issues.push({ path: paths.html, message: "HTML revision does not match canonical proposal" });
  if (!html.includes(`data-content-sha256="${source.contentSha256}"`))
    issues.push({
      path: paths.html,
      message: "HTML semantic content hash does not match canonical proposal",
    });
  const markdownBytes = fs.readFileSync(paths.markdown);
  const markdown = markdownBytes.toString("utf8");
  const expected = renderProposal(source.proposal, {
    sourceBytes: source.bytes,
    sourcePath: expectedSourcePath,
  });
  if (!htmlBytes.equals(Buffer.from(expected.html)))
    issues.push({
      path: paths.html,
      message: "HTML projection bytes differ from deterministic canonical render",
    });
  if (!markdownBytes.equals(Buffer.from(expected.markdown)))
    issues.push({
      path: paths.markdown,
      message: "Markdown projection bytes differ from deterministic canonical render",
    });
  const marker = `Generated from ${expectedSourcePath} · ${source.bytesSha256} · revision ${source.proposal.revision}. Do not edit by hand.`;
  if (!markdown.includes(marker))
    issues.push({
      path: paths.markdown,
      message: "Markdown source marker does not match canonical proposal",
    });
  const expectedStatus = {
    draft: "drafted",
    reviewed: "drafted",
    approved: "proposed",
    planned: "planned",
    "in-progress": "in-progress",
    done: "done",
  }[source.proposal.lifecycle];
  if (!new RegExp(`^status: ${escapeRegex(expectedStatus)}$`, "m").test(markdown))
    issues.push({
      path: paths.markdown,
      message: "Markdown lifecycle projection does not match canonical proposal",
    });
  if (!markdown.includes(`semantic content \`${source.contentSha256}\``))
    issues.push({
      path: paths.markdown,
      message: "Markdown semantic content hash does not match canonical proposal",
    });
  return {
    ok: issues.length === 0,
    issues,
    html_sha256: artifact.sha256,
    markdown_sha256: proposalBytesHash(markdownBytes),
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printProposalResult(result, json) {
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.ok) process.stdout.write("Proposal check passed.\n");
  else {
    process.stdout.write("Proposal check failed:\n");
    for (const found of result.issues) process.stdout.write(`- ${found.path}: ${found.message}\n`);
  }
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`proposal-check: ${error.message}\n`);
    return 2;
  }
  const result = check(options);
  printProposalResult(result, options.json);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { parseArgs, check, main, proposalBytesHash, validateProjections };
