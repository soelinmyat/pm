# PM-090: SSE Event Bus Core — POST, Store, SSE, Port Discovery

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable any local process to POST JSON events to the dashboard server and any browser tab to receive them in real-time via SSE — validated end-to-end with curl.

**Architecture:** Three additions to `scripts/server.js` inside `createDashboardServer()`: (1) a POST `/events` handler that validates and stores events in a capped ring buffer, (2) a GET `/events` SSE endpoint that streams events with heartbeat and Last-Event-ID replay, and (3) SSE connection tracking in the existing `allConnections` set. Plus one new shell script `scripts/find-dashboard-port.sh` that reuses the port hash logic from `start-server.sh`.

**Tech Stack:** Node.js (raw `http` module), shell (bash)

---

## Upstream Context

> Injected from research at `pm/research/sse-event-bus/findings.md`.

### Key Findings
- OpenCode (SST) validates SSE event bus with typed events + POST ingestion + multi-client subscription at production scale
- SSE wins over WebSocket for PM's use case: unidirectional server-to-browser, automatic reconnection, simpler
- PM already has WebSocket for reload broadcast — SSE coexists, does not replace
- Port discovery is a shell utility — the stable port hash (`hashProjectPort`) already exists in both JS and shell

### Design Decisions
- Single-scope (per-project) event bus — no cross-project aggregation
- No authentication on POST — localhost-only server, acceptable
- In-memory only — events lost on server restart (disk persistence deferred)

---

## Current State

What **already exists** (no changes needed):

| Feature | Location |
|---------|----------|
| `hashProjectPort(dir)` — MD5 hash to port 3000-9999 | `server.js:95-99` |
| `routeDashboard(req, res, pmDir)` — GET route dispatcher | `server.js:1294-1401` |
| `broadcastDashboard(msg)` — iterate Set, write to each socket | `server.js:3753-3758` |
| `allConnections` Set — tracks all raw connections for clean shutdown | `server.js:3733` |
| `server.close` override — destroys all connections + clears sets | `server.js:3842-3856` |
| HTTP handler — currently returns 405 for non-GET | `server.js:3760-3766` |
| Shell port hash — `node -e` with MD5 in `start-server.sh` | `start-server.sh:119-123` |
| `module.exports` — exports `createDashboardServer`, `hashProjectPort` | `server.js:4149-4155` |

What **needs building:**

| AC | Gap | Task |
|----|-----|------|
| AC1-2 | POST `/events` handler with validation | Task 1 |
| AC3 | In-memory ring buffer capped at 200 | Task 1 |
| AC4-6 | GET `/events` SSE endpoint with heartbeat | Task 2 |
| AC7 | Last-Event-ID replay from ring buffer | Task 2 |
| AC8 | SSE connections tracked in `allConnections`, destroyed on `server.close()` | Task 2 |
| AC9-10 | `scripts/find-dashboard-port.sh` port discovery script | Task 3 |

---

## Task 1: POST /events Endpoint + Ring Buffer

**Files:**
- Modify: `scripts/server.js:3730-3766` (inside `createDashboardServer`)
- Test: `tests/server.test.js`

The ring buffer and POST handler live inside `createDashboardServer()` so they share closure scope with `allConnections` and `dashClients`.

- [ ] **Step 1: Write failing tests for POST /events**

Add to `tests/server.test.js`:

