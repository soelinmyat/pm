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

function classForSkill(skill) {
  return SKILL_CLASSIFICATION[skill.name] || skill.skillFm?.["skill-class"] || null;
}

module.exports = { SKILL_CLASSES, SKILL_CLASSIFICATION, classForSkill };
