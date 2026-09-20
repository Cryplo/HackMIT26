import type { DashboardClient } from "./ui-contracts";
import type { Check, MerchantRule, ReviewRow, RuleResponse, SearchResponse } from "./types";
import { approvalBlock } from "./review";
import { DashboardError } from "./helpers";
import { fixtureCheck, fixtureReviews, fixtureRules, normalizeVendor, previewReceiptUrl, previewResponse } from "./fixtures";

function fail(code: string, message: string, status = 409): never { throw new DashboardError(code, message, status); }
const copy = <T>(value: T): T => structuredClone(value);

/** ponytail: six fixture scenarios only; use the real API for arbitrary receipts and model evaluation. */
export function createPreviewClient(): DashboardClient {
  const rows = copy(fixtureReviews.submissions);
  const rules = copy(fixtureRules);
  let knowledgeRevision = 0;
  const getRow = (id: string) => rows.find(row => row.id === id) ?? fail("NOT_FOUND", "Claim not found.", 404);
  function currentRow(id: string, revision: number) {
    const row = getRow(id);
    if (row.review_revision !== revision) fail("STALE_REVIEW", "This claim changed. Refresh and review it before trying again.");
    return row;
  }
  function currentRule(id: string, version: number) {
    const rule = rules.find(item => item.id === id) ?? fail("NOT_FOUND", "Rule not found.", 404);
    if (rule.version !== version) fail("STALE_RULE", "This rule changed. Refresh before trying again.");
    return rule;
  }
  function touch(row: ReviewRow) {
    row.review_revision++;
    row.updated_at = new Date().toISOString();
    row.status = row.decision_status !== "pending" ? row.decision_status : row.assessment_status === "matched" || !row.assessment_status ? "pending" : row.assessment_status;
  }
  function approvalGuard(row: ReviewRow) {
    if (row.processing_status === "running" || row.receipt?.extraction_status !== "succeeded" || !row.assessment_status) {
      fail("APPROVAL_BLOCKED", "Approval requires completed extraction and reconciliation with no active processing.");
    }
    if (row.assessment_knowledge_revision !== knowledgeRevision) fail("STALE_ASSESSMENT", "Rules changed — recheck this claim before approval.");
    if (row.decisions.some(check => check.field_checked === "duplicate" && check.verdict !== "pass") ||
        rows.some(other => other.id !== row.id && other.decision_status === "approved" && row.receipt?.sha256 && other.receipt?.sha256 === row.receipt.sha256)) {
      fail("DUPLICATE_BLOCKED", "This receipt may already be claimed. Duplicate claims cannot be approved.");
    }
    if (approvalBlock(row, knowledgeRevision, rows, true)) {
      fail("APPROVAL_BLOCKED", "Approval is blocked by a failed or incomplete amount, currency, date, policy, cap, or duplicate check.");
    }
  }
  function eligibleSource(rule: MerchantRule) {
    const source = getRow(rule.source_submission_id);
    if (source.decision_status !== "approved" || source.decisions.findLast(check => check.check_method === "human")?.evidence_json.correction_id !== rule.source_correction_id) {
      fail("RULE_INELIGIBLE", "The source approval is no longer valid.");
    }
  }
  const ruleResult = (rule: MerchantRule): RuleResponse => copy({ rule, knowledge_revision: knowledgeRevision });
  function assess(row: ReviewRow) {
    const humanChecks = row.decisions.filter(check => check.check_method === "human");
    const parsed = row.receipt?.parsed_fields_json;
    const make = (field: string, verdict: Check["verdict"], rationale: string, value: unknown = verdict): Check => ({
      ...fixtureCheck(0, field, verdict, rationale, value), id: crypto.randomUUID(),
    });
    let checks: Check[];
    if (row.receipt?.extraction_status !== "succeeded" || !parsed) {
      checks = [make("extraction", "unknown", "Synthetic receipt extraction is unavailable; retry extraction first.")];
    } else {
      const same = rows.filter(other => other.id !== row.id && row.receipt?.sha256 && other.receipt?.sha256 === row.receipt.sha256);
      row.duplicate_submission_ids = same.filter(other => `${other.submitted_at}:${other.id}` < `${row.submitted_at}:${row.id}`).map(other => other.id);
      const duplicate = same.some(other => other.decision_status === "approved" || `${other.submitted_at}:${other.id}` < `${row.submitted_at}:${row.id}`);
      const aliases = rules.filter(rule => rule.state === "active" && getRow(rule.source_submission_id).decision_status === "approved" &&
        normalizeVendor(rule.payload.observed_vendor) === normalizeVendor(parsed.vendor || "") && rule.payload.scope.category === row.category && rule.payload.scope.currency === row.currency);
      const learned = new Set(aliases.map(rule => normalizeVendor(rule.payload.canonical_vendor)));
      const ambiguous = normalizeVendor(parsed.vendor || "") === "syn hbr042";
      const cap = { flight: 50000, hotel: 25000, train: 20000, bus: 10000, other: 5000 }[row.category];
      const datePass = parsed.receipt_date != null && parsed.receipt_date >= "2026-09-01" && parsed.receipt_date <= "2026-09-30";
      checks = [
        make("amount", parsed.amount_minor == null ? "unknown" : parsed.amount_minor === row.amount_requested_minor ? "pass" : "fail", "Synthetic comparison of requested and receipt totals.", parsed.amount_minor === row.amount_requested_minor),
        make("currency", parsed.currency === "USD" ? "pass" : parsed.currency ? "fail" : "unknown", "Receipt currency must be USD.", parsed.currency),
        make("receipt_date", parsed.receipt_date ? datePass ? "pass" : "fail" : "unknown", "Receipt date must fall within the September event policy.", parsed.receipt_date),
        make("policy", datePass ? "pass" : "unknown", "Synthetic policy applies to this travel category."),
        make("policy_cap", row.amount_requested_minor <= cap ? "pass" : "fail", `Synthetic policy cap: $${cap / 100}.`),
        make("duplicate", duplicate ? "fail" : "pass", duplicate ? "The same synthetic receipt appears in an earlier or approved claim." : "No earlier or approved exact-file duplicate."),
        make("merchant", ambiguous && !(learned.size === 1 && learned.has("harbor hotel")) ? "unknown" : parsed.vendor ? "pass" : "unknown", ambiguous && learned.has("harbor hotel") ? "Simulated active hotel/USD alias identifies Harbor Hotel." : ambiguous ? "SYN HBR042 needs a reviewer’s merchant confirmation." : "Synthetic merchant matches the category."),
        make("name", parsed.names.length ? parsed.names.includes(row.attendee_name) ? "pass" : "fail" : "unknown", "Synthetic traveler-name comparison."),
      ];
    }
    row.decisions = [...checks, ...humanChecks];
    row.assessment_status = checks.some(check => check.verdict === "fail") ? "flagged" : checks.some(check => check.verdict === "unknown") ? "needs_review" : "matched";
    row.assessment_knowledge_revision = knowledgeRevision;
    row.latest_run_id = crypto.randomUUID();
    row.processing_status = "idle";
    row.processing_error = null;
    if (row.assessment_status !== "needs_review") row.investigation = null;
    touch(row);
  }
  return {
    mode: "preview",
    async getReviews(signal) { signal?.throwIfAborted(); return copy(previewResponse(rows, knowledgeRevision)); },
    async getRules(signal) { signal?.throwIfAborted(); return copy({ rules, knowledge_revision: knowledgeRevision }); },
    async reconcile(input) {
      if (!input.submission_ids.length || input.submission_ids.length > 50 || new Set(input.submission_ids).size !== input.submission_ids.length) fail("INVALID_BODY", "Select 1–50 unique claims to recheck.", 400);
      return { results: input.submission_ids.map(id => {
        const row = getRow(id);
        assess(row);
        return { submission_id: row.id, run_id: row.latest_run_id, assessment_status: row.assessment_status, decision_status: row.decision_status, review_revision: row.review_revision };
      }) };
    },
    async decide(input) {
      const row = currentRow(input.submission_id, input.expected_review_revision);
      const note = input.human_note.trim();
      if (!note || note.length > 2000) fail("INVALID_BODY", "Enter a decision reason between 1 and 2,000 characters.", 400);
      if (input.correction_type !== "decision_override" || Object.keys(input.correction_payload_json).length) fail("USE_RULES_ENDPOINT", "Merchant learning is a separate rule proposal.", 400);
      if (input.human_verdict === "approved") approvalGuard(row);
      row.decision_status = input.human_verdict;
      row.processing_status = "idle";
      row.processing_error = null;
      const correctionId = crypto.randomUUID();
      row.decisions.push({ ...fixtureCheck(0, "human_decision", input.human_verdict === "approved" ? "pass" : "fail", note, input.human_verdict), id: correctionId, check_method: "human", evidence_json: { simulated: true, correction_id: correctionId } });
      let changed = false;
      for (const rule of rules) if (rule.source_submission_id === row.id && rule.state !== "disabled") {
        changed ||= rule.state === "active";
        rule.state = "disabled"; rule.version++; rule.latest_test = null;
      }
      if (changed) knowledgeRevision++;
      touch(row);
      return copy({ correction_id: correctionId, row });
    },
    async proposeRule(input) {
      const row = currentRow(input.submission_id, input.expected_review_revision);
      const canonical = input.canonical_vendor.trim();
      if (!canonical || canonical.length > 120) fail("INVALID_BODY", "Enter a merchant name between 1 and 120 characters.", 400);
      if (row.decision_status !== "approved") fail("RULE_INELIGIBLE", "Approve the supported source claim before proposing a rule.");
      const vendor = row.receipt?.parsed_fields_json?.vendor;
      if (!vendor?.trim() || row.receipt?.extraction_status !== "succeeded") fail("RULE_INELIGIBLE", "The approved source must contain an extracted observed vendor.");
      if (normalizeVendor(vendor) === normalizeVendor(canonical)) fail("RULE_INELIGIBLE", "The canonical name must differ from the observed descriptor.");
      const correctionId = row.decisions.findLast(check => check.check_method === "human" && check.answer_json.value === "approved")?.evidence_json.correction_id;
      if (typeof correctionId !== "string" || !correctionId.trim()) fail("RULE_INELIGIBLE", "The source needs a recorded approval.");
      const existing = rules.find(rule => rule.state === "draft" && rule.source_correction_id === correctionId && normalizeVendor(rule.payload.canonical_vendor) === normalizeVendor(canonical));
      if (existing) return ruleResult(existing);
      const rule: MerchantRule = { id: crypto.randomUUID(), version: 1, state: "draft", source_submission_id: row.id,
        source_correction_id: correctionId, created_at: new Date().toISOString(), latest_test: null,
        payload: { observed_vendor: vendor, canonical_vendor: canonical, scope: { category: row.category, currency: row.currency } } };
      rules.push(rule);
      return ruleResult(rule);
    },
    async testRule(id, input) {
      const rule = currentRule(id, input.expected_rule_version);
      if (rule.state !== "draft") fail("RULE_INELIGIBLE", "Only draft rules can be tested.");
      eligibleSource(rule);
      rule.version++;
      // This fixture result demonstrates the gate; it is not a provider evaluation or accuracy claim.
      const passed = normalizeVendor(rule.payload.canonical_vendor) === "harbor hotel" && rule.payload.scope.category === "hotel";
      rule.latest_test = { rule_id: rule.id, rule_version: rule.version, knowledge_revision: knowledgeRevision, suite_version: "alias-v1", mode: "simulated",
        tested_at: new Date().toISOString(), passed, improved_case_ids: passed ? ["preview-valid-1", "preview-valid-2"] : [], regressed_case_ids: [],
        reasons: [passed ? "Simulated fixture: two valid hotel examples improve; protected examples remain unchanged. Not a live model benchmark." : "Simulated fixture: this canonical merchant does not resolve the valid hotel examples. Use Harbor Hotel to explore the passing flow."],
        before: { total: 10, correct: 8, false_matches: 0, needs_review: 4 },
        after: { total: 10, correct: passed ? 10 : 8, false_matches: 0, needs_review: passed ? 2 : 4 } };
      return copy(rule.latest_test);
    },
    async activateRule(id, input) {
      const rule = currentRule(id, input.expected_rule_version);
      if (rule.state !== "draft") fail("RULE_INELIGIBLE", "Only draft rules can be activated.");
      eligibleSource(rule);
      const report = rule.latest_test;
      if (!report) fail("TEST_REQUIRED", "Test this rule before activation.");
      if (!report.passed) fail("TEST_FAILED", "This rule did not pass its simulated test.");
      if (report.rule_version !== rule.version || report.knowledge_revision !== knowledgeRevision || report.mode !== "simulated" || report.suite_version !== "alias-v1") fail("STALE_RULE_TEST", "Rules changed. Test this draft again before activation.");
      rule.state = "active"; rule.version++; knowledgeRevision++;
      return ruleResult(rule);
    },
    async disableRule(id, input) {
      const rule = currentRule(id, input.expected_rule_version);
      if (rule.state !== "disabled") { if (rule.state === "active") knowledgeRevision++; rule.state = "disabled"; rule.version++; rule.latest_test = null; }
      return ruleResult(rule);
    },
    async retryExtraction(id, expectedRevision) {
      const row = currentRow(id, expectedRevision);
      if (row.decision_status !== "pending" || row.processing_status === "running") fail("EXTRACTION_BLOCKED", "Retry requires a pending decision and no active processing.");
      if (!row.receipt) fail("NOT_FOUND", "No original receipt is available.", 404);
      if (row.receipt.extraction_status !== "failed") fail("EXTRACTION_BLOCKED", "This preview only retries the failed-extraction example.");
      row.receipt.extraction_status = "succeeded";
      row.receipt.extraction_error = null;
      row.receipt.parsed_fields_json = { schema_version: 1, vendor: "Synthetic Air", receipt_date: "2026-09-18", amount_minor: 23000, currency: "USD", names: ["Riley Park"], receipt_number: "SYN-006" };
      row.assessment_status = null; row.assessment_knowledge_revision = null; row.latest_run_id = null; row.decisions = []; row.investigation = null;
      row.processing_status = "idle"; row.processing_error = null;
      touch(row);
      return copy({ row });
    },
    async search(input): Promise<SearchResponse> {
      const started = performance.now();
      if (input.snapshot_token !== previewResponse(rows, knowledgeRevision).snapshot_token) fail("STALE_SNAPSHOT", "Claims changed. Search again using the current review queue.");
      const query = input.query.trim().toLowerCase();
      if (!query || query.length > 300) fail("INVALID_BODY", "Enter a search between 1 and 300 characters.", 400);
      if (/\b(approve|reject|delete|activate|disable|sum|average|how many|total spend)\b/.test(query)) fail("UNSUPPORTED_QUERY", "Search finds claims; it cannot change records or calculate totals.", 422);
      const filtered = rows.filter(row => Object.entries(input.filters).every(([key, value]) => row[key as keyof ReviewRow] === value));
      // ponytail: fixed demo intents, not a replacement semantic-search provider.
      const matches: ReviewRow[] = [], possible: ReviewRow[] = [];
      const amount = query.match(/(?:above|over|more than)\s*\$?(\d+(?:\.\d{1,2})?)/);
      for (const row of filtered) {
        const text = `${row.attendee_name} ${row.category} ${row.receipt?.parsed_fields_json?.vendor || ""} ${row.assessment_status} ${row.decision_status}`.toLowerCase();
        let match = text.includes(query);
        if (amount) match = row.amount_requested_minor > Math.round(Number(amount[1]) * 100);
        else if (/duplicate/.test(query)) match = row.decisions.some(check => check.field_checked === "duplicate" && check.verdict !== "pass");
        else if (/overclaim|exceed|amount.*(?:differ|mismatch)/.test(query)) match = row.decisions.some(check => check.field_checked === "amount" && check.verdict === "fail");
        else if (/failed|unreadable|extract/.test(query)) match = row.receipt?.extraction_status === "failed";
        else if (/hotel|merchant|harbor|descriptor/.test(query)) match = row.category === "hotel";
        else if (/pending|need.*review/.test(query)) match = row.decision_status === "pending";
        if (match) matches.push(row);
        else if (query.split(/\s+/).filter(word => word.length > 3).some(word => text.includes(word))) possible.push(row);
      }
      return copy({ snapshot_token: input.snapshot_token, evaluated_count: filtered.length, matches, possible_matches: possible,
        mode: "simulated", model: null, latency_ms: Math.round(performance.now() - started) });
    },
    async exportReviews() { return fail("UNAVAILABLE", "CSV export is unavailable in this UI preview. Use the configured API workspace.", 503); },
    receiptUrl: previewReceiptUrl,
  };
}
