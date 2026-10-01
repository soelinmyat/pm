"use strict";
// Shared product drafts publish over an authorized host. Local journals contain
// execution mechanics only, and never confer human approval or replay writes.
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual: equal } = require("node:util");
const { createWorkflowClient } = require("./productmemory-workflow");
const {
  sha,
  validateAuthoringEntries,
  readDraftContract,
  materializePinnedSource,
} = require("./lib/native-dev-contract");
const {
  acquireProjectWriteLock,
  createProjectRootAnchor,
  readProjectInput,
  writeProjectJsonAtomic,
} = require("./lib/project-file");
const categories = new Set([
  "record",
  "context-document",
  "document-artifact",
  "document-sidecar",
  "artifact-asset",
  "document-attachment",
]);
function createNativeAuthoring(transport) {
  const client = createWorkflowClient(transport);
  function location(sourceDir, slug) {
    if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      throw new Error("Canonical authoring slug required");
    const root = fs.realpathSync(sourceDir);
    return {
      root,
      anchor: createProjectRootAnchor(root),
      relativeDraft: `.pm/authoring/${slug}/draft`,
      draftRoot: path.join(root, `.pm/authoring/${slug}/draft`),
      journalPath: `.pm/authoring/${slug}/publication.json`,
      slug,
    };
  }
  const save = (where, journal, replace = true) =>
    writeProjectJsonAtomic(where.root, where.journalPath, journal, {
      replace,
      fileMode: 0o600,
      directoryMode: 0o700,
    });
  const lock = (where) =>
    acquireProjectWriteLock(where.root, `.pm/authoring/${where.slug}/operation`, {
      attempts: 1,
      waitMs: 0,
    });
  const readDraft = (where, document, maxBytes) =>
    readProjectInput(where.root, `${where.relativeDraft}/${document}`, maxBytes, {
      projectRootAnchor: where.anchor,
      requireStablePath: true,
    }).bytes;
  function source(where, entries, executionPath, stage) {
    const checked = entries.map((entry) => {
      const bytes = readDraft(where, entry.path, 32 * 1024 * 1024);
      if (sha(bytes) !== entry.content_hash)
        throw new Error("Authoring draft changed; plan a new publication");
      return { path: entry.path, role: entry.role, content_hash: entry.content_hash };
    });
    return readDraftContract(
      { snapshot_root: where.draftRoot, entries: checked, execution_path: executionPath },
      where.slug,
      stage,
      { root: where.root, prefix: where.relativeDraft, anchor: where.anchor }
    );
  }
  function load(where) {
    const journal = JSON.parse(
      readProjectInput(where.root, where.journalPath, 4 * 1024 * 1024, { requireStablePath: true })
        .bytes
    );
    if (
      journal.schema_version !== 1 ||
      journal.kind !== "productmemory-authoring-publication" ||
      !equal(journal.identity, client.identity) ||
      journal.slug !== where.slug ||
      journal.draft_root !== where.draftRoot ||
      !Array.isArray(journal.entries) ||
      !["ready", "complete"].includes(journal.state)
    )
      throw new Error("Exact authorized authoring journal required");
    for (const entry of journal.entries) {
      if (
        !entry ||
        Object.keys(entry).some(
          (key) =>
            ![
              "path",
              "role",
              "category",
              "source_metadata",
              "content_hash",
              "byte_size",
              "if_revision",
              "state",
              "ack_revision",
            ].includes(key)
        ) ||
        !categories.has(entry.category) ||
        !entry.source_metadata ||
        typeof entry.source_metadata !== "object" ||
        Array.isArray(entry.source_metadata) ||
        !Number.isSafeInteger(entry.byte_size) ||
        entry.byte_size < 0 ||
        !Number.isSafeInteger(entry.if_revision) ||
        entry.if_revision < 0 ||
        !["planned", "attempting", "verified"].includes(entry.state) ||
        (entry.state === "verified"
          ? !Number.isSafeInteger(entry.ack_revision) || entry.ack_revision < 1
          : entry.ack_revision !== null)
      )
        throw new Error("Invalid authoring publication mechanics");
    }
    if (
      !Number.isSafeInteger(journal.workflow_id) ||
      journal.workflow_id < 1 ||
      !Number.isSafeInteger(journal.workflow_revision) ||
      journal.workflow_revision < 1 ||
      !journal.bundle ||
      !["planned", "attempting", "verified"].includes(journal.bundle.state)
    )
      throw new Error("Invalid authoring workflow mechanics");
    source(where, journal.entries, journal.execution_path, journal.stage);
    return journal;
  }
  async function getFile(document, revision, bytes = false) {
    const response = await transport.request({
      method: "GET",
      path: `/api/v1/knowledge_file?project=${encodeURIComponent(client.identity.project)}&path=${encodeURIComponent(document)}${revision === undefined ? "" : `&revision=${revision}`}${bytes ? "" : "&include_content=false"}`,
    });
    if (response.status === 404) return null;
    if (
      response.status !== 200 ||
      response.body?.path !== document ||
      !Number.isSafeInteger(response.body.revision) ||
      response.body.revision < 1 ||
      !/^[a-f0-9]{64}$/.test(response.body.content_hash) ||
      !categories.has(response.body.category) ||
      !response.body.source_metadata ||
      typeof response.body.source_metadata !== "object" ||
      Array.isArray(response.body.source_metadata)
    )
      throw new Error("Exact current product document required");
    return response.body;
  }
  const matches = (remote, entry, revision) =>
    remote &&
    remote.revision === revision &&
    remote.path === entry.path &&
    remote.content_hash === entry.content_hash &&
    remote.category === entry.category &&
    equal(remote.source_metadata, entry.source_metadata);
  async function workflow(journal) {
    const observed = await client.get(journal.record_id);
    if (
      observed.id !== journal.workflow_id ||
      observed.revision !== journal.workflow_revision ||
      !["grooming", "proposed"].includes(observed.status)
    )
      throw new Error("Authoring workflow changed; preserve the publication intent and reconcile");
    if (journal.stage === "rfc") {
      const proposal = journal.entries.find((entry) => entry.role === "proposal");
      const approved = observed.bundle?.entries?.find((entry) => entry.role === "proposal");
      if (
        observed.bundle?.current !== true ||
        observed.bundle.review?.decision !== "approved" ||
        !observed.bundle.review.user?.trim() ||
        proposal?.path !== approved?.path ||
        proposal?.content_hash !== approved?.content_hash
      )
        throw new Error("Product approval changed before RFC publication");
    }
    return observed;
  }
  const bundleEntries = (journal) =>
    journal.entries
      .map((entry) => ({
        path: entry.path,
        role: entry.role,
        revision: entry.ack_revision,
        content_hash: entry.content_hash,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  function bundleMatches(remote, journal) {
    const observed = remote.bundle?.entries
      ?.map(({ path, role, revision, content_hash }) => ({ path, role, revision, content_hash }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return (
      remote.id === journal.workflow_id &&
      remote.revision === journal.workflow_revision + 1 &&
      remote.bundle?.current === true &&
      Number.isSafeInteger(remote.bundle.id) &&
      remote.bundle.id > 0 &&
      /^[a-f0-9]{64}$/.test(remote.bundle.digest) &&
      !remote.bundle.review &&
      equal(observed, bundleEntries(journal))
    );
  }
  return Object.freeze({
    async fetch({ sourceDir, slug, recordId, executionPath }) {
      const where = location(sourceDir, slug),
        release = lock(where);
      try {
        if (fs.existsSync(where.draftRoot))
          throw new Error("Existing private draft must be reconciled before fetching");
        const observed = await client.get(recordId);
        if (observed.bundle?.current !== true)
          throw new Error("Exact current remote bundle required to seed authoring");
        validateAuthoringEntries(observed.bundle.entries);
        const entries = [];
        let total = 0;
        for (const entry of observed.bundle.entries) {
          if (/\.(?:approval|session|lease)\.json$/i.test(entry.path))
            throw new Error("Private authority/runtime files cannot seed product drafts");
          const remote = await getFile(entry.path, entry.revision, true);
          if (!remote) throw new Error("Exact immutable draft source required");
          total = materializePinnedSource({
            root: where.root,
            destination: `${where.relativeDraft}/${entry.path}`,
            entry,
            data: remote,
            total,
          });
          entries.push({
            path: entry.path,
            role: entry.role,
            category: remote.category,
            source_metadata: structuredClone(remote.source_metadata),
          });
        }
        const input = {
          stage: observed.bundle.entries.some((entry) => entry.role === "rfc") ? "rfc" : "groom",
          record_id: recordId,
          execution_path: executionPath || null,
          entries,
        };
        const latest = await client.get(recordId);
        if (
          latest.revision !== observed.revision ||
          latest.bundle?.digest !== observed.bundle.digest ||
          latest.bundle?.current !== true
        )
          throw new Error(
            "Remote authoring seed changed during fetch; retain the partial private draft for reconciliation"
          );
        const manifestPath = `.pm/authoring/${slug}/manifest.json`;
        writeProjectJsonAtomic(where.root, manifestPath, input, {
          replace: false,
          fileMode: 0o600,
          directoryMode: 0o700,
        });
        return { manifest_path: manifestPath, input, source_bundle_digest: observed.bundle.digest };
      } finally {
        release();
      }
    },
    async plan({ sourceDir, slug, input }) {
      const where = location(sourceDir, slug),
        release = lock(where);
      try {
        if (fs.existsSync(path.join(where.root, where.journalPath)))
          throw new Error(
            "Existing authoring publication must be reconciled; never overwrite its intent"
          );
        if (
          !input ||
          Object.keys(input).some(
            (key) => !["record_id", "execution_path", "entries", "stage"].includes(key)
          ) ||
          !Array.isArray(input.entries)
        )
          throw new Error("Closed authoring manifest required");
        if (!["groom", "rfc"].includes(input.stage))
          throw new Error("Explicit Groom or RFC publication stage required");
        const entries = input.entries.map((entry) => {
          if (
            !entry ||
            Object.keys(entry).some(
              (key) => !["path", "role", "category", "source_metadata"].includes(key)
            ) ||
            !categories.has(entry.category) ||
            !entry.source_metadata ||
            typeof entry.source_metadata !== "object" ||
            Array.isArray(entry.source_metadata)
          )
            throw new Error("Explicit reviewable category and source metadata required");
          // Validate paths before reading through the stable anchored draft root.
          if (
            typeof entry.path !== "string" ||
            !entry.path.startsWith("pm/") ||
            entry.path.includes("\\") ||
            entry.path.split("/").some((part) => !part || part === "." || part === "..") ||
            /\.(?:approval|session|lease)\.json$/i.test(entry.path)
          )
            throw new Error("Shared product documents only");
          const bytes = readDraft(where, entry.path, 32 * 1024 * 1024);
          return { ...structuredClone(entry), content_hash: sha(bytes), byte_size: bytes.length };
        });
        source(where, entries, input.execution_path, input.stage); // Full proposal/RFC/prototype/risk validation before any write.
        const observed = await client.get(input.record_id);
        if (!["grooming", "proposed"].includes(observed.status))
          throw new Error("Remote-first authoring requires grooming or proposed workflow");
        if (input.stage === "rfc") {
          if (observed.bundle?.entries?.some((entry) => entry.role === "rfc"))
            throw new Error(
              "RFC publication starts from an approved Groom-only bundle; review the new product cycle before replacing an execution bundle"
            );
          const proposal = entries.find((entry) => entry.role === "proposal");
          const approved = observed.bundle?.entries?.find((entry) => entry.role === "proposal");
          if (
            observed.bundle?.current !== true ||
            observed.bundle.review?.decision !== "approved" ||
            !observed.bundle.review.user?.trim() ||
            proposal?.path !== approved?.path ||
            proposal?.content_hash !== approved?.content_hash
          )
            throw new Error(
              "RFC authoring requires the exact current named human-approved product proposal"
            );
        }
        for (const entry of entries) {
          const current = await getFile(entry.path);
          if (current) {
            entry.category = current.category;
            entry.source_metadata = structuredClone(current.source_metadata);
          }
          entry.if_revision = current?.revision || 0;
          entry.state = current?.content_hash === entry.content_hash ? "verified" : "planned";
          entry.ack_revision = entry.state === "verified" ? current.revision : null;
          if (entry.state === "planned" && entry.byte_size > 10 * 1024 * 1024)
            throw new Error(
              "Changed source exceeds inline publication budget; use the explicit reviewed chunk upload workflow"
            );
        }
        const journal = {
          schema_version: 1,
          kind: "productmemory-authoring-publication",
          identity: client.identity,
          slug,
          draft_root: where.draftRoot,
          stage: input.stage,
          record_id: input.record_id,
          workflow_id: observed.id,
          workflow_revision: observed.revision,
          execution_path: input.stage === "groom" ? null : input.execution_path,
          state: "ready",
          entries,
          bundle: { state: "planned" },
        };
        await workflow(journal);
        save(where, journal, false);
        return journal;
      } finally {
        release();
      }
    },
    async publish({ sourceDir, slug }) {
      const where = location(sourceDir, slug),
        release = lock(where);
      try {
        const journal = load(where);
        if (journal.state === "complete") {
          if (!bundleMatches(await client.get(journal.record_id), journal))
            throw new Error("Completed remote publication changed; reconcile explicitly");
          return journal;
        }
        if (
          journal.entries.some((entry) => entry.state === "attempting") ||
          journal.bundle.state === "attempting"
        )
          throw new Error(
            "Uncertain publication must be recovered by observation; no write replay"
          );
        for (const entry of journal.entries) {
          if (entry.state === "verified") continue;
          await workflow(journal);
          // Re-read exact bytes immediately before dispatch; the service enforces CAS.
          const bytes = readDraft(where, entry.path, 10 * 1024 * 1024);
          if (sha(bytes) !== entry.content_hash) throw new Error("Authoring draft changed");
          entry.state = "attempting";
          save(where, journal);
          const response = await transport.request({
            method: "PUT",
            path: `/api/v1/knowledge_file?project=${encodeURIComponent(client.identity.project)}`,
            body: {
              path: entry.path,
              content_base64: bytes.toString("base64"),
              content_hash: entry.content_hash,
              category: entry.category,
              source_metadata: entry.source_metadata,
              if_revision: entry.if_revision,
            },
          });
          if (response.status !== 200 || !matches(response.body, entry, entry.if_revision + 1))
            throw new Error("Publication acknowledgement differs; observe before continuing");
          entry.state = "verified";
          entry.ack_revision = response.body.revision;
          save(where, journal);
        }
        source(where, journal.entries, journal.execution_path, journal.stage);
        const observed = await workflow(journal);
        for (const entry of journal.entries)
          if (!matches(await getFile(entry.path), entry, entry.ack_revision))
            throw new Error("Published source changed before bundle publication");
        journal.bundle.state = "attempting";
        save(where, journal);
        const result = await client.publish(observed, bundleEntries(journal));
        if (!bundleMatches(result, journal))
          throw new Error("Bundle acknowledgement differs; observe before continuing");
        journal.bundle = { state: "verified", id: result.bundle.id, digest: result.bundle.digest };
        journal.state = "complete";
        save(where, journal);
        return journal;
      } finally {
        release();
      }
    },
    async recover({ sourceDir, slug }) {
      const where = location(sourceDir, slug),
        release = lock(where);
      try {
        const journal = load(where);
        for (const entry of journal.entries.filter((item) => item.state === "attempting")) {
          const remote = await getFile(entry.path);
          if (!matches(remote, entry, entry.if_revision + 1))
            throw new Error(
              "No exact publication acknowledgement; retain intent and do not replay"
            );
          entry.state = "verified";
          entry.ack_revision = remote.revision;
          save(where, journal);
        }
        if (journal.bundle.state === "attempting") {
          const remote = await client.get(journal.record_id);
          if (!bundleMatches(remote, journal))
            throw new Error("No exact bundle acknowledgement; retain intent and do not replay");
          journal.bundle = {
            state: "verified",
            id: remote.bundle.id,
            digest: remote.bundle.digest,
          };
          journal.state = "complete";
          save(where, journal);
        } else if (journal.state !== "complete") await workflow(journal);
        return journal;
      } finally {
        release();
      }
    },
  });
}
module.exports = { createNativeAuthoring };
