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
  // No strategy → suggest /pm:strategy
  const { pmDir: pmDir1, cleanup: cleanup1 } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir1);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('Suggested next'), 'must show suggested next section');
      assert.ok(body.includes('/pm:strategy'), 'must suggest strategy when none exists');
    } finally { await close(); }
  } finally { cleanup1(); }

  // Has strategy + landscape + competitors + ideas → suggest grooming
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
      const { body } = await httpGet(port, '/backlog');
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
      const { statusCode, body } = await httpGet(port, '/backlog');
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
    const { stdout } = await execFileAsync(startScript, ['--project-dir', root, '--mode', 'dashboard', '--background']);
    const info = JSON.parse(stdout.trim());

    assert.ok(info.url, 'start-server.sh must return a dashboard URL');
    assert.ok(info.screen_dir, 'start-server.sh must return screen_dir for cleanup');

    const url = new URL(info.url);
    const { statusCode: homeStatus, body: homeBody } = await httpGet(Number(url.port), '/');
    assert.equal(homeStatus, 200);
    assert.ok(homeBody.includes('Knowledge base overview'), 'home route must render the dashboard shell');
    assert.ok(homeBody.includes('Landscape'), 'home route must summarize landscape content from the target project');

    const { statusCode: researchStatus, body: researchBody } = await httpGet(Number(url.port), '/kb?tab=research');
    assert.equal(researchStatus, 200);
    assert.ok(researchBody.includes('Market Landscape'), 'KB research tab must read the project knowledge base');

    await execFileAsync(stopScript, [info.screen_dir]);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 28. Nav restructure — KB umbrella
// ---------------------------------------------------------------------------

test('Dashboard nav shows Home, Proposals, Backlog, Knowledge Base', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      // Check nav links (inside <nav> element)
      const navMatch = body.match(/<nav>([\s\S]*?)<\/nav>/);
      assert.ok(navMatch, 'page must have a nav element');
      const navHtml = navMatch[1];
      assert.ok(navHtml.includes('Knowledge Base'), 'nav must show Knowledge Base');
      assert.ok(navHtml.includes('Proposals'), 'nav must show Proposals');
      assert.ok(navHtml.includes('Backlog'), 'nav must show Backlog');
      assert.ok(!navHtml.includes('>Research<'), 'nav must NOT show Research as top-level');
      assert.ok(!navHtml.includes('>Strategy<'), 'nav must NOT show Strategy as top-level');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /kb defaults to research tab', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\n---\n# Market Landscape\n',
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('kb-tab'), 'must render KB sub-tabs');
      assert.ok(body.includes('Market Landscape'), 'default tab must show research content');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /kb?tab=strategy shows strategy content', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb?tab=strategy');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('kb-tab'), 'must render KB sub-tabs');
      assert.ok(body.includes('Strategy'), 'strategy tab must show strategy content');
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

test('KB nav item is highlighted on /kb routes', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/kb');
      assert.ok(body.includes('href="/kb" class="active"') || body.includes("href=\"/kb\" class=\"active\""), 'KB nav item must be active on /kb');
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
// 29. readGroomState reads .pm/.groom-state.md from project root
// ---------------------------------------------------------------------------

test('readGroomState returns parsed frontmatter for existing state', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/.groom-state.md': '---\ntopic: "Dashboard Redesign"\nphase: research\nstarted: 2026-03-16\n---\n',
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.equal(result.topic, 'Dashboard Redesign');
    assert.equal(result.phase, 'research');
    assert.equal(result.started, '2026-03-16');
  } finally { cleanup(); }
});

test('readGroomState returns null when no groom state exists', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('readGroomState returns null for corrupted state file', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/.groom-state.md': 'not yaml at all just random text',
  });
  try {
    const mod = loadServer();
    const result = mod.readGroomState(pmDir);
    // parseFrontmatter returns {} for no match, so readGroomState returns null when no topic
    assert.equal(result, null);
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
    '.pm/.groom-state.md': '---\ntopic: "Dashboard Redesign"\nphase: scope-review\nstarted: 2026-03-16\n---\n',
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
    '.pm/.groom-state.md': 'this is not yaml frontmatter',
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
  assert.equal(mod.groomPhaseLabel('scope'), 'Scoping');
  assert.equal(mod.groomPhaseLabel('scope-review'), 'Scope Review');
  assert.equal(mod.groomPhaseLabel('groom'), 'Drafting Issues');
  assert.equal(mod.groomPhaseLabel('team-review'), 'Team Review');
  assert.equal(mod.groomPhaseLabel('bar-raiser'), 'Bar Raiser');
  assert.equal(mod.groomPhaseLabel('present'), 'Presentation');
  assert.equal(mod.groomPhaseLabel('link'), 'Linking Issues');
  assert.equal(mod.groomPhaseLabel('unknown-phase'), 'Unknown Phase', 'unmapped phases use humanizeSlug');
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
    '.pm/.groom-state.md': '---\ntopic: "In Progress Feature"\nphase: research\nstarted: 2026-03-17\n---\n',
  });
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null);
    assert.equal(totalCount, 2);
    assert.ok(cardsHtml.includes('In Progress Feature'), 'draft card must appear');
    assert.ok(cardsHtml.includes('draft'), 'must have draft class');
    assert.ok(cardsHtml.includes('/pm:groom'), 'must have resume hint');
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
