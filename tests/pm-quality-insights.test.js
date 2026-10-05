"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { writeKnowledgeArtifact } = require("../scripts/knowledge-writeback");
const { applyRoutes } = require("../scripts/insight-routing");
const { rewriteInsights, sourceFingerprint } = require("../scripts/insight-rewrite");
const { generateRouteSuggestions } = require("../scripts/insight-route-suggestions");
const { loadMarkdown, writeMarkdown } = require("../scripts/kb-utils");

const SOURCE = "evidence/research/team-requests.md";
const INSIGHT = "insights/product/request-location.md";
const NAVIGATION =
  "[internal] Supervisors cannot locate Time off from Team. [evidence:ev_0123456789abcdef01234567]";
const COUNTER =
  "Contradiction: administrators find the request destination quickly; broad prevalence is unverified. [evidence:ev_89abcdef0123456789abcdef]";

function fixture(t) {
  const pmDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-quality-insights-"));
  t.after(() => fs.rmSync(pmDir, { recursive: true, force: true }));
  return pmDir;
}

function evidence(
  pmDir,
  source = SOURCE,
  findings = ["[internal] The CSV import is useful for weekly uploads.", NAVIGATION, COUNTER]
) {
  writeMarkdown(
    path.join(pmDir, source),
    {
      type: "evidence",
      evidence_type: "research",
      topic: "Team requests",
      source_origin: "internal",
      created: "2026-04-10",
      updated: "2026-04-10",
      sources: [],
      cited_by: [],
    },
    `# Team requests\n\n## Summary\n\nOne supervisor group discussed several different tasks. Demand outside this group is unknown.\n\n## Findings\n\n${findings.map((finding, index) => `${index + 1}. ${finding}`).join("\n")}\n\n## Confidence Notes\n\nOne upstream interview group; derivative summaries are not independent support.\n\n## Open Questions\n\nWill a persistent Team entry improve task completion?\n\n## Superseded Findings\n\nAn older assumption of universal navigation failure was withdrawn.\n`
  );
}

function insight(pmDir, sources = [SOURCE]) {
  writeMarkdown(
    path.join(pmDir, INSIGHT),
    {
      type: "insight",
      domain: "product",
      topic: "Request location",
      last_updated: "2026-04-10",
      status: "active",
      confidence: "medium",
      sources,
    },
    "# Request location\n\n## Synthesis\n\nTest navigation with supervisors before expanding this recommendation. Administrators may have different needs.\n\n## Analyst Counterevidence\n\nThe power-user study found no navigation problem.\n"
  );
}

function route(pmDir, extra = {}) {
  return applyRoutes(
    pmDir,
    {
      routes: [
        {
          mode: "existing",
          evidencePath: SOURCE,
          insightPath: INSIGHT,
          description: "Inspect request location",
          ...extra,
        },
      ],
    },
    { skipHotIndex: true }
  );
}

test("routing a later relevant claim preserves counterevidence and analyst text without asserting CSV relevance", (t) => {
  const pmDir = fixture(t);
  evidence(pmDir);
  insight(pmDir);
  const before = loadMarkdown(path.join(pmDir, INSIGHT)).body.trim();
  const result = route(pmDir, { selected_findings: [NAVIGATION] });
  assert.equal(result.rewrites[0].action, "digest-updated");
  const after = loadMarkdown(path.join(pmDir, INSIGHT));
  assert.ok(after.body.includes(before));
  assert.ok(after.body.includes(COUNTER));
  assert.match(after.body, /older assumption of universal navigation failure was withdrawn/);
  assert.equal(after.frontmatter.source_claims[0].finding, NAVIGATION);
  const selection = after.body
    .split("**Selected findings for this topic")[1]
    .split("**Complete source context")[0];
  assert.match(selection, /Supervisors cannot locate/);
  assert.doesNotMatch(selection, /CSV import/);
  assert.equal(after.frontmatter.confidence, "low");
  assert.equal(after.frontmatter.status, "stale");
  assert.equal(after.frontmatter.synthesis_state, "needs-synthesis");
  assert.match(after.body, /Confidence Rationale/);
  assert.doesNotMatch(after.body, /support this topic from multiple angles/);
});

