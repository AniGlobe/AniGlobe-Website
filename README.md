# AniGlobe

AniGlobe is a static site for people who keep anime and manga lists:

- **AniManga Wrapped** reads a public MyAnimeList or AniList profile. Choose
  anime or manga, select a card palette and the sections to show, then copy the
  summary or save a PNG.
- **Anime Guess** and **Manga Guess** each draw five varied clues from one
  public catalog record. The date keeps each daily puzzle consistent. Scores,
  streaks, and the current puzzle stay in the browser.

The site does not store a profile or fetch a complete catalog. Profile requests
load when someone submits a username. Guess requests load one catalog page and
try up to five full records from that page until one has enough details for the
daily clues. The selected puzzle is cached in the browser for that day.

## Run locally

Serve the repository root over HTTP, then open its local address in a browser.
For example:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. The modules and JSON data need an HTTP server;
opening `index.html` directly as a file will not work.

## Data sources

MyAnimeList data comes from [Jikan-Edge](https://jikan.lucashdo.com/), a
community-run API. AniList profiles use its public GraphQL API. The tools
request only the selected anime or manga data. Anime Guess reads the top anime
catalog; Manga Guess reads the top manga catalog. Both stop fetching full
records as soon as a usable daily puzzle is found, with a five-record limit.
Rate limits and service availability are controlled by those providers.

## Project structure

```text
index.html
assets/
  styles.css                 shared design tokens and site shell
  tool-card*.css             Wrapped form and export-card styling
  tool-daily.css             shared anime and manga guessing-game styling
src/
  app.js                     routes, navigation, and footer
  config.js                  site metadata, provider endpoints, tool registry
  domain/media.js            shared anime and manga definitions
  providers/                 provider adapters for public profile data
  tools/card.js              AniManga Wrapped inputs and actions
  tools/card-view.js         normalized profile card and copied summary
  tools/daily.js             shared Anime Guess and Manga Guess gameplay
  anilist.js                 AniList GraphQL client and normalized profile
  export.js                  browser PNG export
  lib.js                     shared DOM, storage, and browser helpers
```

## Adding a tool

Add a route to the registry in `src/config.js` and keep its implementation in a
separate module under `src/tools/`. Put provider-specific response mapping in
`src/providers/`, and share only normalized domain data with the tool. A future
tracker, personal list, or database viewer can follow the same boundary without
adding state to the site shell or to Wrapped.

## Privacy and browser storage

AniGlobe requests a public profile only after someone submits a username. It
does not persist profile responses. Wrapped stores display preferences;
Guess stores its daily puzzle and progress in the current browser.
