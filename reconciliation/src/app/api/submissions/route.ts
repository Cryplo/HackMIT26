import { intakeMode } from "@/lib/intake/config";
import { extractReceipt } from "@/lib/intake/extract";
import { parseUpload, errorResponse } from "@/lib/intake/http";
import { submitReceipt } from "@/lib/intake/service";
import { getStore } from "@/lib/intake/store";
import { getCore } from "@/lib/core/runtime";
import { after } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 300;
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
    if (result.extraction_status === "succeeded") after(async () => {
      // ponytail: request-bound work; use a durable queue if jobs must survive process restarts.
      try { const core = getCore(); if (core.automationEnabled) await core.reconcile([result.submission_id]); }
      catch { console.error("Automatic checks could not start; the saved claim remains available for retry."); }
    });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store", "X-Intake-Mode": extractionMode },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
