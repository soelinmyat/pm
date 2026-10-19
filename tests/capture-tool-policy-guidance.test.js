"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("capture guidance offers permitted user authorization without weakening evidence", () => {
  const guide = fs.readFileSync(
    path.join(__dirname, "../skills/dev/references/design-critique-capture-guide.md"),
    "utf8"
  );
  assert.match(guide, /When host policy permits an explicit user request/);
  assert.match(guide, /ask once for authorization to run the existing Chromium capture helper/);
  assert.match(guide, /A general request to finish the review is not that authorization/);
  assert.match(
    guide,
    /If authorization is declined or host policy forbids the alternative, keep the capture blocked/
  );
  assert.match(guide, /never hand-author native observations, downgrade the route/);
  assert.match(guide, /There is currently no trusted CUA producer/);
});
