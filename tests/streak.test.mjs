import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestStreak, buildMonthCalendar, currentStreak, dayIndexToDate, summarizeProgress } from '../src/domain/streak.js';

const DAY = 86400000;
const idx = (y, m, d) => Math.floor(new Date(y, m, d).getTime() / DAY);

test('dayIndexToDate round-trips the local midnight used by dayIndex()', () => {
  const d = dayIndexToDate(idx(2026, 10, 7));
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 7);
});

test('currentStreak counts consecutive wins ending today', () => {
  const today = idx(2026, 10, 7);
  const progress = [
    { mediaType: 'anime', dayIndex: today, score: 500, won: true },
    { mediaType: 'anime', dayIndex: today - 1, score: 440, won: true },
    { mediaType: 'anime', dayIndex: today - 2, score: 0, won: false },
  ];
  assert.equal(currentStreak(progress, { todayIndex: today }), 2);
});

test('currentStreak keeps grace when today is unplayed but yesterday was won', () => {
  const today = idx(2026, 10, 7);
  const progress = [
    { mediaType: 'anime', dayIndex: today - 1, score: 500, won: true },
    { mediaType: 'anime', dayIndex: today - 2, score: 500, won: true },
  ];
  assert.equal(currentStreak(progress, { todayIndex: today }), 2);
});

test('currentStreak is 0 after a loss today', () => {
  const today = idx(2026, 10, 7);
  const progress = [
    { mediaType: 'anime', dayIndex: today, score: 0, won: false },
    { mediaType: 'anime', dayIndex: today - 1, score: 500, won: true },
  ];
  assert.equal(currentStreak(progress, { todayIndex: today }), 0);
});

test('currentStreak breaks on a missing day', () => {
  const today = idx(2026, 10, 7);
  const progress = [
    { mediaType: 'anime', dayIndex: today, score: 500, won: true },
    { mediaType: 'anime', dayIndex: today - 2, score: 500, won: true },
  ];
  assert.equal(currentStreak(progress, { todayIndex: today }), 1);
});

test('currentStreak is per-media when requested', () => {
  const today = idx(2026, 10, 7);
  const progress = [
    { mediaType: 'anime', dayIndex: today, score: 500, won: true },
    { mediaType: 'manga', dayIndex: today, score: 0, won: false },
  ];
  assert.equal(currentStreak(progress, { mediaType: 'anime', todayIndex: today }), 1);
  assert.equal(currentStreak(progress, { mediaType: 'manga', todayIndex: today }), 0);
});

test('bestStreak finds the longest run, not just the last one', () => {
  const base = idx(2026, 9, 1);
  const progress = [0, 1, 2, 5, 6].map((n) => ({ mediaType: 'anime', dayIndex: base + n, score: 500, won: true }));
  assert.equal(bestStreak(progress), 3);
  assert.equal(bestStreak([]), 0);
});

test('summarizeProgress aggregates totals and per-media streaks', () => {
  const today = idx(2026, 10, 7);
  const progress = [
    { mediaType: 'anime', dayIndex: today, score: 500, won: true },
    { mediaType: 'manga', dayIndex: today, score: 0, won: false },
    { mediaType: 'anime', dayIndex: today - 1, score: 440, won: true },
  ];
  const summary = summarizeProgress(progress, { todayIndex: today });
  assert.equal(summary.total, 3);
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 1);
  assert.equal(summary.winRate, 67);
  assert.equal(summary.byMedia.anime.total, 2);
  assert.equal(summary.byMedia.manga.total, 1);
  assert.equal(summary.recent[0].mediaType, 'anime');
  assert.equal(summary.recent[0].dayIndex, today);
});

test('summarizeProgress on empty history is all zeros', () => {
  const summary = summarizeProgress([], { todayIndex: idx(2026, 10, 7) });
  assert.equal(summary.total, 0);
  assert.equal(summary.winRate, 0);
  assert.deepEqual(summary.recent, []);
});

test('buildMonthCalendar marks won > played > empty and future days', () => {
  const today = idx(2026, 10, 7);
  const month = buildMonthCalendar(2026, 10, [
    { mediaType: 'anime', dayIndex: idx(2026, 10, 2), score: 500, won: true },
    { mediaType: 'anime', dayIndex: idx(2026, 10, 3), score: 0, won: false },
    { mediaType: 'manga', dayIndex: idx(2026, 10, 3), score: 500, won: true },
  ], { todayIndex: today });
  assert.equal(month.days.length, 30);
  assert.equal(month.days.find((d) => d.day === 2).state, 'won');
  assert.equal(month.days.find((d) => d.day === 3).state, 'won', 'a win on either media wins the day');
  assert.equal(month.days.find((d) => d.day === 4).state, 'empty');
  assert.equal(month.days.find((d) => d.day === 8).state, 'future');
  assert.equal(month.firstWeekday, new Date(2026, 10, 1).getDay());
});
