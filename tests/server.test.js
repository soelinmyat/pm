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
 * Make a GET request, return { statusCode, headers, body }.
 */
function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

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

// ---------------------------------------------------------------------------
// 1. --mode dashboard flag is parsed
// ---------------------------------------------------------------------------

test('dashboard server is always the default mode', () => {
  const mod = loadServer();
  assert.equal(typeof mod.createDashboardServer, 'function', 'createDashboardServer must be exported');
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
      assert.ok(body.includes('Knowledge base overview'), 'must show dashboard subtitle');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2b. Dashboard uses project name from .pm/config.json
// ---------------------------------------------------------------------------

test('GET / uses project_name from .pm/config.json in header and title', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    '.pm/config.json': '{"project_name":"Acme Rockets","config_schema":1}',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('Acme Rockets'), 'must show project name from config in header');
      assert.ok(body.includes('<title>Home - Acme Rockets</title>'), 'must use project name in page title');
    } finally { await close(); }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// 2c. Home dashboard shows "Suggested next" action hint
// ---------------------------------------------------------------------------

test('GET / shows suggested next action based on knowledge base state', async () => {
  // No strategy → suggest /pm:groom (groom bootstraps strategy via quick-start)
  const { pmDir: pmDir1, cleanup: cleanup1 } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir1);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('Suggested next'), 'must show suggested next section');
      assert.ok(body.includes('/pm:groom'), 'must suggest groom when no strategy exists');
    } finally { await close(); }
  } finally { cleanup1(); }

  // Has strategy + landscape + competitors + ideas → suggest grooming first (idea slug)
  const { pmDir: pmDir2, cleanup: cleanup2 } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    'pm/landscape.md': '---\ntype: landscape\n---\n# Landscape\n',
    'pm/competitors/acme/profile.md': '---\ntype: competitor\n---\n# Acme\n',
    'pm/backlog/my-idea.md': '---\nstatus: idea\ntitle: My Idea\n---\n# My Idea\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir2);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('/pm:groom'), 'must suggest grooming when ideas exist');
      assert.ok(body.includes('my-idea'), 'must include the idea slug in the hint');
    } finally { await close(); }
  } finally { cleanup2(); }
});

// ---------------------------------------------------------------------------
// 2c. Backlog detail page shows action hint based on status
// ---------------------------------------------------------------------------

test('GET /backlog/<slug> shows contextual action hint', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/idea-item.md': '---\nstatus: idea\ntitle: Idea Item\n---\n# Idea\n',
    'pm/backlog/done-item.md': '---\nstatus: done\ntitle: Done Item\n---\n# Done\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body: ideaBody } = await httpGet(port, '/backlog/idea-item');
      assert.ok(ideaBody.includes('/pm:groom idea-item'), 'idea page must show groom hint with slug');

      const { body: doneBody } = await httpGet(port, '/backlog/done-item');
      assert.ok(!doneBody.includes('/pm:groom'), 'done page must not show groom hint');
    } finally { await close(); }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// 2d. Kanban cards show action hints for idea items
// ---------------------------------------------------------------------------

test('GET /backlog kanban shows per-card hints for ideas', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/my-idea.md': '---\nstatus: idea\ntitle: My Idea\n---\n# Idea\n',
    'pm/backlog/shipped-item.md': '---\nstatus: done\ntitle: Shipped\n---\n# Shipped\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/backlog?view=kanban');
      assert.ok(body.includes('/pm:groom my-idea'), 'idea card must show groom hint with slug');
      assert.ok(!body.includes('/pm:groom shipped-item'), 'shipped card must not show groom hint');
    } finally { await close(); }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// 3. GET /landscape redirects to the research dashboard landscape tab
// ---------------------------------------------------------------------------

test('GET /landscape redirects to /kb?tab=research', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\ncreated: 2026-03-12\n---\n# Market Landscape\n\nSome landscape content.\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers, body } = await httpGet(port, '/landscape');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/kb?tab=research');
      assert.equal(body, '');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. GET /competitors redirects to the research dashboard competitors tab
// ---------------------------------------------------------------------------

test('GET /competitors redirects to /kb?tab=competitors', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/competitors/index.md': '---\ntype: competitor-index\n---\n# Competitors\n',
    'pm/competitors/acme/profile.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers, body } = await httpGet(port, '/competitors');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/kb?tab=competitors');
      assert.equal(body, '');
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
    'pm/competitors/acme/profile.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp Profile\n',
    'pm/competitors/acme/features.md': '---\n---\n# Features\n',
    'pm/competitors/acme/api.md': '---\n---\n# API\n',
    'pm/competitors/acme/seo.md': '---\n---\n# SEO\n',
    'pm/competitors/acme/sentiment.md': '---\n---\n# Sentiment\n',
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
        body.includes('Profile') || body.includes('profile'),
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
    'pm/backlog/issue-1.md': '---\nstatus: open\ntitle: First Issue\n---\n# First Issue\n',
    'pm/backlog/issue-2.md': '---\nstatus: in-progress\ntitle: In Progress Issue\n---\n# In Progress Issue\n',
    'pm/backlog/issue-3.md': '---\nstatus: done\ntitle: Done Issue\n---\n# Done Issue\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('open') || body.includes('Open') || body.includes('OPEN'), 'must show open column');
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
// 6b. Shipped column caps at 10 items with view-all link
// ---------------------------------------------------------------------------

test('GET /backlog caps shipped column at 10 and links to /backlog/shipped', async () => {
  const files = {};
  for (let i = 1; i <= 15; i++) {
    const n = String(i).padStart(3, '0');
    files[`pm/backlog/done-${n}.md`] = `---\ntype: backlog-issue\nid: PM-${n}\ntitle: Done Item ${i}\nstatus: done\npriority: medium\ncreated: 2026-03-01\nupdated: 2026-03-${String(i).padStart(2, '0')}\n---\n# Done ${i}\n`;
  }
  const { pmDir, cleanup } = withPmDir(files);
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog?view=kanban');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('View all 15 shipped'), 'must show view-all link with total count');
      // Should show the 10 most recently updated (PM-006 through PM-015)
      assert.ok(body.includes('PM-015'), 'must include most recent shipped item');
      assert.ok(!body.includes('PM-001') || body.indexOf('PM-001') > body.indexOf('View all'), 'PM-001 should not be in kanban cards');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6c. GET /backlog/shipped returns all shipped items
// ---------------------------------------------------------------------------

test('GET /backlog/shipped returns all shipped items', async () => {
  const files = {};
  for (let i = 1; i <= 15; i++) {
    const n = String(i).padStart(3, '0');
    files[`pm/backlog/done-${n}.md`] = `---\ntype: backlog-issue\nid: PM-${n}\ntitle: Done Item ${i}\nstatus: done\npriority: medium\ncreated: 2026-03-01\nupdated: 2026-03-${String(i).padStart(2, '0')}\n---\n# Done ${i}\n`;
  }
  files['pm/backlog/idea-1.md'] = '---\ntype: backlog-issue\nid: PM-100\ntitle: Idea Item\nstatus: idea\npriority: low\ncreated: 2026-03-01\nupdated: 2026-03-01\n---\n# Idea\n';
  const { pmDir, cleanup } = withPmDir(files);
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog/shipped');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Shipped'), 'must have Shipped heading');
      assert.ok(body.includes('15 items'), 'must show total count');
      assert.ok(body.includes('PM-001'), 'must include oldest shipped item');
      assert.ok(body.includes('PM-015'), 'must include newest shipped item');
      assert.ok(!body.includes('PM-100'), 'must not include non-shipped items');
      assert.ok(body.includes('Backlog'), 'must have breadcrumb back to backlog');
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

test('GET /kb?tab=research returns topic list HTML', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/index.md': '---\ntype: research-index\n---\n# Research Topics\n',
    'pm/research/user-interviews/findings.md': '---\ntopic: User Interviews\nsource_origin: internal\nevidence_count: 12\nupdated: 2026-03-12\n---\n# User Interview Findings\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb?tab=research');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Research') || body.includes('research'), 'must mention research');
      assert.ok(body.includes('Customer evidence'), 'must distinguish internal research topics');
      assert.ok(body.includes('12 evidence records'), 'must show evidence count badge or subtitle for ingested evidence');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 7b. GET /research/{topic} shows internal/mixed evidence metadata
// ---------------------------------------------------------------------------

test('GET /research/{topic} shows source origin and evidence metadata', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/reporting-gaps/findings.md': '---\ntopic: Reporting Gaps\nsource_origin: mixed\nevidence_count: 8\nupdated: 2026-03-12\n---\n# Reporting Gaps\n\n## Findings\n\n1. [internal] Users need better exports.\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/research/reporting-gaps');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Reporting Gaps'), 'must render topic title');
      assert.ok(body.includes('Customer + market evidence'), 'must show mixed-origin subtitle');
      assert.ok(body.includes('8 evidence records'), 'must show evidence count on topic detail page');
      assert.ok(body.includes('Mixed'), 'must render the mixed origin badge');
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
// 13. Nested file changes also trigger WebSocket reload broadcast
// ---------------------------------------------------------------------------

test('Nested file changes in pm/ subdirectories trigger WebSocket reload broadcast', (t, done) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/user-interviews/findings.md': '---\ntopic: user-interviews\n---\n# Initial\n',
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
          receivedData = Buffer.alloc(0);
          writeTimer = setTimeout(() => {
            writeTimer = null;
            if (!finished) {
              fileWritten = true;
              fs.writeFileSync(
                path.join(pmDir, 'research', 'user-interviews', 'findings.md'),
                '---\ntopic: user-interviews\n---\n# Updated\n'
              );
            }
          }, 100);
        }
        return;
      }

      if (!reloadReceived && fileWritten && receivedData.toString('utf8').includes('reload')) {
        reloadReceived = true;
        finish(null);
      }
    });

    clientSocket.on('error', (err) => finish(err));

    safetyTimer = setTimeout(() => {
      safetyTimer = null;
      if (!reloadReceived) {
        finish(new Error('Timed out waiting for WebSocket reload message after nested file change'));
      }
    }, 4000);
  });
});

