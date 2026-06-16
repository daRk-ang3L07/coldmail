# Deploying for free, no credit card (Render + Turso + UptimeRobot)

Runs the app 24/7 in the cloud so it keeps sending when your laptop is off —
**no credit card, no hardware.**

- **Render** — hosts the app (free Web Service, no card)
- **Turso** — the database (free libSQL, no card; survives Render's restarts)
- **UptimeRobot** — pings the app every 5 min so Render's free tier doesn't sleep

> ⏱️ ~30–45 min the first time. Do the steps in order.

---

## Step 1 — Put the code on GitHub (Render deploys from a repo)
On your PC in `d:\Gmass`:
```bash
git init
git add .
git commit -m "deploy"
```
Create an empty **private** repo at github.com, then:
```bash
git remote add origin https://github.com/YOURNAME/coldmail.git
git branch -M main
git push -u origin main
```

---

## Step 2 — Create the free database (Turso)
1. Go to <https://turso.tech> → **Sign in with GitHub** (no card).
2. Create a database (call it `coldmail`). Pick a location near you.
3. Open the database → **Connect / Connect to your app**. Copy two things:
   - **Database URL** — looks like `libsql://coldmail-yourname.turso.io`
   - **Auth token** — click **Create Token**, copy the long string

Keep these two — they become `DATABASE_URL` and `DATABASE_AUTH_TOKEN`.

*(Prefer CLI? `turso db create coldmail` → `turso db show coldmail --url` → `turso db tokens create coldmail`.)*

---

## Step 3 — Create the Render web service
1. Go to <https://render.com> → **Sign in with GitHub** (no card for the free tier).
2. **New → Web Service** → connect your `coldmail` repo.
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm run setup`
   - **Start Command:** `npm start`
   - **Instance type:** **Free**
4. **Environment variables** (Add from the "Environment" section):
   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | a long random string |
   | `GOOGLE_CLIENT_ID` | your existing client id |
   | `GOOGLE_CLIENT_SECRET` | your existing client secret |
   | `DATABASE_URL` | the `libsql://…` URL from Turso |
   | `DATABASE_AUTH_TOKEN` | the Turso auth token |
   | `FRONTEND_URL` | *(leave empty)* |
   | `GOOGLE_REDIRECT_URI` | `https://YOUR-SERVICE.onrender.com/auth/google/callback` |

   > You won't know the exact `onrender.com` URL until the service is created.
   > It's fine to create the service first, copy the URL Render assigns, then
   > come back and set `GOOGLE_REDIRECT_URI`. (Don't set `PORT` — Render sets it.)
5. **Create Web Service.** Render builds + deploys. Watch the logs until you see
   `Server running on port …`.

---

## Step 4 — Point Google OAuth at the Render URL
In Google Cloud Console → **APIs & Services → Credentials → your OAuth client**:
- **Authorized redirect URIs → Add:** `https://YOUR-SERVICE.onrender.com/auth/google/callback`
- Save. (Keep the localhost one for local dev.)
- Make sure `GOOGLE_REDIRECT_URI` on Render matches this **exactly**, then redeploy if you changed it.

---

## Step 5 — Keep it awake (UptimeRobot)
Render's free service sleeps after 15 min idle — which would pause the scheduler.
1. Go to <https://uptimerobot.com> → sign up (free, no card).
2. **Add New Monitor:**
   - Type: **HTTP(s)**
   - URL: `https://YOUR-SERVICE.onrender.com/health`
   - Interval: **5 minutes**
3. Save. This ping keeps the app running 24/7.

---

## Step 6 — Use it
Open **`https://YOUR-SERVICE.onrender.com`** → **Connect Gmail** → done.

> Because tokens moved into the database, you'll connect Gmail fresh here (your
> local connection doesn't carry over). After that it runs in the cloud — close
> your laptop and campaigns keep sending.

---

## Updating the app later
```bash
git add . && git commit -m "update" && git push
```
Render auto-redeploys on every push. Your data is safe in Turso (separate from Render).

## Things to know
- **Cold starts:** if a keep-alive ping is ever missed, the next request takes a
  few seconds to wake the app. It resumes from the database automatically.
- **Weekly Gmail reconnect:** the Google app is in "Testing" mode, so the token
  expires ~weekly. When sends start failing, open the site and click
  **Connect Gmail** again. (Publishing the app to production removes this, but
  Gmail's restricted scopes require Google verification.)
- **Logs:** Render dashboard → your service → **Logs**.
- **Free tier limits:** one always-on free web service is within Render's free
  hours; Turso's free tier is generous for this scale.
