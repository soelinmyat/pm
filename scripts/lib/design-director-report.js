"use strict";

// Checks a Design Director report. The director's judgment is not rechecked
// here. What is checked is that the report is complete, that it was made at
// the commit being delivered by an agent other than the builder, and that its
// verdict follows from its own scores and findings under the rubric's rules.

const crypto = require("node:crypto");
const path = require("node:path");
const { isGitObjectId } = require("./git-object-id");
const { readProjectInput } = require("./project-file");
const { RECOVERY_POLICY } = require("./scoped-recovery");

const REPORT_SCHEMA = "design-director-report";
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_REVIEWS = 5;
const MAX_ROUNDS = 3;
const PASS_FLOOR = 4;
const DIMENSIONS = Object.freeze([
  "fidelity",
  "hierarchy",
  "composition",
  "visual-quality",
  "craft",
  "consistency",
  "flow",
  "resilience",
  "microcopy",
  "accessibility",
]);
const CLASSES = new Set(["major", "regression", "small", "elevation", "system-note"]);
const STATUSES = new Set(["open", "fixed", "answered", "filed"]);
const RESET_REASONS = new Set(["rebuild", "wrong-direction", "invalid-round"]);
const METHODS = new Set(["browser", "simulator", "device", "screenshots-only"]);
const PLATFORMS = new Set(["web", "ios", "android"]);
const LATE_BLOCK_REASONS = new Set(["anchor-2-or-lower", "breaks-task"]);
// A director run is one fix loop: up to five reviews of one piece of work. A
// later commit after an approval starts a new run beside it.
const REPORT_PATH_RE =
  /^\.pm\/dev-sessions\/([^/]+)\/design-critique\/director\/([a-z0-9][a-z0-9._-]{0,63})\/review-([1-5])\/report\.json$/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isImage(bytes) {
  if (bytes.length < 64) return false;
  const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return png || jpeg || webp;
}

// Report-relative files must stay inside the review directory.
function readSibling(root, directory, relative, maxBytes) {
  if (!text(relative) || path.posix.isAbsolute(relative) || relative.split("/").includes(".."))
    throw new Error("must be a path inside the review directory");
  return readProjectInput(root, `${directory}/${relative}`, maxBytes).bytes;
}

