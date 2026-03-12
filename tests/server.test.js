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
      assert.ok(body.includes('dashboard') || body.includes('Dashboard') || body.includes('PM'), 'must mention dashboard or PM');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. GET /landscape redirects to the research dashboard landscape tab
// ---------------------------------------------------------------------------

test('GET /landscape redirects to /research#landscape', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\ncreated: 2026-03-12\n---\n# Market Landscape\n\nSome landscape content.\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers, body } = await httpGet(port, '/landscape');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/research#landscape');
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

test('GET /competitors redirects to /research#competitors', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/competitors/index.md': '---\ntype: competitor-index\n---\n# Competitors\n',
    'pm/competitors/acme/profile.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers, body } = await httpGet(port, '/competitors');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/research#competitors');
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
// 7. GET /research returns topic list HTML
// ---------------------------------------------------------------------------

test('GET /research returns topic list HTML', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/index.md': '---\ntype: research-index\n---\n# Research Topics\n',
    'pm/research/user-interviews/findings.md': '---\ntopic: User Interviews\nsource_origin: internal\nevidence_count: 12\nupdated: 2026-03-12\n---\n# User Interview Findings\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/research');
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

test('path traversal via .. in route slugs returns 404', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/valid-topic/findings.md': '---\ntopic: Valid\n---\n# Valid\n',
    'pm/findings.md': '---\ntopic: Should not be reachable\n---\n# Secret\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const research = await httpGet(port, '/research/..');
      assert.equal(research.statusCode, 404, '/research/.. must return 404');

      const competitors = await httpGet(port, '/competitors/..');
      assert.equal(competitors.statusCode, 404, '/competitors/.. must return 404');

      const backlog = await httpGet(port, '/backlog/..');
      assert.equal(backlog.statusCode, 404, '/backlog/.. must return 404');
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
    assert.ok(homeBody.includes('PM Dashboard'), 'home route must render the dashboard shell');
    assert.ok(homeBody.includes('Landscape'), 'home route must summarize landscape content from the target project');

    const { statusCode: researchStatus, body: researchBody } = await httpGet(Number(url.port), '/research');
    assert.equal(researchStatus, 200);
    assert.ok(researchBody.includes('Market Landscape'), 'research route must read the project knowledge base');
    assert.ok(researchBody.includes('Customer evidence'), 'research route must render ingested-evidence metadata from the target project');

    await execFileAsync(stopScript, [info.screen_dir]);
  } finally {
    cleanup();
  }
});
