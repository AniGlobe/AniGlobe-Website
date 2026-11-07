# AniGlobe Runbook — Setting Up and Running the Account System

One Node process serves everything: the static site, the JSON account API
(`/api/*`), and the SQLite database (`node:sqlite`, zero native dependencies).
Python's `http.server` is static-only — **accounts need the Node server**.

## 1. Set up (first run)

Prerequisites: Node 22+ (`node --version`).

```powershell
npm install          # includes nodemailer (the only production dependency)
npm start            # → http://localhost:8080
```

On first boot the database is created and migrated at `data/aniglobe.db`
(gitignored). Confirm it's alive:

```powershell
curl.exe http://localhost:8080/api/health
# {"ok":true,"uptimeSeconds":42,"db":"ok"}
```

Static-only fallback for poking at the UI without accounts:

```powershell
python -m http.server 8000
```

## 2. Create and verify your first account

1. Open `http://localhost:8080/#/card` and click **Create account** (top-right).
2. Username (3–32 chars: letters, numbers, `.` `-` `_`), valid email, password
   of **10+ characters** mixing at least three of lowercase / uppercase /
   numbers / symbols.
3. Registration signs you in immediately and mails a **confirmation link**
   (24h expiry). The dialog confirms: *"We sent a confirmation link to …"*.
4. With the default console mail transport, the link is printed in the
   **server's stderr** (the terminal where `npm start` runs) as one
   `[aniglobe-mail]` JSON line. Click it (or copy it into `/#/verify?token=…`).
   The account page badge flips to **Verified**.
5. **Log in** works with username *or* email. The session is an httpOnly
   cookie (30 days), not JavaScript storage — it survives reloads and can't
   be stolen by XSS.

Email needs no real SMTP in dev: the console transport logs the link so every
flow is testable on localhost. See §5 when you're ready for real mail.

## 3. What an account actually stores

Only these, and only when signed in:

| Data | Endpoint | Trigger |
| --- | --- | --- |
| Wrapped preferences (theme, layout, colors, sections) | `POST /api/sync/wrapped-prefs` | every settings change |
| Named card templates | `POST /api/sync/templates` (+ `DELETE /:name`) | save / delete in the studio |
| Daily guess results | `POST /api/sync/guess` | when a round finishes |

Profile searches, card contents, and watch history **never leave the browser**.
On sign-in, the server's prefs replace local prefs (the account is the shared
truth); with no server copy yet, local prefs migrate up. Templates merge by
name both ways.

## 4. Manage accounts day to day

From the browser (`#/account`), while logged in:

- **Devices signed in** — every active session with IP and last-seen time.
  **Revoke** kills one device; **Sign out everywhere** kills all of them
  (including this one).
- **Change password** — requires the current password; signs out all other
  sessions and re-issues yours.
- **Reset by email** — request a one-hour reset link. The answer is identical
  whether or not the email exists (no user enumeration). The link page is
  `/#/reset?token=…`; reset also verifies the email and kills all sessions.
- **Email verification** — the unverified badge shows a **Resend** button
  (throttled, always answers 200). Clicking the mailed link verifies instantly.
- **Download my data (JSON)** — your user row, session count, prefs, templates,
  and guess history in one file (GDPR-style export).
- **Delete account** — password-confirmed, irreversible; cascades sessions,
  prefs, templates, and guess rows.

Sessions idle out after **7 days** without activity, even before their 30-day
absolute expiry. Changing the password or completing a reset also signs out
every other device.

## 5. Mail setup (real email without owning a domain)

`server/mail.js` implements real SMTP via nodemailer — the route layer calls
one interface (`sendMail({ to, subject, text })`) and nothing else changes.
You configure everything through environment variables; the code never hardcodes
a domain, so nothing here breaks when you switch domains later.

### 5a. Test locally with no account and no domain (use this first)

Run a fake SMTP catcher on your machine, point the server at it, and every
verification/reset email lands in a local web UI. Full end-to-end testing, zero
sign-ups. `maildev` is already a devDependency:

```powershell
npx maildev --smtp 1025 --web 1080
# then in another terminal:
$env:MAIL_TRANSPORT = "smtp"
$env:SMTP_HOST = "127.0.0.1"
$env:SMTP_PORT = "1025"
$env:MAIL_FROM = "AniGlobe <no-reply@localhost>"
npm start
```

Register an account, open http://localhost:1080, and the confirmation email is
there — click the link and the badge flips to Verified. (Mailpit is the modern
equivalent, a single binary; same env vars apply.)

This is the loop the account tests exercise with an injected mailer; the local
catcher makes the same flow real enough to click through in a browser.

### 5b. Send to real inboxes for free, still without a domain

Most free tiers ask for a domain you must verify with DNS records — but three
don't:

| Provider | Free tier | Domain needed? | Path |
| --- | --- | --- | --- |
| **SendGrid** | 100 emails/day free | No | Settings → Sender Authentication → **Single Sender Verification**: verify one email address (e.g. your Gmail) and send from it. |
| **Brevo** | 300/day free | No | Senders & IP → **Senders & IP** → add a sender email and verify it. SMTP host `smtp-relay.brevo.com:587`. |
| **Mailgun** | sandbox mode free | No | Sandbox sends only to *authorized recipients* you add (one account, up to 5 recipients) — ideal for testing real delivery to yourself; your sandbox domain is provided. |

Provider SMTP settings to copy into the env vars below:

```powershell
$env:MAIL_TRANSPORT = "smtp"
$env:SMTP_HOST = "smtp.sendgrid.net"   # or smtp-relay.brevo.com / smtp.mailgun.org
$env:SMTP_PORT = "587"
$env:SMTP_USER = "apikey"              # or your provider login
$env:SMTP_PASS = "<API key / SMTP key>"
$env:MAIL_FROM = "AniGlobe <you@example.com>"   # the verified sender address
```