// A major finding first seen after round 1 on UI the fix did not touch, below
// the bar that lets a late finding block. It is recorded as missed and filed.
function isLateFollowUp(finding) {
  return (
    finding.class === "major" &&
    finding.first_seen_round > 1 &&
    finding.missed_earlier === true &&
    isObject(finding.late) &&
    finding.late.ui === "unchanged" &&
    finding.late.blocks === false
  );
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function isBlocking(finding, round) {
  if (finding.status !== "open") return false;
  if (finding.class === "major") return !isLateFollowUp(finding);
  if (finding.class === "regression") return true;
  if (finding.class === "small" || finding.class === "elevation") return round < MAX_ROUNDS;
  return false;
}

// The reasons this report cannot approve. An empty list means it may.
function blockers(report) {
  const reasons = [];
  for (const score of listOf(report.scores))
    if (Number.isInteger(score?.value) && score.value < PASS_FLOOR)
      reasons.push(`${score.dimension} scores ${score.value}, below the floor of ${PASS_FLOOR}`);
  for (const finding of listOf(report.findings))
    if (isObject(finding) && isBlocking(finding, report.round))
      reasons.push(`${finding.class} finding ${finding.id} is open`);
  return reasons;
}

function checkScores(report, findingsById, shots, add) {
  const scores = Array.isArray(report.scores) ? report.scores : [];
  if (!Array.isArray(report.scores)) add("scores", "must be an array");
  const seen = new Set();
  scores.forEach((score, index) => {
    const at = `scores[${index}]`;
    if (!isObject(score)) return add(at, "must be an object");
    if (!DIMENSIONS.includes(score.dimension))
      return add(`${at}.dimension`, `must be one of ${DIMENSIONS.join(", ")}`);
    if (seen.has(score.dimension)) add(`${at}.dimension`, "is scored more than once");
    seen.add(score.dimension);
    if (!Number.isInteger(score.value) || score.value < 1 || score.value > 5)
      return add(`${at}.value`, "must be an integer from 1 to 5");
    if (!text(score.anchor)) add(`${at}.anchor`, "must quote the anchor clause the score meets");
    if (!Array.isArray(score.screenshots) || score.screenshots.length === 0)
      add(`${at}.screenshots`, "must cite at least one screenshot");
    else
      for (const id of score.screenshots)
        if (!shots.has(id)) add(`${at}.screenshots`, `cites unknown screenshot ${id}`);
    const linked = (Array.isArray(score.finding_ids) ? score.finding_ids : []).map((id) => {
      const finding = findingsById.get(id);
      if (!finding) add(`${at}.finding_ids`, `cites unknown finding ${id}`);
      else if (finding.dimension !== score.dimension)
        add(`${at}.finding_ids`, `finding ${id} belongs to ${finding.dimension}`);
      return finding;
    });
    const onDimension = [...findingsById.values()].filter(
      (finding) => finding.dimension === score.dimension
    );
    if (score.value < PASS_FLOOR) {
      const open = linked.filter(
        (finding) =>
          finding && ["major", "regression"].includes(finding.class) && finding.status === "open"
      );
      if (open.length === 0)
        add(`${at}.finding_ids`, "a score below 4 must link an open major finding or regression");
    } else if (score.value === 4) {
      if (!text(score.to_reach_5))
        add(`${at}.to_reach_5`, "a 4 must name the change that would make it a 5");
      const capped =
        score.dimension === "craft" && report.exercised?.style_values_measured === false;
      // A filed late major is the named gap: it cannot block, so the score
      // cannot drop below the floor for it, and it cannot be a 5 either.
      const named = linked.some(
        (finding) =>
          finding && (["elevation", "small"].includes(finding.class) || isLateFollowUp(finding))
      );
      if (!named && !capped)
        add(`${at}.finding_ids`, "a 4 must raise its gap as an elevation or small finding");
    } else {
      if (text(score.to_reach_5)) add(`${at}.to_reach_5`, "a 5 has nothing left to raise");
      const left = onDimension.filter(
        (finding) => finding.class !== "system-note" && ["open", "filed"].includes(finding.status)
      );
      if (left.length > 0)
        add(
          `${at}.value`,
          `a 5 cannot leave findings unresolved: ${left.map((finding) => finding.id).join(", ")}`
        );
    }
    if (
      score.dimension === "craft" &&
      report.exercised?.style_values_measured === false &&
      score.value > 4
    )
      add(`${at}.value`, "craft is capped at 4 when style values were not measured");
  });
  for (const dimension of DIMENSIONS)
    if (!seen.has(dimension)) add("scores", `is missing the ${dimension} dimension`);
}

function checkFindings(report, add) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  if (!Array.isArray(report.findings)) add("findings", "must be an array");
  const byId = new Map();
  findings.forEach((finding, index) => {
    const at = `findings[${index}]`;
    if (!isObject(finding)) return add(at, "must be an object");
    if (!text(finding.id)) return add(`${at}.id`, "is required");
    if (byId.has(finding.id)) add(`${at}.id`, `${finding.id} is used more than once`);
    byId.set(finding.id, finding);
    if (!CLASSES.has(finding.class))
      add(`${at}.class`, `must be one of ${[...CLASSES].join(", ")}`);
    if (!DIMENSIONS.includes(finding.dimension))
      add(`${at}.dimension`, "must name exactly one rubric dimension");
    if (!STATUSES.has(finding.status))
      add(`${at}.status`, `must be one of ${[...STATUSES].join(", ")}`);
    for (const field of ["location", "observation", "cost", "change"])
      if (!text(finding[field])) add(`${at}.${field}`, "is required");
    if (!Number.isInteger(finding.first_seen_round) || finding.first_seen_round < 1)
      add(`${at}.first_seen_round`, "must be a positive integer");
    if (finding.status === "answered") {
      if (finding.class !== "elevation")
        add(`${at}.status`, "only an elevation can be answered instead of fixed");
      if (!text(finding.answer)) add(`${at}.answer`, "an answered elevation records the reason");
    }
    const lateFollowUp = isLateFollowUp(finding);
    if (lateFollowUp && finding.status === "open")
      add(`${at}.status`, "a late finding that does not block is filed as a follow-up");
    if (finding.late !== undefined && !(finding.first_seen_round > 1))
      add(`${at}.late`, "applies only to a finding first raised after round 1");
    if (finding.status === "filed") {
      if (["small", "elevation"].includes(finding.class)) {
        if (report.round < MAX_ROUNDS)
          add(`${at}.status`, "small findings and elevations are filed only after round 3");
      } else if (finding.class !== "system-note" && !lateFollowUp)
        add(`${at}.status`, `a ${finding.class} finding cannot be filed as a follow-up`);
    }
    if (
      report.round === MAX_ROUNDS &&
      finding.status === "open" &&
      ["small", "elevation"].includes(finding.class)
    )
      add(`${at}.status`, "in round 3 a small finding or elevation is fixed, answered or filed");
    // After round 1, new findings are narrowed. What a fix changed is new
    // work and is reviewed in full; unchanged UI admits only what was missed
    // and is serious.
    const late = finding.first_seen_round > 1 && finding.first_seen_round === report.round;
    if (late && finding.class !== "system-note" && finding.class !== "regression") {
      if (!isObject(finding.late) || !["changed-by-fix", "unchanged"].includes(finding.late.ui))
        return add(
          `${at}.late`,
          "a finding first raised after round 1 states whether the UI was changed-by-fix or unchanged"
        );
      if (finding.late.ui === "unchanged") {
        if (finding.class !== "major")
          return add(
            `${at}.class`,
            "small findings and elevations cannot be opened on unchanged UI"
          );
        if (finding.missed_earlier !== true)
          add(`${at}.missed_earlier`, "a late major finding on unchanged UI is recorded as missed");
        if (typeof finding.late.blocks !== "boolean")
          add(`${at}.late.blocks`, "must say whether the late finding blocks");
        else if (finding.late.blocks && !LATE_BLOCK_REASONS.has(finding.late.reason))
          add(
            `${at}.late.reason`,
            "a blocking late finding meets anchor-2-or-lower or breaks-task"
          );
        else if (!finding.late.blocks && finding.status === "open")
          add(`${at}.status`, "a late finding that does not block is filed as a follow-up");
      }
    }
  });
  return byId;
}

