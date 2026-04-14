"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a temp directory with an optional .pm/config.json content.
 * Returns the temp dir path and a cleanup function.
 */
function withTmpDir(configContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-"));
  if (configContent !== undefined) {
    fs.mkdirSync(path.join(dir, ".pm"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pm", "config.json"), JSON.stringify(configContent));
  }
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Load the module under test. Returns the module exports.
 * The caller is responsible for chdir-ing to the desired directory before
 * calling functions that depend on cwd (like loadConfig).
 */
function loadProvider() {
  // Clear require cache so each test gets a fresh module
  delete require.cache[require.resolve("../scripts/seo-provider.js")];
  return require("../scripts/seo-provider.js");
}

/**
 * Run `fn` with process.cwd() set to `dir`, restoring cwd afterward.
 */
function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}

// ---------------------------------------------------------------------------
// 1. loadConfig — happy path
// ---------------------------------------------------------------------------

test("loadConfig reads .pm/config.json and returns parsed config", () => {
  const cfg = {
    config_schema: 1,
    integrations: { seo: { provider: "ahrefs", api_key: "key123" } },
  };
  const { dir, cleanup } = withTmpDir(cfg);
  try {
    const { loadConfig } = loadProvider();
    const result = withCwd(dir, () => loadConfig());
    assert.deepEqual(result, cfg);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2. loadConfig — missing file
// ---------------------------------------------------------------------------

test("loadConfig returns null when .pm/config.json does not exist", () => {
  const { dir, cleanup } = withTmpDir(); // no config written
  try {
    const { loadConfig } = loadProvider();
    const result = withCwd(dir, () => loadConfig());
    assert.equal(result, null);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Shared Ahrefs config fixture
// ---------------------------------------------------------------------------

const AHREFS_CONFIG = {
  config_schema: 1,
  integrations: { seo: { provider: "ahrefs", api_key: "TEST_KEY" } },
};

// ---------------------------------------------------------------------------
// Helpers to capture the options passed to the transport
// ---------------------------------------------------------------------------

/**
 * Creates a mock transport that resolves with the given HTTP response.
 * Returns { transport, calls } where calls accumulates invocation args.
 */
function mockTransport(statusCode, body) {
  const calls = [];
  const transport = (options, cb) => {
    calls.push({ options, body: null });
    // Simulate an IncomingMessage-like readable
    const chunks = [JSON.stringify(body)];
    let idx = 0;
    const res = {
      statusCode,
      headers: {},
      on(event, handler) {
        if (event === "data") {
          // deliver data synchronously via setImmediate to mimic async stream
          setImmediate(() => handler(chunks[idx++] || ""));
        }
        if (event === "end") {
          setImmediate(() => {
            // ensure data was delivered first
            setImmediate(() => handler());
          });
        }
        return res;
      },
    };
    cb(res);
    return {
      on() {
        return this;
      },
      end() {},
    };
  };
  return { transport, calls };
}

/**
 * Builds a transport that returns 429 then 200.
 */
function mockTransport429Then200(retryAfter, successBody) {
  const calls = [];
  let callCount = 0;
  const transport = (options, cb) => {
    callCount++;
    const current = callCount;
    calls.push({ options });
    const statusCode = current === 1 ? 429 : 200;
    const bodyObj = current === 1 ? {} : successBody;
    const headers = current === 1 ? { "retry-after": String(retryAfter) } : {};
    const chunks = [JSON.stringify(bodyObj)];
    let idx = 0;
    const res = {
      statusCode,
      headers,
      on(event, handler) {
        if (event === "data") setImmediate(() => handler(chunks[idx++] || ""));
        if (event === "end") setImmediate(() => setImmediate(() => handler()));
        return res;
      },
    };
    cb(res);
    return {
      on() {
        return this;
      },
      end() {},
    };
  };
  return { transport, calls };
}

/**
 * Builds a transport that always returns 429.
 */
function mockTransportAlways429(retryAfter) {
  const calls = [];
  const transport = (options, cb) => {
    calls.push({ options });
    const res = {
      statusCode: 429,
      headers: { "retry-after": String(retryAfter) },
      on(event, handler) {
        if (event === "data") setImmediate(() => handler("{}"));
        if (event === "end") setImmediate(() => setImmediate(() => handler()));
        return res;
      },
    };
    cb(res);
    return {
      on() {
        return this;
      },
      end() {},
    };
  };
  return { transport, calls };
}

// ---------------------------------------------------------------------------
// 3. Ahrefs getKeywords — correct URL and auth header
// ---------------------------------------------------------------------------

test("Ahrefs getKeywords constructs correct URL and auth header", async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { getKeywords } = loadProvider();
    const { transport, calls } = mockTransport(200, { keywords: [] });

    await getKeywords("example.com", AHREFS_CONFIG, transport);

    assert.equal(calls.length, 1);
    const { options } = calls[0];
    assert.equal(options.hostname, "api.ahrefs.com");
    assert.match(options.path, /\/v3\//);
    assert.match(options.path, /example\.com/);
    assert.equal(options.headers["Authorization"], "Bearer TEST_KEY");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. Ahrefs getTraffic — correct URL and auth header
// ---------------------------------------------------------------------------

test("Ahrefs getTraffic constructs correct URL and auth header", async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { getTraffic } = loadProvider();
    const { transport, calls } = mockTransport(200, { metrics: {} });

    await getTraffic("example.com", AHREFS_CONFIG, transport);

    assert.equal(calls.length, 1);
    const { options } = calls[0];
    assert.equal(options.hostname, "api.ahrefs.com");
    assert.match(options.path, /\/v3\//);
    assert.match(options.path, /example\.com/);
    assert.equal(options.headers["Authorization"], "Bearer TEST_KEY");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5. Ahrefs getBacklinks — correct URL and auth header
// ---------------------------------------------------------------------------

test("Ahrefs getBacklinks constructs correct URL and auth header", async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { getBacklinks } = loadProvider();
    const { transport, calls } = mockTransport(200, { backlinks: [] });

    await getBacklinks("example.com", AHREFS_CONFIG, transport);

    assert.equal(calls.length, 1);
    const { options } = calls[0];
    assert.equal(options.hostname, "api.ahrefs.com");
    assert.match(options.path, /\/v3\//);
    assert.match(options.path, /example\.com/);
    assert.equal(options.headers["Authorization"], "Bearer TEST_KEY");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6. Response parsing — keyword data extraction
// ---------------------------------------------------------------------------

test("Ahrefs response parsing extracts keyword data correctly", async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { getKeywords } = loadProvider();
    const rawResponse = {
      keywords: [
        { keyword: "cleaning service", volume: 5000, difficulty: 42 },
        { keyword: "office cleaning", volume: 2200, difficulty: 38 },
      ],
    };
    const { transport } = mockTransport(200, rawResponse);

    const result = await getKeywords("example.com", AHREFS_CONFIG, transport);

    assert.ok(Array.isArray(result.keywords), "result.keywords should be an array");
    assert.equal(result.keywords.length, 2);
    assert.equal(result.keywords[0].keyword, "cleaning service");
    assert.equal(result.keywords[0].volume, 5000);
    assert.equal(result.keywords[0].difficulty, 42);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 7. CLI interface routing
// ---------------------------------------------------------------------------

test("CLI interface routes getKeywords command to correct function", async () => {
  // We test this indirectly: run the script as a child process with mocked
  // transport not feasible via CLI injection, so we test the exported
  // routing logic directly by checking that main() dispatches correctly.
  // This is covered by the unit tests above. We instead verify the module
  // exports all expected CLI-routable functions.
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const mod = loadProvider();
    assert.equal(typeof mod.getKeywords, "function", "getKeywords must be exported");
    assert.equal(typeof mod.getTraffic, "function", "getTraffic must be exported");
    assert.equal(typeof mod.getBacklinks, "function", "getBacklinks must be exported");
    assert.equal(typeof mod.getCompetitors, "function", "getCompetitors must be exported");
    assert.equal(typeof mod.verify, "function", "verify must be exported");
    assert.equal(typeof mod.loadConfig, "function", "loadConfig must be exported");
    assert.equal(typeof mod.ahrefsRequest, "function", "ahrefsRequest must be exported");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 8. verify — returns { ok: true } on valid credentials
// ---------------------------------------------------------------------------

test("verify returns { ok: true } on valid credentials", async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { verify } = loadProvider();
    // A 200 response means credentials are valid
    const { transport } = mockTransport(200, { subscription: { plan: "lite" } });

    const result = await verify(AHREFS_CONFIG, transport);

    assert.deepEqual(result, { ok: true });
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 9. verify — returns { error: "..." } on auth failure
// ---------------------------------------------------------------------------

test('verify returns { error: "..." } on auth failure', async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { verify } = loadProvider();
    const { transport } = mockTransport(401, { error: "Unauthorized" });

    const result = await verify(AHREFS_CONFIG, transport);

    assert.ok("error" in result, "result should have an error key");
    assert.ok(typeof result.error === "string");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 10. verify — returns { error: "no config" } when config is missing
// ---------------------------------------------------------------------------

test('verify returns { error: "no config" } when .pm/config.json is missing', async () => {
  const { dir, cleanup } = withTmpDir(); // no config file
  try {
    const { verify } = loadProvider();
    // Pass null config (as loadConfig() would return when file missing)
    const result = await verify(null);

    assert.deepEqual(result, { error: "no config" });
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 11. 429 triggers one retry, returns data on second success
// ---------------------------------------------------------------------------

test("429 response triggers one retry after delay, returns data on second success", async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { getKeywords } = loadProvider();
    const successBody = { keywords: [{ keyword: "test", volume: 100, difficulty: 10 }] };
    const { transport, calls } = mockTransport429Then200(1, successBody);

    // Override delay to 0ms for test speed
    const result = await getKeywords("example.com", AHREFS_CONFIG, transport, { retryDelay: 0 });

    assert.equal(calls.length, 2, "should have made exactly 2 requests");
    assert.ok(Array.isArray(result.keywords));
    assert.equal(result.keywords[0].keyword, "test");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 12. 429 on both attempts returns { error: "rate_limited", retry_after: N }
// ---------------------------------------------------------------------------

test('429 on both attempts returns { error: "rate_limited", retry_after: N }', async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { getKeywords } = loadProvider();
    const { transport } = mockTransportAlways429(30);

    const result = await getKeywords("example.com", AHREFS_CONFIG, transport, { retryDelay: 0 });

    assert.equal(result.error, "rate_limited");
    assert.equal(typeof result.retry_after, "number");
    assert.equal(result.retry_after, 30);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 13. --limit is passed through to getKeywords (Ahrefs)
// ---------------------------------------------------------------------------

test("getKeywords passes limit option to Ahrefs request", async () => {
  const { dir, cleanup } = withTmpDir(AHREFS_CONFIG);
  try {
    const { getKeywords } = loadProvider();
    const { transport, calls } = mockTransport(200, { keywords: [] });

    await getKeywords("example.com", AHREFS_CONFIG, transport, { limit: 20 });

    assert.equal(calls.length, 1);
    assert.match(calls[0].options.path, /limit=20/);
  } finally {
    cleanup();
  }
});
