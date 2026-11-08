# Kanban — AniGlobe account system

**Updated:** 2026-11-08
**Source:** `artifacts/output/05-planning/execution-plan.md` (scope lock: `[SCOPE_LOCKED: track-a-harden-then-b]`)
**Track B spec:** `artifacts/output/05-planning/product-spec.md` (draft, local per AGENTS norms)

Malformed board entries (if any) are kept as plain text. Columns: Backlog,
To Do, In Progress, Review / QA, Done, Blocked.

## Backlog

- Configure a real SMTP provider (SendGrid single-sender / Brevo / Mailgun sandbox, or owned domain) — documented in RUNBOOK §5, credentials pending
- 2FA for accounts (noted as future work in RUNBOOK known limits)

## To Do

- Spec B004 (template sharing) and B001 (profile/avatar) in detail — B002 shipped, spec drafted

## In Progress

- — (nothing)

## Review / QA

- — (nothing)

## Done

- [x] Account core — register / login / logout, httpOnly sessions (30-day), scrypt passwords, CSRF double-submit
- [x] Track A T001–T009 — persisted rate limits, session idle timeout + device list/revoke, password reset, email verification, CSP + security.txt, security logging + `/api/health`, GDPR data export, backup drill, account copy pass
- [x] Real SMTP mailer (nodemailer 10.4.0, `MAIL_TRANSPORT=smtp`) + free-provider docs (RUNBOOK §5)
- [x] RUNBOOK.md rewritten as a plain-language step-by-step tutorial
- [x] `npm audit` clean — 0 vulnerabilities (nodemailer override; maildev 2.2.1 pinned for local testing)
- [x] Tests 15/15 green (`npm test`: 15 account + 2 MAL)
- [x] Track B B002 — guess history + streak calendar on account page (`src/domain/streak.js`, `tests/streak.test.mjs` 10 tests; 25 total green)
- [x] Track B product-spec draft (`product-spec.md`, OSS decisions recorded)
- [x] Untracked planning docs per AGENTS norms: RUNBOOK.md, copy-deck.md, DESIGN.md (kept local, gitignored)

## Blocked

- B001 Public profile page (avatar upload, bio, Wrapped gallery) — needs spec detail + avatar storage decision (browser-resize, see product-spec)
- B003 OAuth (Google first, PKCE) — needs `GOOGLE_*` env + provider account before live test
- B004 Template sharing (export/import link) — needs spec detail (fragment encoding + size guard)
- B005 Weekly Wrapped digest email — waiting on real SMTP provider + scheduler choice
