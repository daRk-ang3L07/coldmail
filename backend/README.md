# Cold-Email App — Backend (Phase 1)

Sends email through **your own Gmail** via the Gmail API. Phase 1 proves the
hardest integration end-to-end: Google OAuth → store refresh token → send a
real email. No database or Redis required yet (tokens live in `.data/tokens.json`).

## 1. Install

```bash
cd backend
npm install
cp .env.example .env   # then fill in the Google values (step 3)
```

## 2. Enable the Gmail API

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → Library →** search **"Gmail API" → Enable**.

## 3. Create OAuth credentials

1. **APIs & Services → OAuth consent screen**
   - User type: **External**.
   - Fill app name + your email.
   - **Scopes:** add `.../auth/gmail.send` and `.../auth/gmail.readonly`.
   - **Test users:** add the Gmail address you'll send from. (While the app is
     in "Testing" mode only these users can authorize — that's fine for now.)
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**.
   - **Authorized redirect URIs:** add exactly
     `http://localhost:4000/auth/google/callback`
3. Copy the **Client ID** and **Client secret** into `backend/.env`:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
SESSION_SECRET=<any long random string>
```

## 4. Run

```bash
npm run dev
```

Open <http://localhost:4000>:

1. Click **Connect Gmail** → authorize with your test-user Gmail account.
2. Click **Send test email** → check your inbox.

If the email arrives, Phase 1 works. 🎉

## What's next

- **Phase 2:** Excel upload → parse contacts → Postgres (replaces the file token store).
- **Phase 3:** Templates with `{{firstName}}` merge fields.
- **Phase 4:** Campaign scheduler (BullMQ + Redis) — throttle, daily cap, intervals.
- **Phase 5:** Follow-ups + reply detection (uses the `gmail.readonly` scope).

## Project layout

```
src/
  server.js              Express app + middleware
  config/env.js          env vars + OAuth scopes
  auth/oauthClient.js    OAuth2 client, consent URL, token refresh
  routes/auth.js         /auth/google, /callback, /status, /logout
  routes/email.js        /email/test  (Phase 1 send endpoint)
  services/gmailService.js  MIME builder + gmail.send
  lib/tokenStore.js      file-based token store (→ Postgres in Phase 2)
public/index.html        minimal UI to drive the flow
```