test("four derivative evidence files never promote confidence or synthesize independent demand", (t) => {
  const pmDir = fixture(t);
  const sources = [
    SOURCE,
    "evidence/research/copy-2.md",
    "evidence/research/copy-3.md",
    "evidence/research/copy-4.md",
  ];
  for (const source of sources) evidence(pmDir, source);
  insight(pmDir, sources);
  const result = rewriteInsights(pmDir, { insights: [INSIGHT] });
  assert.equal(result.insights[0].confidence, "low");
  const reader = loadMarkdown(path.join(pmDir, INSIGHT));
  assert.equal(reader.frontmatter.source_snapshots.length, 4);
  assert.match(reader.body, /No confidence upgrade is inferred/);
  assert.doesNotMatch(reader.body, /Confidence is high because/);
});

test("same-path revised source is surfaced, prior selection becomes historical, and unchanged replay does not repeat", (t) => {
  const pmDir = fixture(t);
  evidence(pmDir);
  insight(pmDir);
  route(pmDir, { selected_findings: [NAVIGATION] });
  assert.equal(generateRouteSuggestions(pmDir, { evidencePath: SOURCE }).suggestions.length, 0);
  const beforeReplay = fs.readFileSync(path.join(pmDir, INSIGHT), "utf8");
  const repeat = route(pmDir);
  assert.equal(repeat.routes[0].action, "skipped");
  assert.equal(repeat.rewrites.length, 0);
  assert.equal(fs.readFileSync(path.join(pmDir, INSIGHT), "utf8"), beforeReplay);

  evidence(pmDir, SOURCE, [
    "[internal] The current supervisors locate requests successfully using their existing shortcut.",
    COUNTER,
  ]);
  const suggestions = generateRouteSuggestions(pmDir, { evidencePath: SOURCE });
  assert.equal(suggestions.suggestions[0].source_changed, true);
  assert.equal(suggestions.suggestions[0].insightPath, INSIGHT);
  assert.equal(suggestions.suggestedNewRoute, null);
  const changed = route(pmDir);
  assert.equal(changed.routes[0].sourceChanged, true);
  assert.equal(changed.rewrites[0].synthesis_state, "needs-synthesis");
  const reader = loadMarkdown(path.join(pmDir, INSIGHT));
  assert.match(reader.body, /Previously selected findings no longer present/);
  assert.ok(reader.body.includes(NAVIGATION));
  assert.match(reader.body, /current supervisors locate requests successfully/);
  assert.equal(generateRouteSuggestions(pmDir, { evidencePath: SOURCE }).suggestions.length, 0);
});

test("an invented or shortened selected finding cannot mutate source or insight", (t) => {
  const pmDir = fixture(t);
  evidence(pmDir);
  insight(pmDir);
  const priorSource = fs.readFileSync(path.join(pmDir, SOURCE), "utf8");
  const priorInsight = fs.readFileSync(path.join(pmDir, INSIGHT), "utf8");
  const result = route(pmDir, { selected_findings: ["Supervisors cannot locate Time off"] });
  assert.equal(result.routes[0].action, "error");
  assert.match(result.routes[0].reason, /no longer exists/);
  assert.equal(fs.readFileSync(path.join(pmDir, SOURCE), "utf8"), priorSource);
  assert.equal(fs.readFileSync(path.join(pmDir, INSIGHT), "utf8"), priorInsight);
});

