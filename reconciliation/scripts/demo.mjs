import { spawn } from 'node:child_process';
const live = process.argv.includes('--live-jev');
if (live && !process.env.AI_GATEWAY_API_KEY && !process.env.TYPESAFE_API_KEY && !process.env.JEV_API_KEY) {
  // Reuse the existing browser prototype's local Gateway configuration, never print it.
  try { process.loadEnvFile('../.env'); } catch {}
}
if (live && !process.env.AI_GATEWAY_API_KEY && !process.env.TYPESAFE_API_KEY && !process.env.JEV_API_KEY) {
  console.error('Set AI_GATEWAY_API_KEY or TYPESAFE_API_KEY in .env.local to run live Jev.'); process.exit(1);
}
const args = process.argv.slice(2).filter(arg => arg !== '--live-jev');
const portFlag = args.findIndex(arg => arg === '--port' || arg === '-p');
const port = portFlag >= 0 ? args[portFlag + 1] : process.env.PORT || '3000';
const env = { ...process.env, RECONCILIATION_SYNTHETIC_ONLY: 'true', RECONCILIATION_INTAKE_MODE: 'demo', RECONCILIATION_EXTRACTION_MODE: 'demo', RECONCILIATION_MODE: 'simulated', RECONCILIATION_APP_ORIGIN: `http://127.0.0.1:${port}` };
// The explicit demo command never spends credits, even when live keys are configured.
for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TYPESAFE_API_KEY', 'JEV_API_KEY', 'ELASTICSEARCH_URL', 'ELASTICSEARCH_API_KEY', 'OPENAI_API_KEY', 'AI_GATEWAY_API_KEY']) env[key] = '';
if (live) {
  env.RECONCILIATION_MODE = '';
  for (const key of ['TYPESAFE_API_KEY', 'JEV_API_KEY', 'AI_GATEWAY_API_KEY', 'JEV_MODEL']) env[key] = process.env[key] || '';
}
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', ...args], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
