#!/usr/bin/env node
"use strict";

// A credential-free child of an authorized Codex MCP session. The host invokes
// each named tool request and feeds its exact CallToolResult back over stdin.
const path = require("node:path");
const { createMcpSessionTransport } = require("./productmemory-mcp-session");

const safeDiagnostics = new WeakMap();
function localValidationError(message) {
  const error = new Error(message);
  safeDiagnostics.set(error, message);
  return error;
}
function createToolBridge({ input, output, maxBytes = 48 * 1024 * 1024 }) {
  let parts = [],
    bufferedBytes = 0,
    sequence = 0,
    closed = false,
    dispatched = false,
    writeDispatched = false;
  const pending = new Map();
  const fail = (error) => {
    closed = true;
    input.pause();
    parts = [];
    bufferedBytes = 0;
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  };
  input.on("data", (chunk) => {
    if (closed) return;
    const bytes = Buffer.from(chunk);
    let start = 0;
    while (start < bytes.length) {
      const newline = bytes.indexOf(10, start);
      const end = newline < 0 ? bytes.length : newline;
      const part = bytes.subarray(start, end);
      bufferedBytes += part.length;
      if (bufferedBytes > maxBytes)
        return fail(new Error("Host response exceeds the native response budget"));
      parts.push(part);
      if (newline < 0) break;
      const line = Buffer.concat(parts, bufferedBytes);
      parts = [];
      bufferedBytes = 0;
      start = newline + 1;
      let response;
      try {
        response = JSON.parse(line.toString("utf8"));
      } catch {
        return fail(new Error("Malformed host tool response"));
      }
      if (
        !response ||
        Object.keys(response).some((key) => !["id", "result"].includes(key)) ||
        !Number.isSafeInteger(response.id) ||
        !pending.has(response.id) ||
        !Object.hasOwn(response, "result")
      )
        return fail(new Error("Host tool response identity mismatch"));
      const operation = pending.get(response.id);
      pending.delete(response.id);
      operation.resolve(response.result);
    }
  });
  input.on("end", () =>
    fail(
      new Error(
        "Authorized host disconnected; observe remote acknowledgement before retrying any write"
      )
    )
  );
  input.on("error", () => fail(new Error("Authorized host input failed; no write replay")));
  output.on("error", () => fail(new Error("Authorized host output failed; no write replay")));
  return Object.freeze({
    get hasDispatched() {
      return dispatched;
    },
    get hasWriteDispatched() {
      return writeDispatched;
    },
    callTool(call) {
      if (
        !call ||
        Object.keys(call).some((key) => !["name", "arguments"].includes(key)) ||
        typeof call.name !== "string" ||
        !call.arguments ||
        typeof call.arguments !== "object" ||
        Array.isArray(call.arguments)
      )
        return Promise.reject(new Error("Exact named MCP call required"));
      if (closed) return Promise.reject(new Error("Authorized host bridge is closed"));
      // One operation at a time makes acknowledgement association unambiguous.
      if (pending.size)
        return Promise.reject(new Error("A host tool operation is already pending"));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          dispatched = true;
          writeDispatched ||= ![
            "get_feature_workflow",
            "get_knowledge_file",
            "get_knowledge_file_chunk",
          ].includes(call.name);
          output.write(JSON.stringify({ kind: "native-mcp-tool-request", id, ...call }) + "\n");
        } catch {
          fail(new Error("Authorized host output failed; no write replay"));
        }
      });
    },
    close() {
      if (pending.size) throw new Error("Cannot close a pending native tool operation");
      closed = true;
      input.pause();
    },
    abort() {
      fail(new Error("Native host operation ended; no write replay"));
    },
  });
}

function parseArgs(argv) {
  const command = argv[0];
  const values = {};
  const names = new Set([
    "source-dir",
    "project",
    "service-url",
    "slug",
    "record-id",
    "execution-path",
    "session",
    "input",
  ]);
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, "");
    if (
      !argv[index].startsWith("--") ||
      !names.has(key) ||
      Object.hasOwn(values, key) ||
      !argv[index + 1] ||
      argv[index + 1].startsWith("--")
    )
      throw localValidationError("Explicit unique native host arguments required");
    values[key] = argv[index + 1];
  }
  for (const key of ["source-dir", "project", "service-url"])
    if (!values[key]) throw localValidationError(`--${key} is required`);
  return { command, values };
}