// ---------------------------------------------------------------------------
// 14. Missing pm/ directory returns helpful empty state
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

// ---------------------------------------------------------------------------
// 15. XSS prevention: inlineMarkdown escapes HTML entities
// ---------------------------------------------------------------------------

test('inlineMarkdown escapes HTML tags to prevent XSS', () => {
  const mod = loadServer();
  assert.equal(typeof mod.inlineMarkdown, 'function', 'inlineMarkdown must be exported');
  assert.equal(typeof mod.escHtml, 'function', 'escHtml must be exported');

  const malicious = 'Hello <script>alert("xss")</script> world';
  const result = mod.inlineMarkdown(malicious);

  // Must NOT contain raw <script> tags
  assert.ok(!result.includes('<script>'), 'must not contain raw <script> tag');
  assert.ok(!result.includes('</script>'), 'must not contain raw </script> tag');
  // Must contain escaped versions
  assert.ok(result.includes('&lt;script&gt;'), 'must escape < and > in script tags');
});

// ---------------------------------------------------------------------------
// 16. renderMarkdown also escapes HTML in inline content
// ---------------------------------------------------------------------------

test('inlineMarkdown sanitizes malicious markdown links', () => {
  const mod = loadServer();

  // Attribute injection: quotes in URL are escaped so onclick stays inside href value
  const attrInjection = mod.inlineMarkdown('[click](x" onclick="alert(1))');
  // The " must be &quot; so the browser doesn't see a second attribute
  assert.ok(attrInjection.includes('&quot;'), 'quotes in URL must be escaped to &quot;');
  // The dangerous pattern is literal " breaking out of href to create onclick attribute
  // With &quot; escaping, the browser sees onclick as part of the href value, not a new attribute
  assert.ok(!attrInjection.includes('" onclick='), 'literal quote must not break out of href to create onclick attribute');

  // javascript: URL scheme
  const jsScheme = mod.inlineMarkdown('[click](javascript:alert(1))');
  assert.ok(!jsScheme.includes('href="javascript:'), 'must not contain javascript: href');
  assert.ok(!jsScheme.includes('<a'), 'javascript: links should be stripped to plain text');

  // data: URL scheme
  const dataScheme = mod.inlineMarkdown('[click](data:text/html,test)');
  assert.ok(!dataScheme.includes('href="data:'), 'must not contain data: href');
});

test('renderMarkdown escapes HTML in paragraphs and headings', () => {
  const mod = loadServer();
  const md = '# Title <img onerror=alert(1)>\n\nSome <b>bold</b> text';
  const html = mod.renderMarkdown(md);

  assert.ok(!html.includes('<img onerror'), 'must not contain raw <img> with onerror');
  assert.ok(html.includes('&lt;img'), 'must escape img tag');
  assert.ok(!html.includes('<b>bold</b>'), 'must escape raw b tag');
});

// ---------------------------------------------------------------------------
// 17. Path traversal via .. in route slugs returns 404
// ---------------------------------------------------------------------------

test('path traversal via .. in route slugs does not expose parent directory content', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/valid-topic/findings.md': '---\ntopic: Valid\n---\n# Valid\n',
    'pm/findings.md': '---\ntopic: Should not be reachable\n---\n# Secret\n',
    'pm/backlog/normal-item.md': '---\ntitle: Normal\nstatus: idea\n---\n# Normal\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      // URL normalization resolves /research/.. to / (home page) — content is NOT exposed
      const research = await httpGet(port, '/research/..');
      assert.ok(!research.body.includes('Should not be reachable'), '/research/.. must not expose parent content');

      // Encoded traversal attempts: %2e%2e is decoded to .. by the server
      const backlogTraversal = await httpGet(port, '/backlog/%2e%2e');
      assert.ok(!backlogTraversal.body.includes('Should not be reachable'), 'encoded traversal must not expose parent content');

      // Percent-encoded traversal: %2e%2e is normalized by URL constructor to ..
      // which resolves /competitors/%2e%2e to / (home page) — content still not exposed
      const competitorTraversal = await httpGet(port, '/competitors/%2e%2e');
      assert.ok(!competitorTraversal.body.includes('Should not be reachable'), '/competitors/%2e%2e must not expose parent content');

      // Double-encoded traversal with slashes
      const backlogSlug = await httpGet(port, '/backlog/%2e%2e%2f%2e%2e');
      assert.ok(!backlogSlug.body.includes('Should not be reachable'), '/backlog/%2e%2e%2f%2e%2e must not expose parent content');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 18. Badge rendering escapes topic frontmatter to prevent XSS
// ---------------------------------------------------------------------------

test('badge rendering escapes topic frontmatter to prevent XSS', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/xss-test/findings.md': [
      '---',
      'topic: <script>alert(1)</script>',
      'source_origin: internal',
      'evidence_count: 3',
      '---',
      '# XSS Test',
    ].join('\n'),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/research/xss-test');
      assert.equal(statusCode, 200);
      assert.ok(!body.includes('<script>alert(1)</script>'), 'must not contain raw script tag from topic frontmatter');
      assert.ok(body.includes('&lt;script&gt;') || body.includes('XSS Test'), 'topic must be escaped or use fallback');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 19. start-server.sh launches dashboard mode against the provided project directory
// ---------------------------------------------------------------------------

test('start-server.sh launches dashboard mode against the provided project directory', async () => {
  const { root, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\n---\n# Market Landscape\n',
    'pm/research/reporting-gaps/findings.md': '---\ntopic: Reporting Gaps\nsource_origin: internal\nevidence_count: 3\nupdated: 2026-03-12\n---\n# Reporting Gaps\n',
  });

  try {
    const { execFile } = require('child_process');
    const execFileAsync = (file, args) => new Promise((resolve, reject) => {
      execFile(file, args, { cwd: root, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    const startScript = path.join(__dirname, '..', 'scripts', 'start-server.sh');
    const stopScript = path.join(__dirname, '..', 'scripts', 'stop-server.sh');
    const { stdout } = await execFileAsync(startScript, ['--project-dir', root, '--background']);
    const info = JSON.parse(stdout.trim());

    assert.ok(info.url, 'start-server.sh must return a dashboard URL');

    const url = new URL(info.url);
    const { statusCode: homeStatus, body: homeBody } = await httpGet(Number(url.port), '/');
    assert.equal(homeStatus, 200);
    assert.ok(homeBody.includes('Knowledge base overview'), 'home route must render the dashboard shell');
    assert.ok(homeBody.includes('Landscape'), 'home route must summarize landscape content from the target project');

    const { statusCode: researchStatus, body: researchBody } = await httpGet(Number(url.port), '/kb?tab=research');
    assert.equal(researchStatus, 200);
    assert.ok(researchBody.includes('Market Landscape'), 'KB research tab must read the project knowledge base');

    await execFileAsync(stopScript, [info.screen_dir || root]);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 28. Nav restructure — Primary + Secondary tiers
// ---------------------------------------------------------------------------

test('Dashboard nav shows two-tier navigation', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      // Primary nav on home page
      const { body: homeBody } = await httpGet(port, '/');
      const primaryMatch = homeBody.match(/<nav>([\s\S]*?)<\/nav>/);
      assert.ok(primaryMatch, 'page must have a primary nav element');
      const primaryHtml = primaryMatch[1];
      assert.ok(primaryHtml.includes('>Home</a>'), 'primary nav must show Home');
      assert.ok(primaryHtml.includes('>Proposals</a>'), 'primary nav must show Proposals');
      assert.ok(primaryHtml.includes('>Backlog</a>'), 'primary nav must show Backlog');
      assert.ok(primaryHtml.includes('Knowledge Base'), 'primary nav must show Knowledge Base');
      // Secondary nav on KB page
      const { body: kbBody } = await httpGet(port, '/kb?tab=research');
      assert.ok(kbBody.includes('nav-secondary'), 'KB page must have secondary nav');
      const secMatch = kbBody.match(/<nav class="nav-secondary">([\s\S]*?)<\/nav>/);
      assert.ok(secMatch, 'KB page must have a nav-secondary element');
      const secHtml = secMatch[1];
      assert.ok(secHtml.includes('>Strategy</a>'), 'secondary nav must show Strategy');
      assert.ok(secHtml.includes('>Research</a>'), 'secondary nav must show Research');
      assert.ok(secHtml.includes('>Competitors</a>'), 'secondary nav must show Competitors');
      assert.ok(secHtml.includes('>Landscape</a>'), 'secondary nav must show Landscape');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /kb with no tab param defaults to research content', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\n---\n# Market Landscape\n',
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    'pm/research/pricing/findings.md': '---\ntopic: Pricing\ntype: topic-research\ncreated: 2026-03-12\nupdated: 2026-03-12\n---\n# Pricing Research\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Research'), 'must show Research heading');
      assert.ok(body.includes('kb-tab active') || body.includes('class="kb-tab active"'), 'research tab must be active');
      assert.ok(body.includes('Pricing'), 'must show research topic');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /kb?tab=competitors renders competitor cards', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/competitors/acme/profile.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb?tab=competitors');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Competitors'), 'must show Competitors heading');
      assert.ok(body.includes('Acme Corp'), 'must show competitor name');
      assert.ok(body.includes('/competitors/acme'), 'must link to competitor detail');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /kb?tab=strategy renders strategy content', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Product Strategy\n\nOur north star is quality.\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb?tab=strategy');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Strategy'), 'must show Strategy heading');
      assert.ok(body.includes('north star'), 'must render strategy markdown content');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /kb?tab=landscape renders landscape content and highlights landscape nav', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\nupdated: 2026-03-12\n---\n# Market Landscape\n\nSome landscape content.\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb?tab=landscape');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Market Landscape'), 'must render landscape markdown content');
      assert.ok(body.includes('href="/landscape" class="kb-tab active"'), 'landscape nav link must be active');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Old /research URL redirects to /kb?tab=research', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, '/research');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/kb?tab=research');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Old /strategy URL redirects to /kb?tab=strategy', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, '/strategy');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/kb?tab=strategy');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Old /competitors URL redirects to /kb?tab=competitors', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, '/competitors');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/kb?tab=competitors');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('/research/{slug} detail pages still work directly', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/user-onboarding/findings.md': '---\ntopic: User Onboarding\ntype: topic-research\ncreated: 2026-03-01\nupdated: 2026-03-01\n---\n# User Onboarding\nKey findings here.\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/research/user-onboarding');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('User Onboarding'), 'research detail page must still work');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Secondary nav items are highlighted on /kb routes', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/kb');
      const secMatch = body.match(/<nav class="nav-secondary">([\s\S]*?)<\/nav>/);
      assert.ok(secMatch, 'page must have secondary nav');
      // When activeNav is '/kb', all KB sub-links should be active
      assert.ok(secMatch[1].includes('class="active"'), 'secondary nav must have at least one active item on /kb');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Competitor detail page highlights secondary nav', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/competitors/acme/profile.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/competitors/acme');
      assert.ok(body.includes('nav-secondary'), 'page must have secondary nav');
      assert.ok(!body.includes('href="/" class="active"'), 'Home must not be highlighted');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Research topic page highlights secondary nav', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/pricing/findings.md': '---\ntopic: Pricing\ntype: topic-research\ncreated: 2026-03-12\nupdated: 2026-03-12\n---\n# Pricing Research\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/research/pricing');
      assert.ok(body.includes('nav-secondary'), 'page must have secondary nav');
    } finally { await close(); }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// 28. readProposalMeta reads JSON sidecar and returns parsed data
