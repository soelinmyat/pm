"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  checkDesignDirector,
  isDirectorReportPath,
} = require("../scripts/lib/design-director-report");

const SCRIPT = path.join(__dirname, "..", "scripts", "design-director-check.js");
const BASE = ".pm/dev-sessions/unit/design-critique/director/main";
const {
  COMMIT,
  approval,
  finding,
  setScore,
  workspace,
  write,
} = require("./helpers/design-director-fixture");

function check(report, { review = report.review, root = workspace(), commit = COMMIT } = {}) {
  const { reportPath } = write(root, review, report);
  return checkDesignDirector({ root, reportPath, commit, runId: "run-1" });
}

function messages(result) {
  return result.issues.map((item) => `${item.path}: ${item.message}`).join("\n");
}

test("a complete approval with every dimension at the top passes", () => {
  const result = check(approval());
  assert.equal(result.ok, true, messages(result));
  assert.equal(result.outcome, "passed");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.parks, false);
});

test("the report must have been made at the commit being delivered", () => {
  const result = check(approval(), { commit: "b".repeat(40) });
  assert.match(messages(result), /report\.commit: the review ran at a{40}, not at b{40}/);
});

test("the director must be a separate agent from the builder", () => {
  const report = approval();
  report.agents.director = "builder-1";
  assert.match(messages(check(report)), /agents\.director: must be a separate agent/);
  const shared = approval();
  shared.agents.first_impression = "director-1";
  assert.match(messages(check(shared)), /agents\.first_impression: must be separate/);
});

test("an approval cannot stand on a score below the floor of 4", () => {
  const report = approval({ findings: [finding("f-01", "major", "craft")] });
  setScore(report, "craft", 3, { finding_ids: ["f-01"], to_reach_5: "Align the toolbar" });
  const result = check(report);
  assert.match(messages(result), /cannot approve: craft scores 3, below the floor of 4/);
  assert.match(messages(result), /major finding f-01 is open/);
});

test("a rejection with a blocking finding is a valid report that does not pass", () => {
  const report = approval({
    verdict: "reject",
    outcome: "failed",
    first_impression: null,
    first_impression_answers: [],
    findings: [finding("f-01", "major", "hierarchy")],
  });
  setScore(report, "hierarchy", 3, { finding_ids: ["f-01"], to_reach_5: "One primary action" });
  const result = check(report);
  assert.equal(result.ok, true, messages(result));
  assert.equal(result.outcome, "failed");
  assert.equal(result.parks, false);
});

test("a rejection needs a reason the rubric recognises", () => {
  const report = approval({ verdict: "reject", outcome: "failed" });
  assert.match(messages(check(report)), /a rejection needs a score below the floor/);
});

test("craft and composition can block: a small finding stops approval in round 1", () => {
  const report = approval({ findings: [finding("f-02", "small", "craft")] });
  setScore(report, "craft", 4, { finding_ids: ["f-02"], to_reach_5: "Match the button heights" });
  assert.match(messages(check(report)), /cannot approve: small finding f-02 is open/);
});

test("a 4 names its gap and raises it; a 5 leaves nothing unresolved", () => {
  const four = setScore(approval(), "composition", 4);
  const fourResult = messages(check(four));
  assert.match(fourResult, /to_reach_5: a 4 must name the change/);
  assert.match(fourResult, /a 4 must raise its gap as an elevation or small finding/);

  const five = approval({ findings: [finding("f-03", "elevation", "microcopy")] });
  assert.match(messages(check(five)), /a 5 cannot leave findings unresolved: f-03/);
});

test("an elevation can be answered with a recorded reason", () => {
  const report = approval({
    findings: [
      finding("f-04", "elevation", "flow", "answered", {
        answer: "The extra step confirms a delete",
      }),
    ],
  });
  setScore(report, "flow", 4, { finding_ids: ["f-04"], to_reach_5: "Remove the confirm step" });
  assert.equal(check(report).ok, true);
  report.findings[0].answer = "";
  assert.match(messages(check(report)), /an answered elevation records the reason/);
});

test("every dimension is scored once and every score cites a screenshot", () => {
  const report = approval();
  report.scores.pop();
  report.scores[0].screenshots = ["missing"];
  const result = messages(check(report));
  assert.match(result, /scores: is missing the accessibility dimension/);
  assert.match(result, /cites unknown screenshot missing/);
});

