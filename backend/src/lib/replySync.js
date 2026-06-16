import { dueReplyChecks, markReplied, markReplyChecked } from '../services/campaignsService.js';
import { checkThreadReplied } from '../services/gmailService.js';

// Background reply detection: periodically polls the Gmail threads of recipients
// who were emailed but haven't replied yet, and marks the ones who did. This
// keeps the dashboard's reply rate accurate even for campaigns with NO
// follow-ups (the follow-up path also checks replies, just-in-time).

const CYCLE_MS = 60_000; // run a sync pass once a minute
const RECHECK_MS = 3 * 60_000; // re-check a given recipient at most every ~3 min
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // stop tracking replies after 30 days
const BATCH = 25; // cap thread lookups per pass (quota-friendly)

let checker = checkThreadReplied;
export function setReplyChecker(fn) {
  checker = fn;
}

let timer = null;

export async function processReplySync(now = new Date()) {
  const nowMs = now.getTime();
  const items = await dueReplyChecks(nowMs, RECHECK_MS, MAX_AGE_MS, BATCH);
  for (const it of items) {
    try {
      const replied = await checker(it.account, it.thread_id);
      if (replied) {
        await markReplied(it.id);
        console.log(`[reply-sync] recipient ${it.id} replied — marked.`);
      } else {
        await markReplyChecked(it.id, nowMs);
      }
    } catch (err) {
      // Back off this recipient until the next recheck window on error.
      await markReplyChecked(it.id, nowMs);
      console.error(`[reply-sync] check failed for recipient ${it.id}: ${err.message}`);
    }
  }
  return items.length;
}

export function startReplySync() {
  if (timer) return;
  console.log(`[reply-sync] started (every ${CYCLE_MS / 1000}s, recheck ~${RECHECK_MS / 60000}min)`);
  timer = setInterval(() => {
    processReplySync().catch((err) => console.error('[reply-sync] pass failed:', err));
  }, CYCLE_MS);
}

export function stopReplySync() {
  if (timer) clearInterval(timer);
  timer = null;
}
