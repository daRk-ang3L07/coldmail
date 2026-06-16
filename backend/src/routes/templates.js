import { Router } from 'express';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../services/templatesService.js';
import { getContact } from '../services/contactsService.js';
import { mergeTemplate, extractPlaceholders, STARTER_TEMPLATE } from '../lib/merge.js';
import { sendEmail } from '../services/gmailService.js';

export const templatesRouter = Router();

templatesRouter.use((req, res, next) => {
  if (!req.session.email) {
    return res.status(401).json({ error: 'Connect a Gmail account first (/auth/google).' });
  }
  req.account = req.session.email;
  next();
});

// Built-in starter template (not yet saved) — for the "Insert starter" button.
templatesRouter.get('/starter', (req, res) => res.json(STARTER_TEMPLATE));

templatesRouter.get('/', async (req, res) => res.json({ templates: await listTemplates(req.account) }));

templatesRouter.post('/', async (req, res) => {
  const { name, subject, body } = req.body || {};
  if (!name || !subject || !body) {
    return res.status(400).json({ error: 'name, subject and body are required.' });
  }
  res.json(await createTemplate(req.account, { name, subject, body }));
});

templatesRouter.put('/:id', async (req, res) => {
  const { name, subject, body } = req.body || {};
  if (!name || !subject || !body) {
    return res.status(400).json({ error: 'name, subject and body are required.' });
  }
  const updated = await updateTemplate(req.account, Number(req.params.id), { name, subject, body });
  if (!updated) return res.status(404).json({ error: 'Not found.' });
  res.json(updated);
});

templatesRouter.delete('/:id', async (req, res) => {
  if (!(await deleteTemplate(req.account, Number(req.params.id)))) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.json({ ok: true });
});

// Live preview: merge arbitrary (possibly unsaved) subject/body against a
// contact. If no contactId given, uses the most recent contact.
templatesRouter.post('/preview', async (req, res) => {
  const { subject = '', body = '', contactId } = req.body || {};
  const contact = await getContact(req.account, contactId ? Number(contactId) : null);
  const merged = mergeTemplate({ subject, body }, contact);
  res.json({
    ...merged,
    placeholders: extractPlaceholders(subject + '\n' + body),
    contact: contact
      ? { id: contact.id, email: contact.email, name: contact.full_name }
      : null,
    note: contact ? undefined : 'No contacts yet — showing fallbacks. Upload contacts to preview real merges.',
  });
});

// Send ONE merged email to a real contact (proves the merge before bulk send).
templatesRouter.post('/send-test', async (req, res) => {
  const { subject = '', body = '', contactId } = req.body || {};
  const contact = await getContact(req.account, contactId ? Number(contactId) : null);
  if (!contact) return res.status(400).json({ error: 'No contact to send to. Upload contacts first.' });

  const merged = mergeTemplate({ subject, body }, contact);
  try {
    const result = await sendEmail({
      account: req.account,
      to: contact.email,
      subject: merged.subject,
      html: merged.html,
      text: merged.text,
    });
    res.json({ ok: true, to: contact.email, ...result });
  } catch (err) {
    console.error('[templates] send-test failed:', err);
    res.status(500).json({ error: err.message });
  }
});