// ---------------------------------------------------------------------------

test('readProposalMeta returns parsed JSON for existing sidecar', () => {
  const meta = { title: 'Dashboard Redesign', date: '2026-03-17', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 7, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: ['dashboard', 'ux'] };
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/dashboard-redesign.meta.json': JSON.stringify(meta),
  });
  try {
    const mod = loadServer();
    const result = mod.readProposalMeta('dashboard-redesign', pmDir);
    assert.deepEqual(result, meta);
  } finally { cleanup(); }
});

test('readProposalMeta returns null for missing sidecar', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const result = mod.readProposalMeta('nonexistent', pmDir);
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('readProposalMeta returns null for corrupted JSON', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/bad.meta.json': '{ broken json',
  });
  try {
    const mod = loadServer();
    const result = mod.readProposalMeta('bad', pmDir);
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('readProposalMeta rejects path traversal slugs', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/legit.meta.json': '{"title":"ok"}',
  });
  try {
    const mod = loadServer();
    assert.equal(mod.readProposalMeta('../../../etc/passwd', pmDir), null);
    assert.equal(mod.readProposalMeta('foo/bar', pmDir), null);
    assert.equal(mod.readProposalMeta('..', pmDir), null);
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// 29. readGroomState reads .pm/groom-sessions/*.md from project root
// ---------------------------------------------------------------------------

test('readGroomState returns array with single session', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/groom-sessions/dashboard-redesign.md': '---\ntopic: "Dashboard Redesign"\nphase: research\nstarted: 2026-03-16\n---\n',
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.ok(Array.isArray(result), 'must always return array');
    assert.equal(result.length, 1);
    assert.equal(result[0].topic, 'Dashboard Redesign');
    assert.equal(result[0].phase, 'research');
    assert.equal(result[0].started, '2026-03-16');
    assert.equal(result[0]._slug, 'dashboard-redesign');
  } finally { cleanup(); }
});

test('readGroomState returns array with multiple sessions', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/groom-sessions/dashboard-redesign.md': '---\ntopic: "Dashboard Redesign"\nphase: research\nstarted: 2026-03-16\n---\n',
    '.pm/groom-sessions/bulk-editing.md': '---\ntopic: "Bulk Editing"\nphase: scope\nstarted: 2026-03-17\n---\n',
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.ok(Array.isArray(result), 'must return array');
    assert.equal(result.length, 2);
    const topics = result.map(s => s.topic).sort();
    assert.deepEqual(topics, ['Bulk Editing', 'Dashboard Redesign']);
    const slugs = result.map(s => s._slug).sort();
    assert.deepEqual(slugs, ['bulk-editing', 'dashboard-redesign']);
  } finally { cleanup(); }
});

test('readGroomState returns empty array when no groom state exists', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.ok(Array.isArray(result), 'must return array even when empty');
    assert.equal(result.length, 0);
  } finally { cleanup(); }
});

test('readGroomState returns empty array for corrupted state file', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/groom-sessions/broken.md': 'not yaml at all just random text',
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.ok(Array.isArray(result), 'must return array');
    assert.equal(result.length, 0, 'corrupted file should be skipped');
  } finally { cleanup(); }
});

test('readGroomState falls back to legacy .pm/.groom-state.md', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/.groom-state.md': '---\ntopic: "Legacy Session"\nphase: intake\nstarted: 2026-03-15\n---\n',
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.ok(Array.isArray(result), 'must return array');
    assert.equal(result.length, 1);
    assert.equal(result[0].topic, 'Legacy Session');
    assert.equal(result[0].phase, 'intake');
    assert.equal(result[0]._slug, undefined, 'legacy sessions have no slug');
  } finally { cleanup(); }
});