test("supplied bounded synthesis keeps low-confidence rationale, exact source binding and prior counterevidence", (t) => {
  const pmDir = fixture(t);
  evidence(pmDir);
  insight(pmDir);
  route(pmDir, { selected_findings: [NAVIGATION] });
  const synthesis = {
    summary:
      "Test the entry with the observed supervisor group; do not assume demand across the ICP.",
    claims: [
      {
        text: "The supervisor group reported a task-location problem.",
        evidence_refs: [{ path: SOURCE, finding: NAVIGATION }],
      },
    ],
    confidence: {
      level: "low",
      basis: "Direct observation of one supervisor group.",
      limitations: "Independent demand beyond this group is unknown.",
    },
    open_questions: ["Does a persistent entry resolve their task-location failure?"],
  };
  const result = rewriteInsights(pmDir, { insights: [{ insightPath: INSIGHT, synthesis }] });
  assert.equal(result.insights[0].action, "synthesis-updated");
  assert.equal(result.insights[0].semantic_quality_verified, false);
  const reader = loadMarkdown(path.join(pmDir, INSIGHT));
  assert.equal(reader.frontmatter.confidence, "low");
  assert.equal(reader.frontmatter.status, "active");
  assert.equal(reader.frontmatter.synthesis_state, "reviewed");
  assert.match(reader.body, /power-user study found no navigation problem/);
  assert.match(reader.body, /Independent demand beyond this group is unknown/);
  assert.ok(reader.body.includes(COUNTER));
  assert.ok(reader.body.includes(NAVIGATION));

  const before = fs.readFileSync(path.join(pmDir, INSIGHT), "utf8");
  synthesis.claims[0].evidence_refs[0].finding = "Invented independent support.";
  const invalid = rewriteInsights(pmDir, { insights: [{ insightPath: INSIGHT, synthesis }] });
  assert.equal(invalid.insights[0].action, "error");
  assert.equal(fs.readFileSync(path.join(pmDir, INSIGHT), "utf8"), before);
});

test("landscape and competitor sources retain original provenance types during routing", (t) => {
  const pmDir = fixture(t);
  insight(pmDir, []);
  const landscape = "insights/business/landscape.md";
  writeMarkdown(
    path.join(pmDir, landscape),
    {
      type: "insight",
      domain: "business",
      topic: "Landscape",
      last_updated: "2026-04-10",
      status: "active",
      confidence: "low",
      sources: [],
    },
    "# Landscape\n\n## Initial Observations\n\nDemand outside the observed segment is unknown.\n"
  );
  const competitor = "evidence/competitors/vendor/features.md";
  writeMarkdown(
    path.join(pmDir, competitor),
    {
      type: "competitor-features",
      company: "Vendor",
      slug: "vendor",
      profiled: "2026-04-10",
      sources: [],
    },
    "# Features\n\n## Scheduling\n\nThe documented API exposes read operations only.\n"
  );
  const result = applyRoutes(
    pmDir,
    {
      routes: [landscape, competitor].map((evidencePath) => ({
        mode: "existing",
        evidencePath,
        insightPath: INSIGHT,
        description: "Inspect current source support",
      })),
    },
    { skipHotIndex: true }
  );
  assert.equal(
    result.routes.every((item) => item.action === "updated"),
    true
  );
  assert.equal(result.rewrites[0].action, "digest-updated");
  assert.equal(loadMarkdown(path.join(pmDir, landscape)).frontmatter.type, "insight");
  assert.equal(loadMarkdown(path.join(pmDir, competitor)).frontmatter.type, "competitor-features");
});