Skip **Resend** and **Postmark** for now: their free tiers require DNS
verification of a domain you own (SPF/DKIM). They're the ones producing the
domain wall you're hitting — you don't need them to get verification working.

### 5c. When you own a domain later — nothing to change in the app

The sending host is not baked in anywhere:

- Email links are built from the request's `Host` header at send time
  (`originOf()` in `server/mail.js`), so they always point at whatever domain
  you currently serve the site from — `yourapp.vercel.app` today,
  `yourdomain.com` tomorrow, no code change.
- `MAIL_FROM` is a single environment variable. Buying a domain means
  verifying it with your provider (SPF/DKIM DNS records) and setting
  `MAIL_FROM="AniGlobe <no-reply@yourdomain>"` — that is the entire migration.
- Tokens, users, sessions, and all stored data are domain-independent.

So: start on the Vercel domain with a single-sender email (SendGrid/Brevo),
and upgrade the sender to your domain in one env var when you buy one.
Existing users and links are unaffected either way.

Default transport is **console** (logs the email as JSON on stderr) — works
for the §2 first-account flow without any provider at all. Until you configure
a provider, verify by reading the log line:

```
[aniglobe-mail] {"from":"AniGlobe <no-reply@localhost>","to":"you@example.com","subject":"Confirm your email…"}
```

## 6. Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listen port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DATABASE_URL` | `<root>/data/aniglobe.db` | SQLite file; `:memory:` for tests. |
| `NODE_ENV` | unset | `production` → Secure cookies + HSTS. |
| `ENFORCE_CSP` | unset (enforced) | `0` → Content-Security-Policy-Report-Only instead. |
| `MAIL_TRANSPORT` | `console` | `smtp` → send real mail via nodemailer. |
| `SMTP_HOST` | — | SMTP server (provider or `127.0.0.1` for a local catcher). |
| `SMTP_PORT` | `587` | `465` selects TLS automatically. |
| `SMTP_USER` / `SMTP_PASS` | — | Provider credentials. |
| `MAIL_FROM` | `AniGlobe <no-reply@localhost>` | Sender identity on mail; the only domain-bound setting. |

## 7. Back up and restore

```powershell
# Windows: checkpoint the WAL, then copy the file (server can stay up)
node -e "import('./server/db.js').then(m => { const db = m.openDatabase(); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); })"
Copy-Item data\aniglobe.db data\aniglobe.db.2026-11-07.bak
```

Restore: replace `data/aniglobe.db`, restart the server — migrations are
forward-only and idempotent, so an older file upgrades in place. Smoke-test
afterward: start the server, register a throwaway user, confirm `/api/auth/me`
answers, log the user out, delete the throwaway.

Regenerating the database from scratch is always possible (`data/` is
gitignored); accounts, prefs, templates, and guess rows reset to zero.

## 8. Deploying for real

1. `NODE_ENV=production` (Secure cookies + HSTS).
2. Reverse proxy (nginx/Caddy) with TLS in front; TLS is the only thing the
   app server trusts.
3. `DATABASE_URL` on persistent storage (not scratch/ephemeral disks).
4. Schedule the checkpoint-and-copy backup from §7.
5. Verify the checklist: register → confirm email → login → wrap → export →
   log out; confirm the server log shows `[aniglobe-security]` JSON lines and
   `/api/health` answers `{ ok: true }`.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Topbar stays on "Log in" after registering | Request hit the wrong port (Python static server) | Run `npm start` and use port 8080 |
| `500` on `/api/auth/me` | Database locked / `data/` unwritable | Restart server; check `data/` exists and is writable |
| Login works, sync silently absent | Cookie blocked (different host:port for page vs API) | Use the same origin for site and API |
| `429` on login/register | Rate limiter tripped (persisted now) | Wait the window (15 min), then retry |
| Port already in use | Another server instance | `Get-NetTCPConnection -LocalPort 8080` → `Stop-Process` |
| Reset email never arrives | Console transport in dev | Read the `[aniglobe-mail]` line in the server log |
| Verification email goes to spam | Free-tier single-sender delivery | Test with §5a local catcher; add your own inbox as an authorized recipient on Mailgun sandbox |
| `404` on `/data/...` or `/server/...` | Working as intended | The database and server tree are never served |

## 10. Security posture

| Control | State |
| --- | --- |
| Passwords | scrypt N=16384/r=8/p=1, per-user salt, timing-safe compare |
| Login timing | dummy-hash verify on unknown username — no timing oracle |
| Sessions | random token hashed at rest, httpOnly, SameSite=Lax, 30-day absolute + 7-day idle expiry |
| CSRF | double-submit cookie echoed in `X-CSRF-Token` on every mutation |
| Rate limits | persisted in SQLite: register 20/15min, login 30/15min, reset 5/h |
| Static handler | blocks `server/`, `tests/`, `data/`, dotfiles; `/.well-known/security.txt` served |
| Security logging | JSON events on stderr: register, login success/fail, reset, verify, password change, deletion, session revoke |
| Templates/prefs sync | body caps (64 KB prefs, 128 KB templates), per-user rows only |

Known limits (tracked in `artifacts/output/05-planning/execution-plan.md`):
delivery needs one of the §5 providers configured (the console transport only
logs), rate limits are per-instance (fine for one process), and there is no
2FA / OAuth yet (Track B).

## 11. Tests

```powershell
npm test            # backend API (15 tests) + MAL adapter (2 tests)
```

The tests spin up a real HTTP server on an ephemeral port with an in-memory
database — no network needed for the account suite, except the MAL tests
which use the live Jikan-Edge API.
