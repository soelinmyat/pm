"use strict";

// The transport is provided by an already authorized host/session. This module
// never discovers credentials, makes requests on load, or retries stale writes.
const STATUSES = new Set([
  "idea",
  "grooming",
  "proposed",
  "planned",
  "in-progress",
  "shipping",
  "needs-human",
  "done",
  "canceled",
]);

function createWorkflowClient(transport) {
  const identity = transport && transport.identity;
  if (!identity || typeof transport.request !== "function") {
    throw new Error("An authorized session transport and explicit identity are required");
  }
  const url = new URL(identity.service_url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Use an HTTPS service origin without credentials");
  }
  if (
    typeof identity.project !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identity.project)
  ) {
    throw new Error("Explicit project slug required");
  }
  const binding = Object.freeze({ service_url: url.origin, project: identity.project });
  const recordPath = (id) => {
    if (typeof id !== "string" || !/^bkl_[A-Za-z0-9]+$/.test(id))
      throw new Error("Canonical backlog record ID required");
    return `/api/v1/records/${id}`;
  };
  const validate = (data, id) => {
    if (
      !data ||
      !Number.isInteger(data.id) ||
      data.id < 1 ||
      data.project !== binding.project ||
      data.record_id !== id ||
      !Number.isInteger(data.revision) ||
      data.revision < 1 ||
      !STATUSES.has(data.status)
    ) {
      throw new Error("Workflow response identity/revision mismatch");
    }
    return data;
  };
  const request = async (id, suffix, method, body) => {
    if (
      transport.identity?.project !== binding.project ||
      new URL(transport.identity?.service_url).origin !== binding.service_url
    ) {
      throw new Error("Authorized transport identity changed");
    }
    const response = await transport.request({
      method,
      path: `${recordPath(id)}${suffix}?project=${encodeURIComponent(binding.project)}`,
      ...(body === undefined ? {} : { body }),
    });
    if (!response || !Number.isInteger(response.status))
      throw new Error("Structured transport response required");
    if (response.status < 200 || response.status >= 300) {
      const error = new Error(
        response.body?.error?.message || "ProductMemory workflow request failed"
      );
      error.status = response.status;
      error.code = response.body?.error?.code || "request_failed";
      throw error;
    }
    return response.body;
  };
  const conditional = (state) => {
    validate(state, state?.record_id);
    return state.revision;
  };
  const workflowWrite = async (state, suffix, method, body) =>
    validate(
      await request(state.record_id, suffix, method, { ...body, if_revision: conditional(state) }),
      state.record_id
    );

  const start = async (state, execution) => {
    conditional(state);
    const bundle = state.bundle;
    if (
      bundle?.current !== true ||
      !Number.isInteger(bundle.id) ||
      !Number.isInteger(bundle.review?.id) ||
      typeof bundle.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(bundle.digest) ||
      typeof bundle.review?.user !== "string" ||
      !bundle.review.user.trim() ||
      bundle.review?.decision !== "approved" ||
      !Number.isInteger(state.owner_id) ||
      state.owner_id < 1 ||
      !Array.isArray(bundle.entries) ||
      !bundle.entries.some((entry) => entry.role === "rfc") ||
      !bundle.entries.some((entry) => entry.role === "proposal")
    ) {
      throw new Error("Current human-approved proposal/RFC and named owner required");
    }
    const result = await request(state.record_id, "/development_sessions", "POST", {
      repository: execution.repository,
      branch: execution.branch,
      base_commit: execution.base_commit,
      if_revision: state.revision,
    });
    validate(result.workflow, state.record_id);
    const session = result.session;
    if (
      !session ||
      session.feature_workflow_id !== state.id ||
      result.workflow.revision !== state.revision + 1 ||
      result.workflow.bundle?.id !== bundle.id ||
      result.workflow.bundle?.review?.id !== bundle.review.id ||
      result.workflow.bundle?.current !== true ||
      session.feature_bundle_id !== bundle.id ||
      session.feature_bundle_review_id !== bundle.review.id ||
      session.owner_id !== state.owner_id ||
      session.repository !== execution.repository ||
      session.branch !== execution.branch ||
      session.base_commit !== execution.base_commit ||
      session.state !== "running" ||
      session.revision !== 1 ||
      !Number.isInteger(session.id)
    ) {
      throw new Error("Execution approval lineage mismatch");
    }
    return {
      workflow: result.workflow,
      session,
      authority: Object.freeze({
        schema_version: 1,
        kind: "productmemory-feature-execution",
        ...binding,
        record_id: state.record_id,
        bundle_id: bundle.id,
        bundle_digest: bundle.digest,
        review_id: bundle.review.id,
        reviewer: bundle.review.user,
        owner_id: state.owner_id,
        session_id: session.id,
        entries: structuredClone(bundle.entries),
      }),
    };
  };

  return Object.freeze({
    identity: binding,
    get: async (id) => validate(await request(id, "/feature_workflow", "GET"), id),
    enroll: async (id, ifUpdatedAt) => {
      if (typeof ifUpdatedAt !== "string" || !Number.isFinite(Date.parse(ifUpdatedAt)))
        throw new Error("Observed record timestamp required");
      return validate(
        await request(id, "/feature_workflow", "POST", { if_updated_at: ifUpdatedAt }),
        id
      );
    },
    update: (state, changes) => workflowWrite(state, "/feature_workflow", "PATCH", changes),
    publish: (state, entries) => workflowWrite(state, "/feature_bundle", "POST", { entries }),
    start,
    report: async (state, session, report) => {
      conditional(state);
      if (
        !session ||
        !Number.isInteger(session.id) ||
        !Number.isInteger(session.revision) ||
        session.feature_workflow_id !== state.id ||
        session.state !== "running"
      ) {
        throw new Error("Observed running session required");
      }
      const result = await request(
        state.record_id,
        `/development_sessions/${session.id}`,
        "PATCH",
        {
          state: report.state,
          result_commit: report.result_commit,
          verification: report.verification,
          if_revision: state.revision,
          if_session_revision: session.revision,
        }
      );
      validate(result.workflow, state.record_id);
      if (
        result.session?.id !== session.id ||
        result.session.feature_bundle_id !== session.feature_bundle_id ||
        result.session.feature_bundle_review_id !== session.feature_bundle_review_id ||
        result.session.revision !== session.revision + 1
      ) {
        throw new Error("Session report lineage mismatch");
      }
      return result;
    },
  });
}

module.exports = { createWorkflowClient };
