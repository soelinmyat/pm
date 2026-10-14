"use strict";

const { exactObject } = require("./closed-object");
const { coverageReasonIssue } = require("./design-critique-coverage-reason");
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Named scenarios distinguish genuine locale/data/task variants. They never
// exempt a capture from native proof, pixel checks or frozen route ownership.
function validateScenarios(route) {
  const scenarios = new Map();
  if (route.scenarios !== undefined) {
    if (route.schema_version !== 2 || route.mode !== "product-ui")
      throw new Error("route.scenarios requires schema-v2 product-ui coverage");
    if (!Array.isArray(route.scenarios) || !route.scenarios.length || route.scenarios.length > 1000)
      throw new Error("route.scenarios must contain 1 through 1000 rows");
    for (const [index, scenario] of route.scenarios.entries()) {
      const label = `route.scenarios[${index}]`;
      exactObject(scenario, ["id", "subject_id", "description"], label);
      if (typeof scenario.id !== "string" || scenario.id.length > 200 || !ID.test(scenario.id))
        throw new Error(`${label}.id must be bounded kebab-case`);
      if (scenarios.has(scenario.id)) throw new Error(`${label}.id must be unique`);
      if (
        !route.subjects?.some(
          (subject) => subject?.id === scenario.subject_id && subject.platform === "web"
        )
      )
        throw new Error(`${label}.subject_id must reference a web subject`);
      const reasonIssue = coverageReasonIssue(scenario.description, { allowBlank: false });
      if (reasonIssue) throw new Error(`${label}.description ${reasonIssue}`);
      scenarios.set(scenario.id, scenario);
    }
  }
  const used = new Set();
  for (const [index, row] of (route.coverage || []).entries()) {
    if (row?.scenario_id === undefined) continue;
    const scenario = scenarios.get(row.scenario_id);
    if (!scenario || scenario.subject_id !== row.subject_id)
      throw new Error(
        `route.coverage[${index}].scenario_id must reference a scenario for the same subject`
      );
    used.add(row.scenario_id);
  }
  for (const id of scenarios.keys())
    if (!used.has(id)) throw new Error(`route.scenarios.${id} must have a coverage decision`);
}

function coverageIdentity(coverage) {
  return {
    id: coverage.id,
    state: coverage.state,
    viewport: coverage.viewport,
    ...(coverage.scenario_id === undefined ? {} : { scenario_id: coverage.scenario_id }),
  };
}

module.exports = { validateScenarios, coverageIdentity };
