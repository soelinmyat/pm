"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createMcpSessionTransport } = require("../scripts/productmemory-mcp-session");
function fixture(
  response = {
    content: [{ type: "text", text: JSON.stringify({ project: "cleanlog", revision: 3 }) }],
  }
) {
  const calls = [];
  const transport = createMcpSessionTransport({
    identity: { service_url: "https://productmemory.io", project: "cleanlog" },
    callTool: async (call) => {
      calls.push(call);
      return response;
    },
  });
  return { transport, calls };
}
const prefix = "/api/v1/records/bkl_a/";
test("authorized MCP session maps every native lifecycle operation without credentials", async () => {
  const f = fixture();
  const cases = [
    ["GET", "feature_workflow", undefined, "get_feature_workflow", { id: "bkl_a" }],
    [
      "POST",
      "feature_workflow",
      { if_updated_at: "2026-10-01T00:00:00Z" },
      "enable_feature_workflow",
      { id: "bkl_a", if_updated_at: "2026-10-01T00:00:00Z" },
    ],
    [
      "PATCH",
      "feature_workflow",
      { if_revision: 3, status: "proposed" },
      "update_feature_workflow",
      { id: "bkl_a", if_revision: 3, status: "proposed" },
    ],
    [
      "POST",
      "feature_bundle",
      { if_revision: 3, entries: [] },
      "publish_feature_bundle",
      { id: "bkl_a", if_revision: 3, entries: [] },
    ],
    [
      "POST",
      "development_sessions",
      { if_revision: 3, repository: "/fixture", branch: "feature", base_commit: "a".repeat(40) },
      "start_feature_session",
      {
        id: "bkl_a",
        if_revision: 3,
        repository: "/fixture",
        branch: "feature",
        base_commit: "a".repeat(40),
      },
    ],
    [
      "PATCH",
      "development_sessions/7",
      {
        if_revision: 3,
        if_session_revision: 1,
        state: "verified",
        verification: "Current gate proof",
        result_commit: "b".repeat(40),
      },
      "report_feature_session",
      {
        id: "bkl_a",
        session_id: 7,
        if_revision: 3,
        if_session_revision: 1,
        state: "verified",
        verification: "Current gate proof",
        result_commit: "b".repeat(40),
      },
    ],
  ];
  for (const [method, route, body, name, args] of cases) {
    assert.equal(
      (
        await f.transport.request({
          method,
          path: prefix + route + "?project=cleanlog",
          ...(body === undefined ? {} : { body }),
        })
      ).status,
      200
    );
    assert.deepEqual(f.calls.at(-1), { name, arguments: args });
  }
  assert.deepEqual(f.transport.identity, {
    service_url: "https://productmemory.io",
    project: "cleanlog",
  });
});
test("pinned knowledge revisions and history cursors reach their exact MCP tools", async () => {
  const f = fixture();
  await f.transport.request({
    method: "GET",
    path: "/api/v1/knowledge_file?project=cleanlog&path=pm%2Fproposal.json&revision=9",
  });
  assert.deepEqual(f.calls.at(-1), {
    name: "get_knowledge_file",
    arguments: { project: "cleanlog", path: "pm/proposal.json", revision: 9 },
  });
  await f.transport.request({
    method: "GET",
    path: prefix + "feature_workflow?project=cleanlog&session_before=99&review_before=88",
  });
  assert.deepEqual(f.calls.at(-1), {
    name: "get_feature_workflow",
    arguments: { id: "bkl_a", review_before: 88, session_before: 99 },
  });
});
test("origin/project/query/body ambiguities fail before any tool call", async () => {
  const f = fixture();
  for (const input of [
    {
      method: "GET",
      path: "//other.example/api/v1/records/bkl_a/feature_workflow?project=cleanlog",
    },
    { method: "GET", path: prefix + "feature_workflow?project=other" },
    { method: "GET", path: prefix + "feature_workflow?project=cleanlog&project=cleanlog" },
    {
      method: "GET",
      path: prefix + "feature_workflow?project=cleanlog&session_before=9007199254740992",
    },
    { method: "GET", path: prefix + "feature_workflow?project=cleanlog", body: { status: "done" } },
    {
      method: "PATCH",
      path: prefix + "feature_workflow?project=cleanlog",
      body: { id: "bkl_b", if_revision: 3 },
    },
    { method: "GET", path: "/api/v1/knowledge_file?project=cleanlog&path=pm%2F..%2Fsecret" },
    {
      method: "PATCH",
      path: prefix + "development_sessions/9007199254740992?project=cleanlog",
      body: { if_revision: 1, if_session_revision: 1, state: "verified", verification: "proof" },
    },
    {
      method: "POST",
      path: prefix + "feature_bundle?project=cleanlog&review_before=5",
      body: { if_revision: 3, entries: [] },
    },
  ])
    await assert.rejects(f.transport.request(input));
  assert.equal(f.calls.length, 0);
});
test("unknown tool failure is never retried and remains available for durable recovery", async () => {
  let calls = 0;
  const transport = createMcpSessionTransport({
    identity: { service_url: "https://productmemory.io", project: "cleanlog" },
    callTool: async () => {
      calls++;
      throw new Error("Session disconnected after dispatch");
    },
  });
  await assert.rejects(
    transport.request({
      method: "POST",
      path: prefix + "feature_bundle?project=cleanlog",
      body: { if_revision: 3, entries: [] },
    }),
    /after dispatch/
  );
  assert.equal(calls, 1);
});
test("MCP errors preserve their code and malformed success cannot claim a valid response", async () => {
  const f = fixture({
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: { code: "not_found", message: "No revision" } }),
      },
    ],
  });
  assert.deepEqual(
    await f.transport.request({
      method: "GET",
      path: prefix + "feature_workflow?project=cleanlog",
    }),
    { status: 404, body: { error: { code: "not_found", message: "No revision" } } }
  );
  for (const response of [
    { content: [] },
    { content: [{ type: "image", data: "" }] },
    { content: [{ type: "text", text: "null" }] },
    { content: [{ type: "text", text: JSON.stringify({ error: {} }) }] },
  ]) {
    await assert.rejects(
      fixture(response).transport.request({
        method: "GET",
        path: prefix + "feature_workflow?project=cleanlog",
      })
    );
  }
});
function streamedFixture(change = (chunk) => chunk, metadataChange = (body) => body) {
  const bytes = Buffer.alloc(1024 * 1024 + 37, 255);
  const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
  const metadata = {
    path: "pm/prototype.html",
    revision: 9,
    content_hash: sha(bytes),
    byte_size: bytes.length,
    content_encoding: "stream",
    source_metadata: { historical_scope: "unchanged" },
  };
  const calls = [];
  const transport = createMcpSessionTransport({
    identity: { service_url: "https://productmemory.io", project: "cleanlog" },
    callTool: async (call) => {
      calls.push(call);
      let body;
      if (call.name === "get_knowledge_file") body = metadataChange(structuredClone(metadata));
      else {
        const position = call.arguments.position;
        const part = bytes.subarray(position * 1024 * 1024, (position + 1) * 1024 * 1024);
        body = change({
          project: "cleanlog",
          path: metadata.path,
          revision: 9,
          content_hash: metadata.content_hash,
          byte_size: bytes.length,
          position,
          total_chunks: 2,
          chunk_byte_size: part.length,
          chunk_content_hash: sha(part),
          content_base64: part.toString("base64"),
        });
      }
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    },
  });
  return { transport, calls, bytes };
}
test("immutable streamed evidence is read through bounded MCP chunks with full-byte verification", async () => {
  const f = streamedFixture();
  const result = await f.transport.request({
    method: "GET",
    path: "/api/v1/knowledge_file?project=cleanlog&path=pm%2Fprototype.html&revision=9",
  });
  assert.deepEqual(Buffer.from(result.body.content_base64, "base64"), f.bytes);
  assert.deepEqual(result.body.source_metadata, { historical_scope: "unchanged" });
  assert.deepEqual(
    f.calls.slice(1).map((call) => call.arguments),
    [0, 1].map((position) => ({
      project: "cleanlog",
      path: "pm/prototype.html",
      revision: 9,
      position,
    }))
  );
});
test("changed chunk identity bytes counts and complete hashes cannot hydrate evidence", async () => {
  for (const mutation of [
    (chunk) => ({ ...chunk, project: "other" }),
    (chunk) => ({ ...chunk, revision: 10 }),
    (chunk) => ({ ...chunk, position: 99 }),
    (chunk) => ({ ...chunk, total_chunks: 3 }),
    (chunk) => ({ ...chunk, chunk_content_hash: "0".repeat(64) }),
    (chunk) => ({ ...chunk, content_base64: chunk.content_base64 + "!" }),
  ]) {
    const f = streamedFixture(mutation);
    await assert.rejects(
      f.transport.request({
        method: "GET",
        path: "/api/v1/knowledge_file?project=cleanlog&path=pm%2Fprototype.html&revision=9",
      })
    );
    assert.equal(f.calls.length, 2);
  }
  const f = streamedFixture(
    (chunk) => ({ ...chunk, content_hash: "0".repeat(64) }),
    (body) => ({ ...body, content_hash: "0".repeat(64) })
  );
  await assert.rejects(
    f.transport.request({
      method: "GET",
      path: "/api/v1/knowledge_file?project=cleanlog&path=pm%2Fprototype.html&revision=9",
    }),
    /Complete immutable/
  );
});
test("oversized stream fails before any chunk fetch and no bearer or external download is needed", async () => {
  const f = streamedFixture(undefined, (body) => ({
    ...body,
    byte_size: 32 * 1024 * 1024 + 1,
    content_url: "https://untrusted.example/secret",
  }));
  await assert.rejects(
    f.transport.request({
      method: "GET",
      path: "/api/v1/knowledge_file?project=cleanlog&path=pm%2Fprototype.html&revision=9",
    }),
    /Bounded exact/
  );
  assert.equal(f.calls.length, 1);
});
test("authoring writes carry exact CAS metadata and cannot replace the project or target", async () => {
  const f = fixture();
  const body = {
    path: "pm/proposal.json",
    content_base64: "e30=",
    content_hash: "a".repeat(64),
    category: "context-document",
    source_metadata: { retained: true },
    if_revision: 9,
  };
  await f.transport.request({
    method: "PUT",
    path: "/api/v1/knowledge_file?project=cleanlog",
    body,
  });
  assert.deepEqual(f.calls[0], {
    name: "put_knowledge_file",
    arguments: { project: "cleanlog", ...body },
  });
  await assert.rejects(
    f.transport.request({
      method: "PUT",
      path: "/api/v1/knowledge_file?project=cleanlog",
      body: { ...body, project: "other" },
    })
  );
  assert.equal(f.calls.length, 1);
});

