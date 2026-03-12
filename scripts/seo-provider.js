#!/usr/bin/env node
'use strict';

// Zero-dependency SEO provider adapter
// Usage: node seo-provider.js <command> <domain> [options]

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Read .pm/config.json from cwd. Returns parsed object or null if missing.
 */
function loadConfig() {
  const configPath = path.join(process.cwd(), '.pm', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

/**
 * Default transport — thin wrapper around https.request.
 * Signature matches the injected transport used in tests.
 */
const defaultTransport = (options, cb) => https.request(options, cb);

/**
 * Make an HTTPS GET request. Returns a Promise<{ statusCode, headers, body }>.
 * The optional `transport` parameter allows tests to inject a mock.
 */
function httpsGet(options, transport) {
  const _transport = transport || defaultTransport;
  return new Promise((resolve, reject) => {
    const req = _transport(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = chunks.join('');
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers || {}, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Make an HTTPS POST request with a JSON body. Returns a Promise<{ statusCode, headers, body }>.
 * The optional `transport` parameter allows tests to inject a mock.
 */
function httpsPost(options, bodyObj, transport) {
  const _transport = transport || defaultTransport;
  const payload = JSON.stringify(bodyObj);
  const requestOptions = Object.assign({}, options, {
    method: 'POST',
    headers: Object.assign({}, options.headers, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    }),
  });
  return new Promise((resolve, reject) => {
    const req = _transport(requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = chunks.join('');
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers || {}, body });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Ahrefs adapter
// ---------------------------------------------------------------------------

const AHREFS_HOST = 'api.ahrefs.com';

/**
 * Low-level Ahrefs HTTPS GET.
 * endpoint: e.g. '/v3/site-explorer/organic-keywords'
 * params: object of query string params
 * apiKey: Bearer token string
 * transport: optional mock transport
 */
function ahrefsRequest(endpoint, params, apiKey, transport) {
  const query = new URLSearchParams(params).toString();
  const fullPath = query ? `${endpoint}?${query}` : endpoint;
  const options = {
    hostname: AHREFS_HOST,
    port: 443,
    path: fullPath,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  };
  return httpsGet(options, transport);
}

/**
 * Perform a request, retrying once on 429.
 * opts.retryDelay overrides the Retry-After header value (in ms) — used in tests.
 */
async function ahrefsRequestWithRetry(endpoint, params, apiKey, transport, opts) {
  const { retryDelay } = opts || {};

  const first = await ahrefsRequest(endpoint, params, apiKey, transport);
  if (first.statusCode !== 429) {
    return first;
  }

  // Determine delay: opt override (ms) > Retry-After header (seconds->ms) > 5s
  const retryAfterHeader = parseInt(first.headers['retry-after'] || '5', 10);
  const delayMs = retryDelay !== undefined ? retryDelay : retryAfterHeader * 1000;
  await sleep(delayMs);

  const second = await ahrefsRequest(endpoint, params, apiKey, transport);
  if (second.statusCode !== 429) {
    return second;
  }

  // Both attempts hit 429
  return {
    statusCode: 429,
    body: { error: 'rate_limited', retry_after: retryAfterHeader },
  };
}

/**
 * Extract the api_key from a config object.
 * Throws a descriptive error if missing.
 */
function getApiKey(config) {
  const key = config && config.integrations && config.integrations.seo && config.integrations.seo.api_key;
  if (!key) throw new Error('Missing seo.api_key in config');
  return key;
}

/**
 * Parse an Ahrefs response. On non-200 status, returns { error: "..." }.
 * On 429 that survived retries, passes through the { error, retry_after } body.
 */
function parseResponse(response) {
  if (response.statusCode === 200) {
    return response.body;
  }
  if (response.statusCode === 429 && response.body && response.body.error === 'rate_limited') {
    return response.body;
  }
  const message =
    (response.body && (response.body.message || response.body.error)) ||
    `HTTP ${response.statusCode}`;
  return { error: message };
}

// ---------------------------------------------------------------------------
// DataForSEO adapter
// ---------------------------------------------------------------------------

const DATAFORSEO_HOST = 'api.dataforseo.com';

/**
 * Extract DataForSEO credentials (login + password) from config.
 * Throws a descriptive error if missing.
 */
function getDataForSEOCreds(config) {
  const seo = config && config.integrations && config.integrations.seo;
  const login = seo && seo.login;
  const password = seo && seo.password;
  if (!login || !password) throw new Error('Missing seo.login or seo.password in config');
  return { login, password };
}

/**
 * Low-level DataForSEO HTTPS POST.
 * endpoint: e.g. '/v3/keywords_data/google_ads/keywords_for_site/live'
 * body: JSON-serialisable array/object
 * login, password: DataForSEO credentials
 * transport: optional mock transport
 */
function dataforseoRequest(endpoint, body, login, password, transport) {
  const token = Buffer.from(`${login}:${password}`).toString('base64');
  const options = {
    hostname: DATAFORSEO_HOST,
    port: 443,
    path: endpoint,
    method: 'POST',
    headers: {
      Authorization: `Basic ${token}`,
      Accept: 'application/json',
    },
  };
  return httpsPost(options, body, transport);
}

/**
 * Parse a DataForSEO keywords response into the provider-agnostic shape:
 * { keywords: [{ keyword, volume, difficulty }] }
 */
function parseDataForSEOKeywords(response) {
  if (response.statusCode !== 200) {
    const message =
      (response.body && (response.body.status_message || response.body.error)) ||
      `HTTP ${response.statusCode}`;
    return { error: message };
  }

  const keywords = [];
  const tasks = (response.body && response.body.tasks) || [];
  for (const task of tasks) {
    const results = (task && task.result) || [];
    for (const result of results) {
      const items = (result && result.keyword_data) || [];
      for (const item of items) {
        keywords.push({
          keyword: item.keyword,
          volume: item.keyword_info && item.keyword_info.search_volume,
          difficulty: item.keyword_info && item.keyword_info.keyword_difficulty,
        });
      }
    }
  }
  return { keywords };
}

// ---------------------------------------------------------------------------
// Provider routing helpers
// ---------------------------------------------------------------------------

/**
 * Return the provider name from config (defaults to 'ahrefs').
 */
function getProvider(config) {
  return (config && config.integrations && config.integrations.seo && config.integrations.seo.provider) || 'ahrefs';
}

// ---------------------------------------------------------------------------
// Provider-agnostic interface
// ---------------------------------------------------------------------------

/**
 * Get keyword data for a domain.
 */
async function getKeywords(domain, config, transport, opts) {
  if (getProvider(config) === 'dataforseo') {
    const { login, password } = getDataForSEOCreds(config);
    const response = await dataforseoRequest(
      '/v3/keywords_data/google_ads/keywords_for_site/live',
      [{ target: domain, limit: 100 }],
      login,
      password,
      transport,
    );
    return parseDataForSEOKeywords(response);
  }

  const apiKey = getApiKey(config);
  const response = await ahrefsRequestWithRetry(
    '/v3/site-explorer/organic-keywords',
    { select: 'keyword,volume,difficulty', target: domain, limit: 100 },
    apiKey,
    transport,
    opts,
  );
  return parseResponse(response);
}

/**
 * Get organic traffic metrics for a domain.
 */
async function getTraffic(domain, config, transport, opts) {
  const apiKey = getApiKey(config);
  const response = await ahrefsRequestWithRetry(
    '/v3/site-explorer/metrics',
    { target: domain, date_from: '2024-01-01' },
    apiKey,
    transport,
    opts,
  );
  return parseResponse(response);
}

/**
 * Get backlink data for a domain.
 */
async function getBacklinks(domain, config, transport, opts) {
  const apiKey = getApiKey(config);
  const response = await ahrefsRequestWithRetry(
    '/v3/site-explorer/backlinks',
    { select: 'url_from,domain_rating,traffic', target: domain, limit: 100 },
    apiKey,
    transport,
    opts,
  );
  return parseResponse(response);
}

/**
 * Get competitor domains for a set of keywords.
 */
async function getCompetitors(keywords, config, transport, opts) {
  const apiKey = getApiKey(config);
  const keywordList = Array.isArray(keywords) ? keywords.join(',') : keywords;
  const response = await ahrefsRequestWithRetry(
    '/v3/keywords-explorer/serp-overview',
    { select: 'domain,position,traffic', keywords: keywordList },
    apiKey,
    transport,
    opts,
  );
  return parseResponse(response);
}

/**
 * Verify credentials by making a minimal API call.
 * Returns { ok: true } or { error: "..." }.
 */
async function verify(config, transport) {
  if (!config) {
    return { error: 'no config' };
  }

  let apiKey;
  try {
    apiKey = getApiKey(config);
  } catch (e) {
    return { error: e.message };
  }

  const response = await ahrefsRequest(
    '/v3/subscription-info',
    {},
    apiKey,
    transport,
  );

  if (response.statusCode === 200) {
    return { ok: true };
  }

  const message =
    (response.body && (response.body.message || response.body.error)) ||
    `HTTP ${response.statusCode}`;
  return { error: message };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const domain = args[1];

  const config = loadConfig();

  let result;

  try {
    switch (command) {
      case 'getKeywords':
        result = await getKeywords(domain, config);
        break;
      case 'getTraffic':
        result = await getTraffic(domain, config);
        break;
      case 'getBacklinks':
        result = await getBacklinks(domain, config);
        break;
      case 'getCompetitors': {
        // domain arg contains comma-separated keywords
        const keywords = domain ? domain.split(',') : [];
        result = await getCompetitors(keywords, config);
        break;
      }
      case 'verify':
        result = await verify(config);
        break;
      default:
        result = { error: `Unknown command: ${command}` };
    }
  } catch (e) {
    result = { error: e.message };
  }

  process.stdout.write(JSON.stringify(result) + '\n');
}

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

module.exports = {
  loadConfig,
  getKeywords,
  getTraffic,
  getBacklinks,
  getCompetitors,
  verify,
  ahrefsRequest,
  dataforseoRequest,
};

// Run CLI only when invoked directly
if (require.main === module) {
  main().catch((e) => {
    process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
    process.exit(1);
  });
}
