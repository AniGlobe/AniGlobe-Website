# Execution Plan — Account System Hardening + Expansion

**Planned:** 2026-11-07
**Estimated total:** Track A (harden) ~16h — **DONE** · Track B (expand) ~28h — queued
**Developers needed:** 1–2
**Parallelizable tasks:** Track A: 6 of 9 · Track B: 4 of 8
**Scope lock:** `[SCOPE_LOCKED: track-a-harden-then-b]` (recorded in conversation; the Vespyr `step_tracker.js` harness is not installed in this repo)

## Scope anchor (Step 0)

- **Concrete outcome:** `artifacts/output/05-planning/execution-plan.md` — a verified task breakdown for the account system that covers hardening first, features second.
- **Boundary constraints:** The shipped account core (register/login/session/sync) is DONE and verified (11/11 tests, e2e proven). This plan schedules only the gaps, fixes, and expansions below. No new tool modules; no redesign of the existing card or guess games.
- **Target decision:** Which hardening fixes land now (Track A) vs. which expansions queue behind them (Track B), in what dependency order.

## Where the system stands today (as-built, verified)

| Area | Status | Evidence |
|---|---|---|
| Register / login / logout | ✅ shipped | `tests/auth.test.mjs` (9 auth tests), live browser flow |
| Sessions (httpOnly, hashed at rest, 30-day) | ✅ shipped | idle timeout + active-session list, e2e |
| Passwords (scrypt, timing-safe) | ✅ shipped | unit + integration tests |
| CSRF double-submit on mutations | ✅ shipped | 403 test |
| Rate limiting | ✅ shipped (SQLite-backed) | restarts no longer reset counters |
| Wrapped prefs + templates sync | ✅ shipped | round-trip test + browser |
| Guess progress sync | ✅ shipped | API test + browser finish-round |
| Change password / delete account | ✅ shipped | tests + account page live |
| Email verification | ✅ shipped | verify-token flow + badge/resend, console mailer |
| Password reset | ✅ shipped | oracle-proof request, single-use tokens, sessions killed |
| Session management UX | ✅ shipped | devices list, revoke, revoke-all on account page |
| Security logging / health endpoint | ✅ shipped | `[aniglobe-security]` JSON events, `/api/health` |
| Security headers (CSP) | ✅ shipped | enforced CSP, `/.well-known/security.txt` |
| Backup/restore procedure | ✅ documented | RUNBOOK §5, drill notes |
| Account data export | ✅ shipped | `GET /api/auth/export` + account-page button |
| Public profiles / avatar / OAuth | ❌ Track B | needs `product-spec.md` via shape-up |

---

## Track A — Harden the shipped system (~16h)

