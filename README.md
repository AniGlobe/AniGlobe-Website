# AniGlobe

AniGlobe is a site for people who keep anime and manga lists:

- **AniManga Wrapped** reads a public MyAnimeList or AniList profile. MyAnimeList
  imports every page of the selected list, so status counts, rating spread, and
  completed titles, formats, and release years are available alongside the
  aggregate stats. Up to 16 title records are checked for genres and metadata,
  and the card labels this sample.
  Arrange sections with drag and drop or keyboard controls, save named templates,
  then copy the summary or export square and 9:16 PNGs.
- **Anime Guess** and **Manga Guess** each draw five varied clues from one
  public catalog record. The date keeps each daily puzzle consistent. Scores,
  streaks, and the current puzzle stay in the browser.
- **Accounts (optional).** Register or log in to sync your Wrapped preferences,
  saved templates, and daily guess streaks across devices. Profile data itself
  is never stored by accounts — nothing you search is kept.

The site does not store profile responses or fetch a complete catalog.
Profile requests load when someone submits a username. Guess requests load one
catalog page and try up to five full records from that page until one has
enough details for the daily clues. The selected puzzle is cached in the
browser for that day.

## Run locally

```powershell
npm start
```

That boots the Node server (port 8080 by default): it serves the site and the
account API (`/api/*`) from one process with a SQLite database at
`data/aniglobe.db`. Or serve the repository root over HTTP for the static
site only (accounts will be unavailable without the API):

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. The modules and JSON data need an HTTP server;
opening `index.html` directly as a file will not work.

## Accounts and the database

- Node 22+ (`node:sqlite`, `node:crypto`), zero native dependencies.
- `server/db.js` — SQLite schema: `users`, `sessions`, `wrapped_prefs`,
  `templates`, `guess_progress`, plus forward-only migrations.
- `server/passwords.js` — scrypt password hashing (N=16384, r=8, p=1).
- Sessions are httpOnly cookies with server-stored token hashes; mutations
  carry a double-submit CSRF token; auth endpoints are rate-limited.
- `DATABASE_URL` overrides the SQLite file path. `NODE_ENV=production`
  enables Secure cookies and HSTS.

## Data sources

MyAnimeList data comes from [Jikan-Edge](https://jikan.lucashdo.com/), a
community-run API. AniList profiles use its public GraphQL API. Wrapped requests
only the selected anime or manga list. For MyAnimeList, it loads all list pages
for status, ratings, and completed titles, then checks at most 16 titles for
genre and metadata details. Sample-derived genres are labeled with their sample
size. Rate limits and service availability are controlled by those providers.
Anime Guess reads the top anime catalog; Manga Guess reads the top manga
catalog. Both stop fetching full records as soon as a usable daily puzzle is
found, with a five-record limit.

## Project structure

```text
index.html
assets/
  styles.css                 shared design tokens and site shell, tool styling,
                             studio dialog, and auth styles
server/
  index.js                   production entry: static serving + /api/*
  db.js                      SQLite schema and migrations
  passwords.js               scrypt hashing
  ratelimit.js               in-memory rate limiter
  http.js                    JSON helpers, cookies, CSRF, validation
  api.js                     account + sync routes
src/
  app.js                     routes, navigation, and footer
  auth.js                    account client, session state, sync helpers
  config.js                  site metadata, provider endpoints, tool registry
  data/app-data.js           app data lookups
  domain/media.js            shared anime and manga definitions
  domain/profile-insights.js provider-neutral Wrapped insights
  providers/                 provider adapters for public profile data
  tools/card.js              AniManga Wrapped inputs and actions
  tools/card-view.js         normalized profile card and copied summary
  tools/account.js           account page (password change, delete)
  tools/auth-dialog.js       login/register dialog
  tools/daily.js             shared Anime Guess and Manga Guess gameplay
  anilist.js                 AniList GraphQL client and normalized profile
  export.js                  browser PNG export
  lib.js                     shared DOM, storage, and browser helpers
tests/
  auth.test.mjs              account API tests (real HTTP round-trips)
  mal.test.mjs               MyAnimeList import and metric tests
```

## Adding a tool

Add a route to the registry in `src/config.js` and keep its implementation in a
separate module under `src/tools/`. Put provider-specific response mapping in
`src/providers/`, and share only normalized domain data with the tool. A future
tracker, personal list, or database viewer can follow the same boundary without
adding state to the site shell or to Wrapped.

## Privacy and browser storage

AniGlobe requests a public profile only after someone submits a username. It
does not persist profile responses. Without an account, Wrapped stores display
preferences and named card templates in the current browser; Guess stores its
daily puzzle and progress there as well. With an account, those same things —
and only those things — sync to the account so you can pick them up on another
device. No watch history, profile data, or card content leaves the browser.

## Run focused tests

```powershell
npm test
```

Backend tests use Node's built-in test runner against a real HTTP server on
an ephemeral port — no added packages needed.
