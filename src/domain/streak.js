/**
 * Pure streak + calendar helpers for synced guess progress.
 * No DOM, no storage — unit-testable in Node.
 * Input rows look like the API returns: { mediaType, dayIndex, score, won }.
 * dayIndex is whole days since the epoch (local midnight), see lib.dayIndex().
 */

const DAY_MS = 86400000;

/** Convert a dayIndex back to the local-midnight Date it was derived from.
 *  lib.dayIndex() floors (local midnight / DAY), which carries the local UTC
 *  offset, so a plain `new Date(dayIndex * DAY)` can land on the wrong local
 *  day in non-UTC zones. Search ±1 day for the local midnight that floors
 *  back to the same index. */
export function dayIndexToDate(dayIndex) {
  const utc = new Date(dayIndex * DAY_MS);
  for (const delta of [0, -1, 1]) {
    const candidate = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate() + delta);
    if (Math.floor(candidate.getTime() / DAY_MS) === dayIndex) return candidate;
  }
  return new Date(dayIndex * DAY_MS);
}

function wonIndexes(progress, mediaType = null) {
  const set = new Set();
  for (const row of progress || []) {
    if (!row || !Number.isInteger(row.dayIndex)) continue;
    if (mediaType && row.mediaType !== mediaType) continue;
    if (row.won === true) set.add(row.dayIndex);
  }
  return set;
}

function playedIndexes(progress, mediaType = null) {
  const set = new Set();
  for (const row of progress || []) {
    if (!row || !Number.isInteger(row.dayIndex)) continue;
    if (mediaType && row.mediaType !== mediaType) continue;
    set.add(row.dayIndex);
  }
  return set;
}

/**
 * Current streak: consecutive won days ending today, or yesterday if today
 * has not been played yet (same grace as daily.js local streak).
 * A loss or a missing day breaks the run.
 */
export function currentStreak(progress, { mediaType = null, todayIndex } = {}) {
  const wins = wonIndexes(progress, mediaType);
  const played = playedIndexes(progress, mediaType);
  const now = todayIndex != null ? todayIndex : Math.floor(Date.now() / DAY_MS);
  let cursor = now;
  if (!wins.has(cursor)) {
    // Allow one day of grace: streak still alive if yesterday was won and
    // today simply has not been played yet. A loss today breaks it.
    if (played.has(cursor)) return 0;
    cursor = now - 1;
    if (!wins.has(cursor)) return 0;
  }
  let streak = 0;
  while (wins.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

/** Longest consecutive won run anywhere in the history. */
export function bestStreak(progress, { mediaType = null } = {}) {
  const wins = [...wonIndexes(progress, mediaType)].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const idx of wins) {
    run = prev !== null && idx === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = idx;
  }
  return best;
}

/** Aggregate totals for the account-page summary cards. */
export function summarizeProgress(progress, { todayIndex } = {}) {
  const rows = (progress || []).filter((r) => r && Number.isInteger(r && r.dayIndex));
  const wins = rows.filter((r) => r.won === true).length;
  const byMedia = {};
  for (const mediaType of ['anime', 'manga']) {
    const mediaRows = rows.filter((r) => r.mediaType === mediaType);
    byMedia[mediaType] = {
      total: mediaRows.length,
      wins: mediaRows.filter((r) => r.won === true).length,
      currentStreak: currentStreak(rows, { mediaType, todayIndex }),
      bestStreak: bestStreak(rows, { mediaType }),
    };
  }
  return {
    total: rows.length,
    wins,
    losses: rows.length - wins,
    winRate: rows.length ? Math.round((wins / rows.length) * 100) : 0,
    currentStreak: currentStreak(rows, { todayIndex }),
    bestStreak: bestStreak(rows),
    byMedia,
    recent: [...rows].sort((a, b) => b.dayIndex - a.dayIndex),
  };
}

/**
 * Build one month's calendar cells for the account page.
 * Returns { year, month, firstWeekday (0=Sun), days: [{ day, dayIndex, state }] }
 * where state is 'won' | 'played' | 'future' | 'empty'.
 * If a day has both anime and manga entries, a win wins.
 */
export function buildMonthCalendar(year, month, progress, { todayIndex } = {}) {
  const rows = progress || [];
  const byDay = new Map();
  for (const row of rows) {
    if (!row || !Number.isInteger(row.dayIndex)) continue;
    const prev = byDay.get(row.dayIndex);
    if (!prev) byDay.set(row.dayIndex, { won: row.won === true, entries: [row] });
    else {
      prev.won = prev.won || row.won === true;
      prev.entries.push(row);
    }
  }
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const nowIndex = todayIndex != null ? todayIndex : Math.floor(Date.now() / DAY_MS);
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const idx = Math.floor(date.getTime() / DAY_MS);
    const hit = byDay.get(idx);
    let state = 'empty';
    if (idx > nowIndex) state = 'future';
    else if (hit) state = hit.won ? 'won' : 'played';
    days.push({ day, dayIndex: idx, weekday: date.getDay(), state, entries: hit ? hit.entries : [] });
  }
  return { year, month, firstWeekday, daysInMonth, days };
}