test("source revisions invalidate a reviewed assessment and replacing it preserves the analyst history", (t) => {
  const pmDir = fixture(t);
  evidence(pmDir);
  insight(pmDir);
  route(pmDir, { selected_findings: [NAVIGATION] });
  const synthesis = {
    summary: "Observed supervisors need a visible entry; administrators are counterevidence.",
    claims: [
      {
        text: "Supervisors reported difficulty.",
        evidence_refs: [{ path: SOURCE, finding: NAVIGATION }],
      },
    ],
    confidence: {
      level: "low",
      basis: "One observed group.",
      limitations: "Administrators differ.",
    },
    open_questions: [],
  };
  rewriteInsights(pmDir, { insights: [{ insightPath: INSIGHT, synthesis }] });
  const newFinding = "[internal] The same supervisors now locate requests successfully.";
  evidence(pmDir, SOURCE, [newFinding, COUNTER]);
  route(pmDir);
  let reader = loadMarkdown(path.join(pmDir, INSIGHT));
  assert.equal(reader.frontmatter.status, "stale");
  assert.equal(reader.frontmatter.synthesis_state, "needs-synthesis");
  assert.match(reader.body, /Historical assessment: linked evidence or claim selection changed/);
  assert.ok(reader.body.includes(synthesis.summary));
  const before = fs.readFileSync(path.join(pmDir, INSIGHT), "utf8");
  const priorLog = fs.readFileSync(path.join(pmDir, "insights/product/log.md"), "utf8");
  route(pmDir);
  assert.equal(fs.readFileSync(path.join(pmDir, INSIGHT), "utf8"), before);
  assert.equal(fs.readFileSync(path.join(pmDir, "insights/product/log.md"), "utf8"), priorLog);
  const updated = {
    ...synthesis,
    summary: "The current observation no longer supports that entry change.",
    claims: [
      {
        text: "The observed group completed the task.",
        evidence_refs: [{ path: SOURCE, finding: newFinding }],
      },
    ],
  };
  rewriteInsights(pmDir, { insights: [{ insightPath: INSIGHT, synthesis: updated }] });
  reader = loadMarkdown(path.join(pmDir, INSIGHT));
  assert.match(reader.body, /Historical Analyst Assessment/);
  assert.ok(reader.body.includes(synthesis.summary));
  assert.ok(reader.body.includes(updated.summary));
  assert.ok(reader.body.includes(NAVIGATION));
  assert.ok(reader.body.includes(COUNTER));
});

test("changed sources surface every dependent beyond the lexical cap", (t) => {
  const pmDir = fixture(t);
  evidence(pmDir);
  const priorSnapshot = sourceFingerprint(loadMarkdown(path.join(pmDir, SOURCE)));
  const dependents = ["a", "b", "c", "d", "e"].map((slug) => `insights/product/${slug}.md`);
  for (const insightPath of dependents) {
    writeMarkdown(
      path.join(pmDir, insightPath),
      {
        type: "insight",
        domain: "product",
        topic: `Previously evaluated ${insightPath}`,
        status: "active",
        confidence: "high",
        last_updated: "2026-04-10",
        sources: [SOURCE],
        source_snapshots: [{ path: SOURCE, sha256: priorSnapshot }],
      },
      "# Previous assessment\n\nThe earlier conclusion concerned a different question.\n"
    );
  }
  for (const slug of ["lexical-a", "lexical-b", "lexical-c", "lexical-d"]) {
    writeMarkdown(
      path.join(pmDir, `insights/product/${slug}.md`),
      {
        type: "insight",
        domain: "product",
        topic: `Team requests ${slug}`,
        status: "draft",
        confidence: "low",
        last_updated: "2026-04-10",
        sources: [],
      },
      "# Team requests\n"
    );
  }
  evidence(pmDir, SOURCE, ["[internal] Supervisors now locate requests successfully."]);
  const result = generateRouteSuggestions(pmDir, { evidencePath: SOURCE, maxSuggestions: 2 });
  assert.deepEqual(
    result.suggestions
      .filter((item) => item.source_changed)
      .map((item) => item.insightPath)
      .sort(),
    dependents
  );
  assert.equal(result.suggestions.filter((item) => !item.source_changed).length, 2);
  const routed = applyRoutes(
    pmDir,
    { routes: result.suggestions.filter((item) => item.source_changed) },
    { skipHotIndex: true }
  );
  assert.equal(routed.rewrites.length, 5);
  for (const insightPath of dependents) {
    const reader = loadMarkdown(path.join(pmDir, insightPath));
    assert.equal(reader.frontmatter.status, "stale");
    assert.equal(reader.frontmatter.synthesis_state, "needs-synthesis");
    assert.equal(reader.frontmatter.confidence, "low");
  }
});

