/** Isolated paperwork demo. Live extraction is an explicit, paid opt-in; review stays simulated. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoSnapshot } from '../src/lib/core/fixtures';
import { responsesConfig } from '../src/lib/providers/responses';

async function main() {
  const args = process.argv.slice(2), live = args.includes('--live-extraction');
  const portIndex = args.indexOf('--port'), port = portIndex >= 0 ? args[portIndex + 1] : '3017';
  if (!/^\d+$/.test(port || '') || Number(port) < 1024 || Number(port) > 65535 || args.some((arg, i) => !['--live-extraction', '--port'].includes(arg) && !(portIndex >= 0 && i === portIndex + 1))) throw new Error('Use --port 3017 and optional --live-extraction.');
  if (live) responsesConfig('extraction');
  const root = await mkdtemp(path.join(tmpdir(), 'sift-paperwork-'));
  const claims = path.join(root, 'claims');
  await mkdir(claims, { mode: 0o700 });
  await writeFile(path.join(claims, 'core-state.json'), JSON.stringify({ version: 1, state: { ...demoSnapshot(), submissions: [], receipts: [] }, calls: [] }), { mode: 0o600 });
  const env: NodeJS.ProcessEnv = {
    ...process.env, RECONCILIATION_SYNTHETIC_ONLY: 'true', RECONCILIATION_SOURCE_AUDIT: 'true', RECONCILIATION_INTAKE_MODE: 'demo',
    RECONCILIATION_EXTRACTION_MODE: live ? 'live' : 'demo', RECONCILIATION_MODE: 'simulated',
    RECONCILIATION_APP_ORIGIN: `http://127.0.0.1:${port}`, RECONCILIATION_INTAKE_DEMO_DIR: claims,
    RECONCILIATION_INBOX_DIR: path.join(root, 'inbox'), RECONCILIATION_INVESTIGATION_MODE: 'disabled',
    RECONCILIATION_JUSTIFICATION_MODE: 'simulated', RECONCILIATION_AUTOMATION_MODE: 'policy-caps',
    RECONCILIATION_EMAIL_MODE: 'preview', RECONCILIATION_EMAIL_DRAFT_MODE: 'template',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next-paperwork',
  };
  for (const key of ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TYPESAFE_API_KEY','JEV_API_KEY','AI_GATEWAY_API_KEY','RESEND_API_KEY','ELASTICSEARCH_API_KEY']) env[key] = '';
  if (!live) for (const key of ['OPENAI_API_KEY','AZURE_OPENAI_ENDPOINT','AZURE_OPENAI_API_KEY','AZURE_OPENAI_DEPLOYMENT']) env[key] = '';
  console.log(`Paperwork demo: ${live ? 'LIVE paid extraction' : 'SIMULATED authored extraction'}; isolated local storage; simulated review; email preview only.`);
  console.log(`Private store: ${root}\nOpen http://127.0.0.1:${port}/overview`);
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', port], { env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  child.on('exit', code => process.exit(code ?? 0));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Demo startup failed.'); process.exitCode = 1; });
