import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { intakeMode } from "./config";
import { IntakeError, type Claim, type Receipt, type Usage } from "./schema";
import { SupabaseStore } from "../core/store";
import { CoreError } from "../core/validation";
export interface IntakeStore {
  create(claim: Claim, receipt: Receipt, bytes: Uint8Array): Promise<void>;
  finish(receipt: Receipt): Promise<void>;
  usage(call: Usage): Promise<void>;
  read(id: string): Promise<{ receipt: Receipt; bytes: Uint8Array } | null>;
}
export class LocalStore implements IntakeStore {
  constructor(private dir: string) {}
  async create(claim: Claim, receipt: Receipt, bytes: Uint8Array) {
    const { FileStore } = await import("../core/file-store");
    await new FileStore(this.dir).createIntakeRecord(claim, receipt, bytes);
  }
  async finish(receipt: Receipt) {
    const { FileStore } = await import("../core/file-store");
    await new FileStore(this.dir).finishInitialExtraction(receipt);
  }
  async usage(call: Usage) {
    const { FileStore } = await import("../core/file-store");
    await new FileStore(this.dir).intakeUsage(call);
  }
  async read(id: string) {
    try {
      const receipt = JSON.parse(
        await readFile(path.join(this.dir, `${id}.receipt.json`), "utf8"),
      ) as Receipt;
      return {
        receipt,
        bytes: new Uint8Array(await readFile(path.join(this.dir, `${id}.bin`))),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
}
function checked(error: unknown) {
  if (error)
    throw new IntakeError(
      "storage_unavailable",
      "Receipt storage is unavailable.",
      503,
    );
}
export function getStore(): IntakeStore {
  if (intakeMode() === "demo")
    return new LocalStore(
      path.resolve(
        /* turbopackIgnore: true */ process.env
          .RECONCILIATION_INTAKE_DEMO_DIR || ".intake-demo",
      ),
    );
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new IntakeError(
      "storage_not_configured",
      "Live receipt storage is not configured.",
      503,
    );
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const platform = new SupabaseStore(url, key);
  async function checkSchema() {
    try { await platform.assertSchema(); }
    catch (error) {
      if (error instanceof CoreError) throw new IntakeError(error.code.toLowerCase(), error.message, error.status);
      checked(error);
    }
  }
  const bucket = client.storage.from(
    process.env.SUPABASE_RECEIPTS_BUCKET || "receipts",
  );
  return {
    async create(claim, receipt, bytes) {
      await checkSchema();
      const bucketInfo = await client.storage.getBucket(
        process.env.SUPABASE_RECEIPTS_BUCKET || "receipts",
      );
      checked(bucketInfo.error);
      if (bucketInfo.data?.public)
        throw new IntakeError(
          "private_bucket_required",
          "Receipt storage must be private.",
          503,
        );
      checked(
        (
          await bucket.upload(receipt.storage_path, bytes, {
            contentType: receipt.file_type,
            upsert: false,
          })
        ).error,
      );
      // An insert can commit before its response fails. Retain the private original for recovery.
      checked((await client.from("submissions").insert(claim)).error);
      checked((await client.from("receipts").insert(receipt)).error);
    },
    async finish(receipt) {
      await checkSchema();
      checked(
        (await client.rpc("core_finish_initial_extraction", { p_receipt: receipt })).error,
      );
    },
    async usage(call) {
      await checkSchema();
      checked((await client.from("model_calls").insert(call)).error);
    },
    async read(id) {
      const row = await client
        .from("receipts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      checked(row.error);
      if (!row.data) return null;
      const receipt = row.data as Receipt;
      // Only files created within this synthetic intake namespace are viewable.
      if (
        receipt.storage_path !==
        `synthetic/${receipt.submission_id}/${receipt.id}`
      )
        return null;
      const file = await bucket.download(receipt.storage_path);
      // Only a confirmed missing object is unavailable evidence; auth/network errors must surface.
      if (file.error && (("code" in file.error && file.error.code === "NoSuchKey") || (file.error.statusCode === "404" && file.error.message === "Object not found"))) return null;
      checked(file.error);
      return { receipt, bytes: new Uint8Array(await file.data!.arrayBuffer()) };
    },
  };
}
