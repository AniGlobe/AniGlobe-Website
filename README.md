# AniCard

Two small tools on one static site.

- **Taste card**: pick
```

npx serve .

```

##
```

index.html                     shell, mounts nothing itself
assets/styles.css              design tokens and shell
assets/tool-card.css           card body
assets/tool-card-ui.css        card sections and controls
assets/tool-card-platform.css  platform picker
assets/tool-daily.css          daily guess
src/config.js                  site metadata and tool registry
src/app.js                     hash router
src/lib.js                     DOM, storage, clipboard, loader helpers
src/taste.js                   archetypes and derived signals, shared
src/export.js                  DOM to PNG
src/providers/index.js         provider registry
src/providers/anilist.js       AniList client
src/providers/mal.js           MyAnimeList client, through Jikan
src/tools/card.js              card tool wiring
src/tools/card-view.js         card rendering, pure
src/tools/daily.js             daily guess tool
data/puzzles.json              puzzle bank, committed
scripts/generate-puzzles.mjs   rebuilds the bank from AniList

```

## Adding a tracker

Write
```

node scripts/generate-puzzles.mjs 365

```

Review the