test("landscape cannot suggest or directly route itself", (t) => {
  const pmDir = fixture(t);
  const landscape = "insights/business/landscape.md";
  writeMarkdown(
    path.join(pmDir, landscape),
    {
      type: "insight",
      domain: "business",
      topic: "Landscape",
      last_updated: "2026-04-10",
      status: "draft",
      confidence: "low",
      sources: [],
    },
    "# Landscape\n\n## Summary\n\nLandscape contains market patterns.\n"
  );
  const before = fs.readFileSync(path.join(pmDir, landscape), "utf8");
  const suggestions = generateRouteSuggestions(pmDir, { evidencePath: landscape });
  assert.equal(
    suggestions.suggestions.some((item) => item.insightPath === landscape),
    false
  );
  const result = applyRoutes(
    pmDir,
    {
      routes: [
        {
          mode: "existing",
          evidencePath: landscape,
          insightPath: landscape,
          description: "Landscape",
        },
      ],
    },
    { skipHotIndex: true }
  );
  assert.equal(result.routes[0].action, "error");
  assert.match(result.routes[0].reason, /itself/);
  assert.equal(fs.readFileSync(path.join(pmDir, landscape), "utf8"), before);
  assert.deepEqual(loadMarkdown(path.join(pmDir, landscape)).frontmatter.sources, []);
});

test("standalone supplied synthesis projects canonical state into domain and hot indexes", (t) => {
  const pmDir = fixture(t);
  evidence(pmDir);
  insight(pmDir);
  const doc = loadMarkdown(path.join(pmDir, INSIGHT));
  writeMarkdown(
    path.join(pmDir, INSIGHT),
    { ...doc.frontmatter, status: "draft", confidence: "low" },
    doc.body
  );
  fs.writeFileSync(
    path.join(pmDir, "insights/product/index.md"),
    "# Product\n\n| Topic/Source | Description | Updated | Status |\n|---|---|---|---|\n| [request-location.md](request-location.md) | Existing reader description | 2026-04-10 | draft |\n"
  );
  execFileSync("node", [
    path.join(__dirname, "../scripts/hot-index.js"),
    "--dir",
    pmDir,
    "--generate",
  ]);
  const synthesis = {
    summary: "A bounded supervisor finding.",
    claims: [
      {
        text: "Supervisors reported friction.",
        evidence_refs: [{ path: SOURCE, finding: NAVIGATION }],
      },
    ],
    confidence: {
      level: "medium",
      basis: "Analyst reviewed direct observations.",
      limitations: "Broader prevalence remains unknown.",
    },
    open_questions: [],
  };
  const result = JSON.parse(
    execFileSync(
      "node",
      [path.join(__dirname, "../scripts/insight-rewrite.js"), "--pm-dir", pmDir],
      {
        input: JSON.stringify({ insights: [{ insightPath: INSIGHT, synthesis }] }),
        encoding: "utf8",
      }
    )
  );
  assert.equal(result.insights[0].action, "synthesis-updated");
  assert.match(
    fs.readFileSync(path.join(pmDir, "insights/product/index.md"), "utf8"),
    /Existing reader description.*active/
  );
  assert.match(
    fs.readFileSync(path.join(pmDir, "insights/.hot.md"), "utf8"),
    /Request location \| active \| medium/
  );
});

test("writer lazy continuation qualification survives exact selection and routing", (t) => {
  const pmDir = fixture(t);
  const finding =
    "Managers cannot find requests.\nThis only affects occasional managers; administrators find them easily.";
  writeKnowledgeArtifact(pmDir, {
    artifactPath: SOURCE,
    topic: "Team requests",
    summary: "A bounded navigation observation.",
    findings: ["CSV import is useful.", finding],
    sourceOrigin: "internal",
  });
  insight(pmDir, []);
  const result = route(pmDir, { selected_findings: [finding] });
  assert.equal(result.routes[0].action, "updated");
  assert.equal(result.rewrites[0].action, "digest-updated");
  const reader = loadMarkdown(path.join(pmDir, INSIGHT));
  assert.equal(reader.frontmatter.source_claims[0].finding, finding.replace("\n", " "));
  assert.match(
    reader.body,
    /This only affects occasional managers; administrators find them easily/
  );
  const incomplete = route(pmDir, { selected_findings: ["Managers cannot find requests."] });
  assert.equal(incomplete.routes[0].action, "error");
});