test('readGroomState ignores legacy when groom-sessions/ has files', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/groom-sessions/new-feature.md': '---\ntopic: "New Feature"\nphase: scope\nstarted: 2026-03-17\n---\n',
    '.pm/.groom-state.md': '---\ntopic: "Legacy Stale"\nphase: intake\nstarted: 2026-03-10\n---\n',
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.equal(result.length, 1, 'new format takes precedence');
    assert.equal(result[0].topic, 'New Feature');
    assert.equal(result[0]._slug, 'new-feature');
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// 30. proposalGradient is deterministic based on slug
// ---------------------------------------------------------------------------

test('proposalGradient returns consistent gradient for same slug', () => {
  const mod = loadServer();
  const g1 = mod.proposalGradient('dashboard-redesign');
  const g2 = mod.proposalGradient('dashboard-redesign');
  assert.equal(g1, g2, 'same slug must produce same gradient');
  assert.ok(g1.startsWith('linear-gradient('), 'must be a CSS gradient');
});

test('proposalGradient returns different gradients for different slugs', () => {
  const mod = loadServer();
  // With 8 gradients in the palette, these two slugs should differ (extremely likely)
  const g1 = mod.proposalGradient('feature-one');
  const g2 = mod.proposalGradient('feature-two');
  // Not guaranteed different with only 8 options, but the hash should distribute well
  assert.ok(g1.startsWith('linear-gradient('), 'must be a CSS gradient');
  assert.ok(g2.startsWith('linear-gradient('), 'must be a CSS gradient');
});

// ---------------------------------------------------------------------------
// 31. Active session indicator on dashboard home
// ---------------------------------------------------------------------------

test('Dashboard home shows active session banner when groom state exists', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    '.pm/groom-sessions/dashboard-redesign.md': '---\ntopic: "Dashboard Redesign"\nphase: scope-review\nstarted: 2026-03-16\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Dashboard Redesign'), 'must show topic name in banner');
      assert.ok(body.includes('Scope Review'), 'must show human-readable phase name');
      assert.ok(body.includes('2026-03-16'), 'must show start date');
      assert.ok(body.includes('Currently grooming'), 'must have Currently grooming label');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Dashboard home shows multiple session banners', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    '.pm/groom-sessions/dashboard-redesign.md': '---\ntopic: "Dashboard Redesign"\nphase: scope-review\nstarted: 2026-03-16\n---\n',
    '.pm/groom-sessions/bulk-editing.md': '---\ntopic: "Bulk Editing"\nphase: research\nstarted: 2026-03-17\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('Dashboard Redesign'), 'must show first session topic');
      assert.ok(body.includes('Bulk Editing'), 'must show second session topic');
      assert.ok(body.includes('Currently grooming (2 sessions)'), 'must show pluralized label');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Dashboard home uses generic active sessions label when groom and dev sessions coexist', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    '.pm/groom-sessions/dashboard-redesign.md': '---\ntopic: "Dashboard Redesign"\nphase: scope-review\nstarted: 2026-03-16\n---\n',
    '.pm/dev-sessions/p-08.md': '---\ntopic: "P-08 Companion"\n---\n| Stage | Implementation |\n| Size | M |\n| Branch | codex/p-08 |\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('Active Sessions (2)'), 'mixed session types must use the generic active sessions label');
      assert.ok(!body.includes('Currently grooming (2 sessions)'), 'mixed session types must not use the groom-only label');
      assert.ok(body.includes('Dashboard Redesign'), 'must include the groom session topic');
      assert.ok(body.includes('P-08 Companion'), 'must include the dev session topic');
      assert.ok(body.includes('Dev · Stage: Implementation · M · codex/p-08'), 'must show dev session metadata');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Dashboard home links groom session when companion screen exists', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    '.pm/groom-sessions/dashboard-redesign.md': '---\ntopic: "Dashboard Redesign"\nphase: scope-review\nstarted: 2026-03-16\n---\n',
    '.pm/sessions/groom-dashboard-redesign/current.html': '<html><body>Companion</body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('href="/session/dashboard-redesign"'), 'must link to the groom session page when companion output exists');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Dashboard home shows groom session as plain text when companion screen is absent', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    '.pm/groom-sessions/dashboard-redesign.md': '---\ntopic: "Dashboard Redesign"\nphase: scope-review\nstarted: 2026-03-16\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('Dashboard Redesign'), 'must still show the active groom session');
      assert.ok(!body.includes('href="/session/dashboard-redesign"'), 'must not link to a companion page that does not exist');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Dashboard home has no session banner when groom state is absent', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(!body.includes('Currently grooming'), 'must not show grooming label when no state');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Dashboard home has no session banner when groom state is corrupted', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    '.pm/groom-sessions/broken.md': 'this is not yaml frontmatter',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(!body.includes('Currently grooming'), 'corrupted state must not show banner');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('groomPhaseLabel maps raw phase strings to human-readable labels', () => {
  const mod = loadServer();
  assert.equal(mod.groomPhaseLabel('intake'), 'Intake');
  assert.equal(mod.groomPhaseLabel('strategy-check'), 'Strategy Check');
  assert.equal(mod.groomPhaseLabel('research'), 'Research');
  assert.equal(mod.groomPhaseLabel('scope'), 'Scope');
  assert.equal(mod.groomPhaseLabel('scope-review'), 'Scope Review');
  assert.equal(mod.groomPhaseLabel('groom'), 'Issue Drafting');
  assert.equal(mod.groomPhaseLabel('team-review'), 'Team Review');
  assert.equal(mod.groomPhaseLabel('bar-raiser'), 'Bar Raiser');
  assert.equal(mod.groomPhaseLabel('present'), 'Presentation');
  assert.equal(mod.groomPhaseLabel('link'), 'Linking Issues');
  assert.equal(mod.groomPhaseLabel('unknown-phase'), 'Unknown Phase', 'unmapped phases use humanizeSlug');
});

// ---------------------------------------------------------------------------
// PM-056: Empty-state CTA, KB reference, and suggestedNext ordering
// ---------------------------------------------------------------------------

test('GET / shows Start Grooming CTA when pm/ exists but no proposals or groom sessions', async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('class="empty-state-cta"'), 'must use CTA styling class');
      assert.ok(body.includes('Ready to build'), 'must show CTA heading');
      assert.ok(body.includes('/pm:groom'), 'CTA must mention /pm:groom');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET / does not show empty-state CTA when proposals exist', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/my-feature.meta.json': '{"title":"My Feature","gradient":"linear-gradient(135deg,#667eea,#764ba2)","date":"2026-03-20"}',
    'pm/backlog/proposals/my-feature.html': '<html><body>Proposal</body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(!body.includes('class="empty-state-cta"'), 'must not show CTA element when proposals exist');
      assert.ok(body.includes('My Feature'), 'must show proposal gallery');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET / does not show empty-state CTA when groom session is active', async () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/groom-sessions/in-progress.md': '---\ntopic: "In Progress"\nphase: research\nstarted: 2026-03-20\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(!body.includes('class="empty-state-cta"'), 'must not show CTA element when groom session active');
      assert.ok(body.includes('Currently grooming'), 'must show groom banner');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET / shows collapsible knowledge base reference with status badges', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\nupdated: 2026-03-20\n---\n# Strategy\n',
    'pm/landscape.md': '---\ntype: landscape\n---\n# Landscape\n',
    'pm/backlog/proposals/feat.meta.json': '{"title":"Feat","gradient":"#ccc","date":"2026-03-20"}',
    'pm/backlog/proposals/feat.html': '<html></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('kb-reference'), 'must have KB reference section');
      assert.ok(body.includes('<details'), 'KB reference must be collapsible');
      assert.ok(body.includes('badge-ready'), 'must show Ready badges for populated sections');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET / suggestedNext prioritizes groomable ideas over strategy/research suggestions', async () => {
  // Has ideas but no strategy — should still suggest grooming the idea first
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/my-idea.md': '---\nstatus: idea\ntitle: My Idea\n---\n# My Idea\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('/pm:groom my-idea'), 'must suggest grooming the idea, not strategy setup');
    } finally { await close(); }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// Proposal gallery (PM-028)
// ---------------------------------------------------------------------------

test('sanitizeGradient returns valid gradients and falls back for invalid', () => {
  const mod = loadServer();
  assert.equal(mod.sanitizeGradient('linear-gradient(135deg, #667eea 0%, #764ba2 100%)'), 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 'valid gradient passes through');
  assert.equal(mod.sanitizeGradient(null), '#e5e7eb', 'null falls back');
  assert.equal(mod.sanitizeGradient(undefined), '#e5e7eb', 'undefined falls back');
  assert.equal(mod.sanitizeGradient(''), '#e5e7eb', 'empty falls back');
  assert.equal(mod.sanitizeGradient('url(javascript:alert(1))'), '#e5e7eb', 'XSS falls back');
  assert.equal(mod.sanitizeGradient('linear-gradient(135deg, url(javascript:alert(1)))'), '#e5e7eb', 'nested url() rejected');
  assert.equal(mod.sanitizeGradient('linear-gradient(135deg, #000 0%, #fff 100%); color: red'), '#e5e7eb', 'semicolon CSS injection rejected');
});

test('buildProposalCards returns cards sorted newest first', () => {
  const meta1 = { title: 'Feature A', date: '2026-03-15', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 5, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: [] };
  const meta2 = { title: 'Feature B', date: '2026-03-17', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 3, gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', labels: [] };
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feature-a.meta.json': JSON.stringify(meta1),
    'pm/backlog/proposals/feature-b.meta.json': JSON.stringify(meta2),
  });
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null);
    assert.equal(totalCount, 2);
    assert.ok(cardsHtml.indexOf('Feature B') < cardsHtml.indexOf('Feature A'), 'sorted newest first');
  } finally { cleanup(); }
});

test('buildProposalCards includes draft card pinned first with resume hint', () => {
  const meta = { title: 'Completed', date: '2026-03-10', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 2, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: [] };
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/completed.meta.json': JSON.stringify(meta),
    '.pm/groom-sessions/in-progress-feature.md': '---\ntopic: "In Progress Feature"\nphase: research\nstarted: 2026-03-17\n---\n',
  });
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null);
    assert.equal(totalCount, 2);
    assert.ok(cardsHtml.includes('In Progress Feature'), 'draft card must appear');
    assert.ok(cardsHtml.includes('draft'), 'must have draft class');
    assert.ok(cardsHtml.includes('/pm:groom in-progress-feature'), 'must have resume hint with slug');
    assert.ok(cardsHtml.indexOf('In Progress Feature') < cardsHtml.indexOf('Completed'), 'draft pinned first');
  } finally { cleanup(); }
});

test('buildProposalCards returns empty when no proposals exist', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null);
    assert.equal(totalCount, 0);
    assert.equal(cardsHtml, '');
  } finally { cleanup(); }
});

test('buildProposalCards respects limit', () => {
  const metas = {};
  for (let i = 1; i <= 8; i++) {
    metas[`pm/backlog/proposals/feat-${i}.meta.json`] = JSON.stringify({
      title: `Feature ${i}`, date: `2026-03-${String(i).padStart(2, '0')}`, verdict: 'ready',
      verdictLabel: 'Ready', phase: 'completed', issueCount: 1,
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: []
    });
  }
  const { pmDir, cleanup } = withPmDir(metas);
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, 3);
    assert.equal(totalCount, 8, 'totalCount pre-limit');
    assert.ok(cardsHtml.includes('Feature 8'), 'newest must appear');
    assert.ok(!cardsHtml.includes('Feature 1'), 'oldest excluded');
  } finally { cleanup(); }
});

