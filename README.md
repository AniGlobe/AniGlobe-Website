# AniCard

AniCard is a static site with two tools built around public MyAnimeList and
AniList data:

- **Anime Wrapped** builds a profile summary from a MyAnimeList or AniList
  username. MyAnimeList is the default source; its public data is read through
  Jikan, an unofficial API. AniList remains available as an alternative.
- **Anime Guess** fetches one paginated, public MyAnimeList catalog page when
  needed. Its five clues come from the release year, studio, format, genres,
  and synopsis. The daily puzzle is cached in the current browser; progress and
  streaks are saved there as well.

## Run locally

Serve the repository root over HTTP, then open the local address in a browser.
For example:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. The modules and JSON data need an HTTP server;
opening `index.html` directly as a file will not work.

## Catalog requests

The tools request only the public data they use. MyAnimeList requests go
through Jikan. Anime Guess fetches one safe-for-work catalog page at a time and
chooses a clue-complete entry for the current date. It keeps that puzzle in the
current browser for the rest of the day. No catalog export or bulk download is
required.

A future catalog viewer can request the next Jikan page only when someone
browses to it, rather than downloading a local copy of the catalog.

Anime Wrapped requests profile and favorites data from Jikan at a rate-safe
interval and gives up after 10 seconds if a request stalls. If favorites are
unavailable, the profile summary still loads and shows the reason. AniList
Wrapped requests profile statistics, favorites, and only the first ten
completed titles, rather than downloading the entire list.

## Project layout

```text
index.html
assets/                     shared and tool-specific stylesheets
src/app.js                  hash router and page shell
src/anilist.js              AniList profile client and taste signals
src/config.js               site metadata and tool registry
src/lib.js                  DOM, storage, clipboard, and data helpers
src/providers/               AniList and MyAnimeList profile adapters
src/tools/card.js           Anime Wrapped form and actions
src/tools/card-view.js      Anime Wrapped card rendering
src/tools/daily.js          Anime Guess game
```