// Frozen Review round-1 edge regressions.
{
  const A = "evidence/research/a.md",
    B = "evidence/research/b.md",
    I = "insights/product/decision.md";
  const a1 = "Occasional managers lose context.",
    a2 = "Administrators retain context.",
    b = "Returning users recover context.";
  function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-routing-frozen-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [source, findings] of [
      [A, [a1, a2]],
      [B, [b]],
    ])
      writeMarkdown(
        path.join(dir, source),
        {
          type: "evidence",
          evidence_type: "research",
          topic: "Context",
          source_origin: "internal",
          created: "2026-04-10",
          updated: "2026-04-10",
          sources: [],
          cited_by: [],
        },
        `# Context\n\n## Findings\n\n${findings.map((f, n) => `${n + 1}. ${f}`).join("\n")}\n`
      );
    writeMarkdown(
      path.join(dir, I),
      {
        type: "insight",
        domain: "product",
        topic: "Context decision",
        last_updated: "2026-04-10",
        status: "draft",
        confidence: "low",
        sources: [],
      },
      "# Context decision\n\nPrior analyst counterevidence.\n"
    );
    const routes = [
      {
        mode: "existing",
        evidencePath: A,
        insightPath: I,
        description: "Context",
        selected_findings: [a1],
      },
      {
        mode: "existing",
        evidencePath: B,
        insightPath: I,
        description: "Context",
        selected_findings: [b],
      },
    ];
    applyRoutes(dir, { routes }, { skipHotIndex: true });
    rewriteInsights(dir, {
      insights: [
        {
          insightPath: I,
          synthesis: {
            summary: "A bounded segment difference.",
            claims: [
              {
                text: "Occasional managers differ from returning users.",
                evidence_refs: [
                  { path: A, finding: a1 },
                  { path: B, finding: b },
                ],
              },
            ],
            confidence: {
              level: "medium",
              basis: "Observed task difference.",
              limitations: "Population size unknown.",
            },
            open_questions: [],
          },
        },
      ],
    });
    return { dir, routes };
  }
  test("rv-b874f2d764c981b68dae: identical two-source batch replay preserves current reviewed state and bytes", (t) => {
    const { dir, routes } = fixture(t),
      before = fs.readFileSync(path.join(dir, I), "utf8"),
      log = fs.readFileSync(path.join(dir, "insights/product/log.md"), "utf8");
    const result = applyRoutes(dir, { routes }, { skipHotIndex: true });
    assert.deepEqual(result.rewrites, []);
    assert.equal(fs.readFileSync(path.join(dir, I), "utf8"), before);
    assert.equal(fs.readFileSync(path.join(dir, "insights/product/log.md"), "utf8"), log);
  });
  test("rv-abe241ee767039b86b86: selection-only digest failure retries after missing dependency is restored", (t) => {
    const { dir, routes } = fixture(t),
      originalB = fs.readFileSync(path.join(dir, B), "utf8");
    fs.unlinkSync(path.join(dir, B));
    const update = { ...routes[0], selected_findings: [a2] };
    const failure = applyRoutes(dir, { routes: [update] });
    assert.equal(failure.rewrites[0].action, "error");
    assert.equal(loadMarkdown(path.join(dir, I)).frontmatter.digest_pending, "true");
    assert.match(
      fs.readFileSync(path.join(dir, "insights/product/index.md"), "utf8"),
      /Context.*stale/
    );
    assert.match(
      fs.readFileSync(path.join(dir, "insights/.hot.md"), "utf8"),
      /Context decision \| stale \| low/
    );
    const logAfterFailure = fs.readFileSync(path.join(dir, "insights/product/log.md"), "utf8");
    fs.writeFileSync(path.join(dir, B), originalB);
    const retry = applyRoutes(dir, { routes: [update] });
    assert.equal(retry.rewrites.length, 1);
    assert.equal(retry.rewrites[0].action, "digest-updated");
    assert.equal(retry.hotIndexGenerated, true);
    assert.equal(loadMarkdown(path.join(dir, I)).frontmatter.digest_pending, undefined);
    assert.equal(
      fs.readFileSync(path.join(dir, "insights/product/log.md"), "utf8"),
      logAfterFailure
    );
    const after = fs.readFileSync(path.join(dir, I), "utf8");
    const replay = applyRoutes(dir, { routes: [update] }, { skipHotIndex: true });
    assert.deepEqual(replay.rewrites, []);
    assert.equal(fs.readFileSync(path.join(dir, I), "utf8"), after);
    const body = loadMarkdown(path.join(dir, I)).body;
    assert.match(body, /Historical assessment: linked evidence or claim selection changed/);
    assert.ok(
      body
        .split("**Selected findings for this topic")[1]
        .split("**Complete source context")[0]
        .includes(a2)
    );
  });

  test("pending selection digest also retries through standalone rewrite without a new selection change", (t) => {
    const { dir, routes } = fixture(t),
      originalB = fs.readFileSync(path.join(dir, B), "utf8");
    fs.unlinkSync(path.join(dir, B));
    const failure = applyRoutes(
      dir,
      { routes: [{ ...routes[0], selected_findings: [a2] }] },
      { skipHotIndex: true }
    );
    assert.equal(failure.rewrites[0].action, "error");
    const repeatFailure = rewriteInsights(dir, { insights: [I] });
    assert.equal(repeatFailure.insights[0].action, "error");
    assert.equal(loadMarkdown(path.join(dir, I)).frontmatter.digest_pending, "true");
    fs.writeFileSync(path.join(dir, B), originalB);
    const retry = rewriteInsights(dir, { insights: [I] });
    assert.equal(retry.insights[0].action, "digest-updated");
    assert.equal(loadMarkdown(path.join(dir, I)).frontmatter.digest_pending, undefined);
    assert.match(
      loadMarkdown(path.join(dir, I)).body,
      /Historical assessment: linked evidence or claim selection changed/
    );
    const replay = rewriteInsights(dir, { insights: [I] });
    assert.equal(replay.insights[0].action, "skipped");
  });
}