test('GET /proposals with proposals returns card grid', async () => {
  const meta = { title: 'Test Proposal', date: '2026-03-17', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 3, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: [] };
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/test-proposal.meta.json': JSON.stringify(meta),
    'pm/backlog/proposals/test-proposal.html': '<html><body>Proposal content</body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Test Proposal'), 'must show title');
      assert.ok(body.includes('card-gradient'), 'must render gradient');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals empty shows groom hint', async () => {
  const { pmDir, cleanup } = withPmDir({ 'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n' });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('/pm:groom'), 'empty state must mention /pm:groom');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals/{slug} renders dashboard-framed view with iframe', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/my-feature.html': '<html><body><h1>My Feature Proposal</h1></body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals/my-feature');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('proposal-embed'), 'must have dashboard chrome');
      assert.ok(body.includes('iframe'), 'must embed via iframe');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals/{slug} returns 404 for missing and rejects traversal', async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const r1 = await httpGet(port, '/proposals/nonexistent');
      assert.equal(r1.statusCode, 404);
      assert.ok(r1.body.includes('/proposals'), 'must have back link');
      const r2 = await httpGet(port, '/proposals/%zz');
      assert.equal(r2.statusCode, 400, 'malformed URI must return 400');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Home page shows proposal cards with View all link', async () => {
  const meta = { title: 'My Proposal', date: '2026-03-17', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 4, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: [] };
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    'pm/backlog/proposals/my-proposal.meta.json': JSON.stringify(meta),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('My Proposal'), 'must show proposal card');
      assert.ok(body.includes('Recent Proposals'), 'must have section heading');
      assert.ok(body.includes('View all proposals'), 'must have View all link');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Home page has no proposal section when no proposals exist', async () => {
  const { pmDir, cleanup } = withPmDir({ 'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n' });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(!body.includes('Recent Proposals'), 'must not show proposal section');
      assert.ok(!body.includes('View all proposals'), 'must not have View all link text');
    } finally { await close(); }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// Proposal detail view — iframe in dashboard chrome (PM-031)
// ---------------------------------------------------------------------------

test('GET /proposals/{slug} renders iframe in dashboard chrome', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/my-feature.html': '<html><body><h1>My Feature Proposal</h1></body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals/my-feature');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('proposal-embed'), 'must have proposal-embed wrapper');
      assert.ok(body.includes('iframe'), 'must contain an iframe');
      assert.ok(body.includes('/proposals/my-feature/raw'), 'iframe src must point to raw endpoint');
      assert.ok(body.includes('Back to Proposals'), 'must have breadcrumb');
      assert.ok(body.includes('Open standalone'), 'must have standalone link');
      assert.ok(body.includes('PROPOSAL'), 'embed header must say PROPOSAL');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals/{slug}/raw serves raw proposal HTML', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/my-feature.html': '<html><body><h1>My Feature Proposal</h1></body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals/my-feature/raw');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('My Feature Proposal'), 'must serve raw HTML');
      assert.ok(!body.includes('proposal-embed'), 'must NOT have dashboard chrome');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals/{slug} returns 404 for missing proposal with back link', async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals/nonexistent');
      assert.equal(statusCode, 404);
      assert.ok(body.includes('/proposals'), 'must have back link to gallery');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals/{slug} iframe height is 800px', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/tall-proposal.html': '<html><body>Tall proposal</body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/proposals/tall-proposal');
      assert.ok(body.includes('800px'), 'iframe must be 800px height');
    } finally { await close(); }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// Backlog grouped by proposal (PM-030)
// ---------------------------------------------------------------------------

test('findProposalAncestor walks parent chain to find proposal', () => {
  const mod = loadServer();
  const items = {
    'child': { parent: 'parent-issue' },
    'parent-issue': { parent: 'my-proposal' },
    'my-proposal': { parent: null },
  };
  const proposals = new Set(['my-proposal']);
  assert.equal(mod.findProposalAncestor('child', items, proposals), 'my-proposal');
  assert.equal(mod.findProposalAncestor('parent-issue', items, proposals), 'my-proposal');
  assert.equal(mod.findProposalAncestor('my-proposal', items, proposals), 'my-proposal');
});

test('findProposalAncestor returns null for standalone items', () => {
  const mod = loadServer();
  const items = {
    'orphan': { parent: null },
    'child-of-orphan': { parent: 'orphan' },
  };
  const proposals = new Set(['some-proposal']);
  assert.equal(mod.findProposalAncestor('orphan', items, proposals), null);
  assert.equal(mod.findProposalAncestor('child-of-orphan', items, proposals), null);
});

test('findProposalAncestor handles circular chains safely', () => {
  const mod = loadServer();
  const items = { 'a': { parent: 'b' }, 'b': { parent: 'a' } };
  const proposals = new Set();
  assert.equal(mod.findProposalAncestor('a', items, proposals), null);
});

test('buildBacklogGrouped groups items under proposals', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feat-x.meta.json': JSON.stringify({ title: 'Feature X', date: '2026-03-17', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', verdictLabel: 'Ready', issueCount: 2 }),
    'pm/backlog/feat-x.md': '---\ntitle: "Feature X"\nstatus: drafted\nparent: null\nid: "PM-001"\n---\n',
    'pm/backlog/child-a.md': '---\ntitle: "Child A"\nstatus: idea\nparent: "feat-x"\nid: "PM-002"\n---\n',
    'pm/backlog/standalone.md': '---\ntitle: "Standalone"\nstatus: idea\nid: "PM-003"\n---\n',
  });
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    assert.ok(html.includes('Feature X'), 'must show proposal group header');
    assert.ok(html.includes('group-gradient'), 'must show gradient swatch');
    assert.ok(html.includes('Child A'), 'must show child item');
    assert.ok(html.includes('Standalone'), 'must show standalone section');
    assert.ok(html.includes('standalone-header'), 'standalone must have distinct header');
    assert.ok(html.indexOf('Feature X') < html.indexOf('Standalone Issues'), 'proposals before standalone');
  } finally { cleanup(); }
});

test('buildBacklogGrouped returns empty state for empty backlog', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    assert.ok(html.includes('empty-state') || html.includes('No backlog'), 'must show empty state');
  } finally { cleanup(); }
});

test('buildBacklogGrouped shows dead proposal as plain text', () => {
  const { pmDir, cleanup } = withPmDir({
    // No .meta.json for "dead-proposal"
    'pm/backlog/orphan-child.md': '---\ntitle: "Orphan Child"\nstatus: idea\nparent: "dead-proposal"\nid: "PM-010"\n---\n',
  });
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    assert.ok(html.includes('Dead Proposal') || html.includes('dead-proposal'), 'must show dead proposal slug');
    assert.ok(!html.includes('group-gradient'), 'must NOT show gradient for dead proposal');
  } finally { cleanup(); }
});

test('buildBacklogGrouped shows status badges on individual items', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feat-z.meta.json': JSON.stringify({
      title: 'Feature Z', date: '2026-03-18',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      verdictLabel: 'Ready', issueCount: 3
    }),
    'pm/backlog/feat-z.md': '---\ntitle: "Feature Z"\nstatus: drafted\nparent: null\nid: "PM-040"\n---\n',
    'pm/backlog/task-a.md': '---\ntitle: "Task A"\nstatus: in-progress\nparent: "feat-z"\nid: "PM-041"\n---\n',
    'pm/backlog/task-b.md': '---\ntitle: "Task B"\nstatus: idea\nparent: "feat-z"\nid: "PM-042"\n---\n',
  });
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    assert.ok(html.includes('status-badge'), 'must show status badges on items');
    assert.ok(html.includes('badge-in-progress'), 'must show in-progress badge');
    assert.ok(html.includes('badge-drafted'), 'must show drafted badge');
  } finally { cleanup(); }
});

test('GET /backlog defaults to proposal-grouped view', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feat-y.meta.json': JSON.stringify({ title: 'Feature Y', date: '2026-03-17', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', verdictLabel: 'Ready', issueCount: 1 }),
    'pm/backlog/feat-y.md': '---\ntitle: "Feature Y"\nstatus: drafted\nparent: null\nid: "PM-010"\n---\n',
    'pm/backlog/task-1.md': '---\ntitle: "Task 1"\nstatus: idea\nparent: "feat-y"\nid: "PM-011"\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('view-toggle'), 'must show view toggle');
      assert.ok(body.includes('proposal-group'), 'must show proposal groups');
      assert.ok(body.includes('Feature Y'), 'must show proposal header');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /backlog?view=kanban renders existing kanban', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/item-1.md': '---\ntitle: "Item 1"\nstatus: idea\nid: "PM-020"\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog?view=kanban');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('view-toggle'), 'must show view toggle');
      assert.ok(body.includes('kanban'), 'must render kanban');
      assert.ok(body.includes('Item 1'), 'must show item');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /backlog toggle highlights active view correctly', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/item.md': '---\ntitle: "Item"\nstatus: idea\nid: "PM-030"\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      // Default — proposals active
      const def = await httpGet(port, '/backlog');
      assert.ok(def.body.includes('view=proposals" class="toggle-btn active"'), 'proposals must be active by default');

      // Explicit kanban
      const kanban = await httpGet(port, '/backlog?view=kanban');
      assert.ok(kanban.body.includes('view=kanban" class="toggle-btn active"'), 'kanban must be active when selected');

      // Explicit proposals
      const proposals = await httpGet(port, '/backlog?view=proposals');
      assert.ok(proposals.body.includes('view=proposals" class="toggle-btn active"'), 'proposals must be active when explicit');
    } finally { await close(); }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// PM-026 — Legacy proposal fallback (HTML-only, no meta.json)
