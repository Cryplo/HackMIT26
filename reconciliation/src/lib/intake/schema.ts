import { z } from "zod";
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
export const Fields = z
  .object({
    schema_version: z.literal(1),
    vendor: z.string().max(500).nullable(),
    receipt_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (s) =>
          !Number.isNaN(Date.parse(s)) &&
          new Date(s).toISOString().slice(0, 10) === s,
        "Invalid date",
      )
      .nullable(),
    amount_minor: z.number().int().min(0).max(2147483647).nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    names: z.array(z.string().max(300)).max(50),
    receipt_number: z.string().max(500).nullable(),
  })
  .strict();
export const Extraction = z
  .object({
    raw_extracted_text: z.string().max(50000),
    parsed_fields_json: Fields,
  })
  .strict();
export const Submission = z
  .object({
    attendee_name: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    amount_requested_minor: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(0).max(2147483647)),
    currency: z.literal("USD"),
    category: z.enum(["flight", "hotel", "train", "bus", "other"]),
    origin_location: z.string().trim().min(1).max(200),
  })
  .strict();
export type SubmissionInput = z.infer<typeof Submission>;
export type ParsedFields = z.infer<typeof Fields>;
export type Receipt = {
  id: string;
  submission_id: string;
  storage_path: string;
  file_type: string;
  raw_extracted_text: string | null;
  parsed_fields_json: ParsedFields | null;
  extraction_status: "pending" | "succeeded" | "failed";
  extraction_error: string | null;
  extracted_at: string | null;
};
export type Claim = SubmissionInput & {
  id: string;
  submitted_at: string;
  updated_at: string;
  status: "pending";
  latest_run_id: null;
};
export type Usage = {
  id: string;
  run_id: null;
  receipt_id: string;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  estimated_cost_usd: null;
  created_at: string;
};
export class IntakeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function detectType(bytes: Uint8Array, declared: string) {
  const detected =
    Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-"
      ? "application/pdf"
      : Buffer.from(bytes.subarray(0, 8)).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          )
        ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? "image/jpeg"
          : null;
  if (!detected || declared !== detected)
    throw new IntakeError(
      "unsupported_file",
      "Upload a valid PDF, PNG, or JPG whose content matches its file type.",
      415,
    );
  return detected;
}
