"use strict";

function skipResult() {
  return {
    status: "skip",
    reason: "network-policy",
    detail: "codex live adapter requires container network allowlisting proof before execution",
  };
}

module.exports = {
  name: "codex",
  live: true,
  preflight: skipResult,
  run: skipResult,
};
