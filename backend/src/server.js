import express from 'express';
import cookieSession from 'cookie-session';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { initDb } from './db/db.js';
import { authRouter } from './routes/auth.js';
import { emailRouter } from './routes/email.js';
import { contactsRouter } from './routes/contacts.js';
import { listsRouter } from './routes/lists.js';
import { templatesRouter } from './routes/templates.js';
import { campaignsRouter } from './routes/campaigns.js';
import { startScheduler } from './lib/scheduler.js';
import { startReplySync } from './lib/replySync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Behind a reverse proxy (Caddy/host load balancer) in production, so Express
// trusts X-Forwarded-* headers — required for secure cookies over HTTPS.
if (env.isProd) app.set('trust proxy', 1);

app.use(express.json());
app.use(
  cookieSession({
    name: 'gmass.sid',
    secret: env.sessionSecret,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure, // HTTPS-only cookies in production
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  }),
);

// API routes
app.use('/auth', authRouter);
app.use('/email', emailRouter);
app.use('/contacts', contactsRouter);
app.use('/lists', listsRouter);
app.use('/templates', templatesRouter);
app.use('/campaigns', campaignsRouter);
app.get('/health', (req, res) => res.json({ ok: true }));

// Serve the built React app (frontend/dist) in production. The SPA fallback
// returns index.html for any non-API route so client-side rendering works.
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
} else {
  // Dev fallback: the minimal Phase 1 page (React runs separately on :5173).
  app.use(express.static(path.join(__dirname, '..', 'public')));
}

// Initialize the database (schema + migrations) before serving or scheduling.
await initDb();

app.listen(env.port, () => {
  console.log(`\n  Server running on port ${env.port}\n`);
  startScheduler();
  startReplySync();
});
