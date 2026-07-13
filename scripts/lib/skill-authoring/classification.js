"use strict";

const SKILL_CLASSIFICATION = Object.freeze({
  board: "operational-effect",
  bug: "capture",
  "design-critique": "reviewer-gate",
  dev: "lifecycle",
  features: "evidence-pipeline",
  groom: "lifecycle",
  ideate: "conversational",
  ingest: "evidence-pipeline",
  list: "read-only-projection",
  loop: "operational-effect",
  note: "capture",
  refresh: "evidence-pipeline",
  research: "evidence-pipeline",
  review: "reviewer-gate",
  rfc: "lifecycle",
  setup: "operational-effect",
  ship: "lifecycle",
  simplify: "redirect",
  start: "operational-effect",
  strategy: "conversational",
  sync: "operational-effect",
  task: "capture",
  think: "conversational",
  "using-pm": "operational-effect",
});

const SKILL_CLASSES = Object.freeze([
  "lifecycle",
  "evidence-pipeline",
  "reviewer-gate",
  "operational-effect",
  "read-only-projection",
  "conversational",
  "capture",
  "redirect",
]);

const STEP_TRANSITIONS = Object.freeze({
  loop: Object.freeze({
    1: Object.freeze([2, 3, 4, 5, 6, 7]),
    2: Object.freeze([]),
    3: Object.freeze([]),
    4: Object.freeze([]),
    5: Object.freeze([]),
    6: Object.freeze([]),
    7: Object.freeze([]),
  }),
  research: Object.freeze({
    1: Object.freeze([2]),
    2: Object.freeze([3, 4, 5]),
    3: Object.freeze([]),
    4: Object.freeze([]),
    5: Object.freeze([]),
  }),
  refresh: Object.freeze({
    1: Object.freeze([2, 4]),
    2: Object.freeze([3]),
    3: Object.freeze([4]),
    4: Object.freeze([5]),
    5: Object.freeze([]),
  }),
});

function classForSkill(skill) {
  return SKILL_CLASSIFICATION[skill.name] || skill.skillFm?.["skill-class"] || null;
}

module.exports = { SKILL_CLASSES, SKILL_CLASSIFICATION, STEP_TRANSITIONS, classForSkill };