const MANAGED_MARKERS = [
  "<!-- pm-source-digest:start -->",
  "<!-- pm-source-digest:end -->",
  "<!-- pm-reviewed-synthesis:start -->",
  "<!-- pm-reviewed-synthesis:end -->",
  "<!-- pm-insight-state:start -->",
  "<!-- pm-insight-state:end -->",
];

test("rv-a38142031e7cadbef6c4: literal markers in all assessment fields cannot alter repeated synthesis boundaries", (t) => {
  for (const marker of MANAGED_MARKERS) {
    const pmDir = fixture(t);
    const source = `evidence/research/quoted-${marker}.md`;
    const finding = `An observed result ${marker} retains this qualification.`;
    evidence(pmDir, source, [finding]);
    insight(pmDir, [source]);
    const assessment = (stamp) => ({
      summary: `${stamp} summary ${marker} keeps its scope.`,
      claims: [
        {
          text: `${stamp} bounded claim ${marker} keeps counterevidence.`,
          evidence_refs: [{ path: source, finding }],
        },
      ],
      confidence: {
        level: "low",
        basis: `${stamp} basis ${marker} records one source.`,
        limitations: `${stamp} limitation ${marker} avoids broad inference.`,
      },
      open_questions: [`${stamp} question ${marker} preserves uncertainty.`],
    });
    const first = rewriteInsights(pmDir, {
      insights: [{ insightPath: INSIGHT, synthesis: assessment("INITIAL") }],
    });
    assert.equal(first.insights[0].action, "synthesis-updated");
    const next = rewriteInsights(pmDir, {
      insights: [{ insightPath: INSIGHT, synthesis: assessment("REVISED") }],
    });
    assert.equal(next.insights[0].action, "synthesis-updated");
    const body = loadMarkdown(path.join(pmDir, INSIGHT)).body;
    for (const boundary of MANAGED_MARKERS) assert.equal(body.split(boundary).length - 1, 1);
    assert.ok(body.includes(marker.replace("<", "&lt;")));
    assert.match(body, /Historical Analyst Assessment/);
    assert.match(body, /INITIAL limitation.*avoids broad inference/);
    assert.match(body, /power-user study found no navigation problem/);
    const current = body.slice(body.lastIndexOf("## Reviewed Synthesis"));
    assert.doesNotMatch(current, /INITIAL/);
    assert.match(current, /REVISED limitation.*avoids broad inference/);
    assert.match(current, /retains this qualification/);
    const unchanged = fs.readFileSync(path.join(pmDir, INSIGHT), "utf8");
    const invalid = assessment("INVALID");
    invalid.claims[0].evidence_refs[0].finding = "An observed result without its qualification.";
    assert.equal(
      rewriteInsights(pmDir, { insights: [{ insightPath: INSIGHT, synthesis: invalid }] })
        .insights[0].action,
      "error"
    );
    assert.equal(fs.readFileSync(path.join(pmDir, INSIGHT), "utf8"), unchanged);
  }
});

