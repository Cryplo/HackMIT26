import { createClient } from '@supabase/supabase-js';
import { demoSnapshot } from '../src/lib/core/fixtures';
import { receiptPdf } from '../src/lib/demo/samples';
async function main() {
  if (process.env.RECONCILIATION_SYNTHETIC_ONLY !== 'true') throw new Error('Enable RECONCILIATION_SYNTHETIC_ONLY=true first.');
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) throw new Error('Configure Supabase in .env.local first.');
  const client = createClient(url, key, { auth: { persistSession: false } });
  const bucketName = process.env.SUPABASE_RECEIPTS_BUCKET || 'receipts';
  const bucket = await client.storage.getBucket(bucketName);
  if (bucket.error || bucket.data?.public) throw new Error('Apply the migration first; receipts bucket must be private.');
  for (const receipt of demoSnapshot().receipts) {
    const { data, error } = await client.from('receipts').select('id,storage_path').eq('id', receipt.id).single();
    if (error || data.storage_path !== receipt.storage_path) throw new Error('Apply seed.sql first in a dedicated demo project. Seed record missing or changed.');
    const uploaded = await client.storage.from(bucketName).upload(receipt.storage_path, receiptPdf(receipt.parsed_fields_json!), { contentType: 'application/pdf', upsert: true });
    if (uploaded.error) throw new Error(`Unable to upload synthetic receipt ${receipt.id}.`);
    const updated = await client.from('receipts').update({ file_type: 'application/pdf' }).eq('id', receipt.id);
    if (updated.error) throw new Error(`Unable to update synthetic receipt ${receipt.id}.`);
  }
  console.log('Five fictional receipt PDFs uploaded to private demo storage.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
