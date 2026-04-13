#!/usr/bin/env node
"use strict";

const { readStdin } = require("./kb-utils.js");

function normalizeSelection(selection, max) {
  if (selection === undefined || selection === null || selection === "" || selection === "skip") {
    return [];
  }

  if (selection === "all") {
    return Array.from({ length: max }, (_, index) => index + 1);
  }

  if (Array.isArray(selection)) {
    return Array.from(
      new Set(
        selection.map((value) => {
          const parsed = Number.parseInt(String(value), 10);
          if (!Number.isInteger(parsed)) {
            throw new Error(`selection must contain integers, got "${value}"`);
          }
          return parsed;
        })
      )
    ).sort((left, right) => left - right);
  }

  if (typeof selection === "string") {
    return normalizeSelection(
      selection
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      max
    );
  }

  throw new Error(
    'selection must be "all", "skip", a comma-delimited string, or an array of indices'
  );
}

function normalizeRoute(route) {
  const normalized = {
    mode: route.mode,
    evidencePath: route.evidencePath,
    insightPath: route.insightPath,
    description: route.description,
  };

  if (route.mode === "new") {
    normalized.domain = route.domain;
    normalized.topic = route.topic;
  }

  return normalized;
}

function flattenSuggestions(payload) {
  const base = payload && typeof payload === "object" ? payload : {};
  const source =
    base.routeSuggestions && typeof base.routeSuggestions === "object"
      ? base.routeSuggestions
      : base;
  const items = Array.isArray(source.items)
    ? source.items
    : [
        {
          evidencePath: source.evidencePath,
          suggestions: Array.isArray(source.suggestions) ? source.suggestions : [],
          suggestedNewRoute: source.suggestedNewRoute || null,
        },
      ].filter(
        (item) => item.evidencePath || item.suggestions.length > 0 || item.suggestedNewRoute
      );

  const flattened = [];
  for (const item of items) {
    for (const suggestion of item.suggestions || []) {
      flattened.push({
        number: flattened.length + 1,
        evidencePath: item.evidencePath || suggestion.evidencePath,
        topic: item.topic || suggestion.topic,
        reason: suggestion.reason || "",
        route: normalizeRoute(suggestion),
      });
    }
    if (item.suggestedNewRoute) {
      flattened.push({
        number: flattened.length + 1,
        evidencePath: item.evidencePath || item.suggestedNewRoute.evidencePath,
        topic: item.topic || item.suggestedNewRoute.topic,
        reason: item.suggestedNewRoute.reason || "",
        route: normalizeRoute(item.suggestedNewRoute),
      });
    }
  }

  return flattened;
}

function selectRoutes(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const flattened = flattenSuggestions(payload);
  const chosenNumbers = normalizeSelection(payload.selection, flattened.length);
  const selected = chosenNumbers.map((number) => {
    const match = flattened.find((item) => item.number === number);
    if (!match) {
      throw new Error(`selection index ${number} is out of range`);
    }
    return match;
  });

  return {
    routes: selected.map((item) => item.route),
    selected: selected.map(({ number, evidencePath, topic, reason, route }) => ({
      number,
      evidencePath,
      topic,
      reason,
      insightPath: route.insightPath,
      mode: route.mode,
    })),
    available: flattened.map(({ number, evidencePath, topic, reason, route }) => ({
      number,
      evidencePath,
      topic,
      reason,
      insightPath: route.insightPath,
      mode: route.mode,
    })),
  };
}

function main() {
  try {
    const payload = JSON.parse(readStdin() || "{}");
    const result = selectRoutes(payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  flattenSuggestions,
  selectRoutes,
};
