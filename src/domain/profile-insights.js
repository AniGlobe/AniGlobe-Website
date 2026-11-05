const ANIME_ARCHETYPES = [
  {
    label: 'The Completionist',
    blurb: 'You finish what you start. Every season, every OVA, every movie.',
    test: (profile) => profile.count >= 200 && profile.distribution.length >= 7,
  },
  {
    label: 'The Genre Loyalist',
    blurb: 'One genre owns your list, and you are not sorry about it.',
    test: (profile) =>
      !profile.genresSampled &&
      profile.genres.length > 0 &&
      profile.genres[0].count > profile.count * 0.35,
  },
  {
    label: 'The Binger',
    blurb: 'Episode count dwarfs title count. You go deep, not wide.',
    test: (profile) => profile.count > 0 && profile.episodes / profile.count > 26,
  },
  {
    label: 'The Critic',
    blurb: 'Your mean score sits below average. Nothing gets a free pass.',
    test: (profile) => profile.meanScore !== null && profile.meanScore < 68,
  },
  {
    label: 'The Enthusiast',
    blurb: 'Your mean score sits high. You watch to enjoy, not to grade.',
    test: (profile) => profile.meanScore !== null && profile.meanScore > 78,
  },
  {
    label: 'The Contrarian',
    blurb: 'You rate things differently from the crowd, on purpose.',
    test: (profile) =>
      profile.meanScore !== null &&
      Math.abs(profile.meanScore - 72) > 6 &&
      profile.deviation !== null &&
      profile.deviation > 14,
  },
  {
    label: 'The Curator',
    blurb: 'A tight list, deliberately kept. Quality over quantity.',
    test: (profile) => profile.count > 0 && profile.count < 60,
  },
];

export function tasteProfile(profile) {
  if (profile.isSparse) {
    return {
      label: 'Still taking shape',
      blurb: 'A broader pattern will appear as this list grows.',
    };
  }

  if (profile.mediaType === 'manga') {
    const chaptersPerTitle = profile.count > 0 ? (profile.chapters || 0) / profile.count : 0;
    if (profile.count > 0 && chaptersPerTitle > 50) {
      return { label: 'The Long-Form Reader', blurb: 'You stay with a series through plenty of chapters.' };
    }
    if (profile.count > 100) {
      return { label: 'The Shelf Wanderer', blurb: 'Your manga list covers a wide stretch of stories.' };
    }
    if (profile.count > 0 && profile.count < 30) {
      return { label: 'The Selective Reader', blurb: 'A focused list leaves room for each series to stand out.' };
    }
    return { label: 'The Page Turner', blurb: 'Your reading list keeps a mix of stories in rotation.' };
  }

  const archetype = ANIME_ARCHETYPES.find((candidate) => candidate.test(profile));
  return archetype
    ? { label: archetype.label, blurb: archetype.blurb }
    : { label: 'The Explorer', blurb: 'A bit of everything. Your list has range.' };
}

export function signatureTitle(profile) {
  const candidates = Array.isArray(profile.scored)
    ? profile.scored.filter((entry) => entry.average !== null)
    : [];
  if (!candidates.length) return null;

  return candidates.reduce((best, entry) =>
    entry.score * 10 - entry.average > best.score * 10 - best.average ? entry : best
  );
}

export function contrarianIndex(profile) {
  const rows = Array.isArray(profile.scored)
    ? profile.scored.filter((entry) => entry.average !== null)
    : [];
  if (!rows.length) return null;

  const total = rows.reduce(
    (sum, entry) => sum + Math.abs(entry.score * 10 - entry.average),
    0
  );
  return Math.round(total / rows.length);
}
