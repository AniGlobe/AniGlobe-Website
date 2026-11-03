# AniGlobe design direction

AniGlobe is a small, public-data toolkit for anime and manga fans. It turns a
list profile into a personal wrap and makes a daily guessing game from catalog
records. The interface should feel like a lively ocean atlas: clear enough for
profile data, with a little movement and discovery in the games.

## Audience and voice

People who track anime or manga on MyAnimeList or AniList, often on a phone.
Copy stays plain, curious, and specific. It can be playful without talking
down to the reader. Do not invent profile details, ratings, usage claims, or
community activity.

## Visual language

- **Palette:** cool sea-glass `#edf6f6`, deep marine ink `#153441`, and ocean
  teal `#087b84` set the base. Teal marks active routes, the main action, and
  the current clue; its pale tint carries selected surfaces. Error and warning
  colors only communicate those states.
- **Typography:** DM Sans gives the interface a rounded, readable voice. Use
  tabular numerals where values need comparison.
- **Globe motif:** the wordmark's latitude and longitude, the wrap preview, and
  the revealed-clue path connect the tools to an atlas. They carry navigation
  or game state, rather than filling the page with a map pattern.
- **Surfaces:** white work surfaces sit on the cool page ground. Use quiet
  borders to separate controls and sections; reserve elevation for content
  that needs it. Avoid page-wide gradients, glass, glow, and decorative grids.
- **Shape:** rounded controls keep touch targets friendly. The wrap card keeps
  one clipped corner so it reads like a printed field note.

## Composition and motion

The wrapped form leads with the two choices that define a profile, source and
media type. Personalization stays in a disclosure so the profile remains the
main action. The preview sits beside the form on wide screens and below it on
phones; a finished card gets room to read and export.

The guessing page pairs the clue path with the guess field. Score, streak, and
clues stay together; each reveal marks the current point in the route. Five
available record clues appear in a date-seeded order, so refreshing does not
reshuffle an in-progress game.

**Screen questions and signatures:** Wrapped asks which public list to turn
into a shareable card; the real profile card is the answer. Guess asks which
catalog title matches the revealed facts; the clue path carries that answer.
The teal ladder keeps the globe's ocean color on active routes and actions,
while the pale tint marks the current clue. DM Sans keeps profile details
readable without making the data feel like a report. A compact three-tool
sidebar suits the desktop app; a native navigation dialog keeps the same
choices reachable on phones.

**Dials:** ENERGY 2 / RHYTHM 2 / MOTION 2. Pages are lively but not loud. A
short transition marks the newly revealed clue; reduced-motion preferences
remove that movement. Hover, active, and focus states confirm controls. The
main landmark uses a thin teal top rule on keyboard focus, so readers can find
the content without framing the entire work area.

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

- The same wrap options work for anime and manga. Only show facts returned by
  the selected source. Omit a section when a source has no data for it.
- Let readers choose the card palette and which available sections to include.
  The PNG and copied summary follow those selections.
- Anime Guess and Manga Guess share score and clue mechanics, but load clues
  from their own catalog records and keep separate daily progress.
- Footer links point only to existing tools and the data providers used by
  these features. AniGlobe is an independent project.
- Every control works with mouse, touch, and keyboard. Keep visible focus,
  clear status messages, and useful loading, empty, and error states.
- Reflow forms, cards, and navigation to fit small screens and browser zoom.

## Change review

Before adding another tool, identify its data source, normalized profile or
record shape, storage needs, and route. Keep providers independent from
presentation. Do not add a future tracker, list manager, or database viewer to
the navigation until that feature exists.
