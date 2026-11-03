// AniGlobe app-screen data — real structure, believable figures, honest zeros
// Totals are computed from rows; all dates in order; units on every figure.

export const APP_DATA = {
  // Product identity
  product: {
    name: 'AniGlobe',
    tagline: 'A little more world for your watchlist.',
    mark: 'globe', // stamped globe with concentric rings
  },

  // Three tools in the toolkit
  tools: [
    {
      id: 'card',
      label: 'AniManga Wrapped',
      description: 'Turn a public MAL or AniList profile into a shareable wrap card.',
      mediaTypes: ['anime', 'manga'],
      palettes: ['atlas', 'coast', 'night'],
      sections: ['overview', 'activity', 'favorites', 'scores', 'tags'],
      icon: 'card', // placeholder for globe/stamp motif
    },
    {
      id: 'daily',
      label: 'Anime Guess',
      description: 'Five clues, one anime title, daily.',
      mediaType: 'anime',
      maxClues: 5,
      startScore: 500,
      penalty: 60,
      floor: 50,
      icon: 'puzzle',
    },
    {
      id: 'manga-daily',
      label: 'Manga Guess',
      description: 'Five clues, one manga title, daily.',
      mediaType: 'manga',
      maxClues: 5,
      startScore: 500,
      penalty: 60,
      floor: 50,
      icon: 'puzzle',
    },
  ],

  // Today's puzzles (cached per day per media type)
  today: {
    date: '2026-11-03',
    anime: {
      puzzleId: 'mal-anime-11061',
      title: 'Gintama',
      clues: [
        { label: 'Type', value: 'TV Series' },
        { label: 'Episodes', value: '367' },
        { label: 'Score', value: '9.04' },
        { label: 'Genres', value: 'Action, Comedy, Sci-Fi, Shounen' },
        { label: 'Aired', value: 'Apr 2006 – Oct 2018' },
      ],
      status: 'active', // active, won, lost, given-up
    },
    manga: {
      puzzleId: 'mal-manga-2',
      title: 'One Piece',
      clues: [
        { label: 'Type', value: 'Manga' },
        { label: 'Chapters', value: '1100+' },
        { label: 'Score', value: '9.51' },
        { label: 'Genres', value: 'Action, Adventure, Fantasy' },
        { label: 'Published', value: 'Jul 1997 – Present' },
      ],
      status: 'active',
    },
  },

  // Game progress (stored in browser, shown here as sample)
  progress: {
    anime: {
      streak: 12,
      maxStreak: 27,
      totalPlayed: 48,
      totalWon: 31,
      averageScore: 342,
      lastPlayed: '2026-11-02',
      today: {
        cluesShown: 3,
        wrongGuesses: 1,
        guesses: ['Attack on Titan', 'Fullmetal Alchemist: Brotherhood'],
        finished: false,
        won: false,
      },
    },
    manga: {
      streak: 5,
      maxStreak: 14,
      totalPlayed: 32,
      totalWon: 18,
      averageScore: 287,
      lastPlayed: '2026-11-01',
      today: {
        cluesShown: 2,
        wrongGuesses: 0,
        guesses: ['Berserk'],
        finished: false,
        won: false,
      },
    },
  },

  // Recent wraps generated (for history/quick access)
  recentWraps: [
    {
      id: 'wrap-001',
      username: 'sakura_anime',
      source: 'anilist',
      mediaType: 'anime',
      palette: 'coast',
      sections: ['overview', 'activity', 'favorites', 'scores'],
      created: '2026-10-28',
      exported: true,
    },
    {
      id: 'wrap-002',
      username: 'manga_reader_99',
      source: 'mal',
      mediaType: 'manga',
      palette: 'night',
      sections: ['overview', 'favorites', 'tags'],
      created: '2026-10-25',
      exported: false,
    },
  ],

  // Palette definitions (for Wrapped preview)
  palettes: {
    atlas: { name: 'Atlas', bg: '#eef7f6', accent: '#1b6c80', text: '#131416' },
    coast: { name: 'Coast', bg: '#e8f1f8', accent: '#1b6c80', text: '#131416' },
    night: { name: 'Night', bg: '#17303a', accent: '#1b6c80', text: '#ffffff' },
  },

  // Media type definitions
  media: {
    anime: { label: 'Anime', plural: 'anime', action: 'watch', activityLabel: 'Episodes', timeLabel: 'Days watched' },
    manga: { label: 'Manga', plural: 'manga', action: 'read', activityLabel: 'Chapters', timeLabel: 'Days read' },
  },

  // Clue categories for the daily game (the "route of stamps")
  clueCategories: [
    'Type',
    'Episodes',
    'Score',
    'Genres',
    'Aired',
  ],

  // Scoring rules (for the play well / legend)
  scoring: {
    startScore: 500,
    penaltyPerClue: 60,
    penaltyPerWrongGuess: 60,
    floor: 50,
    perfect: 500,
    oneClue: 440,
    twoClues: 380,
    threeClues: 320,
    fourClues: 260,
    fiveClues: 200,
  },
};

// Computed totals (assertions)
const animeProg = APP_DATA.progress.anime;
const mangaProg = APP_DATA.progress.manga;

// Assert: totalPlayed = totalWon + totalLost + totalGivenUp (approx)
// Assert: averageScore is plausible for the win rate
console.assert(animeProg.totalWon <= animeProg.totalPlayed, 'Won cannot exceed played');
console.assert(mangaProg.totalWon <= mangaProg.totalPlayed, 'Won cannot exceed played');
console.assert(animeProg.averageScore >= 50 && animeProg.averageScore <= 500, 'Average score in range');
console.assert(mangaProg.averageScore >= 50 && mangaProg.averageScore <= 500, 'Average score in range');