function checkEvidence(report, root, directory, add) {
  const shots = new Set();
  if (!Array.isArray(report.screenshots) || report.screenshots.length === 0)
    add("screenshots", "must list at least one screenshot");
  else
    report.screenshots.forEach((shot, index) => {
      const at = `screenshots[${index}]`;
      if (!isObject(shot) || !text(shot.id)) return add(at, "needs an id");
      if (shots.has(shot.id)) add(`${at}.id`, `${shot.id} is used more than once`);
      shots.add(shot.id);
      for (const field of ["screen", "viewport"])
        if (!text(shot[field])) add(`${at}.${field}`, "is required");
      try {
        if (!isImage(readSibling(root, directory, shot.path, 64 * 1024 * 1024)))
          add(`${at}.path`, "is not a PNG, JPEG or WebP image");
      } catch (error) {
        add(`${at}.path`, error.message);
      }
    });

  const exercised = report.exercised;
  if (!isObject(exercised)) add("exercised", "must record how the app was exercised");
  else {
    if (!PLATFORMS.has(exercised.platform))
      add("exercised.platform", `must be one of ${[...PLATFORMS].join(", ")}`);
    if (!METHODS.has(exercised.method))
      add("exercised.method", `must be one of ${[...METHODS].join(", ")}`);
    if (!text(exercised.entry)) add("exercised.entry", "must name where the task was started");
    if (!Array.isArray(exercised.journeys) || !exercised.journeys.some(text))
      add("exercised.journeys", "must list at least one journey that was carried out");
    if (typeof exercised.style_values_measured !== "boolean")
      add("exercised.style_values_measured", "must be true or false");
    if (exercised.method === "screenshots-only" && exercised.style_values_measured !== false)
      add("exercised.style_values_measured", "must be false for a screenshots-only review");
  }
  const limits = Array.isArray(report.measurement_limits) ? report.measurement_limits : [];
  if (!Array.isArray(report.measurement_limits)) add("measurement_limits", "must be an array");
  const measurements = Array.isArray(report.measurements) ? report.measurements : [];
  if (!Array.isArray(report.measurements)) add("measurements", "must be an array");
  if (isObject(exercised) && exercised.style_values_measured === false && !limits.some(text))
    add("measurement_limits", "must state what could not be measured");
  if (measurements.length === 0 && !limits.some(text))
    add("measurements", "the standard sweep is required on every changed screen");
  if (isObject(exercised) && exercised.style_values_measured === true && !measurements.length)
    add("measurements", "measured style values need the saved measurement output");
  if (
    measurements.some(
      (entry) => isObject(entry) && path.posix.normalize(String(entry.path)) === "report.json"
    )
  )
    add("measurements", "the report is not measurement output");
  measurements.forEach((entry, index) => {
    const at = `measurements[${index}]`;
    if (!isObject(entry) || !text(entry.screen)) return add(at, "needs the screen it measured");
    try {
      JSON.parse(readSibling(root, directory, entry.path, MAX_REPORT_BYTES).toString("utf8"));
    } catch (error) {
      add(`${at}.path`, `must be the saved tool output: ${error.message}`);
    }
  });
  for (const field of ["examined", "not_examined", "ignored", "self_check_differences"])
    if (!Array.isArray(report[field])) add(field, "must be an array");
  if (Array.isArray(report.examined) && !report.examined.some(text))
    add("examined", "must list what was examined");
  return shots;
}

