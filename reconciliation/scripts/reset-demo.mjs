import { rename, stat } from 'node:fs/promises';
import path from 'node:path';
if (!process.argv.includes('--confirm')) {
  console.error('Run npm run demo:reset -- --confirm with the demo server stopped. Existing local demo data will be archived, not deleted.');
  process.exit(1);
}
const dir = path.resolve(process.env.RECONCILIATION_INTAKE_DEMO_DIR || '.intake-demo');
try { await stat(path.join(dir, '.core-lock')); console.error('Demo storage is locked. Stop the app and resolve any interrupted lock before resetting.'); process.exit(1); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
try {
  const archive = `${dir}.backup-${Date.now()}`;
  await rename(dir, archive);
  console.log(`Demo archived to ${archive}. Restart the app to get five fresh claims.`);
} catch (e) { if (e.code !== 'ENOENT') throw e; console.log('No local data to reset.'); }
