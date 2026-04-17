"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveShortId,
  disambiguateShortIds,
  KIND_PREFIX,
} = require("../scripts/lib/derive-short-id.js");

test("KIND_PREFIX covers every documented kind", () => {
  assert.deepEqual(Object.keys(KIND_PREFIX).sort(), [
    "dev",
    "groom",
    "proposal",
    "rfc",
    "shipped",
    "think",
  ]);
});

test("deriveShortId returns bare Linear ID when linear_id is set", () => {
  assert.equal(
    deriveShortId("dev", { linear_id: "PM-45" }, "/tmp/repo/.pm/dev-sessions/epic-list.md"),
    "PM-45"
  );
  assert.equal(
    deriveShortId("groom", { linear_id: "ENG-1234" }, "/tmp/repo/.pm/groom-sessions/foo.md"),
    "ENG-1234"
  );
});

test("deriveShortId trims and ignores blank linear_id", () => {
  assert.equal(
    deriveShortId("groom", { linear_id: "  " }, "/tmp/repo/.pm/groom-sessions/foo.md"),
    "g/foo"
  );
  assert.equal(
    deriveShortId("groom", { linear_id: null }, "/tmp/repo/.pm/groom-sessions/foo.md"),
    "g/foo"
  );
});

test("deriveShortId falls back to kind prefix + basename slug", () => {
  assert.equal(
    deriveShortId("groom", {}, "/tmp/.pm/groom-sessions/list-active-work.md"),
    "g/list-active-work"
  );
  assert.equal(deriveShortId("rfc", {}, "/tmp/.pm/rfc-sessions/add-auth.md"), "r/add-auth");
  assert.equal(
    deriveShortId("dev", {}, "/tmp/.pm/dev-sessions/list-active-work.md"),
    "d/list-active-work"
  );
  assert.equal(deriveShortId("think", {}, "/tmp/.pm/think-sessions/idea.md"), "t/idea");
  assert.equal(deriveShortId("proposal", {}, "/tmp/pm/backlog/new-feature.md"), "p/new-feature");
  assert.equal(deriveShortId("shipped", {}, "/tmp/pm/backlog/older-win.md"), "s/older-win");
});

test("deriveShortId strips legacy epic-/bugfix- prefixes from dev basenames", () => {
  assert.equal(
    deriveShortId("dev", {}, "/tmp/.pm/dev-sessions/epic-list-active-work.md"),
    "d/list-active-work"
  );
  assert.equal(deriveShortId("dev", {}, "/tmp/.pm/dev-sessions/bugfix-null-ref.md"), "d/null-ref");
});

test("deriveShortId prefers frontmatter slug for rfc when present", () => {
  assert.equal(
    deriveShortId("rfc", { slug: "auth-v2" }, "/tmp/.pm/rfc-sessions/scratch-name.md"),
    "r/auth-v2"
  );
});

test("deriveShortId throws on unknown kind", () => {
  assert.throws(() => deriveShortId("unknown", {}, "/tmp/foo.md"), /unknown kind/i);
});

test("disambiguateShortIds appends -N to collisions within a kind", () => {
  const rows = [
    { shortId: "d/foo", kind: "dev" },
    { shortId: "d/foo", kind: "dev" },
    { shortId: "d/foo", kind: "dev" },
    { shortId: "d/bar", kind: "dev" },
  ];
  disambiguateShortIds(rows);
  assert.deepEqual(
    rows.map((r) => r.shortId),
    ["d/foo", "d/foo-2", "d/foo-3", "d/bar"]
  );
});

test("disambiguateShortIds does not collide across kinds", () => {
  const rows = [
    { shortId: "p/widget", kind: "proposal" },
    { shortId: "s/widget", kind: "shipped" },
  ];
  disambiguateShortIds(rows);
  assert.deepEqual(
    rows.map((r) => r.shortId),
    ["p/widget", "s/widget"]
  );
});

test("disambiguateShortIds leaves Linear-IDed rows alone across kinds", () => {
  const rows = [
    { shortId: "PM-45", kind: "dev" },
    { shortId: "PM-45", kind: "rfc" },
  ];
  disambiguateShortIds(rows);
  assert.deepEqual(
    rows.map((r) => r.shortId),
    ["PM-45", "PM-45-2"]
  );
});
