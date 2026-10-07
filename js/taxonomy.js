// Fixed vocabularies from the spec. Stored values are the keys; labels are for display.

// An item can have any number of seasons; "all year" means all four.
export const SEASONS = [
  { key: 'spring', label: 'Spring' },
  { key: 'summer', label: 'Summer' },
  { key: 'autumn', label: 'Autumn' },
  { key: 'winter', label: 'Winter' },
];
export const ALL_SEASONS = SEASONS.map((s) => s.key);

// Older items used three season groups; read them as the seasons they cover.
const LEGACY_SEASONS = {
  spring_summer: ['spring', 'summer'],
  autumn_winter: ['autumn', 'winter'],
  all_year: ALL_SEASONS,
};
export const normalizeSeasons = (list) =>
  ALL_SEASONS.filter((k) => (list ?? []).some((v) => v === k || LEGACY_SEASONS[v]?.includes(k)));

// She can add her own materials too; these are the starting set.
export const DEFAULT_MATERIALS = [
  'cotton', 'linen', 'wool', 'cashmere', 'silk', 'denim',
  'leather', 'suede', 'polyester', 'viscose', 'nylon', 'acrylic',
];

// She can add her own occasions; these are the starting set.
export const DEFAULT_OCCASIONS = ['work', 'casual', 'going out', 'formal', 'home', 'sport'];

export const TYPES = [
  { key: 'top', label: 'Top', subtypes: ['t-shirt', 'shirt', 'blouse', 'sweater', 'cardigan', 'hoodie', 'tank top', 'polo'] },
  { key: 'bottom', label: 'Bottom', subtypes: ['jeans', 'trousers', 'shorts', 'skirt', 'leggings', 'joggers'] },
  { key: 'dress', label: 'Dress', subtypes: ['mini dress', 'midi dress', 'maxi dress', 'jumpsuit', 'romper'] },
  { key: 'innerwear', label: 'Innerwear', subtypes: ['bra', 'underwear', 'camisole', 'thermal', 'slip', 'nightwear'] },
  { key: 'outerwear', label: 'Outerwear', subtypes: ['jacket', 'coat', 'blazer', 'raincoat', 'puffer', 'vest'] },
  { key: 'shoes', label: 'Shoes', subtypes: ['sneakers', 'boots', 'heels', 'flats', 'sandals', 'loafers'] },
  { key: 'socks', label: 'Socks', subtypes: ['ankle socks', 'crew socks', 'knee socks', 'tights'] },
  { key: 'accessory', label: 'Accessory', subtypes: ['bag', 'belt', 'scarf', 'hat', 'jewelry', 'sunglasses', 'watch'] },
];

export const COLORS = [
  'black', 'white', 'grey', 'beige', 'brown', 'navy', 'blue', 'green',
  'olive', 'yellow', 'orange', 'red', 'pink', 'purple', 'gold', 'silver', 'multicolor',
];

export const PATTERNS = [
  'solid', 'striped', 'checked', 'floral', 'polka dot', 'animal print',
  'graphic', 'geometric', 'abstract', 'textured', 'other',
];

// Swatch colours for the colour chips.
export const COLOR_SWATCH = {
  black: '#1d1d1f', white: '#ffffff', grey: '#9a9a9f', beige: '#e3d5bd', brown: '#7a5233',
  navy: '#1f2c4f', blue: '#3a78d8', green: '#3f8f4f', olive: '#76783a', yellow: '#f2cf3c',
  orange: '#ef8a2c', red: '#d23b3b', pink: '#f0a2c0', purple: '#7d4fb3', gold: '#c9a646',
  silver: '#c4c7cc', multicolor: 'conic-gradient(#d23b3b, #f2cf3c, #3f8f4f, #3a78d8, #7d4fb3, #d23b3b)',
};

export const seasonLabel = (k) => SEASONS.find((s) => s.key === k)?.label ?? k;
export const typeLabel = (k) => TYPES.find((t) => t.key === k)?.label ?? k;
export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