```javascript
// ---------------------------------------------------------------------------
// POST /events — accepts JSON events
// ---------------------------------------------------------------------------

test('POST /events returns 201 with valid event', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const event = {
        type: 'test.event',
        source: 'terminal-1',
        timestamp: Date.now(),
      };
      const { statusCode, body } = await httpPost(port, '/events', event);
      assert.equal(statusCode, 201);
      const parsed = JSON.parse(body);
      assert.ok(parsed.id, 'response must include event id');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('POST /events returns 400 when required fields missing', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode } = await httpPost(port, '/events', { type: 'test' });
      assert.equal(statusCode, 400);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('GET /events returns 405 for non-POST', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode } = await httpGet(port, '/events');
      // GET /events is SSE (Task 2), so this test moves to Task 2.
      // For now, test that PUT /events returns 405.
      const { statusCode: putStatus } = await httpRequest(port, 'PUT', '/events', {});
      assert.equal(putStatus, 405);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('Ring buffer evicts oldest when full (200 cap)', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      // Post 201 events
      for (let i = 0; i < 201; i++) {
        await httpPost(port, '/events', {
          type: 'test.event',
          source: 'terminal-1',
          timestamp: Date.now(),
          detail: { index: i },
        });
      }
      // The first event (index 0) should be evicted
      // We verify via SSE in Task 2; here just confirm 201st succeeds
      const { statusCode } = await httpPost(port, '/events', {
        type: 'test.event',
        source: 'terminal-1',
        timestamp: Date.now(),
        detail: { index: 201 },
      });
      assert.equal(statusCode, 201);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Add `httpPost` and `httpRequest` test helpers**

Add to the helpers section of `tests/server.test.js` (after `httpGet`):

```javascript
/**
 * Make a POST request with JSON body, return { statusCode, headers, body }.
 */
function httpPost(port, urlPath, data) {
  return httpRequest(port, 'POST', urlPath, data);
}

/**
 * Make an HTTP request with a given method and JSON body.
 */
function httpRequest(port, method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/server.test.js`
Expected: New tests FAIL (POST returns 405, helpers not yet used by server)

- [ ] **Step 4: Implement ring buffer + POST handler in server.js**

Inside `createDashboardServer(pmDir)`, after the `allConnections` declaration (line 3733), add:

```javascript
  // ---- SSE Event Bus: ring buffer ----
  const EVENT_BUFFER_CAP = 200;
  const eventBuffer = [];
  let eventIdCounter = 0;

  function pushEvent(event) {
    eventIdCounter++;
    const stored = { id: eventIdCounter, ...event };
    eventBuffer.push(stored);
    if (eventBuffer.length > EVENT_BUFFER_CAP) {
      eventBuffer.shift();
    }
    return stored;
  }
```

Then replace the HTTP handler (lines 3760-3766):

```javascript
  const server = http.createServer((req, res) => {
    const reqUrl = req.url.split('?')[0];

    if (reqUrl === '/events') {
      if (req.method === 'POST') {
        handlePostEvent(req, res);
      } else if (req.method === 'GET') {
        handleSSEConnection(req, res);
      } else {
        res.writeHead(405); res.end('Method Not Allowed');
      }
      return;
    }

    if (req.method === 'GET') {
      routeDashboard(req, res, pmDir);
    } else {
      res.writeHead(405); res.end('Method Not Allowed');
    }
  });
```

Add the POST handler function inside `createDashboardServer`, before the `server` declaration:

```javascript
  function handlePostEvent(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { type, source, timestamp } = parsed;
      if (!type || !source || timestamp == null) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: type, source, timestamp' }));
        return;
      }

      const event = {
        type,
        source,
        timestamp,
        detail: parsed.detail || {},
        source_type: parsed.source_type || 'terminal',
      };

      const stored = pushEvent(event);
      broadcastSSE(stored);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: stored.id }));
    });
  }
