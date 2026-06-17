import { createClient } from '@libsql/client';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Data layer on libSQL (SQLite-compatible). Local dev uses a file; production
// (Render) points DATABASE_URL at a free Turso database so data persists even
// though Render's own disk is ephemeral. Same SQL dialect either way.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', '.data');

let client;
if (process.env.DATABASE_URL) {
  client = createClient({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN });
} else {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  client = createClient({ url: 'file:' + path.join(DATA_DIR, 'app.db') });
}

// Thin async wrapper mirroring the old .run/.get/.all shape.
export const db = {
  async run(sql, args = []) {
    const r = await client.execute({ sql, args });
    return {
      changes: Number(r.rowsAffected || 0),
      lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined,
    };
  },
  async get(sql, args = []) {
    const r = await client.execute({ sql, args });
    return r.rows[0];
  },
  async all(sql, args = []) {
    const r = await client.execute({ sql, args });
    return r.rows;
  },
  // Atomic write transaction. `fn` receives a helper with run/get/all.
  async transaction(fn) {
    const tx = await client.transaction('write');
    const t = {
      run: async (sql, args = []) => {
        const r = await tx.execute({ sql, args });
        return { changes: Number(r.rowsAffected || 0), lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined };
      },
      get: async (sql, args = []) => (await tx.execute({ sql, args })).rows[0],
      all: async (sql, args = []) => (await tx.execute({ sql, args })).rows,
    };
    try {
      const result = await fn(t);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },
};

async function addColumnIfMissing(table, column, definition) {
  const cols = (await db.all(`PRAGMA table_info(${table})`)).map((c) => c.name);
  if (!cols.includes(column)) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Create schema + run migrations. Must be awaited before the app serves.
export async function initDb() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lists_account ON lists(account);

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT,
      company TEXT,
      role TEXT,
      custom TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account, email)
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account);

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_templates_account ON templates(account);

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      name TEXT NOT NULL,
      template_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      daily_cap INTEGER NOT NULL DEFAULT 50,
      interval_seconds INTEGER NOT NULL DEFAULT 180,
      window_start TEXT NOT NULL DEFAULT '09:00',
      window_end TEXT NOT NULL DEFAULT '18:00',
      start_at INTEGER,
      last_sent_at INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER,
      message_id TEXT,
      thread_id TEXT,
      error TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_account ON campaigns(account);
    CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id, status);

    CREATE TABLE IF NOT EXISTS campaign_followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      step INTEGER NOT NULL,
      delay_days INTEGER NOT NULL,
      body TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_followups_campaign ON campaign_followups(campaign_id, step);

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      content BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_campaign ON attachments(campaign_id);
  `);

  // --- Column migrations (idempotent) ---
  await addColumnIfMissing('campaigns', 'send_days', "TEXT NOT NULL DEFAULT '1,2,3,4,5'");
  await addColumnIfMissing('campaigns', 'next_gap_ms', 'INTEGER');
  await addColumnIfMissing('campaigns', 'interval_min_seconds', 'INTEGER');
  await addColumnIfMissing('campaigns', 'interval_max_seconds', 'INTEGER');
  await db.run('UPDATE campaigns SET interval_min_seconds = interval_seconds WHERE interval_min_seconds IS NULL');
  await db.run('UPDATE campaigns SET interval_max_seconds = CAST(interval_seconds * 1.66 AS INTEGER) WHERE interval_max_seconds IS NULL');

  await addColumnIfMissing('campaign_recipients', 'stage', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing('campaign_recipients', 'last_msg_at', 'INTEGER');
  await addColumnIfMissing('campaign_recipients', 'subject', 'TEXT');
  await addColumnIfMissing('campaign_recipients', 'reply_checked_at', 'INTEGER');

  await addColumnIfMissing('contacts', 'list_id', 'INTEGER');
  await db.run('CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id)');

  // Backfill: pre-existing contacts with no list -> an "Imported" list per account.
  const orphans = await db.all('SELECT DISTINCT account FROM contacts WHERE list_id IS NULL');
  for (const { account } of orphans) {
    let list = await db.get('SELECT id FROM lists WHERE account = ? AND name = ?', [account, 'Imported']);
    if (!list) {
      const info = await db.run('INSERT INTO lists (account, name) VALUES (?, ?)', [account, 'Imported']);
      list = { id: info.lastInsertRowid };
    }
    await db.run('UPDATE contacts SET list_id = ? WHERE account = ? AND list_id IS NULL', [list.id, account]);
  }

  // Tokens table (replaces the local JSON file so it survives on Render).
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      email TEXT PRIMARY KEY,
      tokens TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