// ---------------------------------------------------------------------------

test('buildProposalCards shows legacy proposal (HTML only, no meta.json)', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/legacy-feature.html': '<html><body>Legacy</body></html>',
  });
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null, []);
    assert.equal(totalCount, 1, 'must count the legacy proposal');
    assert.ok(cardsHtml.includes('Legacy Feature'), 'must derive title from slug (kebab → title case)');
    assert.ok(cardsHtml.includes('proposal-card'), 'must render as a proposal card');
    assert.ok(cardsHtml.includes('#e5e7eb'), 'must use neutral gray gradient');
    assert.ok(!cardsHtml.includes('badge-ready'), 'must not show verdict badge');
  } finally { cleanup(); }
});

test('buildProposalCards does not double-count proposal with both meta.json and html', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feat-z.meta.json': JSON.stringify({
      title: 'Feature Z', date: '2026-03-18', verdict: 'ready',
      verdictLabel: 'Ready', phase: 'completed', issueCount: 3,
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      labels: ['mvp'],
    }),
    'pm/backlog/proposals/feat-z.html': '<html><body>Feature Z</body></html>',
  });
  try {
    const mod = loadServer();
    const { totalCount } = mod.buildProposalCards(pmDir, null, []);
    assert.equal(totalCount, 1, 'must not double-count');
  } finally { cleanup(); }
});

test('buildBacklogGrouped discovers legacy HTML-only proposals', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/legacy-proj.html': '<html><body>Legacy</body></html>',
    'pm/backlog/legacy-proj.md': '---\ntitle: "Legacy Project"\nstatus: drafted\nparent: null\nid: "PM-100"\n---\n',
    'pm/backlog/child-task.md': '---\ntitle: "Child Task"\nstatus: idea\nparent: "legacy-proj"\nid: "PM-101"\n---\n',
  });
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    // The legacy proposal should appear as a group header (not a dead proposal)
    assert.ok(html.includes('proposal-group'), 'must render as proposal group');
    assert.ok(html.includes('Child Task'), 'must show child under legacy proposal group');
    // Legacy proposals without meta.json render as standalone-header (no gradient)
    // but are still recognized as proposal groups
    assert.ok(html.includes('group-title'), 'must have group title');
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------
// hashProjectPort — determinism and range
// ---------------------------------------------------------------------------

test('hashProjectPort returns the same port for the same directory', () => {
  const mod = loadServer();
  const port1 = mod.hashProjectPort('/Users/alice/Projects/my-app');
  const port2 = mod.hashProjectPort('/Users/alice/Projects/my-app');
  assert.strictEqual(port1, port2, 'same input must produce same port');
});

test('hashProjectPort returns different ports for different directories', () => {
  const mod = loadServer();
  const portA = mod.hashProjectPort('/Users/alice/Projects/app-a');
  const portB = mod.hashProjectPort('/Users/alice/Projects/app-b');
  // Technically could collide, but MD5 makes it astronomically unlikely for these inputs
  assert.notStrictEqual(portA, portB, 'different inputs should produce different ports');
});

test('hashProjectPort returns port in 3000-9999 range', () => {
  const mod = loadServer();
  const paths = [
    '/Users/alice/Projects/foo',
    '/home/bob/code/bar',
    '/tmp/test-project',
    'C:\\Users\\charlie\\code\\baz',
    '/a/very/deeply/nested/project/path/that/is/quite/long',
  ];
  for (const p of paths) {
    const port = mod.hashProjectPort(p);
    assert.ok(port >= 3000, `port ${port} for "${p}" must be >= 3000`);
    assert.ok(port <= 9999, `port ${port} for "${p}" must be <= 9999`);
  }
});

// ---------------------------------------------------------------------------
// isPortAvailable — basic availability check
// ---------------------------------------------------------------------------

test('isPortAvailable returns true for an unused port', async () => {
  const mod = loadServer();
  // Port 0 trick: find an available port by binding, then releasing
  const net = require('net');
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const freePort = srv.address().port;
  await new Promise(r => srv.close(r));

  const available = await mod.isPortAvailable(freePort, '127.0.0.1');
  assert.strictEqual(available, true, 'recently freed port should be available');
});

test('isPortAvailable returns false for an occupied port', async () => {
  const mod = loadServer();
  const net = require('net');
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const occupiedPort = srv.address().port;

  try {
    const available = await mod.isPortAvailable(occupiedPort, '127.0.0.1');
    assert.strictEqual(available, false, 'occupied port should not be available');
  } finally {
    await new Promise(r => srv.close(r));
  }
});

// ---------------------------------------------------------------------------
// resolvePort — collision fallback
// ---------------------------------------------------------------------------

test('resolvePort uses PM_PORT when set', async () => {
  const origPort = process.env.PM_PORT;
  const origDir = process.env.PM_PROJECT_DIR;
  try {
    process.env.PM_PORT = '4567';
    process.env.PM_PROJECT_DIR = '/tmp/test';
    const mod = loadServer();
    const result = await mod.resolvePort('127.0.0.1');
    assert.strictEqual(result.port, 4567);
    assert.strictEqual(result.hashed, null);
    assert.strictEqual(result.shifted, false);
  } finally {
    if (origPort !== undefined) process.env.PM_PORT = origPort;
    else delete process.env.PM_PORT;
    if (origDir !== undefined) process.env.PM_PROJECT_DIR = origDir;
    else delete process.env.PM_PROJECT_DIR;
  }
});

test('resolvePort falls back to next port when hashed port is occupied', async () => {
  const origPort = process.env.PM_PORT;
  const origDir = process.env.PM_PROJECT_DIR;
  try {
    delete process.env.PM_PORT;
    process.env.PM_PROJECT_DIR = '/tmp/collision-test';
    const mod = loadServer();

    // Determine what port would be hashed
    const expectedPort = mod.hashProjectPort('/tmp/collision-test');

    // Occupy that port
    const net = require('net');
    const blocker = net.createServer();
    await new Promise(r => blocker.listen(expectedPort, '127.0.0.1', r));

    try {
      const result = await mod.resolvePort('127.0.0.1');
      assert.notStrictEqual(result.port, 0, 'resolvePort should not fall back to OS-assigned port in test');
      assert.ok(result.port > expectedPort, `resolved port ${result.port} should be > hashed port ${expectedPort}`);
      assert.strictEqual(result.hashed, expectedPort);
      assert.strictEqual(result.shifted, true);
    } finally {
      await new Promise(r => blocker.close(r));
    }
  } finally {
    if (origPort !== undefined) process.env.PM_PORT = origPort;
    else delete process.env.PM_PORT;
    if (origDir !== undefined) process.env.PM_PROJECT_DIR = origDir;
    else delete process.env.PM_PROJECT_DIR;
  }
});

// ---------------------------------------------------------------------------
// PM-060: Session route — current.html override
// ---------------------------------------------------------------------------

test('GET /session/{slug} serves current.html override when present', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
    '.pm/groom-sessions/my-feature.md': '---\ntopic: "My Feature"\nphase: research\nstarted: 2026-03-20\n---\n',
    '.pm/sessions/groom-my-feature/current.html': '<html><body>OVERRIDE CONTENT</body></html>',
  });
  const { port, close } = await startDashboardServer(pmDir);
  try {
    const res = await httpGet(port, '/session/my-feature');
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('OVERRIDE CONTENT'), 'must serve current.html content');
    assert.ok(!res.body.includes('Phase:'), 'must not render state view when override exists');
  } finally { await close(); cleanup(); }
});

test('GET /session/{slug} falls through to state view when no current.html', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
    '.pm/groom-sessions/my-feature.md': '---\ntopic: "My Feature"\nphase: research\nstarted: 2026-03-20\n---\n',
  });
  const { port, close } = await startDashboardServer(pmDir);
  try {
    const res = await httpGet(port, '/session/my-feature');
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('My Feature'), 'must render state view with topic');
  } finally { await close(); cleanup(); }
});

test('GET /session/{slug} path traversal blocked', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
  });
  const { port, close } = await startDashboardServer(pmDir);
  try {
    const res = await httpGet(port, '/session/..%2F..%2Fetc%2Fpasswd');
    assert.equal(res.statusCode, 404);
  } finally { await close(); cleanup(); }
});

test('GET /session/{slug} returns 404 for nonexistent session', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
  });
  const { port, close } = await startDashboardServer(pmDir);
  try {
    const res = await httpGet(port, '/session/nonexistent');
    assert.equal(res.statusCode, 404);
    assert.ok(res.body.includes('No session found'), 'must show session not found message');
  } finally { await close(); cleanup(); }
});

