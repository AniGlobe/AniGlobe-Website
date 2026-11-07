# AniGlobe Runbook — plain-language guide to the account system

This file is a step-by-step tutorial. It explains, in everyday words:

- how to start AniGlobe,
- how accounts work,
- how to test email verification (including free ways that need **no domain**),
- how to back up your data, and
- how to put the site on the internet.

You only need basic computer skills. Anything technical is explained where it
comes up.

**The one-sentence version:** one small program (the "server") runs the whole
site, the account API, and the database — the same program does all three
jobs. You start it with one command.

> One thing to know up front: Python's `http.server` can only show the web
> pages. **Accounts (login, sync, email) only work through the Node server**
> described below — always `npm start`, always port 8080.

---

## Before you start

You need exactly one thing installed: **Node.js 22 or newer**.

Check what you have by typing this in a terminal and pressing Enter:

```powershell
node --version
```

If it prints something like `v22.x.x` or higher, you're ready. (If it says
"command not found", install Node from nodejs.org first, then restart your
terminal.)

That's the whole list. The server's only extra package (`nodemailer`, which
handles sending email) installs automatically in the next step.

---

## Step 1 — Start the server

Open a terminal in the project folder and type:

```powershell
npm install   # first time only — downloads what the server needs
npm start     # starts the server
```

You should see a line like this:

```
AniGlobe listening at http://localhost:8080
```

That means the server is running. **Leave this terminal open** — the server
stops when you close the terminal. Stopping it is safe; your data stays
saved in the database file and is back when you start again.

### Check it's really alive

Open a *second* terminal and type:

```powershell
curl.exe http://localhost:8080/api/health
```

You should get back something like:

```json
{"ok":true,"uptimeSeconds":42,"db":"ok"}
```

