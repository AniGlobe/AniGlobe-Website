/**
 * Daily anime and manga guessing games.
 *
 * Five clues, revealed one at a time. Wrong guesses cost points, and the same
 * puzzle is selected from one MyAnimeList page on demand and cached for the day.
 */

import { el, render, store, copyText, dateKey, dayIndex, hashString, setStatus } from '../lib.js';
import { fetchDailyPuzzle } from '../providers/mal.js';
import { getSession, pullGuessProgress, pushGuessProgress } from '../auth.js';
import { site } from '../config.js';
import { resolveMediaType } from '../domain/media.js';
import { currentStreak } from '../domain/streak.js';

const MAX_CLUES = 5;
const START_SCORE = 500;
const PENALTY = 60;
const FLOOR = 50;

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

function isValidPuzzle(puzzle, mediaType) {
  return Boolean(
    puzzle &&
      puzzle.mediaType === mediaType &&
      Array.isArray(puzzle.answers) &&
      puzzle.answers.some((answer) => typeof answer === 'string' && answer.trim()) &&
      Array.isArray(puzzle.clues) &&
      puzzle.clues.length >= MAX_CLUES &&
      puzzle.clues.every((clue) =>
        clue && typeof clue.label === 'string' && clue.label.trim() &&
        typeof clue.value === 'string' && clue.value.trim()
      )
  );
}

