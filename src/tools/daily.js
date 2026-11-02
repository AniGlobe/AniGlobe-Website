/**
 * Daily anime guesser.
 *
 * Five clues, revealed one at a time. Wrong guesses cost points, and the same
 * puzzle is selected from one MyAnimeList page on demand and cached for the day.
 */

import { el, render, store, copyText, dateKey, dayIndex, setStatus } from '../lib.js';
import { fetchDailyPuzzle } from '../providers/mal.js';
import { site } from '../config.js';

const STYLE_ID = 'tool-daily-styles';
const KEY_LAST_DATE = 'daily:last-date';
const KEY_LAST_INDEX = 'daily:last-index';
const KEY_STREAK = 'daily:streak';
const KEY_RESULT = 'daily:result';
const KEY_PUZZLE = 'daily:puzzle';

const CLUE_LABELS = ['Year', 'Studio', 'Format', 'Genres', 'Hook'];
const MAX_CLUES = CLUE_LABELS.length;
const START_SCORE = 500;
const PENALTY = 60;
const FLOOR = 50;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('../../assets/tool-daily.css', import.meta.url).href;
  document.head.append(link);
}

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function scoreFor(cluesShown, wrongGuesses) {
  return Math.max(FLOOR, START_SCORE - (cluesShown - 1) * PENALTY - wrongGuesses * PENALTY);
}

function matches(puzzle, guess) {
  const target = normalise(guess);
  return Boolean(target) && puzzle.answers.some((answer) => normalise(answer) === target);
}

function isValidPuzzle(puzzle) {
  return Boolean(
    puzzle &&
      Array.isArray(puzzle.answers) &&
      puzzle.answers.some((answer) => typeof answer === 'string' && answer.trim()) &&
      Number.isInteger(puzzle.year) &&
      typeof puzzle.studio === 'string' &&
      typeof puzzle.format === 'string' &&
      Array.isArray(puzzle.genres) &&
      puzzle.genres.length > 0 &&
      typeof puzzle.hook === 'string' &&
      puzzle.hook.trim()
  );
}

function clueValue(puzzle, index) {
  switch (index) {
    case 0:
      return String(puzzle.year);
    case 1:
      return puzzle.studio;
    case 2:
      return puzzle.format;
    case 3:
      return puzzle.genres.join(', ');
    default:
      return puzzle.hook;
  }
}

function gridFor(cluesShown) {
  return Array.from({ length: MAX_CLUES }, (_, index) =>
    index < cluesShown ? '\u25A0' : '\u25A1'
  ).join('');
}

function shareText(number, cluesShown, guesses, score, won) {
  return [
    site.name + ' daily #' + number,
    gridFor(cluesShown),
    won
      ? cluesShown +
        (cluesShown === 1 ? ' clue' : ' clues') +
        ', ' +
        guesses +
        (guesses === 1 ? ' guess' : ' guesses') +
        ', ' +
        score +
        ' pts'
      : 'Not today. ' + cluesShown + ' clues, ' + guesses + ' guesses',
  ].join('\n');
}

function restoredResult(value, today) {
  if (!value || value.date !== today || !Number.isInteger(value.cluesShown)) return null;
  if (!Array.isArray(value.wrongGuesses) || typeof value.finished !== 'boolean') return null;

  return {
    cluesShown: Math.min(MAX_CLUES, Math.max(1, value.cluesShown)),
    wrongGuesses: value.wrongGuesses.filter((guess) => typeof guess === 'string'),
    finished: value.finished,
    won: value.finished && value.won === true,
  };
}

