import {
  getRunningCampaigns,
  countSentSince,
  nextQueuedRecipient,
  markRecipientSent,
  markRecipientFailed,
  markRecipientSkipped,
  setLastSent,
  setStatusById,
  setNextGap,
  getFollowups,
  dueFollowupCandidates,
  markFollowupSent,
  markReplied,
  hasPendingWork,
} from '../services/campaignsService.js';
import { getTemplate } from '../services/templatesService.js';
import { getContact } from '../services/contactsService.js';
import { mergeTemplate } from './merge.js';
import { sendEmail, checkThreadReplied } from '../services/gmailService.js';

// How often the engine wakes up. Sends are additionally paced by each
// campaign's interval_seconds, so this is just the polling granularity.
// Effective minimum interval between sends ≈ TICK_MS.
const TICK_MS = 15_000;

// Injectable collaborators (overridden in tests so we never hit Gmail).
let senderFn = sendEmail;
export function setSender(fn) {
  senderFn = fn;
}
let replyCheckerFn = checkThreadReplied;
export function setReplyChecker(fn) {
  replyCheckerFn = fn;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Randomize the gap before the next send so timing looks human, not robotic:
// a uniform random value between the campaign's min and max bounds (e.g. 2–5 min).
export function randomGapMs(minSeconds, maxSeconds) {
  const lo = minSeconds * 1000;
  const hi = Math.max(maxSeconds, minSeconds) * 1000;
  return Math.round(lo + Math.random() * (hi - lo));
}

// Record a send: stamp the time AND pick the next randomized gap.
async function pace(campaign, nowMs) {
  await setLastSent(campaign.id, nowMs);
  await setNextGap(campaign.id, randomGapMs(campaign.interval_min_seconds, campaign.interval_max_seconds));
}

let timer = null;

function parseHHMM(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
}
function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}
function startOfTodayMs(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Process one campaign per tick. At most ONE email is sent (initial OR
 * follow-up), gated by start time, weekday, window, interval and daily cap.
 * Due follow-ups are attempted before new initials; recipients who replied
 * are detected and dropped from the sequence (no more follow-ups).
 */
async function processCampaign(c, now = new Date()) {
  const nowMs = now.getTime();
  const steps = await getFollowups(c.id);

  // Completion check FIRST — timing-independent, so a finished campaign is
  // marked 'completed' promptly regardless of window/cap/interval gates.
  if (!(await hasPendingWork(c.id, steps.length))) {
    await setStatusById(c.id, 'completed');
    return;
  }

  // Gate 1: not started yet.
  if (c.start_at && nowMs < c.start_at) return;

  // Gate 2: not an allowed weekday (0=Sun..6=Sat; e.g. Mon–Fri only).
  const allowedDays = String(c.send_days || '1,2,3,4,5').split(',').map(Number);
  if (!allowedDays.includes(now.getDay())) return;

  // Gate 3: outside the daily send window (local time).
  const mod = minutesOfDay(now);
  if (mod < parseHHMM(c.window_start) || mod >= parseHHMM(c.window_end)) return;

  // Gate 4: interval pacing — respect the randomized gap since the last send.
  const requiredGap = c.next_gap_ms || c.interval_min_seconds * 1000;
  if (c.last_sent_at && nowMs - c.last_sent_at < requiredGap) return;

  // Gate 5: daily cap reached for today.
  if ((await countSentSince(c.id, startOfTodayMs(now))) >= c.daily_cap) return;

  const template = await getTemplate(c.account, c.template_id);
  if (!template) {
    console.error(`[scheduler] campaign ${c.id}: template ${c.template_id} missing — pausing.`);
    await setStatusById(c.id, 'paused');
    return;
  }

  // --- 1) Try a due follow-up (reply-aware) ---
  if (steps.length) {
    for (const r of await dueFollowupCandidates(c.id, steps.length)) {
      const step = steps[r.stage]; // next step for this recipient
      if (!step) continue;
      const due = nowMs - r.last_msg_at >= step.delay_days * DAY_MS;
      if (!due) continue;

      // Skip anyone who already replied — and stop their sequence.
      let replied = false;
      try {
        replied = await replyCheckerFn(c.account, r.thread_id);
      } catch (err) {
        console.error(`[scheduler] campaign ${c.id}: reply check failed for ${r.email}: ${err.message}`);
        continue; // retry on a later tick
      }
      if (replied) {
        await markReplied(r.id);
        console.log(`[scheduler] campaign ${c.id}: ${r.email} replied — follow-ups stopped.`);
        continue;
      }

      const contact = await getContact(c.account, r.contact_id);
      if (!contact) {
        await markRecipientSkipped(r.id, 'contact deleted');
        continue;
      }

      // Follow-ups reply in-thread: "Re: <original subject>" + the step body.
      const merged = mergeTemplate(
        { subject: 'Re: ' + (r.subject || template.subject), body: step.body },
        contact,
      );
      try {
        await senderFn({
          account: c.account,
          to: r.email,
          subject: merged.subject,
          html: merged.html,
          text: merged.text,
          threadId: r.thread_id,
        });
        await markFollowupSent(r.id, { sentAt: nowMs, stage: r.stage + 1 });
        console.log(`[scheduler] campaign ${c.id}: follow-up #${r.stage + 1} to ${r.email}`);
      } catch (err) {
        await markRecipientFailed(r.id, err.message);
        console.error(`[scheduler] campaign ${c.id}: follow-up to ${r.email} failed: ${err.message}`);
      }
      await pace(c, nowMs);
      return; // one send per tick
    }
  }

  // --- 2) Otherwise send the next initial email ---
  const recipient = await nextQueuedRecipient(c.id);
  if (recipient) {
    const contact = await getContact(c.account, recipient.contact_id);
    if (!contact) {
      await markRecipientSkipped(recipient.id, 'contact deleted');
      return;
    }
    const merged = mergeTemplate(template, contact);
    try {
      const res = await senderFn({
        account: c.account,
        to: recipient.email,
        subject: merged.subject,
        html: merged.html,
        text: merged.text,
      });
      await markRecipientSent(recipient.id, {
        messageId: res.id,
        threadId: res.threadId,
        sentAt: nowMs,
        subject: merged.subject,
      });
      console.log(`[scheduler] campaign ${c.id}: sent to ${recipient.email}`);
    } catch (err) {
      await markRecipientFailed(recipient.id, err.message);
      console.error(`[scheduler] campaign ${c.id}: send to ${recipient.email} failed: ${err.message}`);
    }
    await pace(c, nowMs);
  }
}

/** One scheduler tick: process every running campaign. */
export async function processTick(now = new Date()) {
  for (const c of await getRunningCampaigns()) {
    try {
      await processCampaign(c, now);
    } catch (err) {
      console.error(`[scheduler] campaign ${c.id} tick error:`, err);
    }
  }
}

export function startScheduler() {
  if (timer) return;
  console.log(`[scheduler] started (tick every ${TICK_MS / 1000}s)`);
  // Fire-and-forget ticks; each tick awaits its own work.
  timer = setInterval(() => {
    processTick().catch((err) => console.error('[scheduler] tick failed:', err));
  }, TICK_MS);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