`ok:true` and `db:"ok"` means everything works. If you get anything else,
jump to [Troubleshooting](#troubleshooting).

### The static-only shortcut (no accounts)

If you only want to look at the website pages — no login, no sync — you can
instead run:

```powershell
python -m http.server 8000
```

and visit http://localhost:8000. But the site will be in "guest mode":
accounts and email only work through `npm start`.

---

## Step 2 — Create your first account

1. Open **http://localhost:8080/#/card** in your browser.
2. Click **Create account** in the top-right corner.
3. Fill in three things. The rules are:

   - **Username** — 3 to 32 characters. Letters, numbers, dots, dashes and
     underscores only, like `myname.42`. No spaces.
   - **Email** — a real address you can open the inbox of. (Not a fake
     domain like `you@localhost`.)
   - **Password** — at least **10 characters**, and it must use at least
     **three of these four kinds** of characters:
     - lowercase letters (`abc`)
     - uppercase letters (`ABC`)
     - numbers (`123`)
     - symbols (`!@#`)

     Example that works: `HappyCat-42` (lowercase + uppercase + symbol +
     number). Up to 128 characters long.

4. Submit the form. You are **signed in immediately** — no waiting, no
   extra step. The dialog confirms: *"We sent a confirmation link to …"*.

Logging in later works with your **username or your email** — either one.
Your session is stored in a special kind of cookie (httpOnly) that lasts 30
days: it survives browser restarts, and website code can't steal it.

---

## Step 3 — Verify your email

When you register, the server emails you a **confirmation link**. The link
lasts 24 hours. Clicking it marks your email as verified, and the account
page shows a **Verified** badge. You have three ways to get the link:

### Option A — read it from the server terminal (no setup at all)

With no email provider configured, the server prints the whole email as one
long line in the terminal where `npm start` is running:

```
[aniglobe-mail] {"from":"AniGlobe <no-reply@localhost>","to":"you@example.com","subject":"Confirm your email…","text":"Welcome to AniGlobe… http://localhost:8080/#/verify?token=abc123…"}
```

Copy the link (it starts with `http://localhost:8080/#/verify?token=` and
ends after a long random string) and open it in your browser. Done — the
badge flips to **Verified**. This is the fastest way to confirm everything
works.

### Option B — a fake inbox on your own computer (best for real testing)

A **mail catcher** is a small program that acts like an email server but
keeps every email on your own computer and shows them in a web page. No
account, no password, no domain — nothing leaves your machine. `maildev` is
already installed with the project, so:

1. Open a terminal and run:

   ```powershell
   npx maildev --smtp 1025 --web 1080
   ```

   This starts the fake email server (port 1025) and its inbox page (port
   1080). Leave it running.

2. In a *second* terminal, set four temporary settings and start the server:

   ```powershell
   $env:MAIL_TRANSPORT = "smtp"
   $env:SMTP_HOST = "127.0.0.1"
   $env:SMTP_PORT = "1025"
   $env:MAIL_FROM = "AniGlobe <no-reply@localhost>"
   npm start
   ```

   These are called **environment variables** — just named settings you give
   the program when it starts. Together they tell the server: "send real
   email, to the fake server on this computer, signed as
   `no-reply@localhost`".

3. Register an account in the browser (Step 2).
4. Open **http://localhost:1080** in the browser. The confirmation email is
   sitting in the inbox. Click the link inside it.

That's the complete loop — the same flow real users get, just with a safe
fake inbox instead of real mail. (Mailpit is the modern equivalent, a single
binary download; the same four settings work.)

> **If maildev errors with `450 ENOENT … Temp\maildev\*.eml`:** maildev
> stores received mail in a temp folder and that folder got deleted. Fix it
> with `New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\Temp\maildev"`
> (or just restart maildev — it recreates the folder).

---

## Step 4 — What your account actually saves

Only these three things, and only when you're signed in:

| What gets saved | When |
| --- | --- |
| Your Wrapped card settings (theme, layout, colours, sections) | Every time you change a setting |
| Named card templates you save in the studio | When you save or delete one |
| Your daily guess results (score/won per day) | When a guessing round finishes |

Everything else — profile searches, card contents, watch history — **never
leaves your browser**.

When you sign in, the server's saved settings replace what's on the device
(the account becomes the shared truth, so all your devices match). If the
account has no saved settings yet, the settings on your device are uploaded
instead. Templates merge by name in both directions.

---

## Step 5 — Manage your account day to day

Logged in, go to **#/account**. You'll find:

- **Your details** — username, email, "member since", and the
  **Verified** badge.
- **Devices signed in** — every active session, with its IP address and
  last-used time. **Revoke** signs out one device; **Sign out everywhere**
  signs out all of them (including the one you're on).
- **Change password** — asks for your current password first, and signs out
  your other devices.
- **Reset by email** — asks for a one-hour reset link. The reply is the same
  whether or not the email exists, so nobody can use it to find out which
  emails have accounts. Resetting also verifies the email and signs out all
  devices.
- **Resend confirmation** — if your email isn't verified yet, this button
  sends a new link (it's rate-limited and always answers "ok").
- **Download my data (JSON)** — one file with your user record, settings,
  templates, and guessing history. Handy for backups or the legal "right to
  an export" kind of request.
- **Delete account** — needs your password, is permanent, and wipes
  everything (sessions, settings, templates, guess history).

Sessions also expire on their own: after **7 days** without any activity,
even though the cookie itself would last 30 days.

---

## Step 6 — Send real emails for free, without owning a domain

Everything above works with zero email setup. When you want verification and
reset emails delivered to *real* inboxes, you need an email provider — but
you **don't** need your own domain. The trick is verifying a **single email
address** ("single sender verification") instead of a whole domain.

| Provider | Free tier | How to do it without a domain |
| --- | --- | --- |
| **SendGrid** | 100 emails/day, free | Settings → Sender Authentication → **Single Sender Verification** → verify one address (e.g. your Gmail) and send from it |
| **Brevo** | 300 emails/day, free | "Senders & IP" → add a sender email and verify it. SMTP host: `smtp-relay.brevo.com`, port 587 |
| **Mailgun** | sandbox mode, free | You get a sandbox domain for free. Only mail *authorized recipients* you add (up to 5) — perfect for testing real delivery to your own inbox |

Then paste the provider's details into the same four settings as Step 3:

```powershell
$env:MAIL_TRANSPORT = "smtp"
$env:SMTP_HOST = "smtp.sendgrid.net"   # or smtp-relay.brevo.com / smtp.mailgun.org
$env:SMTP_PORT = "587"
$env:SMTP_USER = "apikey"              # your provider login
$env:SMTP_PASS = "<API key or SMTP key>"
$env:MAIL_FROM = "AniGlobe <you@example.com>"   # the address you verified
npm start
```

**Skip Resend and Postmark for now.** Their free tiers require DNS
verification of a domain you actually own (SPF/DKIM records) — that's the
wall you ran into. You don't need them: all three providers above work with
a bare email address.

---

## Step 7 — Later, when you buy a domain: nothing to change

Starting on a Vercel domain today does **not** lock you in. The app never
hard-codes a domain:

- Email links are built from the request's `Host` header **at the moment the
  email is sent** (`originOf()` in `server/mail.js`). Serve the site from
  `yourapp.vercel.app` today and `yourdomain.com` tomorrow — new emails
  automatically carry the new address. No code change.
- The sender identity is one setting: `MAIL_FROM`. When you own a domain,
  verify it with your provider (add their SPF/DKIM records at your domain
  registrar), then set `MAIL_FROM = "AniGlobe <no-reply@yourdomain>"`.
  That's the entire migration.
- Users, tokens, sessions, and the database are completely
  domain-independent.

So the safe path is: start today on the Vercel domain with a verified single
sender (SendGrid/Brevo), and upgrade the sender when you buy a domain.
Existing users are unaffected either way.

---

## Settings reference (environment variables)

These are optional settings named in ALL_CAPS. You set them just before
`npm start`. Defaults are fine for local use.

| Setting | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | Port the server listens on. |
| `HOST` | `0.0.0.0` | Which network interfaces to bind (keep the default). |
| `DATABASE_URL` | `data/aniglobe.db` | Where the database file lives. `:memory:` keeps everything in RAM (tests use this; data vanishes on restart). |
| `NODE_ENV` | unset | Set to `production` when you're live — enables Secure cookies and HSTS (recommended when a proxy serves HTTPS). |
| `ENFORCE_CSP` | unset (enforced) | Set to `0` only while debugging fonts/vendors; it softens the browser security policy to report-only. |
| `MAIL_TRANSPORT` | `console` | `console` = print emails to the terminal. `smtp` = send real email via the settings below. |
| `SMTP_HOST` | — | Email server to send through (provider host, or `127.0.0.1` for a local catcher). |
| `SMTP_PORT` | `587` | `465` switches to encrypted TLS automatically. |
| `SMTP_USER` / `SMTP_PASS` | — | The provider's login and key/password. |
| `MAIL_FROM` | `AniGlobe <no-reply@localhost>` | The address emails are "from". The only domain-bound setting — change this when you get a domain. |

---

## Backing up and restoring the database

The entire database is **one file**: `data/aniglobe.db` (git-ignored, so it
isn't in git). Backup = copy the file. Restore = put the file back and
restart the server.

**Back up** (the first line flushes everything to disk; safe to run even
while the server is up):

```powershell
node -e "import('./server/db.js').then(m => { const db = m.openDatabase(); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); })"
Copy-Item data\aniglobe.db data\aniglobe.db.backup-2026-11-07.dat
```

**Restore:**

1. Stop the server.
2. Replace `data/aniglobe.db` with your backup copy.
3. Start the server again. Older database files upgrade themselves on
   startup (migrations are forward-only).
4. Smoke-test: register a throwaway user, check `/api/auth/me` answers,
   then delete the throwaway.

You can also just delete `data/` and start fresh — accounts, settings,
templates, and guess history all reset to zero.

---

## Putting it on the internet (deploying for real)

1. Set `NODE_ENV=production` (Secure cookies + HSTS).
2. Put a reverse proxy with TLS in front (nginx or Caddy). TLS is the only
   thing the app server trusts — do it there.
3. Point `DATABASE_URL` at storage that persists between restarts (never
   scratch/ephemeral disks — the database would vanish).
4. Schedule the backup from above.
5. Run the checklist once: register → confirm email → login → build a wrap
   → export → log out. Confirm the server log shows
   `[aniglobe-security]` JSON lines and `/api/health` answers
   `{ "ok": true }`.

---

## Troubleshooting

| What you see | What it probably means | What to do |
| --- | --- | --- |
| Topbar stays on "Log in" after registering | The request hit the wrong port (you're on the Python static server) | Run `npm start` and use port 8080 |
| `500` on `/api/auth/me` | Database locked, or `data/` not writable | Restart the server; check `data/` exists and is writable |
| Login works but sync silently doesn't | Cookie blocked — page and API on different hosts/ports | Use the same origin for site and API |
| `429` on login or register | Rate limiter tripped (it's persisted, so it survives restarts) | Wait the window (15 min), then retry |
| Port already in use | Another server instance is running | Find it: `Get-NetTCPConnection -LocalPort 8080` → stop with `Stop-Process` |
| Reset email never arrives | Console transport in dev | Read the `[aniglobe-mail]` line in the server log |
| Verification email goes to spam | Free-tier single-sender delivery is often flagged | Test with the local catcher (Step 3B); for real delivery use a provider from Step 6 |
| Maildev: `450 ENOENT … Temp\maildev\*.eml` | Maildev's temp folder was deleted | Create it: `New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\Temp\maildev"`, or just restart maildev |
| `404` on `/data/…` or `/server/…` | Working as intended | The database and server code are never served |
| Server log shows `verify_mail_failed` / `reset_mail_failed` | The mail send itself failed | Check the error in the event; usually wrong `SMTP_*` settings or the maildev temp folder (above) |

---

## Security at a glance

| Protection | What it does |
| --- | --- |
| Passwords | Hashed with scrypt (slow, salted, timing-safe compare) — never stored in plain text |
| Login timing | Fake verification for unknown usernames, so response time can't reveal whether an account exists |
| Sessions | Random tokens, hashed at rest, httpOnly cookie, SameSite=Lax, 30-day absolute + 7-day idle expiry |
| CSRF | A token cookie echoed in `X-CSRF-Token` on every change — blocks cross-site request forgery |
| Rate limits | Stored in the database: register 20/15 min, login 30/15 min, reset 5/hour |
| File server | Blocks `server/`, `tests/`, `data/`, and dotfiles — the database and code can never be downloaded |
| Security logging | JSON events on the server's stderr: register, login success/failure, reset, verify, password change, deletion, session revoke |
| Sync endpoints | Size caps (64 KB settings, 128 KB templates), per-user rows only |

Known limits (tracked in `artifacts/output/05-planning/execution-plan.md`):
delivery needs one of the Step 6 providers configured (the console
transport only logs), rate limits are per-instance (fine for one process),
and there's no 2FA / OAuth yet (Track B).

---

## Running the tests

```powershell
npm test
```

This runs the backend test suite (15 account tests) plus the MAL adapter
tests (2). The account tests start a real HTTP server on a random port with
an in-memory database — no network needed. The MAL tests use the live
Jikan-Edge API. All 17 should pass.
