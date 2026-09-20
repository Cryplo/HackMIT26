import type { DashboardClient } from "./ui-contracts";
import type { ClaimMessage, DecisionResponse } from "../review-contracts";
import { decisionReason } from "./decision-reason";
import type { Check, CheckMutationRequest, CustomCheck, CustomCheckUpsert, InvestigationRun, MerchantRule, ResolutionProcedure, ReviewRow, RuleResponse, SearchResponse, SupportingDocument } from "./types";
import { checkCatalog } from "../check-catalog";
import { approvalBlock, investigationFailure } from "./review";
import { DashboardError } from "./helpers";
import { fixtureCheck, fixtureReviews, fixtureRules, normalizeVendor, previewReceiptUrl, previewResponse } from "./fixtures";
import { fixtureBookingReference, fixtureInvestigations, fixtureProcedureCandidate, fixtureSupportingDocuments, investigationAssessment } from "./investigation-fixtures";

function fail(code: string, message: string, status = 409): never { throw new DashboardError(code, message, status); }
const copy = <T>(value: T): T => structuredClone(value);

/** ponytail: six fixture scenarios only; use the real API for arbitrary receipts and model evaluation. */
export function createPreviewClient(): DashboardClient {
  const rows = copy(fixtureReviews.submissions);
  const rules = copy(fixtureRules);
  const documents = fixtureSupportingDocuments(rows);
  const runs = fixtureInvestigations(rows);
  const procedures: ResolutionProcedure[] = [];
  const customChecks: CustomCheck[] = [];
  const messages: ClaimMessage[] = [];
  const pendingNotifications = () => messages.filter(message => message.status === "draft" && message.correction_id && rows.some(row => row.id === message.claim_id && row.decision_status === message.intended_verdict && row.decisions.findLast(check => check.check_method === "human")?.evidence_json.correction_id === message.correction_id));
  const notificationSnapshot = () => JSON.stringify([previewResponse(rows, knowledgeRevision).snapshot_token, pendingNotifications().map(message => [message.id, message.message_revision])]);
  const decisions = new Map<string, { payload: string; response: DecisionResponse }>();
  const evidenceRevisions = new Map(rows.map(row => [row.id, documents.some(document => document.claim_id === row.id) ? 1 : 0]));
  const originalUrls = new Map<string, string>();
  for (const row of rows) row.latest_investigation = runs.find(run => run.claim_id === row.id) ?? null;
  let knowledgeRevision = 0;
  const getRow = (id: string) => rows.find(row => row.id === id) ?? fail("NOT_FOUND", "Claim not found.", 404);
  function currentRow(id: string, revision: number) {
    const row = getRow(id);
    if (!Number.isSafeInteger(revision) || revision < 0) fail("INVALID_BODY", "Supply a nonnegative integer review revision.", 400);
    if (row.review_revision !== revision) fail("STALE_REVIEW", "This claim changed. Refresh and review it before trying again.");
    return row;
  }
  function currentRule(id: string, version: number) {
    const rule = rules.find(item => item.id === id) ?? fail("NOT_FOUND", "Rule not found.", 404);
    if (rule.version !== version) fail("STALE_RULE", "This rule changed. Refresh before trying again.");
    return rule;
  }
  function currentCheck(id: string, version: number) {
    const check = customChecks.find(item => item.id === id) ?? fail("NOT_FOUND", "Check not found.", 404);
    if (!Number.isSafeInteger(version) || version < 1) fail("INVALID_BODY", "Supply a positive integer check version.", 400);
    if (check.version !== version) fail("STALE_CHECK", "This check changed. Refresh before trying again.");
    return check;
  }
  function validCheckInput(input: CustomCheckUpsert) {
    const label = input.label?.trim(), instructions = input.instructions?.trim();
    if (!label || label.length > 80 || !instructions || instructions.length < 10 || instructions.length > 2000) fail("INVALID_BODY", "Enter a check name up to 80 characters and instructions of 10–2,000 characters.", 400);
    if (input.category !== undefined && input.category !== null && !["flight", "hotel", "train", "bus", "other"].includes(input.category)) fail("INVALID_BODY", "Choose a valid category scope.", 400);
    for (const key of ["pass", "fail", "unknown"] as const) {
      const criterion = input.criteria?.[key];
      if (criterion !== undefined && (!criterion.trim() || criterion.length > 500)) fail("INVALID_BODY", "Each criterion must be 1–500 characters.", 400);
    }
    return { label, instructions, category: input.category ?? null };
  }
  const checkResult = (check: CustomCheck) => copy({ check, knowledge_revision: knowledgeRevision });
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
  const getRun = (id: string) => runs.find(run => run.run_id === id) ?? fail("NOT_FOUND", "Investigation not found.", 404);
  const snapshot = (row: ReviewRow) => investigationAssessment(row, evidenceRevisions.get(row.id) ?? 0, knowledgeRevision);
  function matchingBooking(row: ReviewRow): SupportingDocument | undefined {
    const reference = fixtureBookingReference(row);
    const attached = documents.filter(document => document.claim_id === row.id);
    const bookings = attached.filter(document => document.kind === "booking_confirmation");
    if (!reference || row.category !== "hotel" || row.currency !== "USD" || normalizeVendor(row.receipt?.parsed_fields_json?.vendor || "") !== "harbor reservations" ||
        attached.some(document => document.extraction_status !== "succeeded") || bookings.some(document => !document.facts?.booking_reference || normalizeVendor(document.facts.booking_reference) !== normalizeVendor(reference))) return;
    return bookings.find(document => document.facts?.vendor === "Harbor Hotel" && document.facts.currency === row.currency &&
      document.facts.amount_minor === row.receipt?.parsed_fields_json?.amount_minor && document.facts.purchase_date === row.receipt?.parsed_fields_json?.receipt_date && document.facts.names.includes(row.attendee_name));
  }
  function currentProcedure(id: string, version: number) {
    const procedure = procedures.find(item => item.id === id) ?? fail("NOT_FOUND", "Procedure not found.", 404);
    if (!Number.isSafeInteger(version) || version < 1) fail("INVALID_BODY", "Supply a positive integer procedure version.", 400);
    if (procedure.version !== version) fail("STALE_RULE", "This procedure changed. Refresh before trying again.");
    return procedure;
  }
  function eligibleProcedureSource(procedure: ResolutionProcedure) {
    const source = getRow(procedure.source_claim_id);
    const run = getRun(procedure.source_run_id);
    if (source.decision_status !== "approved" || source.decisions.findLast(check => check.check_method === "human")?.evidence_json.correction_id !== procedure.source_correction_id ||
        run.after_assessment?.evidence_revision !== evidenceRevisions.get(source.id) || !matchingBooking(source)) fail("RULE_INELIGIBLE", "The approved source evidence changed; a new supported source and proposal are required.");
  }
  const procedureResult = (procedure: ResolutionProcedure) => copy({ procedure, knowledge_revision: knowledgeRevision });
  function assess(row: ReviewRow, investigatedBooking?: SupportingDocument) {
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
      const ambiguous = normalizeVendor(parsed.vendor || "") === "harbor reservations";
      const booking = matchingBooking(row);
      const appliedProcedure = booking && procedures.find(procedure => procedure.state === "active" && procedure.trigger_scope.observed_vendor === parsed.vendor &&
        procedure.trigger_scope.category === row.category && procedure.trigger_scope.currency === row.currency && getRow(procedure.source_claim_id).decision_status === "approved");
      const supported = booking && (investigatedBooking?.id === booking.id || !!appliedProcedure);
      const cap = { flight: 50000, hotel: 25000, train: 20000, bus: 10000, other: 5000 }[row.category];
      const datePass = parsed.receipt_date != null && parsed.receipt_date >= "2026-09-01" && parsed.receipt_date <= "2026-09-30";
      checks = [
        make("amount", parsed.amount_minor == null ? "unknown" : parsed.amount_minor === row.amount_requested_minor ? "pass" : "fail", "Synthetic comparison of requested and receipt totals.", parsed.amount_minor === row.amount_requested_minor),
        make("currency", parsed.currency === "USD" ? "pass" : parsed.currency ? "fail" : "unknown", "Receipt currency must be USD.", parsed.currency),
        make("receipt_date", parsed.receipt_date ? datePass ? "pass" : "fail" : "unknown", "Receipt date must fall within the September event policy.", parsed.receipt_date),
        make("policy", datePass ? "pass" : "unknown", "Synthetic policy applies to this travel category."),
        make("policy_cap", row.amount_requested_minor <= cap ? "pass" : "fail", `Synthetic policy cap: $${cap / 100}.`),
        make("duplicate", duplicate ? "fail" : "pass", duplicate ? "The same synthetic receipt appears in an earlier or approved claim." : "No earlier or approved exact-file duplicate."),
        make("merchant", ambiguous && !supported && !(learned.size === 1 && learned.has("harbor hotel")) ? "unknown" : parsed.vendor ? "pass" : "unknown", supported ? "Simulated fixture: the receipt and Harbor Hotel booking confirmation share a booking reference." : ambiguous && learned.has("harbor hotel") ? "Simulated active hotel/USD alias identifies Harbor Hotel." : ambiguous ? "The receipt says Harbor Reservations; confirm which hotel received the payment." : "Synthetic merchant matches the category."),
        make("name", parsed.names.length ? parsed.names.includes(row.attendee_name) ? "pass" : "fail" : "unknown", "Synthetic traveler-name comparison."),
      ];
      if (supported) checks.find(check => check.field_checked === "merchant")!.evidence_json = {
        simulated: true, booking_reference: booking.facts!.booking_reference,
        evidence_refs: [{ kind: "receipt", id: row.receipt!.id }, { kind: "supporting_document", id: booking.id }],
        ...(appliedProcedure ? { procedure_ids: [appliedProcedure.id] } : {}),
      };
      // The simulated fixture cannot judge reviewer-authored questions; active custom checks stay honestly unknown.
      for (const check of customChecks.filter(item => item.state === "active" && (item.category === null || item.category === row.category))) {
        checks.push({ ...make(check.field, "unknown", `Simulated fixture cannot evaluate custom check "${check.label}"; the claim needs human review.`), check_method: "jev", evidence_json: { simulated: true, custom_check_id: check.id, check_label: check.label, check_version: check.version } });
      }
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
    async getReviews(signal) {
      signal?.throwIfAborted();
      const response = previewResponse(rows, knowledgeRevision);
      return copy({ ...response, capabilities: { ...response.capabilities!, supporting_documents: true, investigations: true, resolution_procedures: true, automatic_decision_emails: true, email_mode: "preview" } });
    },
    async getNotifications(signal) {
      signal?.throwIfAborted();
      return copy({ snapshot_token: notificationSnapshot(), mode: "preview" as const, messages: pendingNotifications() });
    },
    async sendNotifications(input) {
      if (input.confirmed !== true || !Array.isArray(input.message_ids) || !input.message_ids.length || input.message_ids.length > 1000 || new Set(input.message_ids).size !== input.message_ids.length) fail("INVALID_INPUT", "Confirm a nonempty notification selection.", 400);
      if (input.snapshot_token !== notificationSnapshot()) fail("STALE_SNAPSHOT", "Notifications changed. Review the pending list before confirming again.");
      const pending = pendingNotifications();
      if (input.message_ids.some(id => !pending.some(message => message.id === id))) fail("STALE_SNAPSHOT", "Notifications changed. Review the pending list before confirming again.");
      const released = pending.filter(message => input.message_ids.includes(message.id));
      for (const message of released) { message.status = "previewed"; message.message_revision++; message.updated_at = new Date().toISOString(); }
      return copy({ messages: released, processed: released.length, mode: "preview" as const, delivery_error: null });
    },
    async getMessages(id, signal) {
      signal?.throwIfAborted(); getRow(id);
      return copy({ messages: messages.filter(message => message.claim_id === id) });
    },
    async getSupportingDocuments(claimId, signal) {
      signal?.throwIfAborted(); getRow(claimId);
      return copy({ documents: documents.filter(document => document.claim_id === claimId) });
    },
    async uploadSupportingDocument(claimId, file, kind, expectedRevision) {
      let row = currentRow(claimId, expectedRevision);
      if (row.decision_status !== "pending") fail("EVIDENCE_BLOCKED", "Supporting evidence can only be added to pending claims.");
      if (row.processing_status === "running") fail("RUN_ACTIVE", "Wait for the active operation before adding evidence.");
      if (!["booking_confirmation", "itemized_document", "itinerary", "payment_confirmation", "other"].includes(kind)) fail("INVALID_BODY", "Choose a documented supporting-evidence kind.", 400);
      if (!file.size || file.size > 8 * 1024 * 1024) fail("INVALID_FILE", "Choose a PDF, PNG, or JPEG up to 8 MiB.", 400);
      if (documents.filter(document => document.claim_id === claimId).length >= 8) fail("DOCUMENT_LIMIT", "A claim supports at most eight supporting documents.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileType = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-" ? "application/pdf" :
        [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ? "image/png" :
        bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : null;
      if (!fileType) fail("INVALID_FILE", "The selected file must contain PDF, PNG, or JPEG bytes.", 400);
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
      row = currentRow(claimId, expectedRevision);
      if (documents.some(document => document.claim_id === claimId && document.sha256 === sha256)) fail("DOCUMENT_EXISTS", "These bytes are already attached to this claim.");
      const document: SupportingDocument = { id: crypto.randomUUID(), claim_id: claimId, kind, file_type: fileType, sha256, created_at: new Date().toISOString(),
        extraction_status: "failed", extraction_error: "Simulated preview retains your file but does not extract arbitrary uploads. Use the provided booking fixture for the simulated investigation.",
        extraction_provenance: "Simulated preview; no provider extraction attempted", extracted_text: null, facts: null };
      documents.push(document); originalUrls.set(document.id, URL.createObjectURL(new Blob([bytes], { type: fileType })));
      evidenceRevisions.set(row.id, (evidenceRevisions.get(row.id) ?? 0) + 1);
      row.assessment_status = null; row.assessment_knowledge_revision = null; row.latest_run_id = null;
      row.decisions = row.decisions.filter(check => check.check_method === "human"); row.investigation = null;
      touch(row);
      return copy({ document, row });
    },
    supportingDocumentUrl(claimId, documentId) {
      const document = documents.find(item => item.claim_id === claimId && item.id === documentId);
      if (!document) return null;
      if (!originalUrls.has(document.id) && document.extracted_text) originalUrls.set(document.id, URL.createObjectURL(new Blob([document.extracted_text], { type: "text/plain" })));
      return originalUrls.get(document.id) ?? null;
    },
    async getInvestigations(claimId, signal) {
      signal?.throwIfAborted();
      const found = runs.filter(run => claimId === undefined || run.claim_id === claimId).toSorted((a, b) => b.started_at.localeCompare(a.started_at) || b.run_id.localeCompare(a.run_id));
      return copy({ runs: found, coverage: { complete: true, returned: found.length, total: found.length } });
    },
    async getInvestigation(runId, signal) { signal?.throwIfAborted(); return copy({ run: getRun(runId) }); },
    async investigate(claimId, expectedRevision) {
      const row = currentRow(claimId, expectedRevision);
      if (row.processing_status === "running") fail("RUN_ACTIVE", "An operation is already active for this claim.");
      if (row.decision_status !== "pending" || !row.assessment_status) fail("INVESTIGATION_BLOCKED", "Investigation requires an assessed claim with a pending human decision.");
      const blocked = investigationFailure(row);
      if (blocked) fail("INVESTIGATION_NOT_NEEDED", blocked);
      const runId = crypto.randomUUID(), startedAt = new Date().toISOString();
      const before = snapshot(row);
      const booking = matchingBooking(row);
      const failed = row.receipt?.extraction_status !== "succeeded";
      if (!failed) assess(row, booking);
      const outcome = failed ? null : row.assessment_status === "matched" ? "resolved" : row.assessment_status === "flagged" ? "discrepancy_found" : "needs_human";
      const refs = row.receipt ? [{ kind: "receipt" as const, id: row.receipt.id }, ...(booking ? [{ kind: "supporting_document" as const, id: booking.id }] : [])] : [];
      const run: InvestigationRun = { run_id: runId, claim_id: row.id, trigger: "manual", status: failed ? "failed" : "completed", outcome,
        headline: `Simulated fixture: ${failed ? "receipt extraction unavailable" : outcome === "resolved" ? "ready for human review" : outcome === "discrepancy_found" ? "a protected check remains blocked" : "more evidence is needed"}`,
        summary: booking ? "Simulated fixture: matching booking references establish Harbor Hotel merchant identity; all financial and duplicate checks were recomputed. No provider calls were made." : "Simulated fixture: checked available evidence without provider calls. Human approval remains separate.",
        unresolved_question: outcome === "needs_human" ? "Provide a successfully extracted booking confirmation with the same booking reference, merchant, guest, date, and purchase total." : null,
        findings: failed ? [] : [{ id: crypto.randomUUID(), check: booking ? "merchant" : row.decisions.find(check => check.verdict === "fail")?.field_checked || "merchant",
          statement: booking ? "Simulated receipt and booking confirmation share a nonempty booking reference and consistent purchase facts." : "Simulated assessment retains the available evidence and any blocked or unresolved checks.", evidence_refs: refs }],
        before_assessment: before, after_assessment: failed ? null : snapshot(row), proposed_learning: outcome === "resolved" && booking ? fixtureProcedureCandidate(row, booking) : null,
        steps: [{ id: crypto.randomUUID(), run_id: runId, sequence: 1, tool: "read_receipt", status: failed ? "failed" : "completed", started_at: startedAt, completed_at: new Date().toISOString(),
          summary: "Simulated fixture: inspected the synthetic original receipt.", evidence_refs: refs.filter(ref => ref.kind === "receipt"), error: failed ? "Simulated extraction is unavailable." : null },
          ...(!failed && documents.some(document => document.claim_id === row.id) ? [{ id: crypto.randomUUID(), run_id: runId, sequence: 2, tool: "read_supporting_documents" as const,
            status: "completed" as const, started_at: startedAt, completed_at: new Date().toISOString(), summary: "Simulated fixture: inspected saved supporting evidence.",
            evidence_refs: documents.filter(document => document.claim_id === row.id).map(document => ({ kind: "supporting_document" as const, id: document.id })), error: null }] : [])],
        started_at: startedAt, completed_at: new Date().toISOString(), mode: "simulated", model: null, error: failed ? "Simulated extraction failure. Retry extraction, then recheck." : null };
      runs.push(run); row.latest_investigation = run;
      if (!failed) row.latest_run_id = run.run_id;
      return copy({ run, row });
    },
    async getProcedures(signal) { signal?.throwIfAborted(); return copy({ procedures, knowledge_revision: knowledgeRevision }); },
    async proposeProcedure(runId, expectedRevision) {
      const run = getRun(runId), row = currentRow(run.claim_id, expectedRevision);
      if (run.status !== "completed" || run.outcome !== "resolved" || !run.proposed_learning || !run.after_assessment) fail("RULE_INELIGIBLE", "This investigation has no supported procedure candidate.");
      if (row.latest_investigation?.run_id !== runId || run.after_assessment.evidence_revision !== evidenceRevisions.get(row.id)) fail("STALE_RUN", "Evidence or the latest investigation changed. Review the current result.");
      const correction = row.decisions.findLast(check => check.check_method === "human");
      const correctionId = correction?.evidence_json.correction_id;
      if (row.decision_status !== "approved" || correction?.answer_json.value !== "approved" || typeof correctionId !== "string" || !matchingBooking(row)) fail("RULE_INELIGIBLE", "A human must approve the supported source claim before proposing a procedure.");
      const existing = procedures.find(procedure => procedure.source_run_id === runId && procedure.source_correction_id === correctionId && procedure.state === "draft");
      if (existing) return procedureResult(existing);
      const procedure: ResolutionProcedure = { ...copy(run.proposed_learning), id: crypto.randomUUID(), version: 1, state: "draft", source_claim_id: row.id, source_run_id: runId,
        source_correction_id: correctionId, created_at: new Date().toISOString(), latest_test: null, latest_test_error: null };
      procedures.push(procedure); return procedureResult(procedure);
    },
    async testProcedure(id, expectedVersion) {
      const procedure = currentProcedure(id, expectedVersion);
      if (procedure.state !== "draft") fail("RULE_INELIGIBLE", "Only draft procedures can be tested.");
      eligibleProcedureSource(procedure);
      procedure.latest_test_error = null;
      procedure.latest_test = { procedure_id: id, procedure_version: procedure.version, knowledge_revision: knowledgeRevision, suite_version: "booking-reference-v1", mode: "simulated",
        tested_at: new Date().toISOString(), passed: true, applied_case_ids: ["preview-procedure-valid-a", "preview-procedure-valid-b"], regressed_case_ids: [],
        before: { total: 12, correct: 12, false_matches: 0, needs_review: 4 }, after: { total: 12, correct: 12, false_matches: 0, needs_review: 4 },
        reasons: ["Simulated fixture report for the fixed 12-case safety gate; no live suite, provider evaluation, or measured accuracy improvement."] };
      return copy(procedure.latest_test);
    },
    async activateProcedure(id, expectedVersion) {
      const procedure = currentProcedure(id, expectedVersion);
      if (procedure.state !== "draft") fail("RULE_INELIGIBLE", "Only draft procedures can be activated.");
      eligibleProcedureSource(procedure);
      const report = procedure.latest_test;
      if (!report) fail("TEST_REQUIRED", "Run the simulated safety test before activation.");
      if (!report.passed || procedure.latest_test_error) fail("TEST_FAILED", "The latest test did not pass.");
      if (report.procedure_version !== procedure.version || report.knowledge_revision !== knowledgeRevision || report.suite_version !== "booking-reference-v1" || report.mode !== "simulated") fail("STALE_RULE_TEST", "Knowledge changed. Test this draft again before activation.");
      procedure.state = "active"; procedure.version++; knowledgeRevision++;
      return procedureResult(procedure);
    },
    async disableProcedure(id, expectedVersion) {
      const procedure = currentProcedure(id, expectedVersion);
      if (procedure.state !== "disabled") { if (procedure.state === "active") knowledgeRevision++; procedure.state = "disabled"; procedure.version++; procedure.latest_test = null; }
      return procedureResult(procedure);
    },
    async getRules(signal) { signal?.throwIfAborted(); return copy({ rules, knowledge_revision: knowledgeRevision }); },
    async getChecks(signal) { signal?.throwIfAborted(); return copy({ checks: checkCatalog({ custom_checks: customChecks }), knowledge_revision: knowledgeRevision }); },
    async createCheck(input) {
      const valid = validCheckInput(input);
      if (customChecks.length >= 12) fail("CHECK_LIMIT", "At most 12 custom checks are supported.");
      const base = `custom_${valid.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32)}`;
      if (!/^custom_[a-z0-9]/.test(base)) fail("INVALID_BODY", "The check name must contain a letter or digit.", 400);
      const taken = new Set(customChecks.map(item => item.field));
      let field = base, suffix = 2;
      while (taken.has(field) || !/^custom_[a-z0-9_]{2,40}$/.test(field)) field = `${base}_${suffix++}`;
      const now = new Date().toISOString();
      const check: CustomCheck = { id: crypto.randomUUID(), version: 1, state: "active", field, label: valid.label, instructions: valid.instructions,
        criteria: { pass: input.criteria?.pass?.trim() || "The receipt evidence clearly satisfies this check.", fail: input.criteria?.fail?.trim() || "The receipt evidence clearly violates this check.", unknown: input.criteria?.unknown?.trim() || "The evidence is missing, incomplete, or conflicting." },
        category: valid.category, created_at: now, updated_at: now };
      customChecks.push(check); knowledgeRevision++;
      return checkResult(check);
    },
    async updateCheck(id, input) {
      const check = currentCheck(id, input.expected_check_version);
      const valid = validCheckInput(input);
      Object.assign(check, { label: valid.label, instructions: valid.instructions, category: valid.category,
        criteria: { pass: input.criteria?.pass?.trim() || check.criteria.pass, fail: input.criteria?.fail?.trim() || check.criteria.fail, unknown: input.criteria?.unknown?.trim() || check.criteria.unknown },
        version: check.version + 1, updated_at: new Date().toISOString() });
      if (check.state === "active") knowledgeRevision++;
      return checkResult(check);
    },
    async enableCheck(id, input) {
      const check = currentCheck(id, input.expected_check_version);
      if (check.state === "active") fail("STALE_CHECK", "This check is already enabled.");
      check.state = "active"; check.version++; check.updated_at = new Date().toISOString(); knowledgeRevision++;
      return checkResult(check);
    },
    async disableCheck(id, input) {
      const check = currentCheck(id, input.expected_check_version);
      if (check.state === "disabled") fail("STALE_CHECK", "This check is already disabled.");
      check.state = "disabled"; check.version++; check.updated_at = new Date().toISOString(); knowledgeRevision++;
      return checkResult(check);
    },
    async reconcile(input) {
      if (!input.submission_ids.length || input.submission_ids.length > 50 || new Set(input.submission_ids).size !== input.submission_ids.length) fail("INVALID_BODY", "Select 1–50 unique claims to recheck.", 400);
      return { results: input.submission_ids.map(id => {
        const row = getRow(id);
        assess(row);
        return { submission_id: row.id, run_id: row.latest_run_id, assessment_status: row.assessment_status, decision_status: row.decision_status, review_revision: row.review_revision };
      }) };
    },
    async decide(input) {
      if (typeof input.human_note !== "string" || !["approved", "rejected"].includes(input.human_verdict) ||
          (input.applicant_reason !== undefined && (typeof input.applicant_reason !== "string" || input.applicant_reason.trim().length > 1500)) ||
          (input.request_id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.request_id))) fail("INVALID_BODY", "Supply a valid decision, request ID, and applicant reason up to 1,500 characters.", 400);
      const payload = JSON.stringify({ submission_id: input.submission_id, expected_review_revision: input.expected_review_revision, human_verdict: input.human_verdict, human_note: input.human_note, correction_type: input.correction_type, correction_payload_json: input.correction_payload_json, applicant_reason: input.applicant_reason });
      const prior = input.request_id ? decisions.get(input.request_id) : undefined;
      if (prior) {
        if (prior.payload !== payload) fail("MESSAGE_CONFLICT", "This request ID was already used with a different decision.");
        return copy(prior.response);
      }
      const row = currentRow(input.submission_id, input.expected_review_revision);
      const note = input.human_note.trim();
      if (!note || note.length > 2000) fail("INVALID_BODY", "Enter a decision reason between 1 and 2,000 characters.", 400);
      if (input.correction_type !== "decision_override" || !input.correction_payload_json || typeof input.correction_payload_json !== "object" || Array.isArray(input.correction_payload_json) || Object.keys(input.correction_payload_json).length) fail("USE_RULES_ENDPOINT", "Merchant learning is a separate rule proposal.", 400);
      if (input.human_verdict === "approved") approvalGuard(row);
      const correctionId = crypto.randomUUID(), now = new Date().toISOString();
      const reason = input.applicant_reason?.trim() || decisionReason(row, "rejected", knowledgeRevision, rows, true);
      const body = input.human_verdict === "approved"
        ? "Your claim has been approved for reimbursement. This notice confirms approval; it does not confirm that payment has been made."
        : reason ? `${reason}\n\nPlease contact your reviewer if you need clarification about this decision.` : null;
      const subject = input.human_verdict === "approved" ? "Your reimbursement request is approved" : "Update on your reimbursement request";
      const header = `${row.attendee_name} — claim ${row.id} (${row.category}): ${input.human_verdict === "approved" ? "Approved for reimbursement" : "Rejected"}. ${row.currency} ${(row.amount_requested_minor / 100).toFixed(2)} ${input.human_verdict === "approved" ? "approved" : "requested"}.`;
      const text = body ? `${header}\n\n${body}` : "";
      const message: ClaimMessage | undefined = body ? {
        id: crypto.randomUUID(), claim_id: row.id, kind: input.human_verdict === "approved" ? "approval" : "rejection", intended_verdict: input.human_verdict,
        draft_revision: 1, message_revision: 1, source_review_revision: row.review_revision, source_evidence_revision: evidenceRevisions.get(row.id) ?? 0,
        source_knowledge_revision: knowledgeRevision, assessment_run_id: row.latest_run_id, reason_check_ids: [], recipient: row.email,
        subject, body, original_generated_subject: subject, original_generated_explanation: body, generation_error: null,
        generation_provenance: "template", generation_model: "applicant-template-v1", correction_id: correctionId, request_id: input.request_id ?? null,
        mode: "preview", from: "onboarding@resend.dev", reply_to: null, outcome_header: header, rendered_text: text,
        rendered_html: `<div style="white-space:pre-wrap">${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")}</div>`,
        status: "draft", provider_message_id: null, first_attempt_at: null, attempt_count: 0, next_attempt_at: null, error: null,
        created_at: now, updated_at: now, confirmed_at: now,
      } : undefined;
      row.decision_status = input.human_verdict;
      row.decision_source = "human";
      row.learning = { status: "not_applicable", summary: "Preview only: your internal review reason is saved. Automatic learning is not run in this tab.", updated_at: now };
      row.processing_status = "idle";
      row.processing_error = null;
      row.decisions.push({ ...fixtureCheck(0, "human_decision", input.human_verdict === "approved" ? "pass" : "fail", note, input.human_verdict), id: correctionId, check_method: "human", evidence_json: { simulated: true, correction_id: correctionId } });
      let changed = false;
      for (const rule of rules) if (rule.source_submission_id === row.id && rule.state !== "disabled") {
        changed ||= rule.state === "active";
        rule.state = "disabled"; rule.version++; rule.latest_test = null;
      }
      for (const procedure of procedures) if (procedure.source_claim_id === row.id && procedure.state !== "disabled") {
        changed ||= procedure.state === "active";
        procedure.state = "disabled"; procedure.version++; procedure.latest_test = null;
        procedure.latest_test_error = "Source approval changed. Propose and test a new procedure.";
      }
      if (changed) knowledgeRevision++;
      touch(row);
      for (const previous of messages) if (previous.claim_id === row.id && previous.status === "draft" && previous.correction_id) {
        previous.status = "cancelled"; previous.message_revision++; previous.updated_at = now;
      }
      if (message) messages.push(message);
      const response = copy({ correction_id: correctionId, row, ...(message ? { message } : {}), email_error: message ? null : "Decision saved. An applicant-facing reason is required to create this rejection notice." });
      if (input.request_id) decisions.set(input.request_id, { payload, response });
      return copy(response);
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
    async retryLearning(id, expectedRevision) {
      const row = currentRow(id, expectedRevision);
      if (row.learning?.status !== "failed") fail("LEARNING_NOT_RETRYABLE", "Only failed learning can be retried.");
      row.learning = { status: "not_applicable", summary: "Preview only: your internal review reason is saved. Automatic learning is not run in this tab.", updated_at: new Date().toISOString() };
      return copy({ row });
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
    receiptUrl(row) {
      const url = previewReceiptUrl(row);
      const prefix = "data:image/svg+xml;charset=utf-8,";
      if (!row.receipt || !url?.startsWith(prefix)) return url;
      if (!originalUrls.has(row.receipt.id)) originalUrls.set(row.receipt.id, URL.createObjectURL(new Blob([decodeURIComponent(url.slice(prefix.length))], { type: "image/svg+xml" })));
      return originalUrls.get(row.receipt.id)!;
    },
  };
}
