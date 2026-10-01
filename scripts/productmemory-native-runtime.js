"use strict";
// Fresh native execution; shared product records stay remote, execution mechanics local.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createWorkflowClient } = require("./productmemory-workflow");
const schema = require("./lib/dev-session-schema");
const context = require("./lib/native-dev-context");
const { sha, validateEntries, readContract } = require("./lib/native-dev-contract");
const { gitExec } = require("./lib/git-env");
const {
  acquireProjectWriteLock,
  createProjectRootAnchor,
  readProjectInput,
  writeProjectFileAtomic,
  writeProjectJsonAtomic,
} = require("./lib/project-file");
function createNativeRuntime(transport) {
  const client = createWorkflowClient(transport);
  function load(sessionPath) {
    const requested = path.resolve(sessionPath);
    const match = requested.match(
      /^(.*)\/\.pm\/dev-sessions\/([a-z0-9]+(?:-[a-z0-9]+)*)\/session\.json$/
    );
    if (!match || fs.realpathSync(match[1]) !== match[1])
      throw new Error("Canonical local native session location required");
    const root = match[1];
    const relative = `.pm/dev-sessions/${match[2]}/session.json`;
    const anchor = createProjectRootAnchor(root);
    const { bytes } = readProjectInput(root, relative, 4 * 1024 * 1024, {
      projectRootAnchor: anchor,
      requireStablePath: true,
    });
    const session = JSON.parse(bytes);
    const errors = schema.validateSession(session);
    if (
      errors.length ||
      !session.task.native ||
      session.slug !== match[2] ||
      session.source.worktree !== root
    )
      throw new Error("Valid fresh canonical native session required");
    return { session, root, relative, anchor, digest: sha(bytes) };
  }
  function lock(root, slug) {
    return acquireProjectWriteLock(root, `.pm/dev-sessions/${slug}/native-operation`, {
      attempts: 1,
      waitMs: 0,
    });
  }
  async function lockedSession(sessionPath, operation) {
    const preflight = load(sessionPath);
    if (
      preflight.session.task.native.service_url !== client.identity.service_url ||
      preflight.session.task.native.project !== client.identity.project
    )
      throw new Error("Native transport identity changed");
    const release = lock(preflight.root, preflight.session.slug);
    try {
      const loaded = load(sessionPath);
      if (loaded.digest !== preflight.digest)
        throw new Error("Local native session changed before lock; read it again explicitly");
      const save = (next) => {
        const errors = schema.validateSession(next);
        if (errors.length) throw new Error(`Invalid native state: ${errors[0].message}`);
        const latest = readProjectInput(loaded.root, loaded.relative, 4 * 1024 * 1024, {
          projectRootAnchor: loaded.anchor,
          requireStablePath: true,
        }).bytes;
        if (sha(latest) !== loaded.digest)
          throw new Error("Local native session changed; no stale overwrite allowed");
        writeProjectJsonAtomic(loaded.root, loaded.relative, next, {
          fileMode: 0o600,
          directoryMode: 0o700,
        });
        return next;
      };
      return await operation(loaded.session, save, loaded);
    } finally {
      release();
    }
  }
  async function withSession(sessionPath, operation) {
    return lockedSession(sessionPath, (session, save) =>
      context.inLiveScope(session, transport, (current) => operation(session, save, current))
    );
  }
  function decision(session, sessionPath, checked) {
    return { ...schema.nextDecision(session, sessionPath), native_contract: checked.contract };
  }
  function acknowledge(session, result, intent) {
    const native = session.task.native;
    const workflow = result.workflow;
    const remote = result.session;
    if (
      workflow?.id !== native.workflow_id ||
      workflow.revision !== native.workflow_revision + 1 ||
      workflow.status !== "in-progress" ||
      workflow.owner_id !== native.owner_id ||
      workflow.bundle?.current !== true ||
      workflow.bundle.id !== native.bundle_id ||
      workflow.bundle.digest !== native.bundle_digest ||
      workflow.bundle.review?.id !== native.review_id ||
      remote?.id !== native.remote_session_id ||
      remote.state !== "verified" ||
      remote.revision !== native.remote_session_revision + 1 ||
      remote.feature_bundle_id !== native.bundle_id ||
      remote.feature_bundle_review_id !== native.review_id ||
      remote.owner_id !== native.owner_id ||
      remote.result_commit !== intent.proof.commit ||
      remote.verification !== intent.verification
    )
      throw new Error("Native certification acknowledgement mismatch");
    const next = structuredClone(session);
    next.task.native.workflow_revision = workflow.revision;
    next.task.native.remote_session_revision = remote.revision;
    next.task.native.remote_session_state = "verified";
    next.task.native.certification = {
      commit: intent.proof.commit,
      gate_manifest_sha256: intent.proof.gate_manifest_sha256,
      verification: intent.verification,
    };
    return next;
  }
  return Object.freeze({
    async initialize({ sourceDir, slug, recordId, executionPath }) {
      const initial = schema.createSession({ sourceDir, slug });
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(initial.slug))
        throw new Error("Canonical native slug requires lowercase words separated by hyphens");
      if (
        initial.source.branch === initial.source.default_branch ||
        initial.source.branch === "detached"
      )
        throw new Error("Fresh feature worktree required for native development");
      const root = fs.realpathSync(initial.source.worktree);
      const relativeSession = `.pm/dev-sessions/${initial.slug}/session.json`;
      const release = lock(root, initial.slug);
      try {
        if (fs.existsSync(path.join(root, relativeSession)))
          throw new Error("Existing local session must finish or be explicitly reconciled");
        const intentPath = `.pm/dev-sessions/${initial.slug}/native-initialization-intent.json`;
        if (fs.existsSync(path.join(root, intentPath)))
          throw new Error(
            "Native initialization has a pending intent; recover it without replaying start"
          );
        const observed = await client.get(recordId);
        if (observed.bundle?.current !== true || observed.bundle.review?.decision !== "approved")
          throw new Error("Fresh named current native bundle review required");
        validateEntries(observed.bundle.entries);
        const relativeSnapshot = `.pm/productmemory/${crypto.randomUUID()}`;
        // Exclusive anchored writes cannot hydrate runtime, leases or legacy approval files.
        let total = 0;
        for (const entry of observed.bundle.entries) {
          if (/\.(?:approval|session|lease)\.json$/i.test(entry.path))
            throw new Error("Legacy authority/runtime files cannot bootstrap native execution");
          const response = await transport.request({
            method: "GET",
            path: `/api/v1/knowledge_file?project=${encodeURIComponent(client.identity.project)}&path=${encodeURIComponent(entry.path)}&revision=${entry.revision}`,
          });
          const data = response?.body;
          if (
            response?.status !== 200 ||
            data?.path !== entry.path ||
            data.revision !== entry.revision ||
            data.content_hash !== entry.content_hash ||
            typeof data.content_base64 !== "string" ||
            data.content_base64.length > 45 * 1024 * 1024
          )
            throw new Error("Pinned native source unavailable or exceeds bootstrap budget");
          const bytes = Buffer.from(data.content_base64, "base64");
          total += bytes.length;
          if (
            bytes.toString("base64") !== data.content_base64 ||
            bytes.length !== data.byte_size ||
            total > 64 * 1024 * 1024 ||
            sha(bytes) !== entry.content_hash
          )
            throw new Error("Pinned native source hash/size mismatch");
          writeProjectFileAtomic(root, `${relativeSnapshot}/${entry.path}`, bytes, {
            replace: false,
            fileMode: 0o600,
            directoryMode: 0o700,
            maxBytes: 32 * 1024 * 1024,
          });
        }
        const draftNative = {
          entries: observed.bundle.entries,
          snapshot_root: path.join(root, relativeSnapshot),
          execution_path: executionPath,
        };
        const validated = readContract(draftNative, initial.slug);
        // Check destination before creating remote authority; CAS refuses intervening edits.
        if (
          fs.existsSync(path.join(root, relativeSession)) ||
          gitExec(root, ["rev-parse", "HEAD"]).trim() !== initial.source.base_commit
        )
          throw new Error("Local initialization state changed");
        writeProjectJsonAtomic(
          root,
          intentPath,
          {
            schema_version: 1,
            identity: client.identity,
            initial,
            draft_native: draftNative,
            observed,
          },
          { replace: false, fileMode: 0o600, directoryMode: 0o700 }
        );
        const result = await client.start(observed, {
          repository: initial.source.repo_root,
          branch: initial.source.branch,
          base_commit: initial.source.base_commit,
        });
        initial.task.native = {
          kind: "productmemory-native-dev-v1",
          ...client.identity,
          record_id: recordId,
          workflow_id: observed.id,
          workflow_revision: result.workflow.revision,
          bundle_id: result.authority.bundle_id,
          bundle_digest: result.authority.bundle_digest,
          review_id: result.authority.review_id,
          reviewer: result.authority.reviewer,
          owner_id: result.authority.owner_id,
          remote_session_id: result.session.id,
          remote_session_revision: result.session.revision,
          remote_session_state: "running",
          certification: null,
          ...draftNative,
        };
        try {
          return await context.inLiveScope(initial, transport, async (current) => {
            const routed = schema.applyRouting(initial, validated.facts);
            writeProjectJsonAtomic(root, relativeSession, routed, {
              replace: false,
              fileMode: 0o600,
              directoryMode: 0o700,
            });
            return {
              session_path: path.join(root, relativeSession),
              session: routed,
              decision: decision(routed, path.join(root, relativeSession), current.checked),
            };
          });
        } catch (error) {
          // No auto-retry, cancellation or fabricated local session after remote start.
          error.remote_session_id = result.session.id;
          error.message = `Remote session ${result.session.id} started; local initialization failed. Stop and reconcile explicitly: ${error.message}`;
          throw error;
        }
      } finally {
        release();
      }
    },
    async recoverInitialization({ sourceDir, slug }) {
      const root = fs.realpathSync(sourceDir);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new Error("Canonical native slug required");
      const relative = `.pm/dev-sessions/${slug}/session.json`;
      const sessionPath = path.join(root, relative);
      if (fs.existsSync(sessionPath))
        return withSession(sessionPath, (session, save, current) => ({
          session_path: sessionPath,
          session,
          decision: decision(session, sessionPath, current.checked),
        }));
      const release = lock(root, slug);
      try {
        const { bytes } = readProjectInput(
          root,
          `.pm/dev-sessions/${slug}/native-initialization-intent.json`,
          4 * 1024 * 1024
        );
        const intent = JSON.parse(bytes);
        if (
          intent.schema_version !== 1 ||
          intent.identity?.service_url !== client.identity.service_url ||
          intent.identity.project !== client.identity.project ||
          intent.initial?.slug !== slug ||
          intent.initial.source.worktree !== root
        )
          throw new Error("Native initialization intent mismatch");
        const observed = await client.get(intent.observed.record_id);
        const old = intent.observed;
        if (
          observed.revision !== old.revision + 1 ||
          observed.status !== "in-progress" ||
          observed.bundle?.current !== true ||
          observed.bundle.id !== old.bundle.id ||
          observed.bundle.digest !== old.bundle.digest ||
          observed.bundle.review?.id !== old.bundle.review.id ||
          observed.bundle.review.decision !== "approved" ||
          observed.owner_id !== old.owner_id
        )
          throw new Error("Pending remote initialization changed; reconcile explicitly");
        const candidates = observed.sessions.filter(
          (item) =>
            item.state === "running" &&
            item.revision === 1 &&
            item.feature_bundle_id === old.bundle.id &&
            item.feature_bundle_review_id === old.bundle.review.id &&
            item.owner_id === old.owner_id &&
            item.repository === root &&
            item.branch === intent.initial.source.branch &&
            item.base_commit === intent.initial.source.base_commit
        );
        if (candidates.length !== 1)
          throw new Error("No unique acknowledged native initialization; do not replay start");
        const remote = candidates[0];
        const initial = intent.initial;
        if (schema.validateSession(initial).length || initial.task.native)
          throw new Error("Fresh pre-start initialization intent required");
        initial.task.native = {
          kind: "productmemory-native-dev-v1",
          ...client.identity,
          record_id: observed.record_id,
          workflow_id: observed.id,
          workflow_revision: observed.revision,
          bundle_id: observed.bundle.id,
          bundle_digest: observed.bundle.digest,
          review_id: observed.bundle.review.id,
          reviewer: observed.bundle.review.user,
          owner_id: observed.owner_id,
          remote_session_id: remote.id,
          remote_session_revision: remote.revision,
          remote_session_state: "running",
          certification: null,
          ...intent.draft_native,
        };
        const checked = readContract(initial.task.native, slug);
        return await context.inLiveScope(initial, transport, (current) => {
          const routed = schema.applyRouting(initial, checked.facts);
          writeProjectJsonAtomic(root, relative, routed, {
            replace: false,
            fileMode: 0o600,
            directoryMode: 0o700,
          });
          return {
            session_path: sessionPath,
            session: routed,
            decision: decision(routed, sessionPath, current.checked),
          };
        });
      } finally {
        release();
      }
    },
    decision: (sessionPath) =>
      withSession(sessionPath, (session, save, current) =>
        decision(session, sessionPath, current.checked)
      ),
    async record(sessionPath, result) {
      return withSession(sessionPath, async (session, save) => {
        const next = schema.recordResult(session, result);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
    async gate(sessionPath, input) {
      return withSession(sessionPath, async (session) => {
        if (session.task.native.remote_session_state !== "running")
          throw new Error("Certified native gates are immutable; start a fresh session");
        const relative = `.pm/dev-sessions/${session.slug}/gates.json`;
        const manifestPath = path.join(session.source.worktree, relative);
        const before = fs.existsSync(manifestPath)
          ? readProjectInput(session.source.worktree, relative, 1024 * 1024, {
              requireStablePath: true,
            }).bytes
          : null;
        const { planGateWrite } = require("./lib/dev-gate-writer");
        const plan = planGateWrite({ ...input, sessionPath, session });
        await context.verifyCurrent(session, transport);
        const latest = fs.existsSync(manifestPath)
          ? readProjectInput(session.source.worktree, relative, 1024 * 1024, {
              requireStablePath: true,
            }).bytes
          : null;
        if ((before === null) !== (latest === null) || (before && sha(before) !== sha(latest)))
          throw new Error("Gate manifest changed; no stale overwrite allowed");
        writeProjectJsonAtomic(session.source.worktree, relative, plan.manifest, {
          replace: before !== null,
          fileMode: 0o600,
          directoryMode: 0o700,
        });
        return plan;
      });
    },
    async recertifyEvidence(sessionPath, { phases, commit, verificationByPhase }) {
      return withSession(sessionPath, async (session, save) => {
        const next = schema.recertifyEvidence(session, phases, commit, verificationByPhase);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
    async recordNonPassingQaCandidate(sessionPath, { status, commit, records }) {
      return withSession(sessionPath, async (session, save) => {
        const next = schema.recordNonPassingQaCandidate(session, status, commit, records);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
    async anchorQaHistory(sessionPath, { commit, records }) {
      return withSession(sessionPath, async (session, save) => {
        const next = schema.anchorQaHistory(session, commit, records);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
    async resumeBlocked(sessionPath, resolution) {
      return withSession(sessionPath, async (session, save) => {
        const next = schema.resumeBlocked(session, resolution);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
    async workspace(sessionPath) {
      return withSession(sessionPath, async (session, save) => {
        if (session.phase !== "workspace") throw new Error("Run only the current workspace phase");
        const next = schema.updateWorkspace(session, session.source.worktree);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
    async grant(sessionPath, actions, reason) {
      return withSession(sessionPath, async (session, save) => {
        // The host supplies explicit user authorization; bundle review grants none.
        const next = schema.grantAuthority(session, actions, reason);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
    async transitionCandidate(sessionPath, input) {
      return withSession(sessionPath, async (session, save) => {
        const next = schema.transitionCandidate(session, input);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
    async certify(sessionPath) {
      return withSession(sessionPath, async (session, save) => {
        if (session.task.native.remote_session_state === "verified")
          return { session, idempotent: true };
        if (
          !["ship", "retro"].includes(session.phase) ||
          session.task.work_units.some((unit) => unit.status !== "completed")
        )
          throw new Error(
            "Finish implementation, QA and independent current-commit review before native certification"
          );
        const { verifyDelivery } = require("./productmemory-dev-authority");
        const proof = verifyDelivery(sessionPath, session);
        const verification = JSON.stringify({
          kind: "pm-native-canonical-gates-v1",
          run_id: session.run_id,
          bundle_digest: session.task.native.bundle_digest,
          ...proof,
        });
        const intent = {
          schema_version: 1,
          run_id: session.run_id,
          native: session.task.native,
          proof,
          verification,
        };
        const relativeIntent = `.pm/dev-sessions/${session.slug}/native-certification-intent.json`;
        if (fs.existsSync(path.join(session.source.worktree, relativeIntent)))
          throw new Error(
            "Native certification has a pending intent; recover acknowledgement without replaying report"
          );
        writeProjectJsonAtomic(session.source.worktree, relativeIntent, intent, {
          replace: false,
          fileMode: 0o600,
          directoryMode: 0o700,
        });
        const { observed, remote } = await context.verifyCurrent(session, transport);
        if (gitExec(session.source.worktree, ["rev-parse", "HEAD"]).trim() !== proof.commit)
          throw new Error("Worktree changed during native certification");
        // The remote preflight yields while retained evidence can change locally.
        // Revalidate and bind the exact durable intent immediately before writing.
        const currentProof = verifyDelivery(sessionPath, session);
        if (JSON.stringify(currentProof) !== JSON.stringify(intent.proof))
          throw new Error("Delivery evidence changed during native certification");
        const result = await client.report(observed, remote, {
          state: "verified",
          result_commit: proof.commit,
          verification,
        });
        const next = acknowledge(session, result, intent);
        await context.verifyCurrent(next, transport);
        return { session: save(next), receipt: result, idempotent: false };
      });
    },
    async recoverCertification(sessionPath) {
      return lockedSession(sessionPath, async (session, save) => {
        if (session.task.native.remote_session_state === "verified") {
          await context.verifyCurrent(session, transport);
          return { session, idempotent: true };
        }
        const { bytes } = readProjectInput(
          session.source.worktree,
          `.pm/dev-sessions/${session.slug}/native-certification-intent.json`,
          4 * 1024 * 1024
        );
        const intent = JSON.parse(bytes);
        if (
          intent.schema_version !== 1 ||
          intent.run_id !== session.run_id ||
          JSON.stringify(intent.native) !== JSON.stringify(session.task.native)
        )
          throw new Error("Native certification intent changed");
        const observed = await client.get(session.task.native.record_id);
        const remote = observed.sessions.find(
          (item) => item.id === session.task.native.remote_session_id
        );
        const next = acknowledge(session, { workflow: observed, session: remote }, intent);
        await context.verifyCurrent(next, transport);
        return { session: save(next), idempotent: true };
      });
    },
    async transitionWorkUnit(sessionPath, input) {
      return withSession(sessionPath, async (session, save) => {
        const next = schema.transitionWorkUnit(session, input);
        await context.verifyCurrent(next, transport);
        return save(next);
      });
    },
  });
}
module.exports = { createNativeRuntime };
