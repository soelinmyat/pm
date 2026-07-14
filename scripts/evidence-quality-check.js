#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateCitationBindings } = require("./lib/evidence-schema");

function scoreEvidenceArtifact({ markdown, ledger, artifactPath }) {
  const citationIssues = validateCitationBindings({ markdown, ledger, artifactPath });
  const citations = [...markdown.matchAll(/\[evidence:(ev_[a-f0-9]{24})\]/g)].map(
    (match) => match[1]
  );
  const distinctCitations = new Set(citations);
  const dimensions = {
    traceability:
      citationIssues.length === 0 ? 2 : /provenance_version:\s*2/.test(markdown) ? 1 : 0,
    source_coverage: distinctCitations.size >= 2 ? 2 : distinctCitations.size === 1 ? 1 : 0,
    uncertainty:
      /\bHypothesis:/i.test(markdown) && /## Open Questions\s*\n[\s\S]*?\S/i.test(markdown)
        ? 2
        : /\b(?:Hypothesis:|Open Questions)\b/i.test(markdown)
          ? 1
          : 0,
    contradiction: /^\s*[-*]\s+Contradiction:.*(?:\[evidence:ev_[a-f0-9]{24}\].*){2}/im.test(
      markdown
    )
      ? 2
      : /\bContradiction:/i.test(markdown)
        ? 1
        : 0,
    decision_usefulness:
      /## Strategic Relevance\s*\n[\s\S]*?\S/i.test(markdown) &&
      /## Implications\s*\n[\s\S]*?\b(?:prioritize|test|measure|defer|build|avoid|segment)\b/i.test(
        markdown
      )
        ? 2
        : /## (?:Strategic Relevance|Implications)/i.test(markdown)
          ? 1
          : 0,
  };
  return {
    schema_version: 1,
    score: Object.values(dimensions).reduce((sum, value) => sum + value, 0),
    max_score: 10,
    dimensions,
    citation_issues: citationIssues,
  };
}

function main(argv = process.argv.slice(2)) {
  const fixtureDir = argv[0] && path.resolve(argv[0]);
  if (!fixtureDir) throw new Error("fixture directory is required");
  const result = scoreEvidenceArtifact({
    markdown: fs.readFileSync(path.join(fixtureDir, "artifact.md"), "utf8"),
    ledger: JSON.parse(fs.readFileSync(path.join(fixtureDir, "ledger.json"), "utf8")),
    artifactPath: "evidence/research/bulk-editing.md",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.citation_issues.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`evidence-quality-check: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { main, scoreEvidenceArtifact };