export default {
  id: 'daily',
  title: 'Anime Guess',
  blurb: 'Five clues, one title. Reveal only what you need.',

  async mount(root) {
    injectStyles();

    const head = el(
      'div',
      { class: 'tool-head' },
      el('h1', {}, 'Anime Guess'),
      el('p', {}, 'Five clues, one title. Reveal only what you need.')
    );
    const body = el('section', { class: 'panel', 'aria-label': 'Daily anime guessing game' });
    render(
      root,
      head,
      body
    );
    render(
      body,
      el('p', { class: 'daily-loading', role: 'status', 'aria-live': 'polite' },       'Loading today’s puzzle from MyAnimeList...')
    );

    const today = dateKey();
    const index = dayIndex();
    let puzzle;

    const cachedPuzzle = store.get(KEY_PUZZLE, null);
    if (cachedPuzzle && cachedPuzzle.date === today && isValidPuzzle(cachedPuzzle.puzzle)) {
      puzzle = cachedPuzzle.puzzle;
    } else {
      try {
        puzzle = await fetchDailyPuzzle(today);
      } catch (error) {
        render(
          body,
          el(
            'div',
            { class: 'daily-empty', role: 'alert' },
            error && error.message
              ? error.message
              : 'Could not load today’s puzzle from MyAnimeList. Check your connection and try again.'
          )
        );
        return;
      }

      store.set(KEY_PUZZLE, { date: today, puzzle });
    }

    const number = parseInt(today.split('-').join(''), 10);
    const savedResult = restoredResult(store.get(KEY_RESULT, null), today);

    let cluesShown = savedResult ? savedResult.cluesShown : 1;
    let wrongGuesses = savedResult ? savedResult.wrongGuesses : [];
    let finished = savedResult ? savedResult.finished : false;
    let won = savedResult ? savedResult.won : false;
    let streak = Number(store.get(KEY_STREAK, 0)) || 0;
    const lastDate = store.get(KEY_LAST_DATE, '');
    const lastIndex = Number(store.get(KEY_LAST_INDEX, -1));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastDate !== today && (lastDate !== dateKey(yesterday) || lastIndex !== index - 1)) {
      streak = 0;
    }

    const meter = el('div', { class: 'daily-meter', 'aria-live': 'polite' });
    const clueList = el('ol', { class: 'daily-clues', 'aria-label': 'Puzzle clues' });
    const guessRow = el('div', { class: 'daily-guesses', 'aria-label': 'Incorrect guesses' });
    const status = el('div', {
      class: 'status',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    const resultBox = el('section', { class: 'daily-result', hidden: true, 'aria-live': 'polite' });
    const input = el('input', {
      type: 'text',
      id: 'daily-guess',
      name: 'guess',
      placeholder: 'Type an anime title',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      required: true,
      'aria-describedby': 'daily-hint',
    });
    const submit = el('button', { class: 'btn', type: 'submit' }, 'Guess');
    const revealButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Next clue');
    const giveUpButton = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Reveal answer');
    const form = el(
      'form',
      { novalidate: true },
      el(
        'div',
        { class: 'field' },
        el('label', { for: 'daily-guess' }, 'Your guess'),
        el('div', { class: 'input-row' }, input, submit),
        el('p', { class: 'hint', id: 'daily-hint' }, 'Titles can be entered in English or romaji.')
      ),
      status
    );
    const actions = el(
      'div',
      { class: 'daily-actions' },
      revealButton,
      giveUpButton
    );
    render(body, meter, clueList, guessRow, actions, form, resultBox);

    function currentScore() {
      return scoreFor(cluesShown, wrongGuesses.length);
    }

    function saveProgress() {
      const saved = store.set(KEY_RESULT, {
        date: today,
        cluesShown,
        wrongGuesses,
        finished,
        won,
      });

      if (finished) {
        store.set(KEY_LAST_DATE, today);
        store.set(KEY_LAST_INDEX, index);
        store.set(KEY_STREAK, streak);
      }

      return saved;
    }

    function renderMeter() {
      render(
        meter,
        el('span', {}, 'Clues ', el('strong', {}, cluesShown + '/' + MAX_CLUES)),
        el('span', {}, 'Score ', el('strong', {}, String(currentScore()))),
        el('span', {}, 'Streak ', el('strong', {}, String(streak)))
      );
    }

    function renderClues() {
      render(
        clueList,
        CLUE_LABELS.map((label, clueIndex) => {
          const shown = clueIndex < cluesShown;
          return el(
            'li',
            { class: 'daily-clue' + (shown ? '' : ' daily-clue--locked') },
            el('span', { class: 'daily-clue-label' }, label),
            el('span', { class: 'daily-clue-value' }, shown ? clueValue(puzzle, clueIndex) : 'Locked')
          );
        })
      );
    }

    function renderGuesses() {
      render(
        guessRow,
        wrongGuesses.length
          ? [
              el('span', { class: 'daily-guesses-label' }, 'Wrong guesses'),
              ...wrongGuesses.map((guess) => el('span', { class: 'daily-guess-chip' }, guess)),
            ]
          : null
      );
    }

    function renderResult() {
      resultBox.hidden = !finished;
      if (!finished) {
        render(resultBox);
        return;
      }

      const score = won ? currentScore() : 0;
      const button = el(
        'button',
        { class: 'btn btn-outline', type: 'button' },
        'Copy result'
      );
      render(
        resultBox,
        el('h2', { class: 'daily-result-title' }, won ? 'Correct' : 'The answer was ' + puzzle.answers[0]),
        el(
          'p',
          { class: 'daily-result-body' },
          won
            ? 'Solved with ' + score + ' points. Your streak is ' + streak + '.'
            : 'Come back tomorrow for another puzzle.'
        ),
        el('pre', { class: 'daily-share' }, shareText(number, cluesShown, wrongGuesses.length + (won ? 1 : 0), score, won)),
        button
      );
      button.addEventListener('click', async () => {
        const copied = await copyText(shareText(
          number,
          cluesShown,
          wrongGuesses.length + (won ? 1 : 0),
          score,
          won
        ));
        setStatus(
          status,
          copied ? 'Result copied to the clipboard.' : 'Could not copy the result. Check clipboard permissions and try again.',
          copied ? 'info' : 'error'
        );
      });
    }

    function renderGame() {
      renderMeter();
      renderClues();
      renderGuesses();
      renderResult();
      input.disabled = finished;
      submit.disabled = finished;
      revealButton.disabled = finished || cluesShown >= MAX_CLUES;
      giveUpButton.disabled = finished;
      if (cluesShown >= MAX_CLUES && !finished) revealButton.textContent = 'All clues shown';
      else revealButton.textContent = 'Next clue';
    }

    function finishRound(didWin) {
      finished = true;
      won = didWin;
      if (won) {
        streak = lastDate === dateKey(new Date(Date.now() - 86400000)) && lastIndex === index - 1
          ? streak + 1
          : 1;
      } else {
        streak = 0;
      }

      const saved = saveProgress();
      renderGame();
      if (!saved) {
        setStatus(status, 'This browser could not save your result or streak.', 'warn');
      } else {
        setStatus(status, won ? 'Puzzle solved.' : 'Puzzle complete.', 'info');
      }
    }

    revealButton.addEventListener('click', () => {
      if (finished || cluesShown >= MAX_CLUES) return;
      cluesShown += 1;
      const saved = saveProgress();
      renderGame();
      setStatus(
        status,
        saved ? 'Clue ' + cluesShown + ' revealed.' : 'Clue revealed, but progress could not be saved in this browser.',
        saved ? 'info' : 'warn'
      );
    });

    giveUpButton.addEventListener('click', () => finishRound(false));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (finished) return;

      const guess = input.value.trim();
      if (!guess) {
        setStatus(status, 'Enter a title before submitting your guess.', 'error');
        input.focus();
        return;
      }

      if (matches(puzzle, guess)) {
        finishRound(true);
        return;
      }

      if (wrongGuesses.some((previous) => normalise(previous) === normalise(guess))) {
        setStatus(status, 'You already tried that title.', 'warn');
        input.select();
        return;
      }

      wrongGuesses.push(guess);
      input.value = '';
      const saved = saveProgress();
      renderGame();
      setStatus(
        status,
        saved ? 'Not that one. Try another title or reveal the next clue.' : 'Wrong guess. Progress could not be saved in this browser.',
        saved ? 'warn' : 'error'
      );
      input.focus();
    });

    renderGame();
    if (finished) {
      setStatus(status, won ? 'You already solved today’s puzzle.' : 'Today’s puzzle is complete.', 'info');
    }
  },
};
