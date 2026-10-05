"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inspectHtmlArtifact } = require("../scripts/artifact-check");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// These are instruction-contract regressions: they protect against the specific
// false inferences and incoherent exemplar that motivated the quality change.
test("research confines API conclusions to documented capability", () => {
  const api = read("skills/research/references/api-analysis.md");
  assert.doesNotMatch(
    api,
    /most honest representation|signals modern architecture rewrite|They have PMF|Integration was an afterthought/
  );
  assert.match(api, /JWT is a token format, not an alternative to OAuth/);
  assert.match(api, /documented external resource model/);
  assert.match(api, /partner-only, plan-gated, or private access/);
  assert.match(
    api,
    /Switching-cost, ecosystem demand, and customer-outcome claims require independent/
  );
});

test("review interpretation preserves sparse and nonrepresentative evidence", () => {
  const mining = read("skills/research/references/review-mining.md");
  const profile = read("skills/research/references/competitor-profiling.md");
  assert.doesNotMatch(mining, /carry 2x weight|70% positive|praise is more authentic/);
  assert.doesNotMatch(profile, /at least 2 praise themes and 2 complaint themes/);
  assert.match(mining, /Deduplicate cross-posts/);
  assert.match(mining, /n\/N/);
  assert.match(mining, /trend unknown/);
  assert.match(mining, /One or zero praise or complaint themes is valid/);
  assert.match(
    read("skills/research/SKILL.md"),
    /Routing alone never promotes an insight to verified demand/
  );
});

test("scope and synthesis retain rare critical behavior and conflicting evidence", () => {
  const scope = read("skills/groom/references/scope-validation.md");
  const synthesis = read("skills/groom/references/synthesizer-agent.md");
  assert.doesNotMatch(scope, /Low:.*edge-case coverage|Low: UI change|Items landing in "Cut"/);
  assert.match(scope, /frequency, severity, recoverability/);
  assert.match(scope, /preventing duplicate approval and incorrect balances/);
  assert.doesNotMatch(
    synthesis,
    /claude-only|strictly more source citations|If a concern is in out_of_scope, it's not a risk/
  );
  assert.match(synthesis, /several summaries of one observation remain one evidence chain/);
  assert.match(synthesis, /An exclusion can create a risk/);
});

test("strategy and advisory summaries expose the actual decision and uncertainty", () => {
  const interview = read("skills/strategy/references/interview-guide.md");
  assert.match(interview, /Priority and opportunity cost/);
  assert.match(interview, /Selectable alternative/);
  assert.match(interview, /Success and reversal/);
  assert.match(interview, /Baselines and targets are not yet known/);
  assert.doesNotMatch(
    interview,
    /terse answers mean move on|These five questions are the minimum viable/
  );
  const style = read("skills/groom/references/style-guide.md");
  assert.doesNotMatch(
    style,
    /Advisory items after user acknowledges blockers|2 advisory notes — want to see them/
  );
  assert.match(style, /Material limitation: demand beyond the two pilot teams is unverified/);
});

test("RFC reference is a complete coherent two-unit contract with a decisive concurrency oracle", () => {
  const html = read("references/templates/rfc-reference.html");
  const issues = [
    ...html.matchAll(
      /<div class="issue-detail">([\s\S]*?)(?=<div class="issue-detail">|<\/section>)/g
    ),
  ].map((match) => match[1]);
  const advertised = Number(html.match(/M · (\d+) issues/)[1]);
  assert.equal(issues.length, advertised);
  assert.deepEqual(
    issues.map((block) => Number(block.match(/class="issue-detail-num">(\d+)/)[1])),
    [1, 2]
  );
  for (const block of issues) {
    for (const field of [
      "Outcome:",
      "Acceptance Criteria",
      "Approach:",
      "Owns:",
      "Dependencies:",
      "Verification commands:",
      "Test hooks:",
    ]) {
      assert.ok(block.includes(field), `Missing executable field ${field}`);
    }
  }
  assert.match(html, /exactly one receives 200 and one 409/);
  assert.match(html, /Stored name equals the successful request and revision is 5/);
  assert.match(html, /explicit retry uses revision 5 and succeeds at revision 6/);
  assert.match(html, /Authorization precedes conflict lookup/);
  assert.doesNotMatch(
    html,
    /anchor_from|CRDT|Concurrent edits from multiple users merge without conflicts/
  );
  const resolved = html.slice(html.indexOf('id="questions"'), html.indexOf('id="log"'));
  assert.match(resolved, /Q: overwrite a newer name automatically\?/);
  assert.match(resolved, /A: no/);
  assert.match(resolved, /Remaining limitations/);
  assert.match(html, /No customer study, benchmark or real approval is claimed/);
  assert.equal(inspectHtmlArtifact(html, { kind: "rfc", template: true }).issues.length, 0);
});
