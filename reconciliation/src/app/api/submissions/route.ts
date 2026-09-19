import { intakeMode } from "@/lib/intake/config";
import { extractReceipt } from "@/lib/intake/extract";
import { parseUpload, errorResponse } from "@/lib/intake/http";
import { submitReceipt } from "@/lib/intake/service";
import { getStore } from "@/lib/intake/store";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(request: Request) {
  try {
    const mode = intakeMode();
    const extractionMode = process.env.RECONCILIATION_EXTRACTION_MODE || mode;
    if (!["demo", "live"].includes(extractionMode)) throw new Error("Invalid extraction mode");
    const { input, bytes, fileType } = await parseUpload(request);
    const result = await submitReceipt(
      input,
      bytes,
      fileType,
      getStore(),
      (id) => extractReceipt(bytes, fileType, id, extractionMode as "demo" | "live"),
    );
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store", "X-Intake-Mode": extractionMode },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