function clueOrder(puzzle, today, mediaType) {
  const order = Array.from({ length: puzzle.clues.length }, (_, index) => index);
  let seed = hashString(today + ':' + mediaType + ':' + puzzle.id);
  for (let index = order.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swap = seed % (index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order.slice(0, MAX_CLUES);
}

function gridFor(cluesShown) {
  return Array.from({ length: MAX_CLUES }, (_, index) =>
    index < cluesShown ? '\u25A0' : '\u25A1'
  ).join('');
}

function shareText(number, cluesShown, guesses, score, won, mediaLabel) {
  return [
    site.name + ' ' + mediaLabel + ' daily #' + number,
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

function restoredResult(value, today, puzzle) {
  if (!value || value.date !== today || value.puzzleId !== puzzle.id || !Number.isInteger(value.cluesShown)) {
    return null;
  }
  if (!Array.isArray(value.wrongGuesses) || typeof value.finished !== 'boolean') return null;
  if (
    !Array.isArray(value.order) ||
    value.order.length !== MAX_CLUES ||
    new Set(value.order).size !== MAX_CLUES ||
    value.order.some((index) => !Number.isInteger(index) || index < 0 || index >= puzzle.clues.length)
  ) {
    return null;
  }

  return {
    cluesShown: Math.min(MAX_CLUES, Math.max(1, value.cluesShown)),
    wrongGuesses: value.wrongGuesses.filter((guess) => typeof guess === 'string'),
    finished: value.finished,
    won: value.finished && value.won === true,
    order: value.order,
  };
}

export default {
  id: 'daily',
  title: 'Anime Guess',
  blurb: 'Five clues, one title. Reveal only what you need.',

  async mount(root, tool = {}) {
    const media = resolveMediaType(tool.mediaType);
    const storageKey = (name) => 'daily:' + name + ':v4:' + media.id;
    const puzzleKey = 'daily:puzzle:v4:' + media.id;

    let lastScore = null;

    const head = el(
      'div',
      { class: 'tool-head daily-head' },
      el('h1', {}, media.label + ' Guess'),
      el('p', {}, 'Five clues hide one title. Every extra clue costs 60 points.')
    );
    const body = el('section', { class: 'daily-panel', 'aria-label': 'Daily ' + media.label.toLowerCase() + ' guessing game' });
    render(
      root,
      head,
      body
    );
    render(
      body,
      el('p', { class: 'daily-loading', role: 'status', 'aria-live': 'polite' }, 'Loading today’s ' + media.label.toLowerCase() + ' puzzle from MyAnimeList...')
    );

    const today = dateKey();
    const index = dayIndex();
    let puzzle;

    const cachedPuzzle = store.get(puzzleKey, null);
    if (cachedPuzzle && cachedPuzzle.date === today && isValidPuzzle(cachedPuzzle.puzzle, media.id)) {
      puzzle = cachedPuzzle.puzzle;
    } else {
      try {
        puzzle = await fetchDailyPuzzle(today, media.id);
      } catch (error) {
        const message = error && error.message
          ? error.message
          : 'Could not load today’s ' + media.label.toLowerCase() + ' puzzle from MyAnimeList. Check your connection and try again.';
        const retry = el('button', { class: 'btn btn-outline', type: 'button' }, 'Try again');
        render(
          body,
          el('div', { class: 'daily-empty', role: 'alert' }, el('p', {}, message), retry)
        );
        retry.focus();
        retry.addEventListener('click', () => {
          const mountCtx = root;
          // Re-mount this tool in place — same as a hashchange remount,
          // without losing scroll position or the cached order.
          const entry = { id: 'daily', label: media.label + ' Guess', mediaType: media.id };
          const modPromise = import('./daily.js');
          modPromise.then((mod) => mod.default.mount(mountCtx, entry)).catch(() => {
            render(body, el('div', { class: 'daily-empty', role: 'alert' }, el('p', {}, 'Could not reload the puzzle. Try again in a moment.')));
          });
        });
        return;
      }

      store.set(puzzleKey, { date: today, puzzle });
    }

    const number = parseInt(today.split('-').join(''), 10);

    // The puzzle's day index sits beside the title once it exists: the stamp
    // that ties the game to one date is stale for the cached case, so both
    // paths set it after the puzzle is known.
    const stamp = el('div', { class: 'tool-stamp num' }, 'Daily #' + number);
    head.insertBefore(stamp, head.querySelector('p'));

    const savedResult = restoredResult(store.get(storageKey('result'), null), today, puzzle);
    const order = savedResult ? savedResult.order : clueOrder(puzzle, today, media.id);

    let cluesShown = savedResult ? savedResult.cluesShown : 1;
    let wrongGuesses = savedResult ? savedResult.wrongGuesses : [];
    let finished = savedResult ? savedResult.finished : false;
    let won = savedResult ? savedResult.won : false;
    let streak = Number(store.get(storageKey('streak'), 0)) || 0;
    let lastDate = store.get(storageKey('last-date'), '');
    let lastIndex = Number(store.get(storageKey('last-index'), -1));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastDate !== today && (lastDate !== dateKey(yesterday) || lastIndex !== index - 1)) {
      streak = 0;
    }
    // Reconcile with server history when signed in: another device may have
    // extended the streak while this browser was away. The server is the
    // shared truth; the local value only wins if it is simply ahead.
    if (getSession()) {
      pullGuessProgress(media.id)
        .then((rows) => {
          const serverStreak = currentStreak(rows, { mediaType: media.id, todayIndex: index });
          if (serverStreak > streak) {
            streak = serverStreak;
            store.set(storageKey('streak'), streak);
            // Keep the finishRound() guard in sync, or a win today would
            // wrongly reset the just-synced streak to 1.
            const wonRows = rows.filter((r) => r.mediaType === media.id && r.won === true);
            if (wonRows.length) {
              const latest = wonRows.reduce((a, b) => (b.dayIndex > a.dayIndex ? b : a));
              const latestDate = new Date(latest.dayIndex * 86400000);
              lastDate = dateKey(new Date(latestDate.getFullYear(), latestDate.getMonth(), latestDate.getDate()));
              lastIndex = latest.dayIndex;
              store.set(storageKey('last-date'), lastDate);
              store.set(storageKey('last-index'), lastIndex);
            }
            renderMeter();
          }
        })
        .catch(() => {
          /* offline: keep the local streak */
        });
    }

    const meter = el('div', { class: 'daily-meter kpis', 'aria-live': 'polite' });
    const clueList = el('ol', { class: 'daily-clues', 'aria-label': 'Puzzle clues' });
    const guesses = el('div', { class: 'daily-guesses', 'aria-label': 'Incorrect guesses' });
    const board = el(
      'section',
      { class: 'daily-board' },
      el('h2', { class: 'daily-board-title' }, 'From the record'),
      clueList,
      guesses
    );
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
      placeholder: 'Type a ' + media.label.toLowerCase() + ' title',
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
      { class: 'daily-form', novalidate: true },
      el(
        'div',
        { class: 'field' },
        el('label', { for: 'daily-guess' }, 'Your guess'),
        el('div', { class: 'input-row' }, input, submit),
        el('p', { class: 'hint', id: 'daily-hint' }, 'Titles can be entered in English or romaji.')
      ),
      status
    );
    const rules = el(
      'div',
      { class: 'daily-rules' },
      el('p', { class: 'daily-rules-title' }, 'How scoring works'),
      el('ul', {},
        el('li', {}, 'Wrong guesses and new clues each cost 60 points.'),
        el('li', {}, 'Guessing with the first clue keeps the start score of ' + START_SCORE + '.'),
        el('li', {}, 'A solve in one clue scores ' + START_SCORE + '; the floor is ' + FLOOR + '.')
      )
    );
    const actions = el(
      'div',
      { class: 'daily-actions' },
      revealButton,
      giveUpButton
    );
    const side = el('div', { class: 'daily-side' }, form, actions, rules);
    render(body, meter, board, side, resultBox);

    function currentScore() {
      return scoreFor(cluesShown, wrongGuesses.length);
    }

    function saveProgress() {
      const saved = store.set(storageKey('result'), {
        date: today,
        puzzleId: puzzle.id,
        cluesShown,
        wrongGuesses,
        finished,
        won,
        order,
      });

      if (finished) {
        store.set(storageKey('last-date'), today);
        store.set(storageKey('last-index'), index);
        store.set(storageKey('streak'), streak);
      }

      return saved;
    }

    function kpi(label, value, options = {}) {
      const valueNode = el('strong', { class: 'kpi-value num' }, value);
      if (options.flash) valueNode.dataset.flash = 'down';
      if (options.small) valueNode.append(el('small', {}, options.small));
      return el('div', { class: 'kpi' + (options.lead ? ' kpi--lead' : '') }, el('span', { class: 'kpi-label' }, label), valueNode);
    }

    function renderMeter() {
      const score = currentScore();
      const flash = lastScore !== null && score < lastScore;
      lastScore = score;

      render(
        meter,
        kpi('Score', String(score), { lead: true, flash }),
        kpi('Clues', String(cluesShown), { small: 'of 5' }),
        kpi(media.label + ' streak', String(streak))
      );

      if (flash) {
        setTimeout(() => {
          const scoreValue = meter.querySelector('.kpi--lead .kpi-value');
          if (scoreValue) delete scoreValue.dataset.flash;
        }, 900);
      }
    }

    function renderClues() {
      render(
        clueList,
        order.map((puzzleIndex, position) => {
          const clue = puzzle.clues[puzzleIndex];
          const shown = position < cluesShown;
          return el(
            'li',
            {
              class:
                'daily-clue' +
                (shown ? ' daily-clue--revealed' : ' daily-clue--locked') +
                (shown && position === cluesShown - 1 ? ' daily-clue--current' : ''),
            },
            el('span', { class: 'daily-clue-stamp', 'aria-hidden': 'true' }),
            el('span', { class: 'daily-clue-label' }, clue.label),
            el('span', { class: 'daily-clue-value' }, shown ? clue.value : '')
          );
        })
      );
    }

    function renderGuesses() {
      render(
        guesses,
        wrongGuesses.length
          ? [
              el('span', { class: 'daily-guesses-label' }, 'Missed'),
              ...wrongGuesses.map((guess) => el('span', { class: 'daily-guess-chip' }, guess)),
            ]
          : [
              el('span', { class: 'daily-guesses-label daily-guesses-label--quiet' }, 'No misses yet.'),
            ]
      );
    }

    function renderResult() {
      resultBox.hidden = !finished;
      resultBox.dataset.tone = won ? 'win' : 'lose';
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
        el(
          'div',
          { class: 'daily-result-head' },
          el('h2', { class: 'daily-result-title' }, won ? 'Correct' : 'The answer was ' + puzzle.answers[0]),
          el(
            'p',
            { class: 'daily-result-body' },
            won
              ? 'Solved with ' + score + ' points. Your streak is ' + streak + '.'
              : 'Come back tomorrow for another puzzle.'
          )
        ),
        el('pre', { class: 'daily-share num' }, shareText(number, cluesShown, wrongGuesses.length + (won ? 1 : 0), score, won, media.label)),
        el(
          'div',
          { class: 'daily-result-actions' },
          button,
          getSession() ? el('a', { class: 'btn btn-quiet', href: '#/account' }, 'See your streak history') : null
        )
      );
      button.addEventListener('click', async () => {
        const copied = await copyText(shareText(
          number,
          cluesShown,
          wrongGuesses.length + (won ? 1 : 0),
          score,
          won,
          media.label
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
      if (getSession()) {
        pushGuessProgress({ mediaType: media.id, dayIndex: index, score: won ? currentScore() : 0, won });
      }
      renderGame();
      // Input becomes disabled on finish; move focus to the result so
      // keyboard/screen-reader users land on the outcome, not <body>.
      const resultHeading = resultBox.querySelector('.daily-result-title');
      if (resultHeading) {
        resultHeading.tabIndex = -1;
        resultHeading.focus();
      }
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
