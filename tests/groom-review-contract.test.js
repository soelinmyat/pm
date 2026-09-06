"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const {
  normalizeReviewText,
  reviewAnswerQuality,
  reviewEvidenceRelevanceQuality,
  reviewFindingQuality,
  reviewTextTokens,
} = require("../scripts/lib/groom-review-contract.js");

function assertCompleteReviewPasses(review) {
  assert.deepEqual(reviewAnswerQuality(review.conclusion, review.rationale, review.question), {
    ok: true,
    reason: "contains a distinct conclusion and rationale",
  });
  assert.deepEqual(
    reviewEvidenceRelevanceQuality(
      review.relevance,
      review.conclusion,
      review.rationale,
      review.question
    ),
    { ok: true, reason: "connects the evidence to the answer" }
  );
  assert.deepEqual(
    reviewFindingQuality(review.finding, review.conclusion, review.rationale, review.question),
    { ok: true, reason: "identifies a concrete review finding" }
  );
}

test("review quality accepts substantive Burmese conclusions, evidence, and findings", () => {
  assertCompleteReviewPasses({
    question: "Is the problem and evidence chain sufficient for this decision?",
    conclusion:
      "အသုံးပြုသူအထောက်အထားများက အတည်ပြုခြင်းလုပ်ငန်းစဉ်တွင် ပြဿနာရှိကြောင်း ရှင်းလင်းစွာ ဖော်ပြသည်။",
    rationale:
      "ဖြစ်ရပ်များစွာတွင် အကြောင်းအရာပြောင်းလဲပြီးနောက် အတည်ပြုချက်အဟောင်းက အသုံးပြုသူများကို မှားယွင်းစွာ ယုံကြည်စေခဲ့သည်။",
    relevance:
      "ဖြစ်ရပ်မှတ်တမ်းများက အတည်ပြုခြင်း ပြဿနာနှင့် အသုံးပြုသူယုံကြည်မှု ပျက်စီးခြင်းတို့ ဆက်စပ်ပုံကို ပြသသည်။",
    finding:
      "ပြန်လည်ရယူခြင်းအဆင့်အတွက် အချိန်ကန့်သတ်ချက်နှင့် တာဝန်ရှိသူကို တိကျစွာ မသတ်မှတ်ရသေးပါ။",
  });
});

test("review quality segments substantive Chinese text without whitespace", () => {
  assertCompleteReviewPasses({
    question: "Is the problem and evidence chain sufficient for this decision?",
    conclusion: "现有用户证据足以证明审批流程存在明确而且反复发生的问题。",
    rationale: "多次事故记录显示提案内容变更以后，旧的批准状态仍然误导团队继续执行错误决定。",
    relevance: "事故记录直接连接审批流程问题以及团队遭受的错误执行风险。",
    finding: "恢复路径仍然缺少明确负责人、截止时间以及可以观察的完成标准。",
  });
});

test("review tokenization falls back to graphemes when word segmentation is unavailable", () => {
  const contractPath = path.resolve(__dirname, "../scripts/lib/groom-review-contract.js");
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      `Intl.Segmenter = undefined;
       const { reviewTextTokens } = require(${JSON.stringify(contractPath)});
       process.stdout.write(JSON.stringify([...reviewTextTokens("现有用户证据表明审批流程存在明确问题")]))`,
    ],
    { encoding: "utf8" }
  );
  assert.ok(JSON.parse(output).length >= 5);
});

test("review tokenization preserves accented Latin words at the existing thresholds", () => {
  const normalized = normalizeReviewText("Résumé, naïveté, façade; déjà-vu — jalapeño.");
  assert.equal(normalized, "résumé naïveté façade déjà vu jalapeño");
  assert.deepEqual(
    [...reviewTextTokens(normalized)],
    ["résumé", "naïveté", "façade", "déjà", "jalapeño"]
  );

  assertCompleteReviewPasses({
    question: "Is the problem and evidence chain sufficient for this decision?",
    conclusion: "Résumé déjà vérifié: la façade naïve révèle un échec répété et mesurable.",
    rationale:
      "À Montréal, l’équipe compare plusieurs études détaillées afin d’expliquer pourquoi cet échec persiste.",
    relevance:
      "L’étude de Montréal relie directement l’échec répété aux décisions décrites dans le résumé vérifié.",
    finding:
      "La récupération omet encore le propriétaire, l’échéance précise et la méthode de contrôle indépendante.",
  });
});