test("metadata-only knowledge reads use the authorized MCP tool without fetching source bytes", async () => {
  const calls = [];
  const transport = createMcpSessionTransport({
    identity: { service_url: "https://productmemory.io", project: "cleanlog" },
    callTool: async (call) => {
      calls.push(call);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              path: "pm/asset.html",
              revision: 3,
              byte_size: 32 * 1024 * 1024,
              content_hash: "a".repeat(64),
              category: "document-artifact",
              source_metadata: { history: "retained" },
            }),
          },
        ],
      };
    },
  });
  const result = await transport.request({
    method: "GET",
    path: "/api/v1/knowledge_file?project=cleanlog&path=pm%2Fasset.html&include_content=false",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [
    {
      name: "get_knowledge_file",
      arguments: { project: "cleanlog", path: "pm/asset.html", include_content: false },
    },
  ]);
  assert.equal(Object.hasOwn(result.body, "content_base64"), false);
});

test("metadata-only mode fails closed if a service returns a stream and rejects coerced flags before tool calls", async () => {
  let calls = 0;
  const transport = createMcpSessionTransport({
    identity: { service_url: "https://productmemory.io", project: "cleanlog" },
    callTool: async () => {
      calls++;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              path: "pm/asset.html",
              revision: 3,
              content_encoding: "stream",
              content_url: "/private-content",
            }),
          },
        ],
      };
    },
  });
  await assert.rejects(
    transport.request({
      method: "GET",
      path: "/api/v1/knowledge_file?project=cleanlog&path=pm%2Fasset.html&include_content=false",
    }),
    /Metadata-only response/
  );
  assert.equal(calls, 1);
  for (const value of ["0", "FALSE", "null", ""])
    await assert.rejects(
      transport.request({
        method: "GET",
        path: `/api/v1/knowledge_file?project=cleanlog&path=pm%2Fasset.html&include_content=${value}`,
      }),
      /Explicit boolean/
    );
  assert.equal(calls, 1);
});
