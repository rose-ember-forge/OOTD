// Outfit of the day: picks a full outfit from the wardrobe with simple styling rules,
// no AI service. Pieces must suit the season and occasion; combinations are scored so
// colors and patterns go together, and the best of many random tries wins.
//
// The suggestion is seeded by date + season + occasion, so it stays the same all day
// until she shuffles.

import { ALL_YEAR } from './taxonomy.js';

// Colors that go with anything. Denim reads as neutral too, whatever its color tag.
const NEUTRALS = new Set(['black', 'white', 'grey', 'beige', 'brown', 'navy', 'silver', 'gold']);
// Pairs that tend to fight when both are the main colors.
const CLASHES = [
  ['red', 'pink'], ['red', 'orange'], ['orange', 'pink'], ['purple', 'orange'],
  ['green', 'red'], ['yellow', 'purple'], ['green', 'pink'],
];

// The slots of an outfit, in the order they're shown.
export const SLOTS = [
  { key: 'outerwear', label: 'Layer' },
  { key: 'top', label: 'Top' },
  { key: 'dress', label: 'Dress' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'shoes', label: 'Shoes' },
  { key: 'accessory', label: 'Accessory' },
];

// Northern-hemisphere seasons by month; she can pick another season on the screen.
export function seasonForDate(date = new Date()) {
  const m = date.getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

// Small seeded random generator (mulberry32), so a day's outfit is repeatable.
export function seededRandom(seedText) {
  let h = 1779033703;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickFrom = (list, rand) => list[Math.floor(rand() * list.length)];

const isDenim = (i) => (i.materials ?? []).includes('denim') || /jean|denim/i.test(i.subtype ?? '');
const isNeutral = (i) => isDenim(i) || NEUTRALS.has(i.color);
const isPatterned = (i) => i.color === 'multicolor' || (i.pattern && !['solid', 'textured'].includes(i.pattern));

function fitsSeason(item, season) {
  const s = item.seasons ?? [];
  return !s.length || s.includes(ALL_YEAR) || s.includes(season);
}
function fitsOccasion(item, occasion) {
  const o = item.occasions ?? [];
  return !occasion || !o.length || o.includes(occasion);
}

/** Items that could go into today's outfit, grouped by type. */
export function candidates(items, { season, occasion }) {
  const byType = {};
  for (const i of items) {
    if (!i.type || !fitsSeason(i, season) || !fitsOccasion(i, occasion)) continue;
    (byType[i.type] ??= []).push(i);
  }
  return byType;
}

/** Higher is better. `outfit` maps slot → item (missing slots are undefined). */
export function score(outfit, season) {
  const pieces = Object.values(outfit).filter(Boolean);
  const main = ['outerwear', 'top', 'dress', 'bottom', 'shoes'].map((k) => outfit[k]).filter(Boolean);
  let s = 0;

  // One patterned piece is a statement; two or more is busy.
  const patterned = main.filter(isPatterned).length;
  if (patterned > 1) s -= 3 * (patterned - 1);

  // Neutral base plus at most two accent colors; clashing accents cost extra.
  const accents = [...new Set(main.filter((i) => !isNeutral(i) && i.color && i.color !== 'multicolor').map((i) => i.color))];
  if (accents.length > 2) s -= 2 * (accents.length - 2);
  for (const [a, b] of CLASHES) if (accents.includes(a) && accents.includes(b)) s -= 2;
  if (accents.length === 1 && patterned <= 1) s += 1; // a single pop of color
  if (!accents.length && !patterned) s += 0.5; // calm all-neutral look is fine too

  // An accessory or shoes that echo the accent color tie it together.
  const echo = [outfit.accessory, outfit.shoes].filter(Boolean).some((i) => accents.length && accents.includes(i.color));
  if (echo && main.length > 2) s += 1;

  // Sleeve and length should suit the weather.
  const cold = season === 'winter' || season === 'autumn';
  for (const i of pieces) {
    if (cold && (i.sleeve === 'sleeveless' || ['shorts', 'mini'].includes(i.length))) s -= 1.5;
    if (season === 'summer' && (i.sleeve === 'full sleeve' || i.length === 'long')) s -= 1;
  }
  return s;
}

function randomOutfit(byType, season, rand) {
  const o = {};
  const dresses = byType.dress ?? [];
  const canSeparates = (byType.top?.length ?? 0) > 0 && (byType.bottom?.length ?? 0) > 0;
  // Dress or separates, in proportion to how many of each she has.
  const dressOdds = dresses.length / (dresses.length + (canSeparates ? Math.min(byType.top.length, byType.bottom.length) : 0) || 1);
  if (dresses.length && (!canSeparates || rand() < dressOdds)) {
    o.dress = pickFrom(dresses, rand);
  } else if (canSeparates) {
    o.top = pickFrom(byType.top, rand);
    o.bottom = pickFrom(byType.bottom, rand);
  }
  if (byType.shoes?.length) o.shoes = pickFrom(byType.shoes, rand);
  // A layer in the cold, sometimes in spring, never in summer.
  const layerOdds = { winter: 1, autumn: 0.85, spring: 0.4, summer: 0 }[season] ?? 0.5;
  if (byType.outerwear?.length && rand() < layerOdds) o.outerwear = pickFrom(byType.outerwear, rand);
  if (byType.accessory?.length && rand() < 0.5) o.accessory = pickFrom(byType.accessory, rand);
  return o;
}

/**
 * Suggest an outfit. Returns { outfit, missing } where `missing` lists what she'd need
 * to add to the wardrobe for a complete outfit (e.g. ['shoes']).
 */
export function suggestOutfit(items, { season, occasion, seed }) {
  const rand = seededRandom(seed);
  const byType = candidates(items, { season, occasion });
  const missing = [];
  if (!byType.dress?.length && !(byType.top?.length && byType.bottom?.length)) {
    if (!byType.top?.length) missing.push('top');
    if (!byType.bottom?.length) missing.push('bottom');
  }
  if (!byType.shoes?.length) missing.push('shoes');

  let best = null;
  let bestScore = -Infinity;
  for (let n = 0; n < 80; n++) {
    const o = randomOutfit(byType, season, rand);
    const s = score(o, season) + rand() * 0.75; // a little variety between equally good looks
    if (s > bestScore) [best, bestScore] = [o, s];
  }
  return { outfit: best ?? {}, missing };
}

/** Another option for one slot that goes with the rest of the outfit (null if there's none). */
export function swapPiece(items, outfit, slot, { season, occasion, seed }) {
  const rand = seededRandom(seed);
  const options = (candidates(items, { season, occasion })[slot] ?? []).filter((i) => i.id !== outfit[slot]?.id);
  if (!options.length) return null;
  const ranked = options
    .map((i) => ({ i, s: score({ ...outfit, [slot]: i }, season) + rand() * 1.5 }))
    .sort((a, b) => b.s - a.s);
  // Pick among the better options so repeated swaps keep showing new pieces.
  return pickFrom(ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2))), rand).i;
}
