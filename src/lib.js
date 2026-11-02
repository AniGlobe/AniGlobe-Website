/**
 * Small shared primitives. Deliberately boring.
 *
 * Rule: a helper lives here only when two or more tools need it.
 * One-off logic belongs in the tool module.
 */

import { runtime } from './config.js';

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */

/**
 * Create an element. Attributes are applied via setAttribute so this stays
 * predictable for things like `aria-*` and `data-*`.
 *
 * Children may be nodes, strings, or falsy (skipped) values.
 *
 * @param {string} tag
 * @param {Record<string, unknown>} [attrs]
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }

  append(node, children);
  return node;
}

/** Replace a node's children. Accepts the same child types as `el`. */
export function render(target, ...children) {
  target.replaceChildren();
  append(target, children);
  return target;
}

function append(target, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    target.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Typed query helper that throws loudly on a missing node. */
export function qs(selector, scope = document) {
  const node = scope.querySelector(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

/* --------------------------------------------------------------------------
   Storage — namespaced, and never throws (private mode / disabled storage)
   -------------------------------------------------------------------------- */

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(runtime.storagePrefix + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(runtime.storagePrefix + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(runtime.storagePrefix + key);
    } catch {
      /* ignore */
    }
  },
};

/* --------------------------------------------------------------------------
   Clipboard — falls back to a temporary textarea on insecure origins
   -------------------------------------------------------------------------- */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* --------------------------------------------------------------------------
   Lazy script loading — used for the html-to-image CDN bundle
   -------------------------------------------------------------------------- */

const scriptCache = new Map();

/**
 * Load an external classic script once and resolve with its global.
 * Rejects with a readable error instead of a bare "Script error."
 */
export function loadScript(url, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (scriptCache.has(url)) return scriptCache.get(url);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (globalName && !window[globalName]) {
        reject(new Error(`Script loaded but ${globalName} was not exposed.`));
      } else {
        resolve(globalName ? window[globalName] : true);
      }
    };
    script.onerror = () => reject(new Error(`Could not load ${url}. Check your connection.`));
    document.head.append(script);
  });

  scriptCache.set(url, promise);
  // Allow a retry after a failure instead of caching the rejection forever.
  promise.catch(() => scriptCache.delete(url));
  return promise;
}

/* --------------------------------------------------------------------------
   Misc
   -------------------------------------------------------------------------- */

/** Load a JSON file from the data directory. */
export async function loadData(file) {
  const response = await fetch(new URL(runtime.dataBase + file, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status}).`);
  return response.json();
}

/** Debounce — used for the username input. */
export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Format a number with a locale separator, tolerant of null. */
export function num(value, fallback = '—') {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString()
    : fallback;
}

/**
 * Set a status line inside a container. tone: 'info' | 'warn' | 'error' | ''
 * An empty message clears the element.
 */
export function setStatus(node, message = '', tone = 'info') {
  node.textContent = message || '';
  if (message) node.dataset.tone = tone;
  else delete node.dataset.tone;
  return node;
}

/** Deterministic pseudo-random from a string seed — used for stable daily picks. */
export function hashString(input) {
  let hash = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** YYYY-MM-DD for a Date, in local time. */
export function dateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days since the Unix epoch, in local time — the puzzle index. */
export function dayIndex(date = new Date()) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(local.getTime() / 86400000);
}
