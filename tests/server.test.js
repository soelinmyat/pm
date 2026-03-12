'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary pm/ directory tree and return helpers.
 */
function withPmDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-'));
  const pmDir = path.join(root, 'pm');
  fs.mkdirSync(pmDir, { recursive: true });

  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  return {
    root,
    pmDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Load a fresh copy of server.js (clears require cache each call).
 */
function loadServer() {
  delete require.cache[require.resolve('../scripts/server.js')];
  return require('../scripts/server.js');
}

/**
 * Start the dashboard server on a random port, return { port, close }.
 */
function startDashboardServer(pmDir) {
  return new Promise((resolve, reject) => {
    // Set env vars before loading the module
    process.env.PM_MODE = 'dashboard';
    process.env.PM_DIR = pmDir;
    process.env.PM_PORT = '0'; // random port

    // We can't easily spawn the full startServer() without side effects,
    // so we use the exported createDashboardServer helper instead.
    const mod = loadServer();
    if (!mod.createDashboardServer) {
      reject(new Error('server.js must export createDashboardServer for testing'));
      return;
    }
    const server = mod.createDashboardServer(pmDir);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise(res => server.close(res)),
      });
    });
    server.on('error', reject);
  });
}

/**
 * Make a GET request, return { statusCode, body }.
 */
function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// 1. --mode dashboard flag is parsed
// ---------------------------------------------------------------------------

test('--mode dashboard flag is parsed correctly', () => {
  const mod = loadServer();
  assert.equal(typeof mod.parseMode, 'function', 'parseMode must be exported');
  const mode = mod.parseMode(['node', 'server.js', '--mode', 'dashboard']);
  assert.equal(mode, 'dashboard');
});

// ---------------------------------------------------------------------------
// 2. GET / returns home dashboard HTML with knowledge base stats
// ---------------------------------------------------------------------------