test("an intentional outlier needs a citation and a defect links its finding", () => {
  const report = approval({
    sweep: [
      { screen: "Orders", outlier: "Export 40px vs 36px", disposition: "intentional", cites: "" },
      { screen: "Orders", outlier: "Divider #9ca3af vs #e5e7eb", disposition: "defect" },
      { screen: "Orders", outlier: "Icon 18px vs 16px", disposition: "looks fine" },
    ],
  });
  const result = messages(check(report));
  assert.match(result, /sweep\[0\]\.cites: an intentional outlier cites/);
  assert.match(result, /sweep\[1\]\.finding_id: a defect outlier links its finding/);
  assert.match(result, /sweep\[2\]\.disposition: must be defect or intentional/);
});

test("an unreachable declared state is a major finding and blocks", () => {
  const report = approval({
    declared_states: [{ state: "payment failed", status: "unreachable", finding_id: "f-05" }],
    findings: [finding("f-05", "major", "resilience")],
  });
  setScore(report, "resilience", 4, { finding_ids: [], to_reach_5: "Reach the failed state" });
  const result = messages(check(report));
  assert.match(result, /cannot approve: major finding f-05 is open/);
  report.declared_states[0].finding_id = "none";
  assert.match(messages(check(report)), /an unreachable declared state is an open major finding/);
});

test("screenshots and measurement output must exist inside the review directory", () => {
  const report = approval();
  report.screenshots[0].path = "../../outside.png";
  report.measurements[0].path = "measurements/absent.json";
  const result = messages(check(report));
  assert.match(result, /screenshots\[0\]\.path: must be a path inside the review directory/);
  assert.match(result, /measurements\[0\]\.path: must be the saved tool output/);
});

test("a screenshots-only review states its limits and caps craft at 4", () => {
  const report = approval({ measurements: [] });
  report.exercised.method = "screenshots-only";
  report.exercised.style_values_measured = false;
  const result = messages(check(report));
  assert.match(result, /measurement_limits: must state what could not be measured/);
  assert.match(result, /craft is capped at 4 when style values were not measured/);

  report.measurement_limits = ["No browser tools: reviewed from supplied screenshots"];
  setScore(report, "craft", 4, { to_reach_5: "Measure spacing on the live page" });
  assert.equal(check(report).ok, true);
});

test("an approval includes the first-impression pass with every point answered", () => {
  const missing = approval({ first_impression: null, first_impression_answers: [] });
  assert.match(messages(check(missing)), /an approval includes the first-impression pass/);
  const unanswered = approval({ first_impression_answers: [] });
  assert.match(messages(check(unanswered)), /point p1 has no answer/);
});

function rejection(review, round, extra = {}) {
  const report = approval({
    review,
    round,
    verdict: "reject",
    outcome: "failed",
    first_impression: null,
    first_impression_answers: [],
    findings: [finding("f-01", "major", "hierarchy")],
    ...extra,
  });
  return setScore(report, "hierarchy", 3, {
    finding_ids: ["f-01"],
    to_reach_5: "One primary action",
  });
}

test("round 2 continues the retained round 1 report and keeps its findings", () => {
  const root = workspace();
  const first = write(root, 1, rejection(1, 1));
  const prior = { path: first.reportPath, sha256: first.sha256 };

  const second = approval({ review: 2, round: 2, prior_report: prior });
  second.findings = [finding("f-01", "major", "hierarchy", "fixed")];
  assert.equal(check(second, { root }).ok, true);

  const dropped = approval({ review: 2, round: 2, prior_report: prior });
  assert.match(messages(check(dropped, { root })), /earlier findings are missing: f-01/);

  const stale = approval({
    review: 2,
    round: 2,
    prior_report: { ...prior, sha256: "0".repeat(64) },
  });
  stale.findings = [finding("f-01", "major", "hierarchy", "fixed")];
  assert.match(messages(check(stale, { root })), /does not match the retained earlier report/);

  const skipped = approval({ review: 2, round: 3, prior_report: prior });
  skipped.findings = [finding("f-01", "major", "hierarchy", "fixed")];
  assert.match(messages(check(skipped, { root })), /without a reset the round equals the review/);
});

