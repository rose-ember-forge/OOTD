// Guesses the main color of a garment from its photo, on the device. Each sampled pixel
// is sorted into one of the app's color names by hue/saturation/brightness, and the
// most common name wins. Only a suggestion: she confirms or changes it.

function toHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}

export function colorName(r, g, b) {
  const [h, s, v] = toHsv(r, g, b);
  if (v < 0.2) return 'black';
  if (s < 0.14) return v > 0.85 ? 'white' : v < 0.35 ? 'black' : 'grey';
  if (h >= 15 && h < 65 && s < 0.4 && v > 0.65) return 'beige';
  if (h < 15 || h >= 345) return s < 0.5 && v > 0.7 ? 'pink' : 'red';
  if (h < 40) return v < 0.6 ? 'brown' : 'orange';
  if (h < 65) return v < 0.55 ? 'olive' : 'yellow';
  if (h < 160) return h < 95 && v < 0.6 ? 'olive' : 'green';
  if (h < 255) return v < 0.45 ? 'navy' : 'blue';
  if (h < 290) return 'purple';
  return v < 0.45 ? 'purple' : 'pink';
}

/**
 * `canvas`: the item image. With `transparent`, only opaque pixels (the cut-out) count;
 * otherwise only the middle of the frame, which is where the garment usually is.
 * Returns a color name, or null if nothing usable was found.
 */
export function suggestColor(canvas, transparent) {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const [x0, x1, y0, y1] = transparent ? [0, w, 0, h] : [w * 0.3, w * 0.7, h * 0.3, h * 0.7].map(Math.round);
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  const votes = {};
  let total = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * w + x) * 4;
      if (transparent && data[i + 3] < 200) continue;
      const name = colorName(data[i], data[i + 1], data[i + 2]);
      votes[name] = (votes[name] ?? 0) + 1;
      total++;
    }
  }
  if (total < 50) return null;
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const [top, topCount] = ranked[0];
  // Three or more colors each covering a good share, with none dominant: stripes, prints...
  const sizeable = ranked.filter(([, n]) => n / total >= 0.15).length;
  if (topCount / total < 0.5 && sizeable >= 3) return 'multicolor';
  return top;
}
