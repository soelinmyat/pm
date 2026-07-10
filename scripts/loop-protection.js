"use strict";

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function isProtectedSourcePath(value) {
  const file = normalizePath(value);
  return (
    file === ".dev-lifecycle-stage" ||
    file === ".pm" ||
    file.startsWith(".pm/") ||
    file === "pm" ||
    file.startsWith("pm/")
  );
}

function protectedSourcePaths(files) {
  return [...new Set((files || []).map(normalizePath).filter(isProtectedSourcePath))].sort();
}

module.exports = {
  isProtectedSourcePath,
  protectedSourcePaths,
};
