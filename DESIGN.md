# AniGlobe design direction

AniGlobe is a small, public-data toolkit for anime and manga fans. It turns a
list profile into a personal wrap and makes a daily guessing game from catalog
records. The interface uses a framed-sheet system: a sea-mist frame holds the
tools; the work happens on a white sheet inset from the frame edge.

## Audience and voice

People who track anime or manga on MyAnimeList or AniList, often on a phone.
Copy stays plain, curious, and specific. It can be playful without talking
down to the reader. Do not invent profile details, ratings, usage claims, or
community activity.

## Visual language

- **Frame and sheet:** the sidebar and top bar share one tinted ground
  (`--ground #eef4f5`, sea-mist from the product hue). The page is a white
  sheet (`--surface #ffffff`) inset 12px from the frame's right and bottom
  edges, with a 1px hairline border (`--border #e4e8e9`) and 16px corners.
  No shadow. Depth comes from the single tone step between frame and sheet.
- **Palette:** the accent is the product's ocean teal `#1b6c80` (`--accent`),
  used for the active tab underline, the main chart series, and the single
  selected state (segmented radios, swatch rings). Status colours: positive
  `#1e7b4f`, negative `#c4242a`, warning `#92400e`. Chart series use the
  accent plus `#2f70bb` and `#a86f0c`.
- **Typography:** IBM Plex Sans (400, 500, 600) for all UI text. IBM Plex
  Mono has one job: game figures, daily stamp, share ticket, and the export
  card's numeric stats. KPI values at 400 weight; the 500 weight goes on
  labels and the active tab.
- **Globe motif:** the brand mark is a single-stroke SVG globe. It rotates
  40deg on wordmark hover. The export card carries a stamped globe in its
  header — two concentric rings at 44% scale — as the maker's mark.
- **Shape:** the sheet corner is 16px. Controls use 6px. The export card has
  a clipped corner (18px three corners, 6px bottom right) so it reads as a
  printed field note. No box-shadow rings on selected states; segmented
  radios and swatch chips use `outline` instead.
- **Surfaces:** the sheet is white. The play well in the daily game uses the
  raised tone (`--raised #f3f7f8`). The KPI strip and clue board are white
  panels with hairline borders.

## Composition and motion

The wrapped form leads with the two choices that define a profile — source
and media type — as segmented radio groups. Personalization (palette, content
toggles) stays in a disclosure so the profile remains the main action. The
preview sits beside the form on wide screens (form ~380px, preview sticky)
and below it on phones; a finished card gets room to read and export.

The guessing page pairs the clue route (left) with the play well (right).
Score, streak, and clues shown stay together in a divided KPI strip above
both. The route of stamps uses an 8px dot: hollow while locked, filled
accent when revealed, current row gets an accent halo via nested flat tint
(no shadow). The rail between stamps is dashed while closed, a walked line
once revealed. Scoring rules legend fills the play well bottom.

**Screen questions and signatures:** Wrapped asks which public list to turn
into a shareable card; the real profile card is the answer. Guess asks which
catalog title matches the revealed facts; the stamp route carries that
answer. The accent keeps the globe's ocean color on active routes and
actions. The frame tint is sea-mist from that hue. A compact two-tool
sidebar suits the desktop app; a native navigation dialog keeps the same
choices reachable on phones.

**Dials:** ENERGY 2 / RHYTHM 2 / MOTION 1. Pages are calm. No entrance
animation. The only motion is feedback: the score flash when it drops (480ms
ease-out), hover and active transitions, focus outlines. Reduced-motion
preferences remove all transitions and animations.

## Product structure

- The shell owns site identity, route navigation, and the shared footer.
- `src/domain/media.js` holds the anime and manga labels shared by tools and
  data adapters.
- `src/providers/` translates AniList and Jikan-Edge responses to the profile
  shape consumed by tools.
- `src/tools/` contains route-level features. A new tracker or personal-list
  feature belongs in its own tool module, not in Wrapped or Guess.
- Profile requests stay on demand. Only display preferences and game progress
  belong in this browser's storage.

## Component rules

- The same wrap options work for anime and manga. Only show facts returned
  by the selected source. Omit a section when a source has no data for it.
- Let readers choose the card palette (atlas, coast, night) and which
  available sections to include. The PNG and copied summary follow those
  selections.
- Anime Guess and Manga Guess share score and clue mechanics, but load clues
  from their own catalog records and keep separate daily progress.
- Footer links point only to existing tools and the data providers used by
  these features. AniGlobe is an independent project.
- Every control works with mouse, touch, and keyboard. Keep visible focus,
  clear status messages, and useful loading, empty, and error states.
- Reflow forms, cards, and navigation to fit small screens and browser zoom.
- The wrap card stays typography-only (export.js warns cross-origin images
  taint the canvas). The PNG background reads `--card-bg` from the card
  element.

## Change review

Before adding another tool, identify its data source, normalized profile or
record shape, storage needs, and route. Keep providers independent from
presentation. Do not add a future tracker, list manager, or database viewer
to the navigation until that feature exists.

## Design system reference

- **Style name:** Framed sheet
- **Seed:** 1013757307
- **Face:** frame tinted from product hue (sea-mist `#eef4f5`), sheet white,
  accent `#1b6c80`
- **Signature elements:** route-of-stamps clue board (dashed rail, accent
  halo on current), clipped-corner export card with three stereo palettes
  (atlas `#eef7f6`, coast `#e8f1f8`, night `#17303a`), stamped globe
  pseudo-rings
- **Sample/placeholder data:** daily puzzles from MyAnimeList catalog
  (Gintama, etc.), wrapped profile from public MAL/AniList username
- **Delivery gate:** Lint 0 FAIL 0 WARN; Inspect clean at 1440/768/390;
  click-through verified (wrong guess, score flash, give-up lose tone,
  segmented radios, swatches, mobile Escape, reduced motion)