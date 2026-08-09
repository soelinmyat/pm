"use strict";

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function isGitObjectId(value) {
  return typeof value === "string" && GIT_OBJECT_ID.test(value);
}

function zeroObjectIdLike(value) {
  if (!isGitObjectId(value)) throw new Error("Git object ID format is unavailable");
  return "0".repeat(value.length);
}

function sameObjectIdFormat(left, right) {
  return isGitObjectId(left) && isGitObjectId(right) && left.length === right.length;
}

module.exports = { isGitObjectId, sameObjectIdFormat, zeroObjectIdLike };