async function main(
  argv,
  { input = process.stdin, output = process.stdout, pluginRoot = __dirname } = {}
) {
  const { command, values } = parseArgs(argv);
  const operations = new Set([
    "initialize",
    "recover-initialization",
    "decision",
    "record",
    "workspace",
    "grant",
    "gate",
    "recertify",
    "record-qa-candidate",
    "anchor-qa-history",
    "unblock",
    "work-unit",
    "candidate",
    "certify",
    "recover-certification",
    "author-fetch",
    "author-plan",
    "author-publish",
    "author-recover",
  ]);
  if (!operations.has(command)) throw localValidationError("Unsupported native host operation");
  const root = path.resolve(values["source-dir"]);
  const { readProjectInput } = require(path.join(pluginRoot, "lib/project-file"));
  let data = null;
  if (values.input) {
    try {
      data = JSON.parse(
        readProjectInput(root, values.input, 4 * 1024 * 1024, {
          requireStablePath: true,
        }).bytes.toString("utf8")
      );
    } catch {
      throw localValidationError("Input must be an available anchored file containing valid JSON.");
    }
  }
  if (
    !data &&
    [
      "record",
      "grant",
      "gate",
      "recertify",
      "record-qa-candidate",
      "anchor-qa-history",
      "unblock",
      "work-unit",
      "candidate",
      "author-plan",
    ].includes(command)
  )
    throw localValidationError("--input is required for this operation");
  const session = values.session ? path.resolve(root, values.session) : null;
  if (
    ![
      "initialize",
      "recover-initialization",
      "author-fetch",
      "author-plan",
      "author-publish",
      "author-recover",
    ].includes(command) &&
    !session
  )
    throw localValidationError("--session is required");
  const bridge = createToolBridge({ input, output });
  try {
    const transport = createMcpSessionTransport({
      identity: { service_url: values["service-url"], project: values.project },
      callTool: bridge.callTool,
    });
    const runtime = require(
      path.join(pluginRoot, "productmemory-native-runtime")
    ).createNativeRuntime(transport);
    let result;
    if (command.startsWith("author-")) {
      const authoring = require(
        path.join(pluginRoot, "productmemory-native-authoring")
      ).createNativeAuthoring(transport);
      const method = {
        "author-fetch": "fetch",
        "author-plan": "plan",
        "author-publish": "publish",
        "author-recover": "recover",
      }[command];
      result = await authoring[method]({
        sourceDir: root,
        slug: values.slug,
        input: data,
        recordId: values["record-id"],
        executionPath: values["execution-path"],
      });
    } else if (command === "initialize")
      result = await runtime.initialize({
        sourceDir: root,
        slug: values.slug,
        recordId: values["record-id"],
        executionPath: values["execution-path"],
      });
    else if (command === "recover-initialization")
      result = await runtime.recoverInitialization({ sourceDir: root, slug: values.slug });
    else if (command === "decision") result = await runtime.decision(session);
    else if (command === "record") result = await runtime.record(session, data);
    else if (command === "workspace") result = await runtime.workspace(session);
    else if (command === "grant") result = await runtime.grant(session, data.actions, data.reason);
    else if (command === "gate") result = await runtime.gate(session, data);
    else if (command === "recertify") result = await runtime.recertifyEvidence(session, data);
    else if (command === "record-qa-candidate")
      result = await runtime.recordNonPassingQaCandidate(session, data);
    else if (command === "anchor-qa-history") result = await runtime.anchorQaHistory(session, data);
    else if (command === "unblock") result = await runtime.resumeBlocked(session, data.resolution);
    else if (command === "work-unit") result = await runtime.transitionWorkUnit(session, data);
    else if (command === "candidate") result = await runtime.transitionCandidate(session, data);
    else if (command === "certify") result = await runtime.certify(session);
    else result = await runtime.recoverCertification(session);
    bridge.close();
    output.write(JSON.stringify({ kind: "native-host-result", result }) + "\n");
    return result;
  } catch (error) {
    if (!bridge.hasDispatched && !safeDiagnostics.has(error))
      safeDiagnostics.set(
        error,
        "Local native validation failed before any MCP tool was requested. Check the selected source, product identity and anchored input."
      );
    if (bridge.hasDispatched && !bridge.hasWriteDispatched && !safeDiagnostics.has(error))
      safeDiagnostics.set(
        error,
        "Native operation failed after read-only MCP requests. Inspect the host results and product contract; no new write was requested. Preserve any earlier intent for reconciliation."
      );
    throw error;
  } finally {
    bridge.abort();
  }
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    // Never print arbitrary remote exception text or private input files.
    const diagnostic = safeDiagnostics.get(error);
    process.stderr.write(
      diagnostic
        ? `${diagnostic}\n`
        : "Native host operation failed. Preserve local intent and inspect the authorized host's tool result; do not replay uncertain writes.\n"
    );
    process.exitCode = 1;
    process.stdin.pause();
  });
module.exports = { createToolBridge, parseArgs, main };