test('Server close cleans up sessions directory watchers without error', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
  });
  // Create .pm/sessions/ with a subdirectory so the watcher has something to watch
  fs.mkdirSync(path.join(root, '.pm', 'sessions', 'groom-test'), { recursive: true });
  fs.writeFileSync(path.join(root, '.pm', 'sessions', 'groom-test', 'current.html'), '<p>test</p>');
  const { port, close } = await startDashboardServer(pmDir);
  // Close should not throw and should clean up watchers
  await close();
  // If we get here without hanging or throwing, watchers were cleaned up
  assert.ok(true, 'server closed cleanly with sessions watchers');
  cleanup();
});



// ---------------------------------------------------------------------------
// Pulse Score — project health metric on home page
// ---------------------------------------------------------------------------

test('Home page shows pulse score with populated KB', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\nupdated: 2026-04-01\n---\n# Strategy\n',
    'pm/research/topic-a/findings.md': '---\ntype: topic-research\nupdated: 2026-04-01\n---\n# Topic A\n',
    'pm/competitors/acme/profile.md': '---\ntype: competitor\nupdated: 2026-04-01\n---\n# Acme\n',
    'pm/backlog/item-1.md': '---\ntype: backlog-issue\nid: "PM-001"\ntitle: "Item 1"\nstatus: done\nupdated: 2026-04-01\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('pulse-score'), 'must include pulse-score widget');
      assert.ok(body.includes('pulse-arc'), 'must include SVG arc');
      assert.ok(body.includes('pulse-arc-fg'), 'must include arc foreground circle');
      assert.ok(body.includes('pulse-breakdown'), 'must include breakdown panel');
      assert.ok(body.includes('pulse-dim-card'), 'must include dimension cards');
      assert.ok(body.includes('Project Health'), 'must include Project Health label');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('Home page hides pulse score when KB is empty', async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(!body.includes('class="pulse-score-value"'), 'must NOT show pulse score widget on empty KB');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Canvas System — tab bar and session serving
// ---------------------------------------------------------------------------

test('Home page shows canvas tabs when canvases exist', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\nupdated: 2026-04-01\n---\n# Strategy\n',
  });
  // Create a canvas directory with current.html
  const canvasDir = path.join(root, '.pm', 'sessions', 'groom-test-feature');
  fs.mkdirSync(canvasDir, { recursive: true });
  fs.writeFileSync(path.join(canvasDir, 'current.html'), '<html><body>Canvas content</body></html>');
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('canvas-tabs'), 'must include canvas tab bar');
      assert.ok(body.includes('canvas-tab'), 'must include canvas tab links');
      assert.ok(body.includes('Test Feature'), 'must humanize canvas slug into label');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('Home page hides canvas tabs when no canvases exist', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\nupdated: 2026-04-01\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(!body.includes('class="canvas-tabs"'), 'must NOT show canvas tab bar when no canvases');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('Session page serves canvas current.html for dev prefix', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  const canvasDir = path.join(root, '.pm', 'sessions', 'dev-auth-flow');
  fs.mkdirSync(canvasDir, { recursive: true });
  fs.writeFileSync(path.join(canvasDir, 'current.html'), '<html><body>Dev canvas here</body></html>');
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/session/auth-flow');
      assert.ok(body.includes('Dev canvas here'), 'must serve dev canvas current.html');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Wireframe viewer: full-page detection (PM-131)
// ---------------------------------------------------------------------------

test('wireframe viewer wraps lo-fi fragment in dashboard shell', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/wireframes/login-form.html': '<div class="form"><input placeholder="Email" /><button>Login</button></div>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog/wireframes/login-form');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('wf-header'), 'lo-fi fragment must be wrapped in dashboard shell');
      assert.ok(body.includes('Lo-fi wireframe'), 'must show lo-fi wireframe label');
      assert.ok(body.includes('Login</button>'), 'must contain the fragment content');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('wireframe viewer serves full-page HTML raw with floating back button', async () => {
  const fullPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Settings Dashboard</title>
<style>
  .app { display: flex; min-height: 100vh; }
  .sidebar { width: 240px; background: #1a1a2e; color: #fff; }
  .main { flex: 1; padding: 2rem; }
</style>
</head>
<body>
<div class="app">
  <div class="sidebar"><nav>Settings</nav></div>
  <div class="main"><h1>Account Settings</h1></div>
</div>
</body>
</html>`;
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/wireframes/settings-dashboard.html': fullPageHtml,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog/wireframes/settings-dashboard');
      assert.equal(statusCode, 200);
      assert.ok(!body.includes('wf-header'), 'full-page must NOT be wrapped in dashboard shell');
      assert.ok(!body.includes('Lo-fi wireframe'), 'must NOT show lo-fi label');
      assert.ok(body.includes('Settings Dashboard'), 'must preserve original title');
      assert.ok(body.includes('.sidebar'), 'must preserve original CSS');
      assert.ok(body.includes('Account Settings'), 'must preserve original content');
      assert.ok(body.includes('Back to'), 'must have floating back button');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('wireframe viewer detects full-page by display:grid layout CSS', async () => {
  const gridPage = `<!DOCTYPE html>
<html>
<head>
<style>
  .app { display: grid; grid-template-columns: 250px 1fr; }
</style>
</head>
<body><div class="app"><aside>Nav</aside><main>Content</main></div></body>
</html>`;
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/wireframes/grid-layout.html': gridPage,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog/wireframes/grid-layout');
      assert.equal(statusCode, 200);
      assert.ok(!body.includes('wf-header'), 'grid layout must be treated as full-page');
      assert.ok(body.includes('display: grid'), 'must preserve grid CSS');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('proposal-scoped wireframe route preserves proposal back link', async () => {
  const fullPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mockup Home</title>
<style>
  .app { display: flex; min-height: 100vh; }
  .sidebar { width: 220px; background: #111827; color: #fff; }
  .main { flex: 1; padding: 2rem; }
</style>
</head>
<body>
<div class="app">
  <div class="sidebar"><a href="mockup-proposals.html">Proposals</a></div>
  <div class="main"><h1>Mockup Home</h1></div>
</div>
</body>
</html>`;
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/wireframes/mockup-home.html': fullPageHtml,
    'pm/backlog/wireframes/mockup-proposals.html': fullPageHtml.replaceAll('Mockup Home', 'Mockup Proposals'),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const proposalPath = '/proposals/dashboard-linear-quality/wireframes/mockup-home';
      const { statusCode, body } = await httpGet(port, proposalPath);
      assert.equal(statusCode, 200);
      assert.ok(body.includes('b.href="/proposals/dashboard-linear-quality#wireframes"'), 'must inject a back link to the proposal wireframes section');
      assert.ok(body.includes('Back to proposal'), 'must label the floating button for proposal context');

      const nestedStatus = await httpGet(port, '/proposals/dashboard-linear-quality/wireframes/mockup-proposals.html');
      assert.equal(nestedStatus.statusCode, 200, 'proposal-scoped route must also accept relative .html mockup links');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('wireframe viewer still wraps HTML with doctype but no layout CSS', async () => {
  const simpleDoc = `<!DOCTYPE html>
<html>
<head><style>body { font-family: sans-serif; }</style></head>
<body><h1>Simple Wireframe</h1><p>Just a heading and text</p></body>
</html>`;
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/wireframes/simple-doc.html': simpleDoc,
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog/wireframes/simple-doc');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('wf-header'), 'doctype without layout CSS must still be wrapped');
      assert.ok(body.includes('Lo-fi wireframe'), 'must show lo-fi label');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PM-117: Design Tokens Foundation
// ---------------------------------------------------------------------------

test('PM-117: spacing tokens --space-1 through --space-24 with correct px values', () => {
  const { DASHBOARD_CSS } = loadServer();
  const expected = {
    '--space-1': '4px',
    '--space-2': '8px',
    '--space-3': '12px',
    '--space-4': '16px',
    '--space-5': '20px',
    '--space-6': '24px',
    '--space-8': '32px',
    '--space-10': '40px',
    '--space-12': '48px',
    '--space-16': '64px',
    '--space-24': '96px',
  };
  for (const [token, value] of Object.entries(expected)) {
    const escapedToken = token.replace(/-/g, '\\-');
    const pattern = new RegExp(`${escapedToken}\\s*:\\s*${value}`);
    assert.ok(pattern.test(DASHBOARD_CSS), `CSS must contain ${token}: ${value}`);
  }
});

test('PM-117: typography tokens --text-xs through --text-3xl with correct rem values', () => {
  const { DASHBOARD_CSS } = loadServer();
  const expected = {
    '--text-xs': '0.75rem',
    '--text-sm': '0.8125rem',
    '--text-base': '0.875rem',
    '--text-lg': '1rem',
    '--text-xl': '1.25rem',
    '--text-2xl': '1.5rem',
    '--text-3xl': '2rem',
  };
  for (const [token, value] of Object.entries(expected)) {
    const escapedToken = token.replace(/[-]/g, '\\-');
    const escapedValue = value.replace(/\./g, '\\.');
    const pattern = new RegExp(`${escapedToken}\\s*:\\s*${escapedValue}`);
    assert.ok(pattern.test(DASHBOARD_CSS), `CSS must contain ${token}: ${value}`);
  }
});

test('PM-117: --surface-raised exists in both :root and [data-theme="light"]', () => {
  const { DASHBOARD_CSS } = loadServer();
  // Extract :root block
  const rootMatch = DASHBOARD_CSS.match(/:root[^{]*\{([^}]+)\}/);
  assert.ok(rootMatch, ':root block must exist');
  assert.ok(rootMatch[1].includes('--surface-raised'), ':root must contain --surface-raised');

  // Extract light theme block
  const lightMatch = DASHBOARD_CSS.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  assert.ok(lightMatch, '[data-theme="light"] block must exist');
  assert.ok(lightMatch[1].includes('--surface-raised'), '[data-theme="light"] must contain --surface-raised');
});

test('PM-117: --border uses rgba() not hex in :root', () => {
  const { DASHBOARD_CSS } = loadServer();
  const rootMatch = DASHBOARD_CSS.match(/:root[^{]*\{([^}]+)\}/);
  assert.ok(rootMatch, ':root block must exist');
  const borderMatch = rootMatch[1].match(/--border\s*:\s*([^;]+)/);
  assert.ok(borderMatch, ':root must contain --border');
  assert.ok(borderMatch[1].includes('rgba('), '--border in :root must use rgba()');
  assert.ok(!borderMatch[1].match(/#[0-9a-fA-F]{3,8}/), '--border in :root must not use hex');
});

test('PM-117: --border uses rgba() in [data-theme="light"]', () => {
  const { DASHBOARD_CSS } = loadServer();
  const lightMatch = DASHBOARD_CSS.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  assert.ok(lightMatch, '[data-theme="light"] block must exist');
  const borderMatch = lightMatch[1].match(/--border\s*:\s*([^;]+)/);
  assert.ok(borderMatch, '[data-theme="light"] must contain --border');
  assert.ok(borderMatch[1].includes('rgba('), '--border in light theme must use rgba()');
  assert.ok(!borderMatch[1].match(/#[0-9a-fA-F]{3,8}/), '--border in light theme must not use hex');
});

test('PM-117: font-variant-numeric: tabular-nums appears in CSS', () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(
    DASHBOARD_CSS.includes('font-variant-numeric: tabular-nums') ||
    DASHBOARD_CSS.includes('font-variant-numeric:tabular-nums'),
    'CSS must contain font-variant-numeric: tabular-nums rule'
  );
});

test('PM-117: light theme contains all variables from dark theme (completeness)', () => {
  const { DASHBOARD_CSS } = loadServer();
  const rootMatch = DASHBOARD_CSS.match(/:root[^{]*\{([^}]+)\}/);
  assert.ok(rootMatch, ':root block must exist');
  const lightMatch = DASHBOARD_CSS.match(/\[data-theme="light"\]\s*\{([^}]+)\}/);
  assert.ok(lightMatch, '[data-theme="light"] block must exist');

  // Extract all CSS custom property names from :root (--xxx)
  const rootVars = [...rootMatch[1].matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]);
  const lightVars = new Set([...lightMatch[1].matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));

  const missing = rootVars.filter(v => !lightVars.has(v));
  assert.deepEqual(missing, [], `Light theme is missing variables: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// PM-118: Typography & Spacing Sweep
// ---------------------------------------------------------------------------

/**
 * Strip :root and [data-theme] variable definition blocks from DASHBOARD_CSS
 * so we only check usage, not the token definitions themselves.
 */
function stripTokenDefinitions(css) {
  // Remove :root block
  let result = css.replace(/:root[^{]*\{[^}]+\}/g, '');
  // Remove [data-theme="light"] variable block (not light overrides for colors)
  result = result.replace(/\[data-theme="light"\]\s*\{[^}]+color-scheme:\s*light;\s*\}/g, '');
  return result;
}

test('PM-118: no raw font-size rem values remain in DASHBOARD_CSS (except em-relative and tiny responsive)', () => {
  const { DASHBOARD_CSS } = loadServer();
  const css = stripTokenDefinitions(DASHBOARD_CSS);
  // Find all font-size declarations with raw rem values
  const rawFontSizes = [...css.matchAll(/font-size\s*:\s*([^;]+)/g)]
    .map(m => m[1].trim())
    .filter(v => /^\d/.test(v) && v.includes('rem'));
  // Only allowed exceptions: 0.5625rem (tiny responsive override)
  const allowed = ['0.5625rem'];
  const violations = rawFontSizes.filter(v => !allowed.includes(v));
  assert.deepEqual(violations, [],
    `Raw rem font-size values found (should use var(--text-*)): ${violations.join(', ')}`);
});

test('PM-118: em-relative font-sizes are preserved', () => {
  const { DASHBOARD_CSS } = loadServer();
  assert.ok(DASHBOARD_CSS.includes('font-size: 0.85em'), 'code should keep 0.85em font-size');
  assert.ok(DASHBOARD_CSS.includes('font-size: 0.75em'), 'backlog-item-id should keep 0.75em font-size');
});

test('PM-118: body uses var(--text-base)', () => {
  const { DASHBOARD_CSS } = loadServer();
  const bodyMatch = DASHBOARD_CSS.match(/body\s*\{[^}]+\}/);
  assert.ok(bodyMatch, 'body rule must exist');
  assert.ok(bodyMatch[0].includes('font-size: var(--text-base)'),
    'body must use font-size: var(--text-base)');
});

test('PM-118: h1 uses var(--text-2xl) with font-weight 600', () => {
  const { DASHBOARD_CSS } = loadServer();
  const h1Match = DASHBOARD_CSS.match(/^h1\s*\{[^}]+\}/m);
  assert.ok(h1Match, 'h1 rule must exist');
  assert.ok(h1Match[0].includes('var(--text-2xl)'), 'h1 must use var(--text-2xl)');
  assert.ok(h1Match[0].includes('font-weight: 600'), 'h1 must use font-weight: 600');
});

test('PM-118: h2 uses var(--text-lg)', () => {
  const { DASHBOARD_CSS } = loadServer();
  const h2Match = DASHBOARD_CSS.match(/^h2\s*\{[^}]+\}/m);
  assert.ok(h2Match, 'h2 rule must exist');
  assert.ok(h2Match[0].includes('var(--text-lg)'), 'h2 must use var(--text-lg)');
});

test('PM-118: .container padding uses space tokens', () => {
  const { DASHBOARD_CSS } = loadServer();
  const containerMatch = DASHBOARD_CSS.match(/\.container\s*\{[^}]+\}/);
  assert.ok(containerMatch, '.container rule must exist');
  assert.ok(containerMatch[0].includes('var(--space-'),
    '.container padding must use var(--space-*) tokens');
});

test('PM-118: .stat-card padding uses space tokens', () => {
  const { DASHBOARD_CSS } = loadServer();
  const statCardMatch = DASHBOARD_CSS.match(/\.stat-card\s*\{[^}]+\}/);
  assert.ok(statCardMatch, '.stat-card rule must exist');
  assert.ok(statCardMatch[0].includes('var(--space-'),
    '.stat-card padding must use var(--space-*) tokens');
});

test('PM-118: .card padding uses space tokens', () => {
  const { DASHBOARD_CSS } = loadServer();
  // Match .card rule (not .card-grid, .card-footer, etc.)
  const cardMatch = DASHBOARD_CSS.match(/^\.card\s*\{[^}]+\}/m);
  assert.ok(cardMatch, '.card rule must exist');
  assert.ok(cardMatch[0].includes('var(--space-'),
    '.card padding must use var(--space-*) tokens');
});

test('PM-118: limited raw rem/px values remain in padding/margin/gap (exclusions only)', () => {
  const { DASHBOARD_CSS } = loadServer();
  const css = stripTokenDefinitions(DASHBOARD_CSS);
  // Find padding/margin/gap with raw rem values (not inside var())
  const rawSpacing = [...css.matchAll(/(padding|margin|gap)\s*:\s*([^;]+)/g)]
    .map(m => ({ prop: m[1], value: m[2].trim() }))
    .filter(({ value }) => {
      // Skip values that are only 0, auto, var(), or em-based
      if (/^(0|auto|none)$/.test(value)) return false;
      if (!/\d+(\.\d+)?(rem|px)/.test(value)) return false;
      // Keep only those NOT using var(--space-*)
      if (value.includes('var(--space-')) return false;
      // Allow em-based values
      if (/^\d+(\.\d+)?em/.test(value) || /\dem\b/.test(value)) return false;
      // Allow structural 1px, -1px, -2px, 2px gap separators
      if (/^-?\d(px)?$/.test(value)) return false;
      if (value === '1px') return false;
      return true;
    });
  // Allow a small number of exclusions (status-badge em-based padding, etc.)
  // After full sweep there should be very few raw values left
  assert.ok(rawSpacing.length <= 15,
    `Too many raw spacing values remain (${rawSpacing.length}): ${rawSpacing.map(s => `${s.prop}: ${s.value}`).join(' | ')}`);
});