test("ambiguous existing managed boundaries fail without changing analyst or evidence bytes", (t) => {
  for (const marker of MANAGED_MARKERS) {
    const pmDir = fixture(t);
    evidence(pmDir);
    insight(pmDir);
    const doc = loadMarkdown(path.join(pmDir, INSIGHT));
    writeMarkdown(
      path.join(pmDir, INSIGHT),
      doc.frontmatter,
      `${doc.body}\n${marker}\nPrior qualification that must survive.\n${marker}\n`
    );
    const before = fs.readFileSync(path.join(pmDir, INSIGHT), "utf8");
    const sourceBefore = fs.readFileSync(path.join(pmDir, SOURCE), "utf8");
    const result = rewriteInsights(pmDir, { insights: [INSIGHT] });
    assert.equal(result.insights[0].action, "error");
    assert.match(result.insights[0].reason, /ambiguous managed insight block/);
    assert.equal(fs.readFileSync(path.join(pmDir, INSIGHT), "utf8"), before);
    assert.equal(fs.readFileSync(path.join(pmDir, SOURCE), "utf8"), sourceBefore);
  }
});

for (const failedProjection of ["insights/product/index.md", "insights/.hot.md"]) {
  test(`rv-436696e8e1f9085677ec: unchanged canonical retry repairs failed ${failedProjection}`, (t) => {
    const pmDir = fixture(t);
    evidence(pmDir);
    insight(pmDir);
    const blocked = path.join(pmDir, failedProjection);
    fs.mkdirSync(blocked);
    const invoke = () => {
      try {
        return {
          status: 0,
          stdout: execFileSync(
            process.execPath,
            [path.join(__dirname, "../scripts/insight-rewrite.js"), "--pm-dir", pmDir],
            {
              input: JSON.stringify({ insights: [INSIGHT] }),
              encoding: "utf8",
              stdio: ["pipe", "pipe", "pipe"],
            }
          ),
        };
      } catch (error) {
        return { status: error.status, stderr: error.stderr };
      }
    };
    const first = invoke();
    assert.equal(first.status, 1);
    const committed = fs.readFileSync(path.join(pmDir, INSIGHT), "utf8");
    const canonical = loadMarkdown(path.join(pmDir, INSIGHT));
    assert.equal(canonical.frontmatter.status, "stale");
    assert.equal(canonical.frontmatter.synthesis_state, "needs-synthesis");
    fs.rmdirSync(blocked);
    const retry = invoke();
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).insights[0].reason, "up-to-date");
    assert.equal(fs.readFileSync(path.join(pmDir, INSIGHT), "utf8"), committed);
    assert.match(
      fs.readFileSync(path.join(pmDir, "insights/product/index.md"), "utf8"),
      /Request location.*stale/
    );
    assert.match(
      fs.readFileSync(path.join(pmDir, "insights/.hot.md"), "utf8"),
      /Request location \| stale \| low/
    );
    assert.ok(
      fs
        .readFileSync(path.join(pmDir, "insights/product/index.md"), "utf8")
        .includes(canonical.frontmatter.last_updated)
    );
  });
}
