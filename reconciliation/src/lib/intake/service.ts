import { randomUUID } from "node:crypto";
import type { IntakeStore } from "./store";
import type { ExtractionResult } from "./extract";
import type { Claim, Receipt, SubmissionInput } from "./schema";
export async function submitReceipt(
  input: SubmissionInput,
  bytes: Uint8Array,
  fileType: string,
  store: IntakeStore,
  extract: (id: string) => Promise<ExtractionResult>,
) {
  const now = new Date().toISOString();
  const claim: Claim = {
    ...input,
    id: randomUUID(),
    status: "pending",
    latest_run_id: null,
    submitted_at: now,
    updated_at: now,
  };
  const receipt: Receipt = {
    id: randomUUID(),
    submission_id: claim.id,
    storage_path: "",
    file_type: fileType,
    raw_extracted_text: null,
    parsed_fields_json: null,
    extraction_status: "pending",
    extraction_error: null,
    extracted_at: null,
  };
  receipt.storage_path = `synthetic/${claim.id}/${receipt.id}`;
  await store.create(claim, receipt, bytes);
  try {
    const result = await extract(receipt.id);
    // Save returned provider usage exactly once, including refusal/invalid-output calls.
    if (result.usage) await store.usage(result.usage);
    receipt.raw_extracted_text = result.raw;
    receipt.parsed_fields_json = result.fields;
    receipt.extraction_status = result.error ? "failed" : "succeeded";
    receipt.extraction_error = result.error;
  } catch {
    receipt.extraction_status = "failed";
    receipt.extraction_error =
      "Extraction or usage persistence failed; receipt retained for review.";
  }
  receipt.extracted_at = new Date().toISOString();
  await store.finish(receipt);
  return {
    submission_id: claim.id,
    receipt_id: receipt.id,
    extraction_status: receipt.extraction_status,
  };
}