| ID | Task | Est. (h) | Depends On | Parallel With | Done |
|---|---|---|---|---|---|
| T001 | **Persist rate limits** in SQLite (atomic `UPDATE... SET count = count + 1` with window check) so limits survive restarts; add reset/prune job; tests incl. restart persistence | 2 | — | T002, T003, T004, T005, T006 | [ ] |
| T002 | **Session idle timeout + active-session list**: store `last_seen_at`, slide expiry on activity (idle cap 7 days), list devices on account page, per-device revoke, "sign out everywhere" button; tests | 3 | — | T001, T003, T004, T005, T006 | [ ] |
| T003 | **Password reset**: token table (hashed tokens, 1h expiry, single-use), `POST /api/auth/password-reset/request` (always 200 — no oracle), `POST /api/auth/password-reset/confirm`; mail via a pluggable `mailer.js` interface with a console/dev stub until SMTP is configured; tests | 3 | — | T001, T002, T004, T005, T006 | [ ] |
| T004 | **Email verification**: verify-token table, gate new accounts to "verify" state (login allowed but flagged until confirmed; resend with throttle), banner on account page; tests. Shares the mailer interface with T003 | 3 | T003 (mailer) | T001, T002, T005 | [ ] |
| T005 | **Security headers**: CSP that keeps Google Fonts, Typekit, and the Jikan/AniList endpoints working (frame-ancestors none, no eval-inline), `well-known/security.txt`, tests for header presence | 2 | — | T001, T002, T003, T006 | [ ] |
| T006 | **Security logging + health**: structured JSON events (login success/fail, register, password change, delete, rate-limit trip) to stderr; `GET /api/health` (db ping + uptime); log rotation note; tests | 2 | — | T001, T002, T003, T004, T005 | [ ] |
| T007 | **Account data export (GDPR)**: `GET /api/auth/export` — user row, session count, prefs, templates, guess progress as a JSON download; account-page button; tests | 2 | T002 (session surface) | T001, T003, T004 | [ ] |
| T008 | **Backup & restore drill**: documented `sqlite3`-free procedure (Node script: checkpoint + copy + integrity check), run against a scratch copy, record the drill in `RUNBOOK.md`; restore replaces `data/aniglobe.db` and restarts server | 1 | T001, T002, T003, T004, T005, T006, T007 | — | [ ] |
| T009 | **Account page copy pass**: sync-status line ("synced 2h ago"), privacy wording alignment with README, empty states for templates; browser walkthrough | 1 | T002, T007 | — | [ ] |

### Dependency graph

```
T001 ─┬─> (parallel, no shared files except server/api.js — sequence merges)
T002 ─┤
T003 ─┤─> T004 (mailer interface)
T005 ─┤
T006 ─┴─> T008
T002, T007 ──> T009
```

### Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Reset/verify emails never arrive (no SMTP yet) | High | Medium | Ship console mailer stub first; document SMTP as env-gated (`MAIL_TRANSPORT`), do not block Track A on vendor choice |
| CSP breaks Typekit/Jikan fetches | Medium | High | Ship CSP in report-only mode first, verify zero violations in browser, then enforce |
| Persisted rate limits reintroduce lockout bugs | Low | Medium | Unit-test counter transitions; keep the in-memory limiter as fallback behind a flag |

---

## Track B — Expand account features (~28h, starts after Track A)

Requires a `product-spec.md` (write via shape-up) before detailed planning.

| ID | Feature | Est. (h) | Depends On | Parallel With | Done |
|---|---|---|---|---|---|
| B001 | Public profile page: avatar upload (server-stored, resized), bio, linked Wrapped card gallery from synced data | 6 | A-T002 | B003 | [ ] |
| B002 | Guess history + streak calendar on account page from synced progress | 4 | A-T002 | B001, B003 | [ ] |
| B003 | OAuth (Google first): PKCE flow, account linking/unlinking, tests with mocked provider | 8 | A-T003 | B001, B002 | [ ] |
| B004 | Template sharing (export/import link) | 4 | A-T007 | — | [ ] |
| B005 | Weekly wrapped digest email (needs SMTP from A-T003/T004) | 6 | A-T004 | — | [ ] |

Track B output: feature specs first, then per-feature execution plans sized 1–4h each.

---

## Worktree allocation (from the project git repo)

`node .agents/scripts/worktree.js` is not installed here; use plain git worktrees:

```
git worktree add ../aniglobe-t001 -b feature/rate-limit-persistence
git worktree add ../aniglobe-t002 -b feature/session-management
git worktree add ../aniglobe-t003 -b feature/password-reset
git worktree add ../aniglobe-t005 -b feature/security-headers
git worktree add ../aniglobe-t006 -b feature/security-logging
```

Each worktree runs `npm test` on its own branch; merge order T001 → T002 → T003 → T004 → T005/T006 → T007 → T008/T009.

## Exit criteria (Track A)

- `node --test tests/*.test.mjs` green including new suites for T001–T004 + T007
- One live browser pass per new user-facing flow (reset, verify banner, sessions list, data export)
- `RUNBOOK.md` committed (written alongside this plan)
