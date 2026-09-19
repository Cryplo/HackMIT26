import { z } from "zod";
import { getStore } from "@/lib/intake/store";
import { IntakeError } from "@/lib/intake/schema";
import { errorResponse } from "@/lib/intake/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      throw new IntakeError(
        "origin_rejected",
        "Open receipts from the demo application.",
        403,
      );
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      throw new IntakeError("invalid_receipt_id", "Invalid receipt ID.");
    const result = await getStore().read(id);
    if (!result)
      throw new IntakeError(
        "receipt_not_found",
        "Receipt not found in synthetic demo scope.",
        404,
      );
    const ext =
      result.receipt.file_type === "application/pdf"
        ? "pdf"
        : result.receipt.file_type === "image/png"
          ? "png"
          : "jpg";
    return new Response(Buffer.from(result.bytes), {
      headers: {
        "Content-Type": result.receipt.file_type,
        "Content-Disposition": `inline; filename="synthetic-receipt.${ext}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
