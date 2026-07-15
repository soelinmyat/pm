"use strict";

const GIT_ENV_KEYS_TO_CLEAR = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_SUPER_PREFIX",
]);

function cleanGitEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const key of GIT_ENV_KEYS_TO_CLEAR) delete env[key];
  return env;
}

module.exports = { GIT_ENV_KEYS_TO_CLEAR, cleanGitEnv };