function checkSweepAndStates(report, findingsById, add) {
  if (!Array.isArray(report.sweep)) add("sweep", "must be an array");
  else
    report.sweep.forEach((entry, index) => {
      const at = `sweep[${index}]`;
      if (!isObject(entry) || !text(entry.screen) || !text(entry.outlier))
        return add(at, "needs the screen and the outlier with its values");
      if (entry.disposition === "intentional") {
        if (!text(entry.cites))
          add(
            `${at}.cites`,
            "an intentional outlier cites a token, component, declared decision or comparable screen"
          );
      } else if (entry.disposition === "defect") {
        if (!findingsById.has(entry.finding_id))
          add(`${at}.finding_id`, "a defect outlier links its finding");
      } else add(`${at}.disposition`, "must be defect or intentional");
    });
  if (!Array.isArray(report.declared_states)) add("declared_states", "must be an array");
  else
    report.declared_states.forEach((entry, index) => {
      const at = `declared_states[${index}]`;
      if (!isObject(entry) || !text(entry.state)) return add(at, "needs the declared state");
      if (entry.status === "examined") return undefined;
      if (entry.status !== "unreachable")
        return add(`${at}.status`, "must be examined or unreachable");
      const finding = findingsById.get(entry.finding_id);
      if (!finding || finding.class !== "major" || finding.status !== "open")
        add(
          `${at}.finding_id`,
          "an unreachable declared state is an open major finding against the build"
        );
      return undefined;
    });
}

function checkAgents(report, add) {
  const agents = report.agents;
  if (!isObject(agents)) return add("agents", "must name the builder and the director");
  for (const role of ["builder", "director"])
    if (!text(agents[role])) add(`agents.${role}`, "is required");
  if (text(agents.builder) && agents.builder === agents.director)
    add("agents.director", "must be a separate agent from the builder");
  if (report.first_impression !== null && report.first_impression !== undefined) {
    if (!text(agents.first_impression)) add("agents.first_impression", "is required");
    else if ([agents.builder, agents.director].includes(agents.first_impression))
      add("agents.first_impression", "must be separate from the builder and the director");
  }
  return undefined;
}

function checkFirstImpression(report, findingsById, add) {
  const impression = report.first_impression;
  const answers = Array.isArray(report.first_impression_answers)
    ? report.first_impression_answers
    : [];
  if (!Array.isArray(report.first_impression_answers))
    add("first_impression_answers", "must be an array");
  if (impression === null || impression === undefined) {
    if (report.verdict === "approve")
      add("first_impression", "an approval includes the first-impression pass and its answers");
    return;
  }
  if (!isObject(impression) || !Array.isArray(impression.points))
    return add("first_impression.points", "must be an array");
  const answered = new Map();
  answers.forEach((entry, index) => {
    const at = `first_impression_answers[${index}]`;
    if (!isObject(entry) || !text(entry.point)) return add(at, "needs the point it answers");
    if (text(entry.finding_id)) {
      if (!findingsById.has(entry.finding_id))
        add(`${at}.finding_id`, `cites unknown finding ${entry.finding_id}`);
    } else if (!text(entry.answer))
      add(`${at}.answer`, "accepts the point as a finding or says why not");
    answered.set(entry.point, entry);
    return undefined;
  });
  if (report.verdict === "approve" && impression.points.length === 0)
    add(
      "first_impression.points",
      "an approval needs the pass to have reported at least one point"
    );
  impression.points.forEach((point, index) => {
    const at = `first_impression.points[${index}]`;
    if (!isObject(point) || !text(point.id) || !text(point.text))
      return add(at, "needs an id and the observation");
    if (report.verdict === "approve" && !answered.has(point.id))
      add(at, `point ${point.id} has no answer`);
    return undefined;
  });
}

