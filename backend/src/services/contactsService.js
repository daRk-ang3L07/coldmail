import { db } from '../db/db.js';

const INSERT_SQL = `
  INSERT INTO contacts (account, list_id, email, first_name, last_name, full_name, company, role, custom)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(account, email) DO NOTHING
`;

/**
 * Bulk-insert parsed contacts into a list. Email stays unique per account, so a
 * contact already in another list is skipped (counts as a duplicate).
 */
export async function insertContacts(account, listId, contacts) {
  let added = 0;
  await db.transaction(async (tx) => {
    for (const c of contacts) {
      const customJson =
        c.custom && Object.keys(c.custom).length ? JSON.stringify(c.custom) : null;
      const info = await tx.run(INSERT_SQL, [
        account,
        listId,
        c.email,
        c.first_name ?? null,
        c.last_name ?? null,
        c.full_name ?? null,
        c.company ?? null,
        c.role ?? null,
        customJson,
      ]);
      added += info.changes;
    }
  });
  return { added, duplicates: contacts.length - added };
}

/** List contacts for an account, optionally scoped to one list. */
export async function listContacts(account, { listId, limit = 100, offset = 0 } = {}) {
  const where = listId ? 'WHERE account = ? AND list_id = ?' : 'WHERE account = ?';
  const params = listId ? [account, listId, limit, offset] : [account, limit, offset];
  const rows = await db.all(
    `SELECT id, list_id, email, first_name, last_name, full_name, company, role, custom, created_at
       FROM contacts ${where}
      ORDER BY id DESC LIMIT ? OFFSET ?`,
    params,
  );
  return rows.map((r) => ({ ...r, custom: r.custom ? JSON.parse(r.custom) : {} }));
}

/** Get one contact by id (or the most recent in a list / overall if id omitted). */
export async function getContact(account, id, listId) {
  let row;
  if (id) {
    row = await db.get(
      `SELECT id, email, first_name, last_name, full_name, company, role, custom
         FROM contacts WHERE account = ? AND id = ?`,
      [account, id],
    );
  } else if (listId) {
    row = await db.get(
      `SELECT id, email, first_name, last_name, full_name, company, role, custom
         FROM contacts WHERE account = ? AND list_id = ? ORDER BY id DESC LIMIT 1`,
      [account, listId],
    );
  } else {
    row = await db.get(
      `SELECT id, email, first_name, last_name, full_name, company, role, custom
         FROM contacts WHERE account = ? ORDER BY id DESC LIMIT 1`,
      [account],
    );
  }
  if (!row) return null;
  return { ...row, custom: row.custom ? JSON.parse(row.custom) : {} };
}

/** Contact count for an account, optionally scoped to one list. */
export async function countContacts(account, listId) {
  const row = listId
    ? await db.get('SELECT COUNT(*) AS n FROM contacts WHERE account = ? AND list_id = ?', [account, listId])
    : await db.get('SELECT COUNT(*) AS n FROM contacts WHERE account = ?', [account]);
  return Number(row.n);
}

/** Lightweight {id, email, name} refs — for building campaigns. Scoped to a list if given. */
export async function listContactRefs(account, listId) {
  return listId
    ? db.all("SELECT id, email, COALESCE(full_name, '') AS name FROM contacts WHERE account = ? AND list_id = ? ORDER BY id", [account, listId])
    : db.all("SELECT id, email, COALESCE(full_name, '') AS name FROM contacts WHERE account = ? ORDER BY id", [account]);
}

/** Delete one contact (scoped to the account). */
export async function deleteContact(account, id) {
  return (await db.run('DELETE FROM contacts WHERE account = ? AND id = ?', [account, id])).changes;
}

/** Delete all contacts in a list (or all for the account if no list given). */
export async function clearContacts(account, listId) {
  return listId
    ? (await db.run('DELETE FROM contacts WHERE account = ? AND list_id = ?', [account, listId])).changes
    : (await db.run('DELETE FROM contacts WHERE account = ?', [account])).changes;
}
