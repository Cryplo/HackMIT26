import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
const live = process.argv.includes('--live-jev');
const showcase = process.argv.includes('--showcase');
const auditReady = process.argv.includes('--audit-ready');
if (auditReady && !showcase) { console.error('--audit-ready requires --showcase.'); process.exit(1); }
if (showcase && live) { console.error('--showcase is offline and cannot be combined with --live-jev.'); process.exit(1); }
if (live && !process.env.AI_GATEWAY_API_KEY && !process.env.TYPESAFE_API_KEY && !process.env.JEV_API_KEY) {
  // Reuse the existing browser prototype's local Gateway configuration, never print it.
  try { process.loadEnvFile('../.env'); } catch {}
}
if (live && !process.env.AI_GATEWAY_API_KEY && !process.env.TYPESAFE_API_KEY && !process.env.JEV_API_KEY) {
  console.error('Set AI_GATEWAY_API_KEY or TYPESAFE_API_KEY in .env.local to run live Jev.'); process.exit(1);
}
const args = process.argv.slice(2).filter(arg => !['--live-jev', '--showcase', '--audit-ready'].includes(arg));
const portFlag = args.findIndex(arg => arg === '--port' || arg === '-p');
const port = portFlag >= 0 ? args[portFlag + 1] : process.env.PORT || '3000';
const env = { ...process.env, RECONCILIATION_SYNTHETIC_ONLY: 'true', RECONCILIATION_INTAKE_MODE: 'demo', RECONCILIATION_EXTRACTION_MODE: 'demo', RECONCILIATION_MODE: 'simulated', RECONCILIATION_APP_ORIGIN: `http://127.0.0.1:${port}` };
// The explicit demo command never spends credits, even when live keys are configured.
env.RECONCILIATION_EMAIL_MODE = 'preview';
env.RECONCILIATION_EMAIL_DRAFT_MODE = 'template';
env.RESEND_API_KEY = '';
for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TYPESAFE_API_KEY', 'JEV_API_KEY', 'ELASTICSEARCH_URL', 'ELASTICSEARCH_API_KEY', 'OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT', 'AI_GATEWAY_API_KEY']) env[key] = '';
if (live) {
  env.RECONCILIATION_MODE = '';
  for (const key of ['TYPESAFE_API_KEY', 'JEV_API_KEY', 'AI_GATEWAY_API_KEY', 'JEV_MODEL']) env[key] = process.env[key] || '';
}
if (showcase) {
  env.RECONCILIATION_INVESTIGATION_MODE = 'simulated';
  env.RECONCILIATION_JUSTIFICATION_MODE = 'simulated';
  if (auditReady) { env.RECONCILIATION_AUTOMATION_MODE = 'policy-caps'; env.RECONCILIATION_AUDIT_DEMO = 'true'; }
  env.RECONCILIATION_INTAKE_DEMO_DIR = path.resolve(process.env.RECONCILIATION_INTAKE_DEMO_DIR || path.join(tmpdir(), `sift-showcase-${randomUUID()}`));
  const seed = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'scripts/seed-showcase.ts', env.RECONCILIATION_INTAKE_DEMO_DIR, ...(auditReady ? ['--audit-ready'] : [])], { env, stdio: 'inherit' });
  if (seed.error || seed.status !== 0) { console.error('Showcase seeding failed; use a new private directory.'); process.exit(1); }
}
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', ...args], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
