/**
 * Daily anime guesser.
 *
 * Five clues, revealed one at a time. A correct guess ends the round, a wrong
 * guess costs points and reveals nothing for free. Score starts at 500 and
 * drops 60 for each extra clue and each wrong guess, with a floor of 50.
 *
 * The puzzle bank is a static file generated ahead of time by
 * scripts/generate-puzzles.mjs, so there is no server, no database and no cron.
 * The puzzle for today is chosen by day-of-epoch, which means the same puzzle
 * for everyone on the same calendar day.
 */

import { el, render, store, copyText, loadData, dateKey, dayIndex, setStatus } from '../lib.js';
import { site } from '../config.js';

const STYLE_ID = 'tool-daily-styles';
const KEY_LAST_DATE = 'daily:last-date';
const KEY_LAST_INDEX = 'daily:last-index';
const KEY_STREAK = 'daily:streak';
const KEY_RESULT = 'daily:result';

const CLUE_LABELS = ['Year', 'Studio', 'Director', 'Genres', 'Hook'];
const MAX_CLUES = CLUE_LABELS.length;
const START_SCORE = 500;
const PENALTY = 60;
const FLOOR = 50;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../assets/tool-daily.css', import.meta.url).href;
  link.dataset.dailyStyle = 'true';
  document.head.append(link);
  const marker = document.createElement('meta');
  marker.id = STYLE_ID;
  document.head.append(marker);
}

/** Lowercase, strip everything that is not a letter or digit. */
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

function scoreFor(cluesShown, wrongGuesses) {
  const raw = START_SCORE - (cluesShown - 1) * PENALTY - wrongGuesses * PENALTY;
  return Math.max(FLOOR, raw);
}

function matches(puzzle, guess) {
  const target = normalise(guess);
  if (!target) return false;
  return puzzle.answers.some((answer) => normalise(answer) === target);
}

function clueValue(puzzle, index) {
  switch (index) {
    case 0:
      return String(puzzle.year);
    case 1:
      return puzzle.studio;
    case 2:
      return puzzle.director;
    case 3:
      return puzzle.genres.join(', ');
    default:
      return puzzle.hook;
  }
}

/** Grid showing how many clues were needed. Functional, not decorative. */
function gridFor(cluesShown) {
  let out = '';
  for (let i = 0; i < MAX_CLUES; i += 1) {
    out += i < cluesShown ? '\u25A0' : '\u25A1';
  }
  return out;
}

function buildShareText(number, cluesShown, guesses, score, won) {
  const lines = [];
  lines.push(site.name + ' daily #' + number);
  lines.push(gridFor(cluesShown));
  lines.push(
    won
      ? cluesShown + (cluesShown === 1 ? ' clue' : ' clues') +
          ', ' + guesses + (guesses === 1 ? ' guess' : ' guesses') +
          ', ' + score + ' pts'
      : 'Not today. ' + cluesShown + ' clues, ' + guesses + ' guesses'
  );
  return lines.join('\n');
}

export default {
  id: 'daily',
  title: 'Guess the anime of the day',
  blurb:
    'Five clues, one title. Reveal only what you need. Come back tomorrow for a new one.',

  async mount(root) {
    injectStyles();

    const head = el(
      'div',
      { class: 'tool-head' },
      el('h1', {}, 'Guess the anime of the day'),
      el('p', {}, 'Five clues, one title. Reveal only what you need. Come back tomorrow for a new one.')
    );

    const body = el('div', { class: 'panel' });
    render(root, head, body);

    let bank;
    try {
      bank = await loadData('puzzles.json');
    } catch (error) {
      render(
        body,
        el('div', { class: 'daily-empty' }, 'Could not load today\u2019s puzzle bank. Reload the page.')
      );
      return;
    }

    const puzzles = (bank && bank.puzzles) || [];
    if (!puzzles.length) {
      render(
        body,
        el(
          'div',
          { class: 'daily-empty' },
          'The puzzle bank is empty. Run scripts/generate-puzzles.mjs to build it.'
        )
      );
      return;
    }

    const today = dateKey();
    const index = dayIndex();
    const puzzle = puzzles[index % puzzles.length];
    const number = index;

    const streakStored = store.get(KEY_STREAK, 0);
    const playedDate = store.get(KEY_LAST_DATE, '');
    const alreadyPlayed = playedDate === today;

    // Restored state lets a returning visitor see their result instead of a
    // reset board, which is the difference between a streak and a guess.
    const restored = alreadyPlayed ? store.get(KEY_RESULT, null) : null;

    let cluesShown = restored ? restored.cluesShown : 1;
    let wrongGuesses = restored ? restored.wrongGuesses : [];
    let finished = restored ? restored.finished : false;
    let won = restored ? restored.won : false;
    let streak = streakStored;

    const clueList = el('ul', { class: 'daily-clues' });
    const meter = el('div', { class: 'daily-meter' });
    const guessRow = el('div', { class: 'daily-guesses' });
    const resultBox = el('div', { class: 'daily-result' });
    const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });

    const input = el('input', {
      type: 'text',
      id: 'daily-guess',
      placeholder: 'type the anime title',
      autocomplete: 'off',
      spellcheck: 'false',
    });

    const submit = el('button', { class: 'btn', type: 'submit' }, 'Guess');
    const revealBtn = el('button', { class: 'btn btn-outline', type: 'button' }, 'Next clue');

    const form = el(
      'form',
      { novalidate: true },
      el(
        'div',
        { class: 'field' },
        el('label', { for: 'daily-guess' }, 'Your guess'),
        el('div', { class: 'input-row' }, input, submit)
      ),
      status
    );

    render(
      body,
      meter,
      clueList,
      guessRow,
      el('div', { class: 'daily-actions' }, revealBtn),
      form,
      resultBox
    );

    function currentScore() {
      return scoreFor(cluesShown, wrongGuesses.length);
    }

    function renderClues() {
      render(
        clueList,
        CLUE_LABELS.map((label, i) => {
          const shown = i < cluesShown;
          return el(
            'li',
            { class: 'daily-clue' + (shown ? '' : ' daily-clue--locked') },
            el('span', { class: 'daily-clue-label' }, label),
            el(
              'span',
              { class: 'daily-clue-value' },
              shown ? clueValue(puzzle, i) : 'hidden'
            )
          );
        })
      );
    }

    function renderMeter() {
      render(
        meter,
        el('
