"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { createToolBridge, parseArgs } = require("../scripts/productmemory-native-host");
function fixture(maxBytes) {
  const input = new PassThrough(),
    output = new PassThrough();
  const requests = [];
  output.on("data", (bytes) => requests.push(JSON.parse(bytes.toString("utf8"))));
  return {
    input,
    output,
    requests,
    bridge: createToolBridge({ input, output, ...(maxBytes ? { maxBytes } : {}) }),
  };
}
test("Codex host invokes exact named MCP tool and feeds its unchanged result without a bearer", async () => {
  const f = fixture();
  const operation = f.bridge.callTool({ name: "get_feature_workflow", arguments: { id: "bkl_a" } });
  assert.deepEqual(f.requests, [
    {
      kind: "native-mcp-tool-request",
      id: 1,
      name: "get_feature_workflow",
      arguments: { id: "bkl_a" },
    },
  ]);
  const result = { content: [{ type: "text", text: '{"revision":9}' }] };
  const response = JSON.stringify({ id: 1, result }) + "\n";
  f.input.write(response.slice(0, 4));
  f.input.write(response.slice(4));
  assert.deepEqual(await operation, result);
  f.bridge.close();
  await assert.rejects(
    f.bridge.callTool({ name: "start_feature_session", arguments: {} }),
    /closed/
  );
});
test("concurrent operations cannot mix acknowledgement identities", async () => {
  const f = fixture();
  const first = f.bridge.callTool({ name: "start_feature_session", arguments: { if_revision: 9 } });
  await assert.rejects(
    f.bridge.callTool({ name: "start_feature_session", arguments: { if_revision: 9 } }),
    /already pending/
  );
  assert.equal(f.requests.length, 1);
  f.input.write(JSON.stringify({ id: 1, result: { content: [] } }) + "\n");
  await first;
  f.bridge.close();
});
test("disconnect after dispatch rejects rather than replaying a consequential write", async () => {
  const f = fixture();
  const operation = f.bridge.callTool({
    name: "report_feature_session",
    arguments: { session_id: 7, if_session_revision: 1 },
  });
  f.input.end();
  await assert.rejects(operation, /observe remote acknowledgement/);
  assert.equal(f.requests.length, 1);
  await assert.rejects(
    f.bridge.callTool({ name: "report_feature_session", arguments: {} }),
    /closed/
  );
  assert.equal(f.requests.length, 1);
});
test("malformed, unsolicited and oversized responses close the bridge", async () => {
  for (const reply of [
    "not json\n",
    '{"id":2,"result":{}}\n',
    '{"id":1,"result":{},"other":true}\n',
    "x".repeat(129),
  ]) {
    const f = fixture(128);
    const operation = f.bridge.callTool({ name: "get_feature_workflow", arguments: {} });
    f.input.write(reply);
    await assert.rejects(operation);
    await assert.rejects(
      f.bridge.callTool({ name: "get_feature_workflow", arguments: {} }),
      /closed/
    );
    assert.equal(f.requests.length, 1);
  }
});
test("host arguments require exact explicit connection and local source selection", () => {
  assert.deepEqual(
    parseArgs([
      "decision",
      "--source-dir",
      "/fixture",
      "--project",
      "cleanlog",
      "--service-url",
      "https://productmemory.io",
      "--session",
      ".pm/session.json",
    ]),
    {
      command: "decision",
      values: {
        "source-dir": "/fixture",
        project: "cleanlog",
        "service-url": "https://productmemory.io",
        session: ".pm/session.json",
      },
    }
  );
  for (const args of [
    ["decision"],
    ["decision", "--token", "secret"],
    ["decision", "--source-dir", "/fixture", "--source-dir", "/other"],
  ])
    assert.throws(() => parseArgs(args));
});

