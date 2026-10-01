"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { DIMENSION_NAMES } = require("../../scripts/lib/dev-risk");
const { sha } = require("../../scripts/lib/native-dev-contract");
const { bindCurrentReviewContract, materializeProposalSources } = require("./groom-review-fixture");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-only-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Fixture");
  fs.writeFileSync(path.join(root, "code.txt"), "code");
  git("add", ".");
  git("commit", "-qm", "baseline");
  git("checkout", "-qb", "structured-groom");
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "remote-contract-"));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  const proposal = bindCurrentReviewContract(
    structuredClone(require("../fixtures/proposals/strong-v1.json"))
  );
  materializeProposalSources(source, proposal);
  const rfc = {
    schema_version: 3,
    slug: proposal.slug,
    title: "Native implementation",
    size: proposal.size,
    design_context: proposal.design_context,
    issues: [
      {
        num: 1,
        title: "Implement contract",
        size: "M",
        depends_on: [],
        owns: ["code.txt"],
        acceptance_criteria: ["Source and approval stay bound"],
        approach: "Implement source binding",
        verification_commands: ["node --test"],
        test_hooks: ["Unit -> source binding"],
      },
    ],
    test_strategy: {
      test_levels: "Unit and integration",
      new_infrastructure: "None",
      regression_surface: "Approval binding",
      verification_commands: "node --test",
      open_questions: "None",
    },
  };
  const execution = {
    schema_version: 1,
    kind: "proposal",
    ui_platform: "web",
    risk: {
      ...Object.fromEntries(DIMENSION_NAMES.map((name) => [name, name === "behavioral" ? 1 : 0])),
      destructive_data: false,
    },
  };
  const documents = new Map([
    ["pm/proposal.json", Buffer.from(JSON.stringify(proposal))],
    ["pm/rfc.json", Buffer.from(JSON.stringify(rfc))],
    ["pm/execution.json", Buffer.from(JSON.stringify(execution))],
  ]);
  for (const item of proposal.source.lineage)
    documents.set(item.path, fs.readFileSync(path.join(source, item.path)));
  const entries = [...documents]
    .map(([document, bytes], index) => ({
      path: document,
      role:
        document === "pm/proposal.json"
          ? "proposal"
          : document === "pm/rfc.json"
            ? "rfc"
            : "supporting",
      revision: 1,
      knowledge_version_id: index + 1,
      content_hash: sha(bytes),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const workflow = {
    id: 1,
    project: "cleanlog",
    record_id: "bkl_NATIVE",
    revision: 5,
    status: "planned",
    owner_id: 2,
    dependencies: [],
    bundle: {
      id: 4,
      digest: "b".repeat(64),
      current: true,
      review: { id: 7, user: "second-person@example.com", decision: "approved" },
      entries,
    },
    sessions: [],
  };
  const calls = [];
  const transport = {
    identity: { service_url: "https://productmemory.io", project: "cleanlog" },
    request: async (input) => {
      calls.push(input);
      const url = new URL(input.path, transport.identity.service_url);
      if (url.pathname === "/api/v1/knowledge_file") {
        const bytes = documents.get(url.searchParams.get("path"));
        return {
          status: 200,
          body: {
            path: url.searchParams.get("path"),
            revision: 1,
            content_hash: sha(bytes),
            byte_size: bytes.length,
            content_base64: bytes.toString("base64"),
          },
        };
      }
      if (input.method === "PATCH") {
        const session = workflow.sessions[0];
        Object.assign(session, {
          state: input.body.state,
          result_commit: input.body.result_commit,
          verification: input.body.verification,
          revision: session.revision + 1,
        });
        workflow.revision++;
        return {
          status: 200,
          body: { workflow: structuredClone(workflow), session: structuredClone(session) },
        };
      }
      if (input.method === "POST") {
        const session = {
          id: 9,
          revision: 1,
          feature_workflow_id: 1,
          feature_bundle_id: 4,
          feature_bundle_review_id: 7,
          owner_id: 2,
          state: "running",
          ...input.body,
        };
        workflow.revision++;
        workflow.status = "in-progress";
        workflow.sessions = [session];
        return { status: 200, body: { workflow: structuredClone(workflow), session } };
      }
      return { status: 200, body: structuredClone(workflow) };
    },
  };
  return {
    root,
    workflow,
    documents,
    calls,
    transport,
    options: {
      sourceDir: root,
      slug: proposal.slug,
      recordId: workflow.record_id,
      executionPath: "pm/execution.json",
    },
  };
}
module.exports = { fixture };
