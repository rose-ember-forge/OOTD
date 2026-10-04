// Photo pipeline: decode → downscale → optional background removal → trim → photo + thumbnail.
// Background removal runs on the device (@imgly/background-removal); its model is
// downloaded on first use (tens of MB) and cached by the browser afterwards.

import { suggestColor } from './color.js';

const PHOTO_MAX = 1200;
const THUMB_MAX = 400;
const WORK_MAX = 1600;

let bgLib;
let bgUsedOnce = false;
const loadBgLib = () =>
  (bgLib ??= import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1/+esm'));

// Start fetching the library and model early (e.g. when the add screen opens).
export function warmUpBackgroundRemoval() {
  loadBgLib()
    .then((m) => m.preload?.())
    .catch(() => {});
}

async function decode(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source, max) {
  const w = source.width;
  const h = source.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  );
}

// Transparent images: WebP keeps alpha and is small, but older Safari can't encode it
// and silently returns PNG instead, which is still fine.
async function encode(canvas, transparent) {
  if (!transparent) return toBlob(canvas, 'image/jpeg', 0.85);
  return toBlob(canvas, 'image/webp', 0.85);
}

// Crop away fully transparent margins around a cut-out, keeping a small padding.
function trimTransparent(source) {
  const canvas = drawScaled(source, Infinity);
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let top = h, left = w, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return canvas; // nothing opaque: keep as is
  const pad = Math.round(Math.max(right - left, bottom - top) * 0.04);
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(w - 1, right + pad);
  bottom = Math.min(h - 1, bottom + pad);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d').drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Turn a picked file into the images we store.
 * Returns { photo, thumb, original, backgroundRemoved, color }: `original` ({ photo, thumb }) is the
 * untouched photo when the background was removed (so a bad cut-out can be undone), else null;
 * `color` is a suggested color name or null.
 * If background removal fails (old device, offline), the original photo is used.
 */
export async function processPhoto(file, { removeBackground = true, onStatus = () => {} } = {}) {
  onStatus('Reading photo…');
  const decoded = await decode(file);
  const working = drawScaled(decoded, WORK_MAX);
  decoded.close?.();

  let source = working;
  let backgroundRemoved = false;
  if (removeBackground) {
    try {
      onStatus(bgUsedOnce ? 'Removing background…' : 'Removing background… (the first one takes a while)');
      const { removeBackground: remove } = await loadBgLib();
      const cutBlob = await remove(await toBlob(working, 'image/jpeg', 0.92));
      source = trimTransparent(await decode(cutBlob));
      backgroundRemoved = true;
      bgUsedOnce = true;
    } catch (err) {
      console.warn('Background removal failed, keeping original photo', err);
    }
  }

  onStatus('Saving sizes…');
  const thumbCanvas = drawScaled(source, THUMB_MAX);
  let color = null;
  try {
    color = suggestColor(thumbCanvas, backgroundRemoved);
  } catch (err) {
    console.warn('Color suggestion failed', err);
  }
  const [photo, thumb, originalPhoto, originalThumb] = await Promise.all([
    encode(drawScaled(source, PHOTO_MAX), backgroundRemoved),
    encode(thumbCanvas, backgroundRemoved),
    backgroundRemoved && encode(drawScaled(working, PHOTO_MAX), false),
    backgroundRemoved && encode(drawScaled(working, THUMB_MAX), false),
  ]);
  const original = backgroundRemoved ? { photo: originalPhoto, thumb: originalThumb } : null;
  return { photo, thumb, original, backgroundRemoved, color };
}
