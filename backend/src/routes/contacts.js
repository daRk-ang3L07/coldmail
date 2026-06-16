import { Router } from 'express';
import multer from 'multer';
import { parseContactsBuffer } from '../lib/excel.js';
import {
  insertContacts,
  listContacts,
  countContacts,
  deleteContact,
  clearContacts,
} from '../services/contactsService.js';
import { getList } from '../services/listsService.js';

export const contactsRouter = Router();

// Keep uploads in memory (files are small) and cap size.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Require an active connected account for every contacts route.
contactsRouter.use((req, res, next) => {
  if (!req.session.email) {
    return res.status(401).json({ error: 'Connect a Gmail account first (/auth/google).' });
  }
  req.account = req.session.email;
  next();
});

// Upload a spreadsheet INTO a list -> parse -> dedupe-insert. Returns a summary.
contactsRouter.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file").' });

  const listId = Number(req.body?.listId);
  if (!listId || !(await getList(req.account, listId))) {
    return res.status(400).json({ error: 'A valid listId is required (create/select a list first).' });
  }

  try {
    const { contacts, columns, skipped, total } = parseContactsBuffer(req.file.buffer);
    if (!contacts.length) {
      return res.status(422).json({
        error: 'No valid contacts found. Make sure there is an email column.',
        columns,
        total,
        skipped,
      });
    }
    const { added, duplicates } = await insertContacts(req.account, listId, contacts);
    res.json({
      ok: true,
      total,
      parsed: contacts.length,
      added,
      duplicates,
      skippedInvalid: skipped,
      columns,
      listCount: await countContacts(req.account, listId),
    });
  } catch (err) {
    console.error('[contacts] upload failed:', err);
    res.status(500).json({ error: 'Could not parse file: ' + err.message });
  }
});

// List contacts (optionally ?listId=, paged).
contactsRouter.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const listId = req.query.listId ? Number(req.query.listId) : undefined;
  res.json({
    total: await countContacts(req.account, listId),
    contacts: await listContacts(req.account, { listId, limit, offset }),
  });
});

// Delete one.
contactsRouter.delete('/:id', async (req, res) => {
  const changes = await deleteContact(req.account, Number(req.params.id));
  if (!changes) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

// Clear contacts in a list (?listId=) or all for the account.
contactsRouter.delete('/', async (req, res) => {
  const listId = req.query.listId ? Number(req.query.listId) : undefined;
  const removed = await clearContacts(req.account, listId);
  res.json({ ok: true, removed });
});
