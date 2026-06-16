import { db } from '../db/db.js';

export async function listTemplates(account) {
  return db.all(
    `SELECT id, name, subject, body, created_at, updated_at
       FROM templates WHERE account = ? ORDER BY updated_at DESC`,
    [account],
  );
}

export async function getTemplate(account, id) {
  return (await db.get(
    'SELECT id, name, subject, body, created_at, updated_at FROM templates WHERE account = ? AND id = ?',
    [account, id],
  )) || null;
}

export async function createTemplate(account, { name, subject, body }) {
  const info = await db.run('INSERT INTO templates (account, name, subject, body) VALUES (?, ?, ?, ?)', [
    account, name, subject, body,
  ]);
  return getTemplate(account, info.lastInsertRowid);
}

export async function updateTemplate(account, id, { name, subject, body }) {
  const { changes } = await db.run(
    `UPDATE templates SET name = ?, subject = ?, body = ?, updated_at = datetime('now')
      WHERE account = ? AND id = ?`,
    [name, subject, body, account, id],
  );
  return changes ? getTemplate(account, id) : null;
}

export async function deleteTemplate(account, id) {
  return (await db.run('DELETE FROM templates WHERE account = ? AND id = ?', [account, id])).changes;
}
