/** Explicit foreground worker. Loading app pages and GET routes never starts this process. */
import { setTimeout as pause } from 'node:timers/promises';
import { getCore } from '../src/lib/core/runtime';
import { emailConfig } from '../src/lib/email/config';
import { dispatchEmailOnce } from '../src/lib/email/dispatcher';
import { CoreError } from '../src/lib/core/validation';
async function main() {
  const config = emailConfig();
  if (config.mode !== 'live') { console.info(`Email worker idle: mode is ${config.mode}; no delivery attempted.`); return; }
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  const core = getCore();
  console.info('Email worker started. Only confirmed, allowlisted live messages will be sent.');
  while (!stop.signal.aborted) {
    try {
      const result = await dispatchEmailOnce(core.store,{config,signal:stop.signal});
      if (result.processed) console.info(JSON.stringify({event:'email_attempt_settled',message_id:result.messageId,status:result.status}));
      if (!result.processed) await pause(3000,undefined,{signal:stop.signal});
    } catch (error) {
      if (stop.signal.aborted) break;
      console.error(error instanceof CoreError ? `Email worker: ${error.code}` : 'Email worker: operation failed; stored lease recovery will preserve send identity.');
      await pause(5000,undefined,{signal:stop.signal}).catch(()=>undefined);
    }
  }
  console.info('Email worker stopped.');
}
main().catch(error=>{console.error(error instanceof CoreError?`Email worker cannot start: ${error.message}`:'Email worker cannot start. Check server configuration.');process.exitCode=1;});
