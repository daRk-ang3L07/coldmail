import { Router } from 'express';
import { listLists, createList, deleteList } from '../services/listsService.js';

export const listsRouter = Router();

listsRouter.use((req, res, next) => {
  if (!req.session.email) {
    return res.status(401).json({ error: 'Connect a Gmail account first (/auth/google).' });
  }
  req.account = req.session.email;
  next();
});

listsRouter.get('/', async (req, res) => res.json({ lists: await listLists(req.account) }));

listsRouter.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'List name is required.' });
  res.json(await createList(req.account, name));
});

listsRouter.delete('/:id', async (req, res) => {
  if (!(await deleteList(req.account, Number(req.params.id)))) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.json({ ok: true });
});