test('GET / returns home dashboard HTML with knowledge base stats', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\n---\n# Market Landscape\n',
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    'pm/backlog/issue-1.md': '---\nstatus: todo\ntitle: Issue 1\n---\n# Issue 1\n',
    'pm/competitors/index.md': '---\ntype: competitor-index\n---\n# Competitors\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('<!DOCTYPE html') || body.includes('<!doctype html'), 'must be a full HTML doc');
      assert.ok(body.includes('dashboard') || body.includes('Dashboard') || body.includes('PM'), 'must mention dashboard or PM');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. GET /landscape reads and renders landscape.md
// ---------------------------------------------------------------------------

test('GET /landscape reads and renders pm/landscape.md', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\ncreated: 2026-03-12\n---\n# Market Landscape\n\nSome landscape content.\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/landscape');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Market Landscape'), 'must render the heading');
      assert.ok(body.includes('landscape content'), 'must render body text');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. GET /competitors returns card grid HTML
// ---------------------------------------------------------------------------

test('GET /competitors returns card grid HTML', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/competitors/index.md': '---\ntype: competitor-index\n---\n# Competitors\n',
    'pm/competitors/acme/overview.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/competitors');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('<!DOCTYPE html') || body.includes('<!doctype html'), 'must be full HTML');
      // Card grid: look for competitor name or a grid/card element
      assert.ok(body.includes('Acme') || body.includes('competitor') || body.includes('grid'), 'must contain competitor or grid content');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5. GET /competitors/acme returns tabbed detail HTML
// ---------------------------------------------------------------------------

test('GET /competitors/acme returns tabbed detail HTML', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/competitors/acme/overview.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp Overview\n',
    'pm/competitors/acme/positioning.md': '---\n---\n# Positioning\n',
    'pm/competitors/acme/features.md': '---\n---\n# Features\n',
    'pm/competitors/acme/pricing.md': '---\n---\n# Pricing\n',
    'pm/competitors/acme/weaknesses.md': '---\n---\n# Weaknesses\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/competitors/acme');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Acme') || body.includes('acme'), 'must reference the competitor');
      // Tabbed: look for tab-like elements or multiple section headings
      assert.ok(
        body.includes('tab') || body.includes('Tab') ||
        body.includes('Overview') || body.includes('overview'),
        'must have tabbed or sectioned layout'
      );
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6. GET /backlog returns kanban HTML grouped by status
// ---------------------------------------------------------------------------

test('GET /backlog returns kanban HTML grouped by status', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/issue-1.md': '---\nstatus: todo\ntitle: First Issue\n---\n# First Issue\n',
    'pm/backlog/issue-2.md': '---\nstatus: in-progress\ntitle: In Progress Issue\n---\n# In Progress Issue\n',
    'pm/backlog/issue-3.md': '---\nstatus: done\ntitle: Done Issue\n---\n# Done Issue\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('todo') || body.includes('Todo') || body.includes('TODO'), 'must show todo column');
      assert.ok(body.includes('in-progress') || body.includes('In Progress') || body.includes('in_progress'), 'must show in-progress column');
      assert.ok(body.includes('done') || body.includes('Done') || body.includes('DONE'), 'must show done column');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 7. GET /research returns topic list HTML
// ---------------------------------------------------------------------------

test('GET /research returns topic list HTML', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/index.md': '---\ntype: research-index\n---\n# Research Topics\n',
    'pm/research/user-interviews/findings.md': '---\ntopic: user-interviews\n---\n# User Interview Findings\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/research');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Research') || body.includes('research'), 'must mention research');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// YAML frontmatter parsing tests (unit tests on the exported parser)
// ---------------------------------------------------------------------------

function getFrontmatterParser() {
  const mod = loadServer();
  assert.equal(typeof mod.parseFrontmatter, 'function', 'parseFrontmatter must be exported');
  return mod.parseFrontmatter;
}

// ---------------------------------------------------------------------------
// 8. YAML frontmatter: flat key-value pairs
// ---------------------------------------------------------------------------

test('YAML frontmatter parses flat key-value pairs correctly', () => {
  const parseFrontmatter = getFrontmatterParser();
  const content = `---
type: landscape
created: 2026-03-12
title: My Title
---
# Body content
`;
  const { data, body } = parseFrontmatter(content);
  assert.equal(data.type, 'landscape');
  assert.equal(data.created, '2026-03-12');
  assert.equal(data.title, 'My Title');
  assert.ok(body.includes('# Body content'), 'body must contain markdown after frontmatter');
});

// ---------------------------------------------------------------------------
// 9. YAML frontmatter: scalar arrays
// ---------------------------------------------------------------------------

test('YAML frontmatter parses scalar arrays correctly', () => {
  const parseFrontmatter = getFrontmatterParser();
  const content = `---
type: landscape
children:
  - slug-a
  - slug-b
  - slug-c
labels:
  - competitive
  - strategy
---
# Body
`;
  const { data } = parseFrontmatter(content);
  assert.equal(data.type, 'landscape');
  assert.deepEqual(data.children, ['slug-a', 'slug-b', 'slug-c']);
  assert.deepEqual(data.labels, ['competitive', 'strategy']);
});

// ---------------------------------------------------------------------------
// 10. YAML frontmatter: arrays of objects
// ---------------------------------------------------------------------------

test('YAML frontmatter parses arrays of objects correctly', () => {
  const parseFrontmatter = getFrontmatterParser();
  const content = `---
type: research
sources:
  - url: https://example.com/article
    accessed: 2026-03-10
    type: web
  - url: https://another.com/report
    accessed: 2026-03-11
    type: pdf
---
# Body
`;
  const { data } = parseFrontmatter(content);
  assert.equal(data.type, 'research');
  assert.ok(Array.isArray(data.sources), 'sources must be an array');
  assert.equal(data.sources.length, 2);
  assert.equal(data.sources[0].url, 'https://example.com/article');
  assert.equal(data.sources[0].accessed, '2026-03-10');
  assert.equal(data.sources[0].type, 'web');
  assert.equal(data.sources[1].url, 'https://another.com/report');
  assert.equal(data.sources[1].type, 'pdf');
});

// ---------------------------------------------------------------------------
// 11. YAML frontmatter: mixed shapes in one file
// ---------------------------------------------------------------------------

test('YAML frontmatter parses mixed shapes (flat + scalar arrays + array-of-objects) in one file', () => {
  const parseFrontmatter = getFrontmatterParser();
  const content = `---
type: competitor
name: Acme Corp
created: 2026-03-12
labels:
  - saas
  - enterprise
research_refs:
  - topic-a
  - topic-b
sources:
  - url: https://acme.com
    accessed: 2026-03-01
    type: web
---
# Acme Corp
`;
  const { data, body } = parseFrontmatter(content);
  assert.equal(data.type, 'competitor');
  assert.equal(data.name, 'Acme Corp');
  assert.equal(data.created, '2026-03-12');
  assert.deepEqual(data.labels, ['saas', 'enterprise']);
  assert.deepEqual(data.research_refs, ['topic-a', 'topic-b']);
  assert.ok(Array.isArray(data.sources));
  assert.equal(data.sources[0].url, 'https://acme.com');
  assert.ok(body.includes('# Acme Corp'));
});

// ---------------------------------------------------------------------------
// 12. File changes trigger WebSocket reload
// ---------------------------------------------------------------------------

test('File changes in pm/ directory trigger WebSocket reload broadcast', (t, done) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\n---\n# Initial\n',
  });

  const mod = loadServer();
  if (!mod.createDashboardServer) {
    cleanup();
    assert.fail('createDashboardServer must be exported');
    return;
  }

  const server = mod.createDashboardServer(pmDir);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();

    // Connect a WebSocket client manually using raw TCP
    const net = require('net');
    const clientSocket = net.createConnection(port, '127.0.0.1', () => {
      clientSocket.write(
        'GET /ws HTTP/1.1\r\n' +
        'Host: 127.0.0.1\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });

    let receivedData = Buffer.alloc(0);
    let upgraded = false;
    let fileWritten = false;
    let reloadReceived = false;
    let finished = false;
    let writeTimer = null;
    let safetyTimer = null;

    function finish(err) {
      if (finished) return;
      finished = true;
      // Cancel pending timers so they don't fire after cleanup
      if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
      if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
      clientSocket.destroy();
      server.close(() => {
        cleanup();
        done(err);
      });
    }

    clientSocket.on('data', (chunk) => {
      receivedData = Buffer.concat([receivedData, chunk]);
      const str = receivedData.toString('utf8');

      if (!upgraded) {
        if (str.includes('101 Switching Protocols')) {
          upgraded = true;
          receivedData = Buffer.alloc(0); // reset buffer to only hold WS frames
          // Write a change to a pm/ file after a short delay
          writeTimer = setTimeout(() => {
            writeTimer = null;
            if (!finished) {
              fileWritten = true;
              fs.writeFileSync(path.join(pmDir, 'landscape.md'), '---\ntype: landscape\n---\n# Updated\n');
            }
          }, 100);
        }
        return;
      }

      // After upgrade, look for 'reload' in the buffered WS frame data
      // Only count as a valid reload if we've already written the file
      if (!reloadReceived && fileWritten && receivedData.toString('utf8').includes('reload')) {
        reloadReceived = true;
        finish(null);
      }
    });

    clientSocket.on('error', (err) => finish(err));

    // Timeout safety: 4 seconds
    safetyTimer = setTimeout(() => {
      safetyTimer = null;
      if (!reloadReceived) {
        finish(new Error('Timed out waiting for WebSocket reload message'));
      }
    }, 4000);
  });
});

// ---------------------------------------------------------------------------
// 13. Missing pm/ directory returns helpful empty state
// ---------------------------------------------------------------------------

test('Missing pm/ directory returns helpful empty state HTML', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-nopm-'));
  // Do NOT create a pm/ subdir
  const nonExistentPmDir = path.join(root, 'pm');
  try {
    const { port, close } = await startDashboardServer(nonExistentPmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/');
      assert.equal(statusCode, 200);
      assert.ok(
        body.includes('setup') || body.includes('Setup') ||
        body.includes('pm:setup') || body.includes('/pm:setup') ||
        body.includes('get started') || body.includes('Get started'),
        'must show setup/get-started message'
      );
    } finally {
      await close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
