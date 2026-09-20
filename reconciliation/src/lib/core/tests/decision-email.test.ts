import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../store';
import { CoreService } from '../service';
import { demoSnapshot, DEMO_IDS } from '../fixtures';
import { DatabaseRetrieval } from '../retrieval';
import { SimulatedJev } from '../jev';
import { workspaceRows } from '../projection';
import { draftDecisionEmail, confirmDecisionEmail } from '../email-actions';
import { dispatchEmailOnce } from '../../email/dispatcher';
import { emailConfig } from '../../email/config';

test('simulated email saves one decision, never dispatches, and rejects conflicting confirmations', async () => {
  const previous = process.env.RECONCILIATION_EMAIL_MODE;
  process.env.RECONCILIATION_EMAIL_MODE = 'preview';
  try {
    const store = new MemoryStore(demoSnapshot());
    const core = new CoreService(store, new DatabaseRetrieval(), new SimulatedJev(), true);
    await core.reconcile([DEMO_IDS[0]]);
    const row = workspaceRows(await store.snapshot()).find(row => row.id === DEMO_IDS[0])!;
    const draft = await draftDecisionEmail(core, row.id, { kind: 'approval', expected_review_revision: row.review_revision, reason_check_ids: [] });
    const input = { expected_review_revision: row.review_revision, human_verdict: 'approved', human_note: 'Receipt verified.', message_id: draft.message.id, expected_draft_revision: draft.message.draft_revision, request_id: randomUUID() };
    const confirmed = await confirmDecisionEmail(core, row.id, input);
    assert.equal(confirmed.message.status, 'draft');
    assert.equal(confirmed.row?.decision_status, 'approved');
    assert.equal((await confirmDecisionEmail(core, row.id, input)).correction_id, confirmed.correction_id);
    assert.equal((await store.snapshot()).corrections.length, 1);
    await assert.rejects(confirmDecisionEmail(core, row.id, { ...input, request_id: randomUUID() }), { code: 'MESSAGE_ALREADY_CONFIRMED' });
    await assert.rejects(confirmDecisionEmail(core, row.id, { ...input, human_note: 'Changed input' }), { code: 'MESSAGE_CONFLICT' });
    const provider = { send: async () => { assert.fail('Simulated messages must never reach an email provider'); } };
    assert.deepEqual(await dispatchEmailOnce(store, { config: emailConfig({}), provider }), { processed: false });
    // Even a later live worker cannot pick up a previewed message.
    assert.deepEqual(await dispatchEmailOnce(store, { config: { ...emailConfig({}), mode: 'live' }, provider }), { processed: false });
    assert.equal((await store.snapshot()).claim_messages![0].attempt_count, 0);
  } finally {
    if (previous === undefined) delete process.env.RECONCILIATION_EMAIL_MODE;
    else process.env.RECONCILIATION_EMAIL_MODE = previous;
  }
});
