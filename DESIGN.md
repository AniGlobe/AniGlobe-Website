# AniGlobe design direction

AniGlobe is a small, public-data toolkit for anime and manga fans. It turns a
list profile into a personal wrap and makes a daily guessing game from catalog
records. The site should feel like a well-kept field guide, with the warmth of
an atlas someone has actually used.

## Audience and voice

People who track anime or manga on MyAnimeList or AniList, often on a phone.
Copy stays plain, curious, and specific. It can be playful without talking
down to the reader. Do not invent profile details, ratings, usage claims, or
community activity.

## Visual language

- **Palette:** warm paper `#f3efe3` and ink `#1d3331` ground the page. Ocean
  teal `#08747a` marks the main action and active route. Clay `#a14327` is a
  rare navigation and focus accent. Each card palette uses the same dark ink
  and clear contrast.
- **Typography:** use the system sans stack. It stays readable on the devices
  this site supports and avoids loading a decorative font over profile data.
  Use tabular numerals only where values need comparison.
- **Globe motif:** latitude and longitude arcs on the wordmark and one
  game-panel marker tie the product name to navigation. They identify the
  tool, rather than filling the page with a map pattern.
- **Surfaces:** paper panels sit directly on the warm page. Use borders to
  separate controls and sections; reserve elevation for content that needs
  it. Avoid page-wide gradients, glass, glow, and decorative grids.
- **Shape:** small radii belong to inputs and buttons. A single asymmetrical
  card corner gives the wrapped summary a printed-card edge.

## Composition and motion

The wrapped form leads with the two choices that define a profile, source and
media type. Personalization stays in a disclosure so the profile remains the
main action. A finished card gets room to read and export.

The guessing page keeps the revealed clue, next action, score, and guess field
in the same reading flow. Five of the available record clues appear in a
date-seeded order, so refreshing does not reshuffle an in-progress game.

**Dials:** ENERGY 2 / RHYTHM 2 / MOTION 2. Pages are lively but not loud. A
short clue-reveal transition marks game progress; reduced-motion preferences
remove that transition. Hover, active, and focus states confirm controls.

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