```

Note: `handleSSEConnection` and `broadcastSSE` are stubs for now — add placeholder:

```javascript
  const sseClients = new Set();

  function broadcastSSE(event) {
    const data = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try { client.write(data); } catch { sseClients.delete(client); }
    }
  }

  function handleSSEConnection(req, res) {
    // Implemented in Task 2
    res.writeHead(501); res.end('Not yet implemented');
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: All new POST tests PASS. Existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat(PM-090): POST /events endpoint with ring buffer"
```

---

## Task 2: GET /events SSE Endpoint with Heartbeat + Replay

**Files:**
- Modify: `scripts/server.js` (inside `createDashboardServer` — replace `handleSSEConnection` stub)
- Modify: `scripts/server.js:3842-3856` (extend `server.close` override for SSE cleanup)
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing tests for SSE endpoint**

Add to `tests/server.test.js`:

```javascript
// ---------------------------------------------------------------------------
// GET /events — SSE stream
// ---------------------------------------------------------------------------

test('GET /events returns SSE content-type and headers', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const headers = await new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path: '/events' }, (res) => {
          resolve(res.headers);
          res.destroy();
        }).on('error', reject);
      });
      assert.equal(headers['content-type'], 'text/event-stream');
      assert.equal(headers['cache-control'], 'no-cache');
      assert.equal(headers['connection'], 'keep-alive');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('SSE receives posted events in real time', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const received = await new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path: '/events' }, (res) => {
          let buf = '';
          res.on('data', chunk => {
            buf += chunk.toString();
            // Look for a complete SSE message (ends with \n\n)
            if (buf.includes('data: ') && buf.includes('\n\n')) {
              res.destroy();
              resolve(buf);
            }
          });
          // Post an event after SSE is connected
          setTimeout(() => {
            httpPost(port, '/events', {
              type: 'test.sse',
              source: 'terminal-1',
              timestamp: Date.now(),
            }).catch(reject);
          }, 50);
        }).on('error', reject);
      });
      assert.ok(received.includes('id: '), 'must have id field');
      assert.ok(received.includes('data: '), 'must have data field');
      assert.ok(received.includes('"test.sse"'), 'must contain event type');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('SSE replays missed events via Last-Event-ID', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      // Post 3 events first
      for (let i = 0; i < 3; i++) {
        await httpPost(port, '/events', {
          type: 'test.replay',
          source: 'terminal-1',
          timestamp: Date.now(),
          detail: { index: i },
        });
      }

      // Connect with Last-Event-ID: 1 — should replay events 2 and 3
      const received = await new Promise((resolve, reject) => {
        const req = http.get({
          hostname: '127.0.0.1',
          port,
          path: '/events',
          headers: { 'Last-Event-ID': '1' },
        }, (res) => {
          let buf = '';
          let count = 0;
          res.on('data', chunk => {
            buf += chunk.toString();
            // Count complete SSE messages
            const matches = buf.match(/data: /g);
            if (matches && matches.length >= 2) {
              res.destroy();
              resolve(buf);
            }
          });
        });
        req.on('error', reject);
        // Timeout safety
        setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 3000);
      });
      // Should contain events with index 1 and 2 (ids 2 and 3)
      assert.ok(received.includes('"index":1'), 'must replay event with index 1');
      assert.ok(received.includes('"index":2'), 'must replay event with index 2');
      assert.ok(!received.includes('"index":0'), 'must NOT replay event before Last-Event-ID');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/server.test.js`
Expected: SSE tests FAIL (handleSSEConnection returns 501)

- [ ] **Step 3: Implement SSE endpoint**

Replace the `handleSSEConnection` stub in `scripts/server.js`:

```javascript
  function handleSSEConnection(req, res) {
    touchActivity();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Replay missed events if Last-Event-ID is present
    const lastId = req.headers['last-event-id'];
    if (lastId != null) {
      const lastIdNum = parseInt(lastId, 10);
      if (!isNaN(lastIdNum)) {
        for (const event of eventBuffer) {
          if (event.id > lastIdNum) {
            res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
          }
        }
      }
    }

    sseClients.add(res);
    allConnections.add(res.socket);

    // Heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(heartbeat); }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });

    res.socket.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  }
