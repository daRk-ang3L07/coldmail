import { db } from '../db/db.js';

/** All lists for an account, each with its contact count. */
export async function listLists(account) {
  const rows = await db.all(
    `SELECT l.id, l.name, l.created_at,
            (SELECT COUNT(*) FROM contacts c WHERE c.list_id = l.id) AS count
       FROM lists l
      WHERE l.account = ?
      ORDER BY l.id DESC`,
    [account],
  );
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

export async function getList(account, id) {
  return (await db.get('SELECT id, name, created_at FROM lists WHERE account = ? AND id = ?', [account, id])) || null;
}

export async function createList(account, name) {
  const info = await db.run('INSERT INTO lists (account, name) VALUES (?, ?)', [account, name]);
  return getList(account, info.lastInsertRowid);
}

/** Delete a list AND its contacts (scoped to the account). Returns true if removed. */
export async function deleteList(account, id) {
  const list = await getList(account, id);
  if (!list) return false;
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM contacts WHERE list_id = ?', [id]);
    await tx.run('DELETE FROM lists WHERE account = ? AND id = ?', [account, id]);
  });
  return true;
}