test("after round 1, small findings cannot be opened on unchanged UI", () => {
  const root = workspace();
  const first = write(root, 1, rejection(1, 1));
  const report = approval({
    review: 2,
    round: 2,
    prior_report: { path: first.reportPath, sha256: first.sha256 },
  });
  report.findings = [
    finding("f-01", "major", "hierarchy", "fixed"),
    finding("f-06", "small", "craft", "open", {
      first_seen_round: 2,
      late: { ui: "unchanged" },
    }),
  ];
  setScore(report, "craft", 4, { finding_ids: ["f-06"], to_reach_5: "Align the icon" });
  assert.match(
    messages(check(report, { root })),
    /small findings and elevations cannot be opened on unchanged UI/
  );

  report.findings[1].late = { ui: "changed-by-fix" };
  assert.match(messages(check(report, { root })), /cannot approve: small finding f-06 is open/);

  report.findings[1] = finding("f-07", "major", "craft", "filed", {
    first_seen_round: 2,
    missed_earlier: true,
    late: { ui: "unchanged", blocks: false },
  });
  report.scores.find((score) => score.dimension === "craft").finding_ids = ["f-07"];
  const filed = check(report, { root });
  assert.equal(filed.ok, true, messages(filed));
  assert.deepEqual(filed.blockers, [], "a late major below the blocking bar is a follow-up");
  assert.deepEqual(filed.follow_ups, ["f-07"]);
});

test("round 3 approves with small items filed, and a round 3 rejection parks", () => {
  const root = workspace();
  const first = write(root, 1, rejection(1, 1));
  const second = write(
    root,
    2,
    rejection(2, 2, { prior_report: { path: first.reportPath, sha256: first.sha256 } })
  );
  const prior = { path: second.reportPath, sha256: second.sha256 };

  const third = approval({ review: 3, round: 3, prior_report: prior });
  third.findings = [
    finding("f-01", "major", "hierarchy", "fixed"),
    finding("f-08", "small", "microcopy", "filed", {
      first_seen_round: 3,
      late: { ui: "changed-by-fix" },
    }),
  ];
  setScore(third, "microcopy", 4, { finding_ids: ["f-08"], to_reach_5: "Shorten the empty text" });
  const passed = check(third, { root });
  assert.equal(passed.ok, true, messages(passed));
  assert.deepEqual(passed.follow_ups, ["f-08"]);

  third.findings[1].status = "open";
  assert.match(
    messages(check(third, { root })),
    /in round 3 a small finding or elevation is fixed, answered or filed/
  );

  const parked = check(rejection(3, 3, { prior_report: prior }), { root });
  assert.equal(parked.ok, true, messages(parked));
  assert.equal(parked.parks, true);
});

test("small findings cannot be filed away before round 3", () => {
  const report = approval({ findings: [finding("f-09", "small", "craft", "filed")] });
  setScore(report, "craft", 4, { finding_ids: ["f-09"], to_reach_5: "Match the radius" });
  assert.match(messages(check(report)), /filed only after round 3/);
});

test("one reset restarts at round 1 for an allowed reason, and only once", () => {
  const root = workspace();
  const first = write(root, 1, rejection(1, 1));
  const prior = { path: first.reportPath, sha256: first.sha256 };

  const reset = rejection(2, 1, {
    prior_report: prior,
    reset: { used: true, reason: "wrong-direction", at_review: 2 },
  });
  reset.findings = [finding("f-10", "major", "composition")];
  setScore(reset, "hierarchy", 5, { finding_ids: [], to_reach_5: "" });
  setScore(reset, "composition", 2, { finding_ids: ["f-10"], to_reach_5: "A different layout" });
  const restarted = check(reset, { root });
  assert.equal(restarted.ok, true, messages(restarted));

  const lazy = rejection(2, 1, {
    prior_report: prior,
    reset: { used: true, reason: "many-findings", at_review: 2 },
  });
  assert.match(messages(check(lazy, { root })), /reset\.reason: must be one of rebuild/);

  const second = write(root, 2, reset);
  const again = rejection(3, 1, {
    prior_report: { path: second.reportPath, sha256: second.sha256 },
    reset: { used: true, reason: "rebuild", at_review: 3 },
  });
  assert.match(messages(check(again, { root })), /a run has one reset/);
});

test("a run has at most five reviews, and the path is bounded", () => {
  assert.equal(isDirectorReportPath(`${BASE}/review-5/report.json`), true);
  assert.equal(isDirectorReportPath(`${BASE}/review-6/report.json`), false);
  const result = checkDesignDirector({
    root: workspace(),
    reportPath: ".pm/dev-sessions/unit/design-critique/report.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues[0].message, /director\/\{run\}\/review-\{1-5\}\/report\.json/);
});

test("the CLI exits 0 for a valid report, 1 for an invalid one and 2 for bad usage", () => {
  const root = workspace();
  const { reportPath } = write(root, 1, approval());
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  const valid = run("--root", root, "--report", reportPath, "--commit", COMMIT, "--json");
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).verdict, "approve");
  const stale = run("--root", root, "--report", reportPath, "--commit", "c".repeat(40));
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /report\.commit/);
  assert.equal(run("--root", root).status, 2);
});

