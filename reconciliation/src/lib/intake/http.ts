import {
  IntakeError,
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  Submission,
  detectType,
} from "./schema";
export function checkOrigin(request: Request) {
  const expected =
    process.env.RECONCILIATION_APP_ORIGIN || new URL(request.url).origin;
  if (
    request.headers.get("origin") !== expected ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new IntakeError(
      "origin_rejected",
      "Submit this form from the application origin.",
      403,
    );
}
export async function boundedMultipart(request: Request) {
  checkOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new IntakeError(
      "invalid_content_type",
      "Expected multipart form data.",
      415,
    );
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES)
    throw new IntakeError("upload_too_large", "Receipt limit is 8 MB.", 413);
  // Read with a hard cap before multipart parsing, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader)
    throw new IntakeError("missing_body", "A submission is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new IntakeError("upload_too_large", "Receipt limit is 8 MB.", 413);
    }
    chunks.push(value);
  }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new IntakeError(
      "invalid_form",
      "The multipart form could not be read.",
    );
  }
  return form;
}
export async function parseUpload(request:Request){
  const form=await boundedMultipart(request);
  const allowed = [...Object.keys(Submission.shape), "file"];
  for (const key of form.keys())
    if (!allowed.includes(key) || form.getAll(key).length !== 1)
      throw new IntakeError(
        "invalid_form",
        "Provide exactly one value per field and one receipt.",
      );
  const result = Submission.safeParse(
    Object.fromEntries(
      Object.keys(Submission.shape).map((key) => [key, form.get(key)]),
    ),
  );
  if (!result.success)
    throw new IntakeError(
      "invalid_submission",
      "Check the name, email, USD amount, category, and origin.",
    );
  const file = form.get("file");
  if (!(file instanceof File) || !file.size)
    throw new IntakeError("missing_file", "Choose one nonempty receipt.");
  if (file.size > MAX_FILE_BYTES)
    throw new IntakeError("upload_too_large", "Receipt limit is 8 MB.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { input: result.data, bytes, fileType: detectType(bytes, file.type) };
}
export function errorResponse(error: unknown) {
  const e =
    error instanceof IntakeError
      ? error
      : new IntakeError(
          "intake_unavailable",
          "The receipt service is unavailable. Please try again.",
          503,
        );
  return Response.json(
    { error: { code: e.code, message: e.message } },
    { status: e.status, headers: { "Cache-Control": "no-store" } },
  );
}
