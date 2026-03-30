'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const GENERATE_SCRIPT = path.join(__dirname, '..', 'scripts', 'generate-platform-files.js');

test('generated platform files are in sync with plugin.config.json', () => {
  assert.doesNotThrow(() => {
    execFileSync('node', [GENERATE_SCRIPT, '--check'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8'
    });
  });
});
