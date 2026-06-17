import { Router } from 'express';
import multer from 'multer';
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  setCampaignStatus,
  deleteCampaign,
  replaceFollowups,
  listRecipients,
  retryFailed,
  addAttachment,
  deleteAttachment,
  listAttachments,
} from '../services/campaignsService.js';
import { listContactRefs } from '../services/contactsService.js';
import { getTemplate } from '../services/templatesService.js';
import { projectSchedule } from '../lib/scheduleProjection.js';

export const campaignsRouter = Router();

campaignsRouter.use((req, res, next) => {
  if (!req.session.email) {
    return res.status(401).json({ error: 'Connect a Gmail account first (/auth/google).' });
  }
  req.account = req.session.email;
  next();
});

const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

// Validate/normalize a list of follow-up steps: [{ delayDays, body }].
function sanitizeFollowups(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => ({
      delayDays: Math.max(0, Math.floor(Number(f.delayDays) || 0)),
      body: String(f.body || '').trim(),
    }))
    .filter((f) => f.body.length > 0);
}

// Parse + clamp the shared schedule settings (used by create AND preview).
function parseScheduleConfig(b) {
  const rawDays = Array.isArray(b.sendDays)
    ? b.sendDays
    : typeof b.sendDays === 'string'
    ? b.sendDays.split(',')
    : [1, 2, 3, 4, 5];
  const days = [...new Set(rawDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const sendDays = (days.length ? days : [1, 2, 3, 4, 5]).join(',');

  // Random gap between min and max seconds (defaults 2–5 min). Max >= min.
  const minS = Math.max(15, Number(b.intervalMinSeconds) || 120);
  const maxS = Math.max(minS, Number(b.intervalMaxSeconds) || 300);

  return {
    dailyCap: Math.max(1, Math.min(Number(b.dailyCap) || 50, 2000)),
    intervalMinSeconds: minS,
    intervalMaxSeconds: maxS,
    windowStart: HHMM_RE.test(b.windowStart) ? b.windowStart : '09:00',
    windowEnd: HHMM_RE.test(b.windowEnd) ? b.windowEnd : '18:00',
    sendDays,
    startAt: b.startAt ? new Date(b.startAt).getTime() : null,
    followups: sanitizeFollowups(b.followups),
  };
}

// Resolve recipients from the request: a specific list, explicit contactIds,
// or (fallback) all contacts.
async function resolveRecipients(account, { listId, contactIds }) {
  const refs = await listContactRefs(account, listId ? Number(listId) : undefined);
  if (Array.isArray(contactIds) && contactIds.length) {
    const set = new Set(contactIds.map(Number));
    return refs.filter((r) => set.has(r.id));
  }
  return refs;
}

// Create a campaign from a template + contacts.
campaignsRouter.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.templateId) {
    return res.status(400).json({ error: 'name and templateId are required.' });
  }
  if (!(await getTemplate(req.account, Number(b.templateId)))) {
    return res.status(400).json({ error: 'Template not found.' });
  }

  const cfg = { name: String(b.name), templateId: Number(b.templateId), ...parseScheduleConfig(b) };
  const chosen = await resolveRecipients(req.account, { listId: b.listId, contactIds: b.contactIds });
  if (!chosen.length) {
    return res.status(400).json({ error: 'No contacts to send to. Pick a list with contacts.' });
  }

  res.json(await createCampaign(req.account, cfg, chosen));
});

// Preview the send schedule WITHOUT creating anything or sending.
// Same body as create (name/template optional). Returns a day-by-day timeline.
campaignsRouter.post('/preview-schedule', async (req, res) => {
  const b = req.body || {};
  const cfg = parseScheduleConfig(b);
  const recipients = await resolveRecipients(req.account, { listId: b.listId, contactIds: b.contactIds });
  if (!recipients.length) {
    return res.status(400).json({ error: 'No contacts to send to. Pick a list with contacts.' });
  }
  const projection = projectSchedule({
    recipients,
    dailyCap: cfg.dailyCap,
    // Use the average of the random range for a realistic timeline estimate.
    intervalSeconds: Math.round((cfg.intervalMinSeconds + cfg.intervalMaxSeconds) / 2),
    windowStart: cfg.windowStart,
    windowEnd: cfg.windowEnd,
    sendDays: cfg.sendDays,
    startAtMs: cfg.startAt,
    followups: cfg.followups,
    nowMs: Date.now(),
  });
  res.json(projection);
});

campaignsRouter.get('/', async (req, res) => res.json({ campaigns: await listCampaigns(req.account) }));

campaignsRouter.get('/:id', async (req, res) => {
  const c = await getCampaign(req.account, Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found.' });
  res.json(c);
});

// Per-recipient detail (optionally filtered by ?status=sent|replied|failed|queued|skipped).
campaignsRouter.get('/:id/recipients', async (req, res) => {
  const c = await getCampaign(req.account, Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found.' });
  const valid = ['queued', 'sent', 'replied', 'failed', 'skipped'];
  const status = valid.includes(req.query.status) ? req.query.status : null;
  res.json({ recipients: await listRecipients(c.id, status) });
});

// Re-queue failed recipients and resume the campaign so they get retried.
campaignsRouter.post('/:id/retry-failed', async (req, res) => {
  const c = await getCampaign(req.account, Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found.' });
  const requeued = await retryFailed(c.id);
  if (requeued && c.status === 'completed') await setCampaignStatus(req.account, c.id, 'running');
  res.json({ ok: true, requeued, campaign: await getCampaign(req.account, c.id) });
});

// Replace a campaign's follow-up steps. Body: { followups: [{ delayDays, body }] }
campaignsRouter.put('/:id/followups', async (req, res) => {
  const c = await getCampaign(req.account, Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found.' });
  await replaceFollowups(c.id, sanitizeFollowups(req.body?.followups));
  res.json(await getCampaign(req.account, c.id));
});

// --- Attachments (e.g. resume), capped at 2 MB, max 5 per campaign ---
const MAX_ATTACHMENTS = 5;
const uploadAtt = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

campaignsRouter.post('/:id/attachments', (req, res) => {
  uploadAtt.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large (max 2 MB). For bigger files, use a link in the template instead.'
        : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file").' });

    const c = await getCampaign(req.account, Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Not found.' });
    if ((await listAttachments(c.id)).length >= MAX_ATTACHMENTS) {
      return res.status(400).json({ error: `Max ${MAX_ATTACHMENTS} attachments per campaign.` });
    }

    await addAttachment(c.id, {
      filename: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      content: req.file.buffer,
    });
    res.json(await getCampaign(req.account, c.id));
  });
});

campaignsRouter.delete('/:id/attachments/:attId', async (req, res) => {
  const c = await getCampaign(req.account, Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found.' });
  await deleteAttachment(c.id, Number(req.params.attId));
  res.json(await getCampaign(req.account, c.id));
});

// Lifecycle: start | pause | resume.
campaignsRouter.post('/:id/:action(start|pause|resume)', async (req, res) => {
  const status = req.params.action === 'pause' ? 'paused' : 'running';
  const c = await setCampaignStatus(req.account, Number(req.params.id), status);
  if (!c) return res.status(404).json({ error: 'Not found.' });
  res.json(c);
});

campaignsRouter.delete('/:id', async (req, res) => {
  if (!(await deleteCampaign(req.account, Number(req.params.id)))) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.json({ ok: true });
});
