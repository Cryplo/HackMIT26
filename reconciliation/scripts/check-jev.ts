import { LiveJev } from '../src/lib/core/jev';
import { demoSnapshot } from '../src/lib/core/fixtures';
async function main() {
if (process.argv.includes('--workflow')) throw new Error('The legacy workflow smoke test is retired. Follow docs/next-work/04-devin-benchmark.md for reviewed rule testing; no model calls were made.');
const direct = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
const key = direct || process.env.AI_GATEWAY_API_KEY;
if (!key) throw new Error('Set TYPESAFE_API_KEY or AI_GATEWAY_API_KEY before the live smoke test.');
const channel = direct ? 'typesafe' : 'gateway';
const model = process.env.JEV_MODEL || (direct ? 'jev-latest' : 'typesafe-ai/jev');
const state = demoSnapshot();
const answer = await new LiveJev(key, model, channel).evaluate({ submission: state.submissions[0], receipt: state.receipts[0].parsed_fields_json!, evidence: { candidates: [], aliases: [], retrieval_mode: 'simulated' } }, crypto.randomUUID(), async call => {
  console.log(JSON.stringify({ provider: call.provider, model: call.model, latency_ms: call.latency_ms, input_tokens: call.input_tokens, output_tokens: call.output_tokens }));
});
console.log(JSON.stringify({ simulated: answer.simulated, answers: answer.answers }, null, 2));

}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
