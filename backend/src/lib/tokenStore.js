import { db } from '../db/db.js';

// OAuth tokens live in the database (oauth_tokens table) so they persist on
// hosts with ephemeral disks (e.g. Render). Same get/save/list interface as
// before — now async.

/** Save (or merge) the OAuth tokens for a given Gmail address. */
export async function saveTokens(email, tokens) {
  const existing = await getTokens(email);
  const merged = {
    ...(existing || {}),
    ...tokens,
    // Google only returns refresh_token on first consent; keep the old one.
    refresh_token: tokens.refresh_token || existing?.refresh_token,
  };
  await db.run(
    `INSERT INTO oauth_tokens (email, tokens, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET tokens = excluded.tokens, updated_at = datetime('now')`,
    [email, JSON.stringify(merged)],
  );
  return merged;
}

/** Get stored tokens for a Gmail address, or null. */
export async function getTokens(email) {
  const row = await db.get('SELECT tokens FROM oauth_tokens WHERE email = ?', [email]);
  return row ? JSON.parse(row.tokens) : null;
}

/** List connected Gmail addresses. */
export async function listAccounts() {
  const rows = await db.all('SELECT email FROM oauth_tokens ORDER BY email');
  return rows.map((r) => r.email);
}