function nativeHostFixture(t, disconnectOnStart = false) {
  const f = require("./helpers/productmemory-native-fixture").fixture(t);
  const input = new PassThrough(),
    output = new PassThrough();
  const requests = [],
    results = [];
  output.on("data", (bytes) => {
    const message = JSON.parse(bytes.toString("utf8"));
    if (message.kind === "native-host-result") {
      results.push(message.result);
      return;
    }
    requests.push(message);
    const args = message.arguments;
    let request;
    if (message.name === "get_feature_workflow")
      request = {
        method: "GET",
        path: `/api/v1/records/${args.id}/feature_workflow?project=cleanlog`,
      };
    else if (message.name === "get_knowledge_file")
      request = {
        method: "GET",
        path: `/api/v1/knowledge_file?project=cleanlog&path=${encodeURIComponent(args.path)}&revision=${args.revision}`,
      };
    else if (message.name === "start_feature_session") {
      const { id, ...body } = args;
      request = {
        method: "POST",
        path: `/api/v1/records/${id}/development_sessions?project=cleanlog`,
        body,
      };
    } else throw new Error(`Unexpected fixture tool ${message.name}`);
    f.transport.request(request).then((response) => {
      if (disconnectOnStart && message.name === "start_feature_session") {
        input.end();
        return;
      }
      input.write(
        JSON.stringify({
          id: message.id,
          result: { content: [{ type: "text", text: JSON.stringify(response.body) }] },
        }) + "\n"
      );
    });
  });
  const argv = (command) => [
    command,
    "--source-dir",
    f.root,
    "--project",
    "cleanlog",
    "--service-url",
    "https://productmemory.io",
    "--slug",
    f.options.slug,
    ...(command === "initialize"
      ? ["--record-id", f.options.recordId, "--execution-path", f.options.executionPath]
      : []),
  ];
  return { f, input, output, requests, results, argv };
}
test("authorized host bootstrap composes real native validators with named MCP tools", async (t) => {
  const { main } = require("../scripts/productmemory-native-host");
  const f = nativeHostFixture(t);
  const result = await main(f.argv("initialize"), f);
  assert.deepEqual(
    require("../scripts/lib/dev-session-schema").validateSession(result.session),
    []
  );
  assert.equal(result.session.task.native.reviewer, "second-person@example.com");
  assert.equal(result.session.authority.merge, false);
  assert.equal(require("node:fs").existsSync(require("node:path").join(f.f.root, "pm")), false);
  assert.equal(f.requests.filter((call) => call.name === "start_feature_session").length, 1);
  assert.deepEqual(f.results, [result]);
});
test("host disconnect after acknowledged remote start retains durable intent and recovery never replays start", async (t) => {
  const { main } = require("../scripts/productmemory-native-host");
  const f = nativeHostFixture(t, true);
  await assert.rejects(main(f.argv("initialize"), f), /observe remote acknowledgement/);
  assert.equal(f.f.workflow.sessions.length, 1);
  assert.equal(f.requests.filter((call) => call.name === "start_feature_session").length, 1);
  const recovered = { ...f, input: new PassThrough(), output: new PassThrough() };
  const calls = [];
  recovered.output.on("data", (bytes) => {
    const message = JSON.parse(bytes.toString("utf8"));
    if (message.kind !== "native-mcp-tool-request") return;
    calls.push(message);
    assert.equal(message.name, "get_feature_workflow");
    recovered.input.write(
      JSON.stringify({
        id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify(f.f.workflow) }] },
      }) + "\n"
    );
  });
  const result = await main(f.argv("recover-initialization"), recovered);
  assert.equal(result.session.task.native.remote_session_id, f.f.workflow.sessions[0].id);
  assert.ok(calls.length > 0);
  assert.equal(f.f.calls.filter((call) => call.method === "POST").length, 1);
});

test("CLI reports safe local validation diagnostics without inventing an uncertain remote write", () => {
  const { spawnSync } = require("node:child_process");
  const script = require("node:path").join(__dirname, "../scripts/productmemory-native-host.js");
  const result = spawnSync(process.execPath, [script, "decision", "--source-dir", "/fixture"], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--project is required/);
  assert.doesNotMatch(result.stderr, /replay uncertain writes/);
  const unknown = spawnSync(
    process.execPath,
    [script, "decision", "--private-marker", "private-secret-marker"],
    { encoding: "utf8", timeout: 5000 }
  );
  assert.equal(unknown.status, 1);
  assert.doesNotMatch(unknown.stderr, /private-secret-marker/);
});