function checkLineage(report, root, directory, reviewNumber, add) {
  const reset = report.reset;
  if (!isObject(reset) || typeof reset.used !== "boolean") {
    add("reset.used", "must be true or false");
    return;
  }
  if (reset.used) {
    if (!RESET_REASONS.has(reset.reason))
      add("reset.reason", `must be one of ${[...RESET_REASONS].join(", ")}`);
    if (
      !Number.isInteger(reset.at_review) ||
      reset.at_review < 2 ||
      reset.at_review > report.review
    )
      add("reset.at_review", "must be the review at which the count restarted");
  } else if (report.review !== report.round)
    add("round", "without a reset the round equals the review number");

  const findings = listOf(report.findings).filter(isObject);
  if (reviewNumber === 1) {
    for (const finding of findings)
      if (finding.first_seen_round !== 1)
        add("findings", `${finding.id} is first seen in round 1 of the first review`);
    if (report.prior_report !== null) add("prior_report", "the first review has none");
    if (report.round !== 1) add("round", "the first review is round 1");
    if (reset.used) add("reset.used", "the first review cannot be a reset");
    return;
  }
  const expected = `${path.posix.dirname(directory)}/review-${reviewNumber - 1}/report.json`;
  const binding = report.prior_report;
  if (!isObject(binding) || binding.path !== expected) {
    add("prior_report.path", `must be ${expected}`);
    return;
  }
  let prior;
  try {
    const bytes = readProjectInput(root, expected, MAX_REPORT_BYTES).bytes;
    if (sha256(bytes) !== binding.sha256)
      return add("prior_report.sha256", "does not match the retained earlier report");
    prior = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return add("prior_report", `cannot read the earlier report: ${error.message}`);
  }
  if (!isObject(prior)) return add("prior_report", "is not a report object");
  if (prior.run_id !== report.run_id) add("prior_report", "belongs to a different run");
  if (prior.review !== reviewNumber - 1) add("prior_report", "is not the immediately prior review");
  if (prior.verdict === "approve")
    add("prior_report", "an approved run has no further review; a later commit starts a new run");
  if (prior.verdict === "reject" && prior.round === MAX_ROUNDS)
    add("prior_report", "the run parked at its round 3 rejection and takes no further review");
  // A finding's first round comes from the retained lineage, not from the
  // report that carries it: a new finding belongs to this round.
  const earlier = new Map(
    listOf(prior.findings)
      .filter(isObject)
      .map((finding) => [finding.id, finding.first_seen_round])
  );
  for (const finding of findings) {
    const expected = earlier.has(finding.id) ? earlier.get(finding.id) : report.round;
    if (finding.first_seen_round !== expected)
      add("findings", `${finding.id} was first seen in round ${expected}`);
  }
  const resetNow = reset.used && reset.at_review === report.review;
  if (prior.reset?.used) {
    if (
      !reset.used ||
      reset.at_review !== prior.reset.at_review ||
      reset.reason !== prior.reset.reason
    )
      add("reset", "a run has one reset; carry the earlier one forward unchanged");
  }
  if (resetNow) {
    if (report.round !== 1) add("round", "a reset restarts at round 1");
  } else {
    if (report.round !== prior.round + 1) add("round", `must be ${prior.round + 1}`);
    // Earlier findings stay open until fixed, so none may drop out of the list.
    const present = new Set(findings.map((finding) => finding.id));
    const dropped = [...earlier.keys()].filter((id) => text(id) && !present.has(id));
    if (dropped.length) add("findings", `earlier findings are missing: ${dropped.join(", ")}`);
  }
  return undefined;
}

