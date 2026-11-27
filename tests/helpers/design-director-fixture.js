"use strict";

// Builders for Design Director reports used by the checker and gate tests.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DIMENSIONS } = require("../../scripts/lib/design-director-report");

const COMMIT = "a".repeat(40);
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(80, 1)]);

function finding(id, klass, dimension, status = "open", extra = {}) {
  return {
    id,
    class: klass,
    dimension,
    status,
    location: "Orders list, toolbar",
    observation: "Export is 40px tall beside three 36px buttons",
    cost: "The row looks uneven",
    change: "Use the 36px button",
    screenshots: ["shot-01"],
    first_seen_round: 1,
    missed_earlier: false,
    ...extra,
  };
}

// A clean round 1 approval: every dimension at 5, nothing open.
function approval(overrides = {}) {
  return {
    schema: "design-director-report",
    schema_version: 1,
    run_id: "main",
    session_run_id: "run-1",
    review: 1,
    round: 1,
    commit: COMMIT,
    verdict: "approve",
    outcome: "passed",
    recovery_policy: "scoped-diagnosis-v1",
    prior_report: null,
    agents: { builder: "builder-1", director: "director-1", first_impression: "fresh-1" },
    exercised: {
      platform: "web",
      method: "browser",
      entry: "/orders",
      journeys: ["Create an order from the list"],
      style_values_measured: true,
    },
    screenshots: [
      {
        id: "shot-01",
        path: "screenshots/shot-01.png",
        screen: "Orders",
        viewport: "1440x900@2x",
      },
    ],
    measurements: [{ screen: "Orders", path: "measurements/orders.json" }],
    scores: DIMENSIONS.map((dimension) => ({
      dimension,
      value: 5,
      anchor: "Nothing left to raise",
      screenshots: ["shot-01"],
      to_reach_5: "",
      finding_ids: [],
    })),
    findings: [],
    sweep: [],
    declared_states: [{ state: "empty list", status: "examined", note: "" }],
    reset: { used: false },
    first_impression: { points: [{ id: "p1", text: "The title is clear" }] },
    first_impression_answers: [{ point: "p1", answer: "Agreed; nothing to change" }],
    ignored: [],
    examined: ["Orders list at 1440 and 390"],
    not_examined: [],
    measurement_limits: [],
    self_check_differences: [],
    ...overrides,
  };
}

function setScore(report, dimension, value, fields = {}) {
  Object.assign(
    report.scores.find((score) => score.dimension === dimension),
    { value, ...fields }
  );
  return report;
}

function workspace() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-director-")));
}

function write(root, review, report, slug = "unit") {
  const base = `.pm/dev-sessions/${slug}/design-critique/director/${report.run_id || "main"}`;
  const dir = path.join(root, base, `review-${review}`);
  fs.mkdirSync(path.join(dir, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(dir, "measurements"), { recursive: true });
  fs.writeFileSync(path.join(dir, "screenshots", "shot-01.png"), PNG);
  fs.writeFileSync(path.join(dir, "measurements", "orders.json"), "{}");
  const bytes = Buffer.from(JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "report.json"), bytes);
  return {
    reportPath: `${base}/review-${review}/report.json`,
    absolutePath: path.join(dir, "report.json"),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

module.exports = { COMMIT, approval, finding, setScore, workspace, write };
