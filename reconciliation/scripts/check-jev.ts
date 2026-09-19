import { LiveJev } from '../src/lib/core/jev';
import { demoSnapshot } from '../src/lib/core/fixtures';
import { DEMO_IDS } from '../src/lib/core/fixtures';
import { CoreService } from '../src/lib/core/service';
import { MemoryStore } from '../src/lib/core/store';
import { SimulatedRetrieval } from '../src/lib/core/retrieval';
async function main() {
const direct = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
const key = direct || process.env.AI_GATEWAY_API_KEY;
if (!key) throw new Error('Set TYPESAFE_API_KEY or AI_GATEWAY_API_KEY before the live smoke test.');
const channel = direct ? 'typesafe' : 'gateway';
const model = process.env.JEV_MODEL || (direct ? 'jev-latest' : 'typesafe-ai/jev');
const state = demoSnapshot();
if (process.argv.includes('--workflow')) {
  const store = new MemoryStore(state);
  const core = new CoreService(store, new SimulatedRetrieval(), new LiveJev(key, model, channel), true);
  const before = await core.reconcile(DEMO_IDS);
  await core.correct({ submission_id: DEMO_IDS[2], human_verdict: 'approved', human_note: 'Synthetic hotel descriptor verified for this test.', correction_type: 'vendor_alias', correction_payload_json: { observed_vendor: 'SYN HBR 042', canonical_vendor: 'Synthetic Harbor Hotel', scope: { category: 'hotel', currency: 'USD' } } });
  const after = await core.reconcile([DEMO_IDS[3], DEMO_IDS[4]]);
  console.log(JSON.stringify({ verified_at: new Date().toISOString(), model, live_jev: true, retrieval: 'simulated', extraction: 'fixtures', before: before.results, after: after.results, checks: store.state.decisions.filter(d => d.submission_id === DEMO_IDS[3] && d.check_method === 'jev').map(d => ({ run_id: d.run_id, field: d.field_checked, verdict: d.verdict, answer: d.answer_json, probability: d.probability, confidence: d.confidence_score, rationale: d.rationale_text })), usage: store.calls.map(({ provider, model, input_tokens, output_tokens, latency_ms }) => ({ provider, model, input_tokens, output_tokens, latency_ms })) }, null, 2));
  return;
}
const answer = await new LiveJev(key, model, channel).evaluate({ submission: state.submissions[0], receipt: state.receipts[0].parsed_fields_json!, evidence: { candidates: [], aliases: [], retrieval_mode: 'simulated' } }, crypto.randomUUID(), async call => {
  console.log(JSON.stringify({ provider: call.provider, model: call.model, latency_ms: call.latency_ms, input_tokens: call.input_tokens, output_tokens: call.output_tokens }));
});
console.log(JSON.stringify({ simulated: answer.simulated, answers: answer.answers }, null, 2));

}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
