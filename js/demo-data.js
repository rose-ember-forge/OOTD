// Sample wardrobe for demo mode: every type and every sleeve/length option, spread over
// the seasons and occasions so filters and outfit suggestions have something to work with.
// The pictures are simple garment shapes drawn here, in each item's color and pattern.

import { COLOR_SWATCH } from './taxonomy.js';

// [type, subtype, sleeve, length, color, pattern, seasons, occasions, materials]
const SAMPLES = [
  ['top', 'tank top', 'sleeveless', null, 'white', 'solid', ['spring', 'summer'], ['casual', 'sport'], ['cotton']],
  ['top', 'blouse', 'sleeveless', null, 'pink', 'floral', ['summer'], ['going out', 'casual'], ['silk']],
  ['top', 't-shirt', 'half sleeve', null, 'navy', 'striped', ['all_year'], ['casual', 'home', 'sport'], ['cotton']],
  ['top', 'shirt', 'half sleeve', null, 'blue', 'solid', ['spring', 'summer'], ['work', 'casual'], ['linen']],
  ['top', 'blouse', 'three-quarter sleeve', null, 'beige', 'solid', ['spring', 'autumn'], ['work', 'formal'], ['viscose']],
  ['top', 'top', 'three-quarter sleeve', null, 'green', 'polka dot', ['spring'], ['going out'], ['polyester']],
  ['top', 'sweater', 'full sleeve', null, 'grey', 'textured', ['autumn', 'winter'], ['work', 'casual'], ['wool']],
  ['top', 'shirt', 'full sleeve', null, 'white', 'solid', ['all_year'], ['work', 'formal', 'going out'], ['cotton']],

  ['bottom', 'shorts', null, 'shorts', 'beige', 'solid', ['summer'], ['casual', 'sport'], ['cotton']],
  ['bottom', 'skirt', null, 'mini', 'black', 'solid', ['spring', 'summer'], ['going out'], ['denim']],
  ['bottom', 'skirt', null, 'knee-length', 'navy', 'checked', ['spring', 'autumn'], ['work'], ['wool']],
  ['bottom', 'skirt', null, 'midi', 'olive', 'solid', ['all_year'], ['casual', 'work'], ['viscose']],
  ['bottom', 'trousers', null, 'cropped', 'white', 'solid', ['spring', 'summer'], ['casual', 'work'], ['linen']],
  ['bottom', 'jeans', null, 'ankle-length', 'blue', 'solid', ['all_year'], ['casual', 'going out'], ['denim']],
  ['bottom', 'trousers', null, 'full-length', 'black', 'solid', ['all_year'], ['work', 'formal'], ['polyester']],
  ['bottom', 'skirt', null, 'maxi', 'red', 'floral', ['summer'], ['going out', 'casual'], ['viscose']],
  ['bottom', 'joggers', null, 'full-length', 'grey', 'solid', ['all_year'], ['home', 'sport', 'casual'], ['cotton']],

  ['dress', 'mini dress', 'sleeveless', 'mini', 'yellow', 'solid', ['summer'], ['going out'], ['cotton']],
  ['dress', 'dress', 'half sleeve', 'knee-length', 'navy', 'polka dot', ['spring', 'summer'], ['work', 'casual'], ['viscose']],
  ['dress', 'midi dress', 'three-quarter sleeve', 'midi', 'purple', 'solid', ['spring', 'autumn'], ['formal', 'going out'], ['silk']],
  ['dress', 'maxi dress', 'full sleeve', 'maxi', 'black', 'solid', ['autumn', 'winter'], ['formal', 'going out'], ['wool']],

  ['outerwear', 'jacket', 'full sleeve', 'cropped', 'blue', 'solid', ['spring', 'autumn'], ['casual'], ['denim']],
  ['outerwear', 'bolero', 'half sleeve', 'cropped', 'pink', 'solid', ['summer'], ['going out', 'formal'], ['cotton']],
  ['outerwear', 'blazer', 'full sleeve', 'hip-length', 'black', 'solid', ['all_year'], ['work', 'formal', 'going out'], ['wool']],
  ['outerwear', 'vest', 'sleeveless', 'thigh-length', 'beige', 'solid', ['spring', 'autumn'], ['casual'], ['nylon']],
  ['outerwear', 'raincoat', 'three-quarter sleeve', 'knee-length', 'olive', 'solid', ['spring', 'autumn'], ['casual', 'work'], ['nylon']],
  ['outerwear', 'coat', 'full sleeve', 'long', 'brown', 'checked', ['winter'], ['work', 'going out', 'formal'], ['wool']],
  ['outerwear', 'puffer', 'full sleeve', 'hip-length', 'navy', 'solid', ['winter'], ['casual', 'sport', 'home'], ['nylon']],

  ['shoes', 'sneakers', null, null, 'white', 'solid', ['all_year'], ['casual', 'sport', 'home'], ['leather']],
  ['shoes', 'boots', null, null, 'brown', 'solid', ['autumn', 'winter'], ['casual', 'work', 'going out'], ['leather']],
  ['shoes', 'heels', null, null, 'black', 'solid', ['all_year'], ['formal', 'going out', 'work'], ['suede']],
  ['shoes', 'sandals', null, null, 'beige', 'solid', ['summer'], ['casual', 'going out'], ['leather']],
  ['shoes', 'flats', null, null, 'navy', 'solid', ['spring', 'summer', 'autumn'], ['work', 'casual'], ['leather']],

  ['socks', 'no-show socks', null, 'no-show', 'white', 'solid', ['all_year'], ['casual', 'sport'], ['cotton']],
  ['socks', 'ankle socks', null, 'ankle', 'grey', 'striped', ['all_year'], ['sport'], ['cotton']],
  ['socks', 'crew socks', null, 'crew', 'black', 'solid', ['autumn', 'winter'], ['work', 'casual'], ['wool']],
  ['socks', 'knee socks', null, 'knee-high', 'navy', 'solid', ['winter'], ['casual'], ['wool']],

  ['innerwear', 'camisole', null, null, 'beige', 'solid', ['all_year'], ['home'], ['silk']],
  ['innerwear', 'thermal', null, null, 'white', 'solid', ['winter'], ['home'], ['cotton']],

  ['accessory', 'bag', null, null, 'black', 'solid', ['all_year'], ['work', 'formal', 'going out'], ['leather']],
  ['accessory', 'scarf', null, null, 'red', 'checked', ['autumn', 'winter'], ['casual', 'work'], ['wool']],
  ['accessory', 'hat', null, null, 'beige', 'solid', ['summer'], ['casual'], ['straw']],
];

