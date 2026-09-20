import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CoreService } from './service';
import { pendingNotice, publicMessage } from './communications-state';
import { workspaceSnapshot } from './projection';
import { CoreError } from './validation';
import { emailConfig, assertEmailRecipient } from '../email/config';
import { dispatchEmailOnce, type DispatchOptions } from '../email/dispatcher';

const confirmation = z.object({ snapshot_token: z.string().regex(/^[a-f0-9]{64}$/),
  message_ids: z.array(z.string().uuid()).min(1).max(1000).refine(ids => new Set(ids).size === ids.length), confirmed: z.literal(true) }).strict();

async function notificationBatch(core: CoreService) {
  const config = emailConfig();
  const state = await core.store.snapshot();
  const history = (await core.store.messages({ action: 'outbox' })).messages ?? [];
  const messages = history.filter(m => pendingNotice(state, m)).sort((a, b) => a.id.localeCompare(b.id));
  const snapshot_token = createHash('sha256').update(JSON.stringify({ workspace: workspaceSnapshot(state).token,
    mode: config.mode, messages: messages.map(m => [m.id, m.message_revision]) })).digest('hex');
  return { config, state, messages, snapshot_token };
}

export async function listWorkspaceNotifications(core: CoreService) {
  const batch = await notificationBatch(core);
  return { snapshot_token: batch.snapshot_token, mode: batch.config.mode, messages: batch.messages.map(publicMessage) };
}

/** Release exactly one reviewed batch. Repeat requests fail stale instead of authorizing another send. */
export async function sendWorkspaceNotifications(core: CoreService, raw: unknown, options: Pick<DispatchOptions, 'provider' | 'signal'> = {}) {
  const parsed = confirmation.safeParse(raw);
  if (!parsed.success) throw new CoreError('INVALID_INPUT', 'Confirm the current notification batch and its message IDs.');
  const batch = await notificationBatch(core), { message_ids, snapshot_token } = parsed.data;
  if (snapshot_token !== batch.snapshot_token) throw new CoreError('STALE_MESSAGE', 'Notifications changed. Refresh and review the batch again.', 409);
  if (batch.config.mode === 'disabled') throw new CoreError('EMAIL_UNAVAILABLE', 'Notifications are disabled.', 503);
  const messages = message_ids.map(id => batch.messages.find(m => m.id === id));
  if (messages.some(m => !m || m.mode !== batch.config.mode)) throw new CoreError('STALE_MESSAGE', 'A notification is no longer eligible for this batch.', 409);
  for (const m of messages) assertEmailRecipient(batch.config, m!.recipient);
  const released = await core.store.messages({ action: 'release_batch', expected: batch.state,
    messages: messages.map(m => ({ id: m!.id, revision: m!.message_revision })), confirmed: true,
    mode: batch.config.mode, from: batch.config.from, reply_to: batch.config.replyTo });
  let delivery_error: string | null = null;
  if (batch.config.mode === 'live') {
    try {
      for (const id of message_ids) await dispatchEmailOnce(core.store, { ...options, config: batch.config, messageId: id });
    } catch { delivery_error = 'The batch was confirmed. Refresh notification history before retrying; some delivery outcomes may still be pending.'; }
  }
  const current = await core.store.messages({ action: 'outbox' }).catch(() => released);
  const results = (current.messages ?? []).filter(m => message_ids.includes(m.id));
  return { messages: results.map(publicMessage), processed: results.filter(m => ['accepted', 'previewed'].includes(m.status)).length,
    mode: batch.config.mode, delivery_error };
}
