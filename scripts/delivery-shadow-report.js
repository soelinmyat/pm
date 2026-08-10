#!/usr/bin/env node
"use strict";

const ELIGIBLE_SIZES = new Set(["XS", "S"]);
const ROUTES = ["actual", "proposed"];

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function boundedString(value, field) {
  if (typeof value !== "string" || !value || value.length > 128 || /[\0\r\n]/.test(value))
    throw new Error(`${field} must be a bounded identifier`);
  return value;
}

function metric(value, field) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be nonnegative`);
  return value;
}

function normalizeDelivery(value) {
  const normalized = {
    id: boundedString(value?.id, "delivery id"),
    size: boundedString(value?.size, "delivery size"),
    app: boundedString(value?.app, "app"),
    actual_route: boundedString(value?.actual_route, "actual route"),
    proposed_route: boundedString(value?.proposed_route, "proposed route"),
  };
  for (const side of ROUTES) {
    normalized[side] = {
      implementation_complete_to_merge_ready_ms: metric(
        value?.[side]?.implementation_complete_to_merge_ready_ms,
        `${side} time`
      ),
      certification_count: metric(
        value?.[side]?.certification_count,
        `${side} certification count`
      ),
    };
  }
  return normalized;
}

function buildShadowReport(deliveries) {
  if (!Array.isArray(deliveries)) throw new Error("deliveries must be an array");
  const eligible = deliveries
    .filter((delivery) => ELIGIBLE_SIZES.has(delivery?.size))
    .map(normalizeDelivery)
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set();
  for (const delivery of eligible) {
    if (ids.has(delivery.id)) throw new Error(`duplicate delivery id: ${delivery.id}`);
    ids.add(delivery.id);
  }
  const groups = new Map();
  for (const delivery of eligible) {
    for (const side of ROUTES) {
      const route = delivery[`${side}_route`];
      const key = `${route}\0${delivery.app}`;
      const group = groups.get(key) || { route, app: delivery.app, times: [], certifications: [] };
      group.times.push(delivery[side].implementation_complete_to_merge_ready_ms);
      group.certifications.push(delivery[side].certification_count);
      groups.set(key, group);
    }
  }
  const actualTimes = eligible.map(
    (delivery) => delivery.actual.implementation_complete_to_merge_ready_ms
  );
  const proposedTimes = eligible.map(
    (delivery) => delivery.proposed.implementation_complete_to_merge_ready_ms
  );
  const actualMedian = median(actualTimes);
  const proposedMedian = median(proposedTimes);
  const observed = actualMedian > 0 ? ((actualMedian - proposedMedian) / actualMedian) * 100 : null;
  const evaluated = eligible.length >= 20;
  return {
    schema_version: 1,
    kind: "delivery-shadow-report-v1",
    status: evaluated ? "evaluated" : "insufficient-sample",
    eligible_deliveries: eligible.length,
    eligibility: { sizes: ["XS", "S"], minimum_deliveries: 20 },
    by_route_app: [...groups.values()]
      .sort((left, right) =>
        left.route === right.route
          ? left.app.localeCompare(right.app)
          : left.route.localeCompare(right.route)
      )
      .map((group) => ({
        route: group.route,
        app: group.app,
        deliveries: group.times.length,
        median_time_ms: median(group.times),
        median_certification_count: median(group.certifications),
      })),
    threshold: {
      evaluated,
      required_improvement_percent: 50,
      actual_median_time_ms: actualMedian,
      proposed_median_time_ms: proposedMedian,
      observed_improvement_percent: observed === null ? null : Math.round(observed * 100) / 100,
      passed: evaluated && observed !== null && observed >= 50,
    },
  };
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error("shadow input exceeds one MiB");
  });
  process.stdin.on("end", () => {
    process.stdout.write(`${JSON.stringify(buildShadowReport(JSON.parse(input)))}\n`);
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${String(error.message).slice(0, 1000)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildShadowReport, median };