test("only a genuinely late finding can be marked as not blocking", () => {
  const report = approval({
    findings: [
      finding("f-01", "major", "craft", "open", { late: { ui: "unchanged", blocks: false } }),
    ],
  });
  setScore(report, "craft", 4, { finding_ids: ["f-01"], to_reach_5: "Align the toolbar" });
  const result = check(report);
  assert.match(messages(result), /late: applies only to a finding first raised after round 1/);
  assert.match(messages(result), /cannot approve: major finding f-01 is open/);
});

test("a finding's first round comes from the retained lineage", () => {
  const first = approval({ findings: [finding("f-01", "small", "craft", "open")] });
  first.findings[0].first_seen_round = 2;
  assert.match(messages(check(first)), /f-01 is first seen in round 1 of the first review/);

  const root = workspace();
  const written = write(root, 1, rejection(1, 1));
  const second = approval({
    review: 2,
    round: 2,
    prior_report: { path: written.reportPath, sha256: written.sha256 },
  });
  second.findings = [
    finding("f-01", "major", "hierarchy", "fixed"),
    finding("f-11", "small", "craft", "open"),
  ];
  setScore(second, "craft", 4, { finding_ids: ["f-11"], to_reach_5: "Align the icon" });
  assert.match(messages(check(second, { root })), /f-11 was first seen in round 2/);
});

test("malformed fields are reported, never thrown", () => {
  for (const mutate of [
    (report) => {
      report.findings = { id: "f-01" };
    },
    (report) => {
      report.scores = 7;
    },
    (report) => {
      report.findings = [null, 3];
    },
  ]) {
    const report = approval();
    mutate(report);
    const result = check(report);
    assert.equal(result.ok, false);
    assert.ok(result.issues.length > 0);
  }
  const root = workspace();
  const dir = `${BASE}/review-1`;
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, "report.json"), "null");
  const sha256 = crypto.createHash("sha256").update("null").digest("hex");
  const second = approval({
    review: 2,
    round: 2,
    prior_report: { path: `${dir}/report.json`, sha256 },
  });
  assert.match(messages(check(second, { root })), /prior_report: is not a report object/);
});

test("the report names its run from its path and binds the session separately", () => {
  const report = approval({ run_id: "other" });
  const root = workspace();
  const { reportPath } = write(root, 1, { ...report, run_id: "main" });
  fs.writeFileSync(path.join(root, reportPath), JSON.stringify(report));
  const result = checkDesignDirector({ root, reportPath, commit: COMMIT, runId: "run-1" });
  assert.match(messages(result), /run_id: must equal main, from its path/);
  const unbound = approval({ session_run_id: "run-9" });
  assert.match(messages(check(unbound)), /session_run_id: must equal the session run run-1/);
});

test("a run parked at round 3 cannot be reopened with a reset", () => {
  const root = workspace();
  let prior = null;
  for (const review of [1, 2, 3]) {
    const written = write(root, review, rejection(review, review, { prior_report: prior }));
    prior = { path: written.reportPath, sha256: written.sha256 };
  }
  const reopened = approval({
    review: 4,
    round: 1,
    prior_report: prior,
    reset: { used: true, reason: "rebuild", at_review: 4 },
  });
  reopened.findings = [finding("f-01", "major", "hierarchy", "fixed")];
  assert.match(
    messages(check(reopened, { root })),
    /the run parked at its round 3 rejection and takes no further review/
  );
});

test("an unreachable declared state blocks until it is reached", () => {
  const report = approval({
    declared_states: [{ state: "payment failed", status: "unreachable", finding_id: "f-05" }],
    findings: [finding("f-05", "major", "resilience", "fixed")],
  });
  assert.match(
    messages(check(report)),
    /an unreachable declared state is an open major finding against the build/
  );
});

test("an approval needs a first-impression pass that reported something", () => {
  const report = approval({ first_impression: { points: [] }, first_impression_answers: [] });
  assert.match(messages(check(report)), /at least one point/);
});

test("measured style values need saved measurement output", () => {
  const report = approval({ measurements: [], measurement_limits: ["Could not reach the drawer"] });
  assert.match(
    messages(check(report)),
    /measurements: measured style values need the saved measurement output/
  );
  const selfReferencing = approval({ measurements: [{ screen: "Orders", path: "report.json" }] });
  assert.match(messages(check(selfReferencing)), /the report is not measurement output/);
});