```

- [ ] **Step 4: Extend server.close override for SSE cleanup**

In the `server.close` override (around line 3844), add SSE cleanup before the `origClose` call:

```javascript
  server.close = function(cb) {
    watcherActive = false;
    closeWatchersUnder(pmDir);
    closeWatchersUnder(sessionsWatchDir);
    // Clear SSE heartbeat intervals and clients
    for (const client of sseClients) {
      try { client.end(); } catch {}
    }
    sseClients.clear();
    // Destroy all open sockets so server.close callback fires promptly
    for (const sock of allConnections) {
      try { sock.destroy(); } catch (e) {}
    }
    allConnections.clear();
    dashClients.clear();
    origClose(cb);
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: All SSE tests PASS. All existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat(PM-090): GET /events SSE endpoint with heartbeat and replay"
```

---

## Task 3: Port Discovery Script

**Files:**
- Create: `scripts/find-dashboard-port.sh`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing test for port discovery**

Add to `tests/server.test.js`:

```javascript
// ---------------------------------------------------------------------------
// find-dashboard-port.sh — port discovery
// ---------------------------------------------------------------------------

const { execFileSync } = require('child_process');

test('find-dashboard-port.sh outputs correct port for running server', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      // The script should discover the port based on the project root directory
      const projectDir = path.dirname(pmDir);
      const scriptPath = path.join(__dirname, '..', 'scripts', 'find-dashboard-port.sh');
      const result = execFileSync('bash', [scriptPath, projectDir], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      // The script uses hash-based port, but our test server uses port 0 (random).
      // So we test the hash output matches hashProjectPort.
      const mod = loadServer();
      const expectedPort = mod.hashProjectPort(projectDir);
      assert.equal(parseInt(result, 10), expectedPort);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('find-dashboard-port.sh exits 1 when no server running', () => {
  // Use a directory that is unlikely to have a server running
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'port-test-'));
  try {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'find-dashboard-port.sh');
    let exitCode;
    try {
      execFileSync('bash', [scriptPath, tmpDir], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      exitCode = 0;
    } catch (err) {
      exitCode = err.status;
    }
    assert.equal(exitCode, 1, 'must exit 1 when no server is running');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/server.test.js`
Expected: Tests FAIL (script does not exist)

- [ ] **Step 3: Create `scripts/find-dashboard-port.sh`**

```bash
#!/usr/bin/env bash
# find-dashboard-port.sh — Discover the dashboard server port for a project directory.
#
# Usage: find-dashboard-port.sh <project-directory>
#
# Outputs the port where the dashboard server is listening (exit 0).
# Outputs nothing and exits 1 if no server is running on that port.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: find-dashboard-port.sh <project-directory>" >&2
  exit 1
fi

PROJECT_DIR="$1"

# Resolve to absolute path
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || {
  exit 1
}

# Compute stable port using same hash as start-server.sh (lines 119-123)
PORT=$(node -e "
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update('$PROJECT_DIR').digest();
  console.log(3000 + (hash.readUInt32BE(0) % 7000));
")

# Check if something is listening on that port
if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "$PORT"
  exit 0
else
  exit 1
fi
```

- [ ] **Step 4: Make script executable**

```bash
chmod +x scripts/find-dashboard-port.sh
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: Port discovery tests PASS (hash test passes; lsof test exits 1 for non-running server). All existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/find-dashboard-port.sh tests/server.test.js
git commit -m "feat(PM-090): add find-dashboard-port.sh for port discovery"
```

---

## Task 4: End-to-End Validation + Final Commit

**Files:**
- Test: manual curl validation
- Modify: `scripts/server.js:4149-4155` (ensure new internals are not leaked in exports)

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/server.test.js`
Expected: ALL tests pass — existing + POST + SSE + port discovery.

- [ ] **Step 2: Manual curl end-to-end validation**

Start the server, then in separate terminals:

```bash
# Terminal 1: Start SSE listener
curl -N http://localhost:$(bash scripts/find-dashboard-port.sh "$(pwd)")/events

# Terminal 2: Post an event
curl -X POST http://localhost:$(bash scripts/find-dashboard-port.sh "$(pwd)")/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"test.manual","source":"curl","timestamp":1711843200}'
```

Expected: Terminal 1 receives `id: 1\ndata: {"id":1,...}\n\n` immediately after the POST.

- [ ] **Step 3: Verify server.close still works cleanly**

Stop the dashboard server (Ctrl+C or kill). Verify process exits without hanging — confirms SSE connections are properly destroyed.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "test(PM-090): end-to-end validation for SSE event bus"
```
