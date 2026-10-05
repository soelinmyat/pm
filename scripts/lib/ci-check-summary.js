"use strict";

// Pure projection of a complete, independently observed required-check snapshot.
// Acquisition, pagination, requirement discovery and merge authority belong to
// the repository adapter, not this helper.
function summarizeRequiredChecks(snapshot) {
  const unavailable = (reason) => ({ status: "unavailable", all_required_passed: false, reason });
  if (!snapshot || !/^[a-f0-9]{40,64}$/i.test(snapshot.expectedHead || "")) {
    return unavailable("expected head is missing or invalid");
  }
  if (snapshot.observedHead !== snapshot.expectedHead) {
    return unavailable("observed PR head does not match the prepared commit");
  }
  if (snapshot.requirementsKnown !== true || snapshot.observationComplete !== true) {
    return unavailable("required-check policy or complete check observation is unavailable");
  }
  if (!Array.isArray(snapshot.requiredChecks) || !Array.isArray(snapshot.checks)) {
    return unavailable("required-check snapshot is malformed");
  }
  if (snapshot.requiredChecks.length === 0) {
    return {
      status: "not-required",
      all_required_passed: false,
      head: snapshot.expectedHead,
      checks: [],
    };
  }
  const requiredNames = new Set();
  const rows = [];
  for (const required of snapshot.requiredChecks) {
    if (!required || typeof required.name !== "string" || !required.name.trim()) {
      return unavailable("required check identity is malformed");
    }
    const identity = JSON.stringify([required.name, required.appId ?? null]);
    if (requiredNames.has(identity)) return unavailable("required check identities are duplicated");
    requiredNames.add(identity);
    const accepted = Object.prototype.hasOwnProperty.call(required, "acceptedConclusions")
      ? required.acceptedConclusions
      : ["success"];
    if (
      !Array.isArray(accepted) ||
      !accepted.length ||
      accepted.some((value) => !["success", "neutral", "skipped"].includes(value))
    ) {
      return unavailable("accepted conclusions must come from observed repository policy");
    }
    const matches = snapshot.checks.filter(
      (check) =>
        check &&
        check.name === required.name &&
        (required.appId === null ||
          required.appId === undefined ||
          check.appId === required.appId) &&
        check.headSha === snapshot.expectedHead
    );
    let status;
    if (matches.length === 0) status = "missing";
    else if (matches.length > 1) status = "ambiguous";
    else {
      const check = matches[0];
      const conclusion = String(check.conclusion || "").toLowerCase();
      if (
        ["failure", "timed_out", "cancelled", "action_required", "stale", "error"].includes(
          conclusion
        )
      ) {
        status = "failed";
      } else if (String(check.status || "").toLowerCase() !== "completed") {
        status = "pending";
      } else if (accepted.includes(conclusion)) {
        status = "passed";
      } else {
        status = "unavailable";
      }
    }
    rows.push({ name: required.name, appId: required.appId ?? null, status });
  }
  const status = rows.every((row) => row.status === "passed")
    ? "passed"
    : ["failed", "ambiguous", "missing", "unavailable", "pending"].find((value) =>
        rows.some((row) => row.status === value)
      );
  return {
    status,
    all_required_passed: status === "passed",
    head: snapshot.expectedHead,
    checks: rows,
  };
}

module.exports = { summarizeRequiredChecks };