function checkDesignDirector(options = {}) {
  const issues = [];
  const add = (field, message) => issues.push({ path: `report.${field}`, message });
  const root = options.root || process.cwd();
  const reportPath = String(options.reportPath || "")
    .split(path.sep)
    .join("/");
  const located = REPORT_PATH_RE.exec(reportPath);
  if (!located)
    return {
      ok: false,
      issues: [
        {
          path: "report",
          message:
            "must be .pm/dev-sessions/{slug}/design-critique/director/{run}/review-{1-5}/report.json",
        },
      ],
    };
  const directory = path.posix.dirname(reportPath);
  const runName = located[2];
  const reviewNumber = Number(located[3]);
  let bytes;
  let report;
  try {
    bytes = readProjectInput(root, reportPath, MAX_REPORT_BYTES).bytes;
    report = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { ok: false, issues: [{ path: "report", message: `cannot be read: ${error.message}` }] };
  }
  if (!isObject(report))
    return { ok: false, issues: [{ path: "report", message: "must be a JSON object" }] };

  if (report.schema !== REPORT_SCHEMA) add("schema", `must equal ${REPORT_SCHEMA}`);
  if (report.schema_version !== 1) add("schema_version", "must equal 1");
  if (report.run_id !== runName) add("run_id", `must equal ${runName}, from its path`);
  if (!text(report.session_run_id)) add("session_run_id", "is required");
  else if (options.runId && report.session_run_id !== options.runId)
    add("session_run_id", `must equal the session run ${options.runId}`);
  if (report.review !== reviewNumber) add("review", `must equal ${reviewNumber}, from its path`);
  if (!Number.isInteger(report.review) || report.review < 1 || report.review > MAX_REVIEWS)
    add("review", `a run has at most ${MAX_REVIEWS} reviews`);
  if (!Number.isInteger(report.round) || report.round < 1 || report.round > MAX_ROUNDS)
    add("round", `must be 1 through ${MAX_ROUNDS}`);
  if (!isGitObjectId(report.commit)) add("commit", "must be the full commit the review ran at");
  else if (options.commit && report.commit !== options.commit)
    add("commit", `the review ran at ${report.commit}, not at ${options.commit}`);
  if (report.recovery_policy !== RECOVERY_POLICY)
    add("recovery_policy", `must equal ${RECOVERY_POLICY}`);
  if (!["approve", "reject"].includes(report.verdict)) add("verdict", "must be approve or reject");
  if (report.outcome !== (report.verdict === "approve" ? "passed" : "failed"))
    add("outcome", "must be passed for an approval and failed for a rejection");

  const findingsById = checkFindings(report, add);
  const shots = checkEvidence(report, root, directory, add);
  checkScores(report, findingsById, shots, add);
  checkSweepAndStates(report, findingsById, add);
  checkAgents(report, add);
  checkFirstImpression(report, findingsById, add);
  if (Number.isInteger(report.review) && Number.isInteger(report.round))
    checkLineage(report, root, directory, reviewNumber, add);

  const reasons = blockers(report);
  if (report.verdict === "approve" && reasons.length > 0)
    add("verdict", `cannot approve: ${reasons.slice(0, 5).join("; ")}`);
  if (report.verdict === "reject" && reasons.length === 0 && issues.length === 0)
    add("verdict", "a rejection needs a score below the floor or an open blocking finding");

  return {
    ok: issues.length === 0,
    issues,
    outcome: report.outcome,
    verdict: report.verdict,
    review: report.review,
    round: report.round,
    run_id: report.run_id,
    commit: report.commit,
    blockers: reasons,
    follow_ups: listOf(report.findings)
      .filter((finding) => isObject(finding) && finding.status === "filed")
      .map((finding) => finding.id),
    report_sha256: sha256(bytes),
    // A rejection in the last round, or with no review left, parks the work.
    parks:
      report.verdict === "reject" && (report.round === MAX_ROUNDS || report.review === MAX_REVIEWS),
  };
}

function isDirectorReportPath(value) {
  return REPORT_PATH_RE.test(String(value || ""));
}

module.exports = {
  DIMENSIONS,
  MAX_REVIEWS,
  MAX_ROUNDS,
  PASS_FLOOR,
  REPORT_SCHEMA,
  checkDesignDirector,
  isDirectorReportPath,
};
