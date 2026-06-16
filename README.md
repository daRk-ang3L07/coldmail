# Cold Email — HR Outreach

A GMass-style cold-email tool that sends through **your own Gmail** via the Gmail
API. Upload contacts, write merge-field templates, schedule throttled sends
(daily cap, interval, time window, weekdays), and auto-send reply-aware
follow-ups.

- **backend/** — Node + Express API, libSQL database (local file in dev, free
  Turso in prod), the scheduler engine, and the Gmail integration.
- **frontend/** — React + Vite single-page app (Gmail-style UI).

Local dev needs no database setup — it uses a local libSQL file automatically.
For free always-on hosting (no credit card), see [DEPLOY.md](DEPLOY.md).

## Running it (two terminals)

You need Google OAuth credentials first — see [backend/README.md](backend/README.md).

**Terminal 1 — backend** (port 4000):
```bash
cd backend
npm install
# create .env from .env.example and fill in the Google values.
# For the React dev server, make sure this line is set:
#   FRONTEND_URL=http://localhost:5173
npm run dev
```

**Terminal 2 — frontend** (port 5173):
```bash
cd frontend
npm install
npm run dev
```

Then open **http://localhost:5173** and click **Connect Gmail**.

### How it fits together in dev
- The React app (5173) calls API paths like `/contacts`, `/campaigns`, `/auth/*`.
- Vite **proxies** those to the backend (4000), so the browser sees one origin
  (no CORS, and the session cookie just works).
- OAuth runs on the backend; after authorizing, the backend redirects back to
  `FRONTEND_URL` (5173) — which is why that env var matters in dev.

## Production (single origin, optional)
Build the frontend and let Express serve it:
```bash
cd frontend && npm run build      # outputs frontend/dist
```
Then serve `frontend/dist` from Express and leave `FRONTEND_URL` blank. (Not
wired up yet — ask if you want this.)

## Feature status
All built & tested: Gmail OAuth send · Excel/CSV contacts · templates + merge ·
scheduler (cap/interval/window/weekdays) · follow-ups + reply detection ·
schedule preview · per-recipient dashboard.

The only piece not yet validated against **real** Gmail (beyond a single test
send) is bulk follow-up threading + reply detection — do a small live test
before using your real HR list.
