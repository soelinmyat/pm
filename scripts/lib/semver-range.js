"use strict";

const VERSION =
  /^(?:v|=)?(0|[1-9]\d*)(?:\.(0|[1-9]\d*|[xX*]))?(?:\.(0|[1-9]\d*|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(value, { partial = false } = {}) {
  const match = String(value || "")
    .trim()
    .match(VERSION);
  if (!match) return null;
  const parts = match.slice(1, 4);
  const specified = parts.filter((part) => part !== undefined).length;
  const wildcard = parts.findIndex((part) => part === "x" || part === "X" || part === "*");
  if (!partial && (specified !== 3 || wildcard !== -1)) return null;
  if (wildcard !== -1 && parts.slice(wildcard + 1).some((part) => part && !/[xX*]/.test(part)))
    return null;
  return {
    major: Number(parts[0]),
    minor: parts[1] === undefined || /[xX*]/.test(parts[1]) ? 0 : Number(parts[1]),
    patch: parts[2] === undefined || /[xX*]/.test(parts[2]) ? 0 : Number(parts[2]),
    prerelease: match[4] ? match[4].split(".") : [],
    specified,
    wildcard: wildcard === -1 ? null : wildcard,
  };
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left);
  const rightNumber = /^\d+$/.test(right);
  if (leftNumber && rightNumber) return Number(left) - Number(right);
  if (leftNumber) return -1;
  if (rightNumber) return 1;
  return left.localeCompare(right);
}

function compare(left, right) {
  for (const key of ["major", "minor", "patch"])
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  if (left.prerelease.length === 0 || right.prerelease.length === 0)
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
        ? 1
        : -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const result = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result < 0 ? -1 : 1;
  }
  return 0;
}

function stableVersion(version) {
  return { ...version, prerelease: [] };
}

function increment(version, key) {
  const next = stableVersion(version);
  if (key === "major") return { ...next, major: next.major + 1, minor: 0, patch: 0 };
  if (key === "minor") return { ...next, minor: next.minor + 1, patch: 0 };
  return { ...next, patch: next.patch + 1 };
}

function lower(version, inclusive = true) {
  return { lower: version, lowerInclusive: inclusive };
}

function upper(version, inclusive = false) {
  return { upper: version, upperInclusive: inclusive };
}

function partialBounds(parsed) {
  const wildcardIndex = parsed.wildcard === null ? parsed.specified : parsed.wildcard;
  if (wildcardIndex <= 1)
    return { ...lower(stableVersion(parsed)), ...upper(increment(parsed, "major")) };
  if (wildcardIndex === 2)
    return { ...lower(stableVersion(parsed)), ...upper(increment(parsed, "minor")) };
  return { exact: parsed };
}

function tokenBounds(token) {
  const match = token.match(/^(\^|~|>=|<=|>|<|=)?\s*(.+)$/);
  if (!match) return null;
  const operator = match[1] || "";
  if (match[2] === "*" || /^[xX]$/.test(match[2])) return {};
  const parsed = parseVersion(match[2], { partial: true });
  if (!parsed) return null;
  if (operator === "^") {
    const ceiling =
      parsed.major > 0
        ? increment(parsed, "major")
        : parsed.minor > 0
          ? increment(parsed, "minor")
          : increment(parsed, "patch");
    return { ...lower(parsed), ...upper(ceiling) };
  }
  if (operator === "~") {
    const ceiling = parsed.specified <= 1 ? increment(parsed, "major") : increment(parsed, "minor");
    return { ...lower(parsed), ...upper(ceiling) };
  }
  if (!operator || operator === "=") return partialBounds(parsed);
  if (parsed.wildcard !== null || parsed.specified < 3) {
    const bounds = partialBounds(parsed);
    if (bounds.exact)
      return operator.startsWith(">")
        ? lower(parsed, operator === ">=")
        : upper(parsed, operator === "<=");
    if (operator === ">=") return lower(bounds.lower, true);
    if (operator === ">") return lower(bounds.upper, true);
    if (operator === "<") return upper(bounds.lower, false);
    return upper(bounds.upper, false);
  }
  if (operator === ">=") return lower(parsed, true);
  if (operator === ">") return lower(parsed, false);
  if (operator === "<=") return upper(parsed, true);
  return upper(parsed, false);
}

function mergeBounds(target, source) {
  if (source.exact) {
    source = { ...lower(source.exact), ...upper(source.exact, true) };
  }
  if (source.lower) {
    const order = target.lower ? compare(source.lower, target.lower) : 1;
    if (!target.lower || order > 0 || (order === 0 && !source.lowerInclusive)) {
      target.lower = source.lower;
      target.lowerInclusive = source.lowerInclusive;
    }
  }
  if (source.upper) {
    const order = target.upper ? compare(source.upper, target.upper) : -1;
    if (!target.upper || order < 0 || (order === 0 && !source.upperInclusive)) {
      target.upper = source.upper;
      target.upperInclusive = source.upperInclusive;
    }
  }
  return target;
}

function nonEmpty(bounds) {
  if (!bounds.lower || !bounds.upper) return true;
  const order = compare(bounds.lower, bounds.upper);
  return order < 0 || (order === 0 && bounds.lowerInclusive && bounds.upperInclusive);
}

function parseAlternative(text) {
  const hyphen = text.match(/^\s*(\S+)\s+-\s+(\S+)\s*$/);
  const tokens = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : text.trim().split(/\s+/);
  const bounds = {};
  for (const token of tokens.filter(Boolean)) {
    const parsed = tokenBounds(token);
    if (!parsed) return null;
    mergeBounds(bounds, parsed);
  }
  return nonEmpty(bounds) ? bounds : null;
}

function parseRange(value) {
  const text = String(value || "").trim() || "*";
  const alternatives = text.split("||").map(parseAlternative);
  return alternatives.some((item) => item === null) ? null : alternatives;
}

function inBounds(version, bounds) {
  if (bounds.lower) {
    const order = compare(version, bounds.lower);
    if (order < 0 || (order === 0 && !bounds.lowerInclusive)) return false;
  }
  if (bounds.upper) {
    const order = compare(version, bounds.upper);
    if (order > 0 || (order === 0 && !bounds.upperInclusive)) return false;
  }
  return true;
}

function satisfies(versionText, rangeText) {
  const version = parseVersion(versionText);
  const range = parseRange(rangeText);
  return Boolean(version && range && range.some((bounds) => inBounds(version, bounds)));
}

function rangesIntersect(rangeTexts) {
  let combined = [{}];
  for (const text of rangeTexts) {
    const alternatives = parseRange(text);
    if (!alternatives) return false;
    combined = combined
      .flatMap((existing) =>
        alternatives.map((alternative) => mergeBounds({ ...existing }, alternative))
      )
      .filter(nonEmpty);
    if (combined.length === 0) return false;
  }
  return combined.length > 0;
}

module.exports = { parseVersion, parseRange, compare, satisfies, rangesIntersect };
