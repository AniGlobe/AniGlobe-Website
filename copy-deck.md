# AniGlobe — Copy Deck

## Argument (one claim per section)

1. **Intro**: AniGlobe turns your public anime/manga list into a beautiful, shareable wrap card and a daily title-guessing game — no account, no tracking, just your public profile.

2. **Features (Wrapped)**: Enter any public MyAnimeList or AniList username, pick anime or manga, choose a palette, toggle sections — see your personal wrapped card generate live.

3. **Features (Guess)**: A new anime or manga puzzle every day. Five clues, one title. Wrong guesses cost points. Streak tracked locally.

4. **How it works**: First, enter a username. Then pick your media and palette. Then export as PNG or copy the summary.

5. **Footer**: AniGlobe — independent, privacy-first, built on public APIs.

---

## Hero

**Headline** (two lines, ~5 words each):
AniGlobe
Your anime world, wrapped.

**Supporting sentence** (max 40ch):
Turn any public profile into a shareable wrap card, then play the daily title-guessing game.

**Primary action**:
Try your wrap →

---

## Intro (narrow column, 4–5 paragraphs)

**Para 1 (medium weight, full ink)**:
Your watchlist tells a story. AniGlobe helps you tell it.

**Para 2**:
Paste a public MyAnimeList or AniList username. Choose anime or manga. Pick a palette. Get a beautiful, personalised wrap card in seconds — ready to share, save, or keep.

**Para 3**:
Every day, a new puzzle. Five clues hide one anime or manga title. Reveal only what you need. Fewer clues mean a higher score. Keep your streak alive.

**Para 4**:
No accounts. No tracking. Only public data you already share. The card renders in your browser; nothing leaves your machine unless you export it.

**Para 5 (with link)**:
Open source, independent, and made by fans. [See the code on GitHub →](#)

---

## Features — Wrapped (pinned output, live controls)

**Section heading**: Your wrap, your way

**Block 1**:
**Sentence**: Choose the list that powers your card.
**Paragraph**: MyAnimeList and AniList both supported. The card adapts to each source's data.
**Control**: Segmented choice — MyAnimeList / AniList (live, changes placeholder and limits)

**Block 2**:
**Sentence**: Pick anime or manga — or make both.
**Paragraph**: Separate wraps for each medium. Different stats, different palette, same globe.
**Control**: Segmented choice — Anime / Manga (live, changes submit button text)

**Block 3**:
**Sentence**: Three palettes. One clipped corner.
**Paragraph**: Sea glass, open water, night map. Each recolours the entire card — background, bars, accents, text.
**Control**: Three swatch chips — Sea glass / Open water / Night map (live, recolours pinned card)

**Block 4**:
**Sentence**: Toggle what appears. Export what you need.
**Paragraph**: Genre map, favourites, top scored, taste notes. All optional.
**Control**: Four checkboxes — Genre map / Favourite titles / Highest-rated / Taste notes (live, updates pinned card)

**Block 5**:
**Sentence**: One click. PNG or plain text.
**Paragraph**: The card saves as a crisp 2× PNG with the correct background. The summary copies as clean text.
**Control**: Two buttons — Copy summary / Save as PNG (disabled on sample, active on real card)

---

## Features — Guess (pinned output, live controls)

**Section heading**: Daily puzzle, daily streak

**Block 1**:
**Sentence**: Five clues. One title. You decide when to guess.
**Paragraph**: Each clue costs 60 points. Start at 500. Floor is 50. Wrong guesses cost the same.
**Control**: Sample clue board — five rows, first revealed, rest locked (static display)

**Block 2**:
**Sentence**: Your guess. Instant feedback.
**Paragraph**: Type in English or romaji. Matches are fuzzy — close counts.
**Control**: Input field with placeholder "Type an anime title" (live, shows chip on wrong guess)

**Block 3**:
**Sentence**: Streak lives in your browser. No server knows.
**Paragraph**: Solve today, come back tomorrow. Miss a day, streak resets.
**Control**: KPI strip — Score / Clues / Streak (live numbers)

---

## How it works (call and response)

**Section heading**: Three steps to your wrap

**Exchange 1**:
**Call**: First, enter a public username.
**Response**: [Input fragment] "username123" — MyAnimeList · Anime · 32 chars max

**Exchange 2**:
**Sentence**: Then pick your look.
**Call**: Then choose media, palette, and sections.
**Response**: [Card fragment] Live wrapped card updating as controls change — Sea glass palette, genres on, favourites off

**Exchange 3**:
**Sentence**: Then share it.
**Call**: Export as PNG or copy the summary.
**Response**: [Finished card fragment] Full 440px card with clipped corner, stamped globe, four stat columns, genre bars, title rows, footer mark — ready to save

---

## Footer (single quiet line)

AniGlobe — Independent anime & manga tools · [GitHub] [Privacy] · © 2026

---

## Idea Sentence

> On this page, **the AniManga Wrapped card generator** becomes **the live fragment on a shaped stage**.

**Competitor test**: "On this page, the MyAnimeList profile card becomes the live fragment" — fails. MAL doesn't generate shareable wrapped cards.

**One live thing**: Visitor interacts with the palette/theme controls on a sample wrapped card in the hero, seeing it recolour instantly. On the Features section, they enter their own username and generate their real card.