// ---------- drawing ----------

const W = 450;
const H = 600;

// Polygons are lists of [x, y] in a 600 × 800 design space, scaled down when drawn.
const poly = (path, points) => {
  points.forEach(([x, y], n) => (n ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
};
const mirror = (points) => points.map(([x, y]) => [600 - x, y]);

// Sleeve shapes: shoulder → cuff → armpit, for the right side.
const SLEEVE_POINTS = {
  'half sleeve': [[420, 190], [505, 300], [462, 335], [400, 285]],
  'three-quarter sleeve': [[420, 190], [528, 420], [486, 448], [400, 290]],
  'full sleeve': [[420, 190], [540, 560], [495, 578], [400, 295]],
};

function addSleeves(path, sleeve, dx = 0) {
  const pts = SLEEVE_POINTS[sleeve];
  if (!pts) return;
  const shifted = pts.map(([x, y]) => [x + dx, y]);
  poly(path, shifted);
  poly(path, mirror(shifted));
}

function upperBody(path, sleeve, hemY, flare = 0) {
  const narrow = sleeve === 'sleeveless' ? 22 : 0;
  path.moveTo(235, 160);
  path.quadraticCurveTo(300, 225, 365, 160);
  path.lineTo(420 - narrow, 190);
  path.lineTo(400 + flare, hemY);
  path.lineTo(200 - flare, hemY);
  path.lineTo(180 + narrow, 190);
  path.closePath();
  addSleeves(path, sleeve);
}

const SKIRT_HEM = { mini: 330, 'knee-length': 470, midi: 580, maxi: 740 };
const LEG_HEM = { shorts: 330, cropped: 600, 'ankle-length': 680, 'full-length': 740 };
const DRESS_HEM = { mini: 500, 'knee-length': 580, midi: 660, maxi: 770 };
const COAT_HEM = { cropped: 430, 'hip-length': 540, 'thigh-length': 620, 'knee-length': 700, long: 770 };
const SOCK_TOP = { 'no-show': 560, ankle: 470, crew: 330, 'knee-high': 120 };

function garmentPath([type, subtype, sleeve, length]) {
  const p = new Path2D();
  if (type === 'top') {
    upperBody(p, sleeve, 560);
  } else if (type === 'bottom') {
    if (SKIRT_HEM[length]) {
      const hem = SKIRT_HEM[length];
      const flare = (hem - 120) * 0.28;
      poly(p, [[205, 120], [395, 120], [395 + flare, hem], [205 - flare, hem]]);
    } else {
      const hem = LEG_HEM[length] ?? 740;
      poly(p, [[200, 120], [400, 120], [408, hem], [318, hem], [300, 300], [282, hem], [192, hem]]);
    }
  } else if (type === 'dress') {
    const hem = DRESS_HEM[length] ?? 660;
    p.moveTo(240, 150);
    p.quadraticCurveTo(300, 205, 360, 150);
    p.lineTo(405, 180);
    p.lineTo(380, 360);
    p.lineTo(440 + (hem - 500) * 0.15, hem);
    p.lineTo(160 - (hem - 500) * 0.15, hem);
    p.lineTo(220, 360);
    p.lineTo(195, 180);
    p.closePath();
    addSleeves(p, sleeve, -12);
  } else if (type === 'outerwear') {
    upperBody(p, sleeve, COAT_HEM[length] ?? 600, 18);
  } else if (type === 'shoes') {
    for (const dx of [0, 230]) {
      if (subtype === 'boots') poly(p, [[95 + dx, 300], [190 + dx, 300], [195 + dx, 520], [290 + dx, 560], [290 + dx, 620], [90 + dx, 620]]);
      else if (subtype === 'heels') poly(p, [[90 + dx, 470], [280 + dx, 560], [285 + dx, 600], [150 + dx, 600], [140 + dx, 640], [120 + dx, 640], [100 + dx, 560]]);
      else if (subtype === 'sandals') poly(p, [[90 + dx, 560], [290 + dx, 560], [290 + dx, 600], [90 + dx, 600]]);
      else poly(p, [[95 + dx, 480], [200 + dx, 480], [290 + dx, 560], [290 + dx, 620], [90 + dx, 620]]);
    }
  } else if (type === 'socks') {
    const top = SOCK_TOP[length] ?? 330;
    for (const dx of [0, 220]) poly(p, [[120 + dx, top], [210 + dx, top], [210 + dx, 560], [300 + dx, 600], [300 + dx, 660], [120 + dx, 660]]);
  } else if (type === 'innerwear') {
    poly(p, [[220, 200], [380, 200], [400, 520], [200, 520]]);
    poly(p, [[228, 120], [238, 120], [238, 200], [228, 200]]);
    poly(p, [[362, 120], [372, 120], [372, 200], [362, 200]]);
  } else if (subtype === 'hat') {
    p.ellipse(300, 470, 230, 60, 0, 0, Math.PI * 2);
    poly(p, [[200, 470], [220, 290], [380, 290], [400, 470]]);
  } else if (subtype === 'scarf') {
    poly(p, [[200, 120], [300, 120], [300, 680], [200, 680]]);
    poly(p, [[300, 120], [420, 220], [420, 600], [330, 600], [330, 260], [300, 240]]);
  } else {
    // bag
    poly(p, [[140, 330], [460, 330], [480, 640], [120, 640]]);
    p.moveTo(220, 330);
    p.bezierCurveTo(220, 170, 380, 170, 380, 330);
    p.lineTo(355, 330);
    p.bezierCurveTo(355, 205, 245, 205, 245, 330);
    p.closePath();
  }
  return p;
}

function paintPattern(ctx, pattern) {
  ctx.save();
  if (pattern === 'striped') {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let y = 0; y < 800; y += 44) ctx.fillRect(0, y, 600, 18);
  } else if (pattern === 'checked') {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 0; x < 600; x += 60) ctx.fillRect(x, 0, 22, 800);
    for (let y = 0; y < 800; y += 60) ctx.fillRect(0, y, 600, 22);
  } else if (pattern === 'polka dot') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let y = 20; y < 800; y += 50) for (let x = (y / 50) % 2 ? 45 : 20; x < 600; x += 50) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'floral') {
    for (let y = 40; y < 800; y += 90) for (let x = (y / 90) % 2 ? 80 : 30; x < 600; x += 100) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let a = 0; a < 5; a++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos((a * 2 * Math.PI) / 5) * 14, y + Math.sin((a * 2 * Math.PI) / 5) * 14, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(250,200,60,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'textured') {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 3;
    for (let x = -800; x < 600; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 800, 800);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSample(sample) {
  const [, , , , color, pattern] = sample;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.scale(W / 600, H / 800);
  const path = garmentPath(sample);
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = COLOR_SWATCH[color]?.startsWith('#') ? COLOR_SWATCH[color] : '#999';
  ctx.fillRect(0, 0, 600, 800);
  paintPattern(ctx, pattern);
  ctx.restore();
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.stroke(path);
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));

function scaled(canvas, w, h) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, 0, 0, w, h);
  return out;
}

/** Fill an empty demo wardrobe with the samples. Returns how many were added. */
export async function addSampleItems(store) {
  // Newest items show first, so add them in reverse to put tops at the top.
  for (const sample of [...SAMPLES].reverse()) {
    const [type, subtype, sleeve, length, color, pattern, seasons, occasions, materials] = sample;
    const canvas = drawSample(sample);
    const [photo, thumb] = await Promise.all([toBlob(canvas), toBlob(scaled(canvas, 300, 400))]);
    await store.saveItem(
      null,
      { type, subtype, sleeve, length, color, pattern, seasons, occasions, materials, tags: ['sample'], use_original: false },
      { photo, thumb, original: null },
    );
  }
  return SAMPLES.length;
}
