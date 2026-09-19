import "server-only";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { intakeMode } from "./config";
import { IntakeError, type Claim, type Receipt, type Usage } from "./schema";
export interface IntakeStore {
  create(claim: Claim, receipt: Receipt, bytes: Uint8Array): Promise<void>;
  finish(receipt: Receipt): Promise<void>;
  usage(call: Usage): Promise<void>;
  read(id: string): Promise<{ receipt: Receipt; bytes: Uint8Array } | null>;
}
export class LocalStore implements IntakeStore {
  constructor(private dir: string) {}
  private async put(name: string, value: unknown) {
    await mkdir(this.dir, { recursive: true });
    const temp = path.join(this.dir, `${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, path.join(this.dir, name));
  }
  async create(claim: Claim, receipt: Receipt, bytes: Uint8Array) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, `${receipt.id}.bin`), bytes, {
      mode: 0o600,
    });
    await this.put(`${claim.id}.submission.json`, claim);
    await this.put(`${receipt.id}.receipt.json`, receipt);
  }
  async finish(receipt: Receipt) {
    await this.put(`${receipt.id}.receipt.json`, receipt);
  }
  async usage(call: Usage) {
    await this.put(`${call.id}.usage.json`, call);
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
  const bucket = client.storage.from(
    process.env.SUPABASE_RECEIPTS_BUCKET || "receipts",
  );
  return {
    async create(claim, receipt, bytes) {
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
      const submission = await client.from("submissions").insert(claim);
      if (submission.error) {
        await bucket.remove([receipt.storage_path]);
        checked(submission.error);
      }
      const saved = await client.from("receipts").insert(receipt);
      if (saved.error) {
        await client.from("submissions").delete().eq("id", claim.id);
        await bucket.remove([receipt.storage_path]);
        checked(saved.error);
      }
    },
    async finish(receipt) {
      const { id, ...values } = receipt;
      checked(
        (await client.from("receipts").update(values).eq("id", id)).error,
      );
    },
    async usage(call) {
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
      checked(file.error);
      return { receipt, bytes: new Uint8Array(await file.data!.arrayBuffer()) };
    },
  };
}
