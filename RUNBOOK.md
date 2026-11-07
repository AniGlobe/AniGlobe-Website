# AniGlobe Runbook — Running and Managing the Account System

One process serves everything: the site, the API, and the SQLite database
(`node:sqlite`, no native deps). This is the complete operating manual.

## 1. Start the server

```powershell
npm start          # → http://localhost:8080 (PORT overridable)
```

Key env vars:

| Variable       | Default                  | Meaning                                          |
| -------------- | ------------------------ | ------------------------------------------------ |
| `PORT`         | `8080`                   | Port to listen on.                               |
| `HOST`         | `0.0.0.0`                | Bind address.                                    |
| `DATABASE_URL` | `<root>/data/aniglobe.db`| SQLite file path. `:memory:` for tests.          |
| `NODE_ENV`     | unset                    | `production` enables Secure cookies + HSTS.      |

The database is created and migrated on first boot. Static-only browsing
without accounts: `python -m http.server 8000` (accounts need the Node
server — `/api/*` 404s otherwise).

## 2. Register and log in

1. Top-right **Create account** (or **Log in**).
2. Username (3–32 chars: letters, numbers, `.` `-` `_`), a valid email, and a
   password of 10+ characters using at least three of: lowercase, uppercase,
   numbers, symbols.
3. The session is an **httpOnly cookie** — it survives page reloads and never
   touches JavaScript storage, so XSS can't steal it.
4. **Log out** is in the topbar account menu or on `#/account`.

## 3. What syncs, and where

Only these three things ever leave the browser, and only for signed-in users:

| Data              | Endpoint                      | Trigger |
| ----------------- | ----------------------------- | ------- |
| Wrapped preferences (theme, layout, colors, section visibility/order) | `POST /api/sync/wrapped-prefs` | every settings change |
| Named card templates | `POST /api/sync/templates`, `DELETE /api/sync/templates/:name` | save / delete in the studio |
| Daily guess results | `POST /api/sync/guess` | when a round finishes |

Profile searches, card contents, and watch history are **never** synced — they
live only in the browser. On sign-in, the server's prefs replace local prefs
(the account is the shared truth); local prefs migrate up if the server has
none (first sign-in). Templates merge by name both ways.

## 4. Manage an account

**In the browser** (`#/account`): email/username shown, change password
(current password required; all other sessions are signed out), delete
account (password-confirmed, irreversible, cascades everything), log out.

**Administratively** (the operator, with the server stopped):

```powershell
node -e "import('./server/db.js').then(m => { const db = m.openDatabase(); console.log(db.prepare('SELECT id, username, email, created_at FROM users').all()); })"
```

- **Force a password reset**: set the user's hash manually, or wait for the
  reset flow (planned in the hardening track).
- **Force-logout every device**: delete that user's rows from `sessions`.
- **Export everything (GDPR)**: as the user, `GET /api/auth/export` (planned);
  today, dump the row set with the query above plus `wrapped_prefs`,
  `templates`, and `guess_progress` filtered by `user_id`.

## 5. Back up and restore the database

```powershell
# stop the server first, or copy while it runs (WAL mode allows it with WAL checkpoint)
node -e "import('./server/db.js').then(m => { const db = m.openDatabase(); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); })"
Copy-Item data\aniglobe.db data\aniglobe.db.2026-11-07.bak
```

Restore: replace `data/aniglobe.db`, restart the server — migrations are
forward-only and idempotent, so an older file upgrades in place. Verify with
`node --test tests\auth.test.mjs` afterwards (the tests use `:memory:`, so
this is a smoke prompt: start the server, register a throwaway user, confirm
`/api/auth/me` answers).

## 6. Security posture (and its limits)

| Control | State |
| --- | --- |
| Passwords | scrypt N=16384/r=8/p=1, per-user salt, timing-safe compare |
| Login timing | dummy-hash verify on unknown username |
| Sessions | random token hashed at rest, httpOnly, SameSite=Lax, 30-day expiry |
| CSRF | double-submit cookie echoed in `X-CSRF-Token` on every mutation |
| Rate limits | register/login buckets, in-memory (see Track A plan) |
| Static handler | blocks `server/`, `tests/`, `data/`, dotfiles |

Not yet (tracked in the execution plan): email verification, password reset,
idle session timeout, active-session list, CSP, structured security logging,
account data export.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Topbar stays on "Log in" after registering | Request hit the wrong port (Python static server) | Run `npm start` and use port 8080 |
| `500` on `/api/auth/me` | Database locked or `data/` directory missing | Restart server; check `data/` exists and is writable |
| Login works, sync silently absent | Cookie blocked by a proxy / different port | Use the same host:port for site and API |
| `429` on login/register | Rate limiter tripped | Wait 15 minutes (window), then retry |
| Port already in use | Another server instance | Stop it: `Get-NetTCPConnection -LocalPort 8080` → `Stop-Process` |

## 8. Deploying for real

1. Set `NODE_ENV=production` (Secure cookies + HSTS).
2. Put a reverse proxy (nginx/Caddy) in front with TLS; it is the only thing
   that should reach the app server.
3. Schedule the checkpoint-and-copy backup (Windows Task Scheduler / cron).
4. Forward `DATABASE_URL` to a path on persistent storage.
5. Verify with: register → login → wrap → export → log out, then read the
   server logs for `[ANIGLOBE-ERROR]` JSON lines.
