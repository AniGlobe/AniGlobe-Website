/**
 * DOM to PNG export.
 *
 * html-to-image is pulled from a CDN on first use so the first paint stays
 * light. It is a classic script, not an ES module, so it is injected and read
 * off window rather than imported.
 *
 * Constraint worth knowing: the target node must not contain cross-origin
 * images. Remote cover art taints the canvas and export throws a SecurityError,
 * which is why the v1 card is typography only. A free image proxy would lift
 * this later.
 */

import { runtime } from './config.js';
import { loadScript } from './lib.js';

export class ExportError extends Error {
  constructor(message, code = 'unknown') {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

/** Fetch the html-to-image global, loading it once. */
async function getHtmlToImage() {
  try {
    return await loadScript(runtime.htmlToImageUrl, runtime.htmlToImageGlobal);
  } catch {
    throw new ExportError(
      'Could not load the image library. Check your connection and try again.',
      'library'
    );
  }
}

/**
 * Render a node to a PNG data URL.
 *
 * `pixelRatio` of 2 gives a retina-crisp card without asking the user to pick
 * a quality setting. Background is passed explicitly because the default is
 * transparent, which looks broken when the PNG is posted on a dark feed.
 *
 * @param {HTMLElement} node
 * @param {{pixelRatio?: number, background?: string, style?: Record<string, string>}} [options]
 * @returns {Promise<string>} data URL
 */
export async function nodeToPng(node, options) {
  if (!node) throw new ExportError('Nothing to export.', 'no_node');

  const opts = options || {};
  const htmlToImage = await getHtmlToImage();

  try {
    const renderOptions = {
      pixelRatio: opts.pixelRatio || 2,
      backgroundColor: opts.background || '#ffffff',
      cacheBust: true,
    };
    if (opts.style) renderOptions.style = opts.style;
    return await htmlToImage.toPng(node, {
      ...renderOptions,
    });
  } catch (error) {
    const message = String((error && error.message) || '');

    if (/tainted|SecurityError/i.test(message)) {
      throw new ExportError(
        'The card contains an image the browser will not let us export. Remove it and try again.',
        'tainted_canvas'
      );
    }

    throw new ExportError('Could not render the card to an image.', 'render');
  }
}

function fitImageToCanvas(dataUrl, width, height, background, pixelRatio) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Promise.reject(new ExportError('The selected export dimensions are invalid.', 'dimensions'));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new ExportError('Could not prepare the image canvas.', 'canvas'));
        return;
      }

      const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      try {
        context.fillStyle = background || '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        reject(new ExportError('Could not prepare the image for the selected layout.', 'canvas'));
      }
    };
    image.onerror = () => reject(new ExportError('Could not read the rendered card image.', 'render'));
    image.src = dataUrl;
  });
}

/**
 * Trigger a browser download for a data URL.
 *
 * The anchor is attached to the document before clicking because Firefox
 * ignores clicks on detached nodes.
 */
export function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Build a stable, filesystem-safe file name.
 * Prefix keeps exports identifiable once they are loose in a Downloads folder.
 */
export function pngFileName(prefix, label, date) {
  const when = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    when.getFullYear() +
    '-' +
    pad(when.getMonth() + 1) +
    '-' +
    pad(when.getDate());

  const safe = String(label || 'card')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+\x24/g, '')
    .slice(0, 32);

  return (prefix || 'anicard') + '-' + (safe || 'card') + '-' + stamp + '.png';
}

/** Render and download in one call. Returns the data URL for preview reuse. */
export async function exportNode(node, fileName, options) {
  const opts = options || {};
  const pixelRatio = opts.pixelRatio || 2;
  const dataUrl = await nodeToPng(node, {
    pixelRatio,
    background: opts.background,
    style: opts.renderWidth
      ? { width: opts.renderWidth + 'px', maxWidth: 'none' }
      : undefined,
  });
  const output = opts.width && opts.height
    ? await fitImageToCanvas(dataUrl, opts.width, opts.height, opts.background, pixelRatio)
    : dataUrl;
  downloadDataUrl(output, fileName);
  return output;
}
