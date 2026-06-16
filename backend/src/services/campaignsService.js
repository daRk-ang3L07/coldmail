import { db } from '../db/db.js';

const MAX_ATTEMPTS = 3;

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// --- Creation ---

export async function createCampaign(account, cfg, recipients) {
  const campaignId = await db.transaction(async (tx) => {
    const info = await tx.run(
      `INSERT INTO campaigns (account, name, template_id, daily_cap, interval_seconds, interval_min_seconds, interval_max_seconds, window_start, window_end, send_days, start_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account, cfg.name, cfg.templateId, cfg.dailyCap,
        cfg.intervalMinSeconds, cfg.intervalMinSeconds, cfg.intervalMaxSeconds,
        cfg.windowStart, cfg.windowEnd, cfg.sendDays, cfg.startAt ?? null,
      ],
    );
    const id = info.lastInsertRowid;
    for (const r of recipients) {
      await tx.run('INSERT INTO campaign_recipients (campaign_id, contact_id, email) VALUES (?, ?, ?)', [id, r.id, r.email]);
    }
    if (Array.isArray(cfg.followups) && cfg.followups.length) {
      let step = 1;
      for (const f of cfg.followups) {
        await tx.run('INSERT INTO campaign_followups (campaign_id, step, delay_days, body) VALUES (?, ?, ?, ?)', [id, step++, f.delayDays, f.body]);
      }
    }
    return id;
  });
  return getCampaign(account, campaignId);
}

// --- Reads ---

async function statusCounts(campaignId) {
  const rows = await db.all('SELECT status, COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? GROUP BY status', [campaignId]);
  const counts = { queued: 0, sent: 0, replied: 0, failed: 0, skipped: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  counts.total = counts.queued + counts.sent + counts.replied + counts.failed + counts.skipped;
  return counts;
}

export async function getFollowups(campaignId) {
  return db.all('SELECT step, delay_days, body FROM campaign_followups WHERE campaign_id = ? ORDER BY step ASC', [campaignId]);
}

async function decorate(c) {
  const [progress, followups, sentToday] = await Promise.all([
    statusCounts(c.id),
    getFollowups(c.id),
    countSentSince(c.id, startOfTodayMs()),
  ]);
  return { ...c, progress, followups, sentToday };
}

export async function getCampaign(account, id) {
  const c = await db.get('SELECT * FROM campaigns WHERE account = ? AND id = ?', [account, id]);
  if (!c) return null;
  return decorate(c);
}

export async function listCampaigns(account) {
  const rows = await db.all('SELECT * FROM campaigns WHERE account = ? ORDER BY id DESC', [account]);
  return Promise.all(rows.map(decorate));
}

export async function replaceFollowups(campaignId, steps) {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM campaign_followups WHERE campaign_id = ?', [campaignId]);
    let step = 1;
    for (const s of steps) {
      await tx.run('INSERT INTO campaign_followups (campaign_id, step, delay_days, body) VALUES (?, ?, ?, ?)', [campaignId, step++, s.delayDays, s.body]);
    }
  });
  return getFollowups(campaignId);
}

export async function setCampaignStatus(account, id, status) {
  const { changes } = await db.run("UPDATE campaigns SET status = ?, updated_at = datetime('now') WHERE account = ? AND id = ?", [status, account, id]);
  return changes ? getCampaign(account, id) : null;
}

export async function deleteCampaign(account, id) {
  return (await db.run('DELETE FROM campaigns WHERE account = ? AND id = ?', [account, id])).changes;
}

// --- Engine helpers ---

export async function getRunningCampaigns() {
  return db.all("SELECT * FROM campaigns WHERE status = 'running'");
}

export async function countSentSince(campaignId, sinceMs) {
  const initials = await db.get('SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND sent_at >= ?', [campaignId, sinceMs]);
  const followups = await db.get('SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND stage > 0 AND last_msg_at >= ?', [campaignId, sinceMs]);
  return Number(initials.n) + Number(followups.n);
}

export async function nextQueuedRecipient(campaignId) {
  return db.get("SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'queued' ORDER BY id LIMIT 1", [campaignId]);
}

export async function hasQueued(campaignId) {
  return !!(await db.get("SELECT 1 FROM campaign_recipients WHERE campaign_id = ? AND status = 'queued' LIMIT 1", [campaignId]));
}

export async function markRecipientSent(recipientId, { messageId, threadId, sentAt, subject }) {
  await db.run(
    `UPDATE campaign_recipients
        SET status = 'sent', sent_at = ?, last_msg_at = ?, message_id = ?, thread_id = ?, subject = ?, error = NULL
      WHERE id = ?`,
    [sentAt, sentAt, messageId, threadId, subject ?? null, recipientId],
  );
}

export async function dueFollowupCandidates(campaignId, totalSteps, limit = 10) {
  return db.all(
    `SELECT * FROM campaign_recipients
      WHERE campaign_id = ? AND status = 'sent' AND stage < ? AND last_msg_at IS NOT NULL
      ORDER BY last_msg_at ASC LIMIT ?`,
    [campaignId, totalSteps, limit],
  );
}

export async function markFollowupSent(recipientId, { sentAt, stage }) {
  await db.run('UPDATE campaign_recipients SET stage = ?, last_msg_at = ?, error = NULL WHERE id = ?', [stage, sentAt, recipientId]);
}

export async function markReplied(recipientId) {
  await db.run("UPDATE campaign_recipients SET status = 'replied' WHERE id = ?", [recipientId]);
}

export async function hasPendingWork(campaignId, totalSteps) {
  if (await hasQueued(campaignId)) return true;
  return !!(await db.get("SELECT 1 FROM campaign_recipients WHERE campaign_id = ? AND status = 'sent' AND stage < ? LIMIT 1", [campaignId, totalSteps]));
}

export async function markRecipientFailed(recipientId, error) {
  await db.run(
    `UPDATE campaign_recipients
        SET attempts = attempts + 1, error = ?,
            status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END
      WHERE id = ?`,
    [String(error).slice(0, 500), recipientId],
  );
}

export async function markRecipientSkipped(recipientId, reason) {
  await db.run("UPDATE campaign_recipients SET status = 'skipped', error = ? WHERE id = ?", [reason, recipientId]);
}

export async function setLastSent(campaignId, ms) {
  await db.run('UPDATE campaigns SET last_sent_at = ? WHERE id = ?', [ms, campaignId]);
}

export async function setNextGap(campaignId, ms) {
  await db.run('UPDATE campaigns SET next_gap_ms = ? WHERE id = ?', [ms, campaignId]);
}

export async function setStatusById(campaignId, status) {
  await db.run("UPDATE campaigns SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, campaignId]);
}

// --- Dashboard + reply-sync ---

export async function listRecipients(campaignId, statusFilter) {
  const params = [campaignId];
  let where = 'WHERE r.campaign_id = ?';
  if (statusFilter) {
    where += ' AND r.status = ?';
    params.push(statusFilter);
  }
  return db.all(
    `SELECT r.id, r.email, r.status, r.attempts, r.sent_at, r.last_msg_at, r.stage, r.error, r.thread_id,
            COALESCE(c.full_name, '') AS name
       FROM campaign_recipients r
       LEFT JOIN contacts c ON c.id = r.contact_id
       ${where}
      ORDER BY r.id`,
    params,
  );
}

export async function retryFailed(campaignId) {
  return (await db.run("UPDATE campaign_recipients SET status = 'queued', attempts = 0, error = NULL WHERE campaign_id = ? AND status = 'failed'", [campaignId])).changes;
}

export async function dueReplyChecks(nowMs, recheckMs, maxAgeMs, limit = 25) {
  return db.all(
    `SELECT r.id, r.thread_id, c.account
       FROM campaign_recipients r
       JOIN campaigns c ON c.id = r.campaign_id
      WHERE r.status = 'sent' AND r.thread_id IS NOT NULL
        AND r.sent_at >= ?
        AND (r.reply_checked_at IS NULL OR r.reply_checked_at <= ?)
      ORDER BY r.reply_checked_at ASC
      LIMIT ?`,
    [nowMs - maxAgeMs, nowMs - recheckMs, limit],
  );
}

export async function markReplyChecked(recipientId, ms) {
  await db.run('UPDATE campaign_recipients SET reply_checked_at = ? WHERE id = ?', [ms, recipientId]);
}
