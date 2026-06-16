import { Router } from 'express';
import { google } from 'googleapis';
import { createOAuthClient, getAuthUrl } from '../auth/oauthClient.js';
import { saveTokens, listAccounts } from '../lib/tokenStore.js';
import { env } from '../config/env.js';

export const authRouter = Router();

// Step 1: send the user to Google's consent screen.
authRouter.get('/google', (req, res) => {
  res.redirect(getAuthUrl());
});

// Step 2: Google redirects back here with a one-time code.
authRouter.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google returned an error: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code.');

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Identify which Gmail account just authorized us.
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: profile } = await oauth2.userinfo.get();
    const email = profile.email;

    await saveTokens(email, tokens);

    // Remember the active account in the session cookie.
    req.session.email = email;

    res.redirect(env.frontendUrl + '/?connected=' + encodeURIComponent(email));
  } catch (err) {
    console.error('[auth] callback failed:', err);
    res.status(500).send('OAuth callback failed: ' + err.message);
  }
});

// Which accounts are connected + who is active in this session.
authRouter.get('/status', async (req, res) => {
  const accounts = await listAccounts();
  res.json({ active: req.session.email || null, accounts });
});

// Clear the active account from the session (does not revoke Google access).
authRouter.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});
