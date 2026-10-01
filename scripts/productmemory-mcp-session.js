"use strict";
const crypto = require("node:crypto");

// The Codex host supplies its already-authorized MCP call function. Credentials
// never enter this adapter, its private runtime, or the child-process protocol.
function createMcpSessionTransport({ identity, callTool }) {
  const url = new URL(identity?.service_url);
  if (
    url.protocol !== "https:" ||
    url.origin !== identity.service_url ||
    url.username ||
    url.password
  )
    throw new Error("Explicit HTTPS MCP service origin required");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identity.project) || typeof callTool !== "function")
    throw new Error("Explicit project and authorized MCP tool caller required");
  const binding = Object.freeze({ service_url: url.origin, project: identity.project });
  const bodyKeys = (body, allowed, required) => {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key)) ||
      required.some((key) => !Object.hasOwn(body, key))
    )
      throw new Error("Closed native MCP request body required");
    return structuredClone(body);
  };
  const positive = (value) => {
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new Error("Positive safe revision required");
    return Number(value);
  };
  function operation(input) {
    if (
      !input ||
      typeof input.path !== "string" ||
      !input.path.startsWith("/") ||
      input.path.startsWith("//")
    )
      throw new Error("Native service-relative request required");
    const requested = new URL(input.path, binding.service_url);
    if (
      requested.origin !== binding.service_url ||
      requested.hash ||
      requested.username ||
      requested.password ||
      requested.searchParams.getAll("project").length !== 1 ||
      requested.searchParams.get("project") !== binding.project
    )
      throw new Error("MCP request project/origin mismatch");
    const allowedQuery =
      requested.pathname === "/api/v1/knowledge_file"
        ? ["project", "path", "revision"]
        : ["project", "bundle_revision", "bundle_before", "review_before", "session_before"];
    for (const key of requested.searchParams.keys()) {
      if (!allowedQuery.includes(key) || requested.searchParams.getAll(key).length !== 1)
        throw new Error("Unexpected or repeated native query parameter");
    }
    if (requested.pathname === "/api/v1/knowledge_file" && input.method === "GET") {
      if (input.body !== undefined) throw new Error("Reads cannot carry a mutation body");
      const path = requested.searchParams.get("path");
      if (
        !path?.startsWith("pm/") ||
        path.includes("\\") ||
        path.split("/").some((p) => !p || p === "." || p === "..")
      )
        throw new Error("Explicit shared product path required");
      return {
        name: "get_knowledge_file",
        arguments: {
          project: binding.project,
          path,
          ...(requested.searchParams.has("revision")
            ? { revision: positive(requested.searchParams.get("revision")) }
            : {}),
        },
      };
    }
    if (requested.pathname === "/api/v1/knowledge_file" && input.method === "PUT") {
      if ([...requested.searchParams.keys()].some((key) => key !== "project"))
        throw new Error("Knowledge writes require an explicit body and project only");
      const args = bodyKeys(
        input.body,
        ["path", "content_base64", "content_hash", "category", "source_metadata", "if_revision"],
        ["path", "content_base64", "content_hash", "category", "source_metadata", "if_revision"]
      );
      if (
        typeof args.path !== "string" ||
        !args.path.startsWith("pm/") ||
        args.path.includes("\\") ||
        args.path.split("/").some((p) => !p || p === "." || p === "..")
      )
        throw new Error("Explicit shared product path required");
      return { name: "put_knowledge_file", arguments: { project: binding.project, ...args } };
    }
    const match = requested.pathname.match(
      /^\/api\/v1\/records\/(bkl_[A-Za-z0-9]+)\/(feature_workflow|feature_bundle|development_sessions)(?:\/([1-9][0-9]*))?$/
    );
    if (!match) throw new Error("Unsupported native MCP route");
    const [, id, route, session] = match;
    if (input.method === "GET" && route === "feature_workflow" && !session) {
      if (input.body !== undefined) throw new Error("Reads cannot carry a mutation body");
      const args = { id };
      for (const key of allowedQuery.filter((key) => key !== "project")) {
        if (requested.searchParams.has(key)) args[key] = positive(requested.searchParams.get(key));
      }
      return { name: "get_feature_workflow", arguments: args };
    }
    if ([...requested.searchParams.keys()].some((key) => key !== "project"))
      throw new Error("Mutation query parameters are not supported");
    if (input.method === "POST" && route === "feature_workflow" && !session)
      return {
        name: "enable_feature_workflow",
        arguments: { id, ...bodyKeys(input.body, ["if_updated_at"], ["if_updated_at"]) },
      };
    if (input.method === "PATCH" && route === "feature_workflow" && !session)
      return {
        name: "update_feature_workflow",
        arguments: {
          id,
          ...bodyKeys(
            input.body,
            ["if_revision", "status", "owner_id", "dependencies", "source_ids"],
            ["if_revision"]
          ),
        },
      };
    if (input.method === "POST" && route === "feature_bundle" && !session)
      return {
        name: "publish_feature_bundle",
        arguments: {
          id,
          ...bodyKeys(input.body, ["if_revision", "entries"], ["if_revision", "entries"]),
        },
      };
    if (input.method === "POST" && route === "development_sessions" && !session)
      return {
        name: "start_feature_session",
        arguments: {
          id,
          ...bodyKeys(
            input.body,
            ["if_revision", "repository", "branch", "base_commit"],
            ["if_revision", "repository", "branch", "base_commit"]
          ),
        },
      };
    if (input.method === "PATCH" && route === "development_sessions" && session)
      return {
        name: "report_feature_session",
        arguments: {
          id,
          session_id: positive(session),
          ...bodyKeys(
            input.body,
            ["if_revision", "if_session_revision", "state", "result_commit", "verification"],
            ["if_revision", "if_session_revision", "state", "verification"]
          ),
        },
      };
    throw new Error("Unsupported native MCP operation");
  }
  async function invoke(call) {
    const result = await callTool(call);
    if (
      !result ||
      !Array.isArray(result.content) ||
      result.content.length !== 1 ||
      (result.isError !== undefined && typeof result.isError !== "boolean") ||
      result.content[0]?.type !== "text" ||
      typeof result.content[0].text !== "string" ||
      Buffer.byteLength(result.content[0].text) > 48 * 1024 * 1024
    )
      throw new Error("Bounded structured MCP tool response required");
    const body = JSON.parse(result.content[0].text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("MCP response object required");
    if (result.isError === true) {
      if (typeof body.error?.code !== "string" || typeof body.error?.message !== "string")
        throw new Error("Structured MCP error required");
      return {
        status:
          body.error.code === "not_found"
            ? 404
            : ["revision_conflict", "stale", "corrupt"].includes(body.error.code)
              ? 409
              : 422,
        body,
      };
    }
    if (Object.hasOwn(body, "error")) throw new Error("MCP response error flag mismatch");
    return { status: 200, body };
  }
  async function hydrate(call, body) {
    const chunkBytes = 1024 * 1024;
    if (
      body.path !== call.arguments.path ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 1 ||
      (call.arguments.revision !== undefined && body.revision !== call.arguments.revision) ||
      !Number.isSafeInteger(body.byte_size) ||
      body.byte_size < 1 ||
      body.byte_size > 32 * chunkBytes ||
      !/^[a-f0-9]{64}$/.test(body.content_hash)
    )
      throw new Error("Bounded exact immutable streamed source identity required");
    const count = Math.ceil(body.byte_size / chunkBytes),
      chunks = [];
    for (let position = 0; position < count; position++) {
      const response = await invoke({
        name: "get_knowledge_file_chunk",
        arguments: {
          project: binding.project,
          path: body.path,
          revision: body.revision,
          position,
        },
      });
      const chunk = response.body;
      if (
        response.status !== 200 ||
        chunk.project !== binding.project ||
        chunk.path !== body.path ||
        chunk.revision !== body.revision ||
        chunk.content_hash !== body.content_hash ||
        chunk.byte_size !== body.byte_size ||
        chunk.position !== position ||
        chunk.total_chunks !== count ||
        typeof chunk.content_base64 !== "string" ||
        chunk.content_base64.length > Math.ceil(chunkBytes / 3) * 4
      )
        throw new Error("Immutable source chunk identity mismatch");
      const bytes = Buffer.from(chunk.content_base64, "base64");
      const expected = Math.min(chunkBytes, body.byte_size - position * chunkBytes);
      if (
        bytes.toString("base64") !== chunk.content_base64 ||
        bytes.length !== expected ||
        chunk.chunk_byte_size !== expected ||
        crypto.createHash("sha256").update(bytes).digest("hex") !== chunk.chunk_content_hash
      )
        throw new Error("Immutable source chunk bytes changed");
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks, body.byte_size);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== body.content_hash)
      throw new Error("Complete immutable source bytes changed");
    return { ...body, content_encoding: "base64", content_base64: bytes.toString("base64") };
  }
  return Object.freeze({
    identity: binding,
    async request(input) {
      const call = operation(input); // Validate before any tool call.
      const response = await invoke(call);
      if (
        response.status === 200 &&
        call.name === "get_knowledge_file" &&
        response.body.content_encoding === "stream"
      )
        return { ...response, body: await hydrate(call, response.body) };
      return response;
    },
  });
}

module.exports = { createMcpSessionTransport };
