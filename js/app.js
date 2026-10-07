import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  SEASONS, ALL_YEAR, normalizeSeasons, toggleSeason, DEFAULT_OCCASIONS, DEFAULT_MATERIALS,
  TYPES, COLORS, PATTERNS, COLOR_SWATCH, SLEEVES, ALL_LENGTHS, sleevesFor, lengthsFor,
  typeLabel, capitalize,
} from './taxonomy.js';
import { processPhoto, warmUpBackgroundRemoval } from './image.js';
import { importState, startImport, stopImport, onImportProgress } from './importer.js';

const app = document.getElementById('app');

let store;
let items = null; // cached list; null means "needs loading"
let itemsLoadedAt = 0;
const ITEMS_MAX_AGE = 45 * 60 * 1000; // photo links from the cloud expire after an hour
const filters = {
  seasons: new Set(), occasions: new Set(), types: new Set(), colors: new Set(), materials: new Set(),
  sleeves: new Set(), lengths: new Set(), q: '', more: false,
};
const SET_FILTERS = ['seasons', 'occasions', 'types', 'colors', 'materials', 'sleeves', 'lengths'];
const selection = { on: false, ids: new Set() }; // grid select mode, for editing many items at once
const UNTAGGED = '__none'; // type filter value for items without a type

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

const chip = (group, value, label, on, extra = '') =>
  `<button type="button" class="chip${on ? ' on' : ''}" data-group="${group}" data-value="${esc(value)}" aria-pressed="${on}" ${extra}>${label}</button>`;

// The swinging-hanger loading screen (same markup as the first paint in index.html).
const loader = (text) =>
  `<div class="loader" role="status"><svg class="loader-hanger" viewBox="80 60 352 300" aria-hidden="true"><g><path d="M256 150a34 34 0 1 1 34-34"/><path d="M256 150v24L106 300c-16 13-7 38 13 38h274c20 0 29-25 13-38L256 174"/></g></svg><p>${text}</p></div>`;

const colorDot = (c) => `<span class="dot" style="background:${COLOR_SWATCH[c] ?? '#ccc'}"></span>`;

function allOccasions() {
  const used = (items ?? []).flatMap((i) => i.occasions ?? []);
  return [...new Set([...DEFAULT_OCCASIONS, ...used])];
}

function allMaterials() {
  const used = (items ?? []).flatMap((i) => i.materials ?? []);
  return [...new Set([...DEFAULT_MATERIALS, ...used])];
}

// Spring, Summer, Autumn, Winter and All year. Picking All year clears the seasons and
// picking a season clears All year (see toggleSeason).
const seasonChips = (selected) => SEASONS.map((x) => chip('seasons', x.key, x.label, selected.includes(x.key))).join('');

// Same shape whatever the data's age: four-season keys, and a materials list.
const normalizeItem = (i) => ({ ...i, seasons: normalizeSeasons(i.seasons), materials: i.materials ?? [] });

async function loadItems(force = false) {
  if (items && !force && Date.now() - itemsLoadedAt < ITEMS_MAX_AGE) return items;
  items = (await store.listItems()).map(normalizeItem);
  itemsLoadedAt = Date.now();
  return items;
}

// Imported photos arrive without a type; those make up the "to tag" queue, oldest first.
const needsTagging = (i) => !i.type;
const tagQueue = () =>
  (items ?? []).filter(needsTagging).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

// ---------- routing ----------

async function route() {
  const hash = location.hash || '#/';
  try {
    if (store.mode === 'cloud' && !(await store.init())) return renderSignIn();
    if (hash === '#/add') return renderEditor(null);
    if (hash === '#/import') return renderImport();
    if (hash === '#/review') return startReview();
    const m = hash.match(/^#\/(item|review)\/(.+)$/);
    if (m) return renderEditor(decodeURIComponent(m[2]), { review: m[1] === 'review' });
    return renderGrid();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="page"><p class="error">Something went wrong: ${esc(err.message)}</p>
      <button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
}

// ---------- sign in ----------

function renderSignIn() {
  app.innerHTML = `
    <div class="signin">
      <h1 class="brand">Wardrobe</h1>
      <p class="muted">Sign in once on each device to see the same wardrobe on your iPhone and Mac.
        We'll email you a link; open it on the device you want to sign in on.</p>
      <form id="email-form" class="email-signin">
        <input type="email" name="email" required placeholder="you@example.com" autocomplete="email">
        <button class="btn btn-primary">Email me a sign-in link</button>
      </form>
      <p class="muted small" id="sent" hidden></p>
    </div>`;
  const form = app.querySelector('#email-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await store.signInWithEmail(form.email.value.trim());
      const sent = app.querySelector('#sent');
      sent.textContent = `Link sent to ${form.email.value.trim()}. Check your inbox (and spam folder).`;
      sent.hidden = false;
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  };
}

// ---------- wardrobe grid ----------

function matches(item) {
  const f = filters;
  // An item matches a season (or material) filter if it has any of the picked ones.
  if (f.seasons.has(ALL_YEAR)) {
    if (!item.seasons.includes(ALL_YEAR)) return false;
  } else if (f.seasons.size && !item.seasons.includes(ALL_YEAR) && !item.seasons.some((x) => f.seasons.has(x))) {
    // All-year pieces count for every season.
    return false;
  }
  if (f.sleeves.size && !f.sleeves.has(item.sleeve)) return false;
  if (f.lengths.size && !f.lengths.has(item.length)) return false;
  if (f.materials.size && !item.materials.some((m) => f.materials.has(m))) return false;
  if (f.occasions.size && !(item.occasions ?? []).some((o) => f.occasions.has(o))) return false;
  if (f.types.size && !f.types.has(item.type || UNTAGGED)) return false;
  if (f.colors.size && !f.colors.has(item.color)) return false;
  if (f.q) {
    const hay = [item.type, item.subtype, item.color, item.pattern, item.fabric, item.fit, item.brand, item.notes, item.sleeve, item.length, ...item.materials, ...(item.tags ?? [])]
      .join(' ')
      .toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const activeFilterCount = () =>
  SET_FILTERS.reduce((n, k) => n + filters[k].size, 0) + (filters.q ? 1 : 0);

async function renderGrid() {
  app.innerHTML = loader('Loading your wardrobe…');
  await loadItems();
  const toTag = items.filter(needsTagging).length;
  app.innerHTML = `
    <header class="topbar">
      <h1 class="brand">Wardrobe</h1>
      <div class="topbar-actions">
        <a class="btn" href="#/import">Import</a>
        <a class="btn btn-primary" href="#/add">+ Add</a>
      </div>
    </header>
    ${store.mode === 'demo' ? `<p class="banner">Demo mode: items are saved in this browser only. Add Supabase settings in <code>js/config.js</code> to sync.</p>` : ''}
    <a class="banner banner-link" id="import-pill" href="#/import" hidden></a>
    ${toTag ? `<a class="banner banner-link" href="#/review"><span><strong>${toTag}</strong> photo${toTag === 1 ? '' : 's'} to tag</span><span>Start ›</span></a>` : ''}
    <section class="filters" id="filters"></section>
    <main class="grid" id="grid"></main>
    <div class="selectbar" id="selectbar" hidden></div>
    <footer class="footer muted">
      <span>${esc(store.userLabel())}</span>
      ${items.length ? `<button type="button" class="link" id="backup">Download backup</button>` : ''}
      ${store.mode === 'cloud' ? `<button type="button" class="link" id="signout">Sign out</button>` : ''}
    </footer>`;
  selection.on = false;
  selection.ids.clear();
  app.querySelector('#backup')?.addEventListener('click', downloadBackup);

  const pill = app.querySelector('#import-pill');
  const paintPill = () => {
    if (!pill.isConnected) return unsubscribe();
    pill.hidden = !importState.running;
    pill.innerHTML = `<span>Importing ${importState.done} of ${importState.total}…</span><span>View ›</span>`;
  };
  const unsubscribe = onImportProgress(paintPill);
  paintPill();

  app.querySelector('#signout')?.addEventListener('click', async () => {
    if (importState.running) return toast('Wait for the import to finish first.', true);
    if (confirm('Sign out on this device?')) {
      await store.signOut();
      items = null;
      route();
    }
  });
  renderFilters();
  renderCards();
}

function renderFilters() {
  const el = app.querySelector('#filters');
  const f = filters;
  el.innerHTML = `
    <div class="filter-row" aria-label="Season">
      ${SEASONS.map((s) => chip('seasons', s.key, s.label, f.seasons.has(s.key))).join('')}
    </div>
    <div class="filter-row" aria-label="Occasion">
      ${allOccasions().map((o) => chip('occasions', o, capitalize(o), f.occasions.has(o))).join('')}
    </div>
    <div class="filter-tools">
      <button type="button" class="link" id="more">${f.more ? 'Fewer filters' : 'More filters'}</button>
      ${activeFilterCount() ? `<button type="button" class="link" id="clear">Clear all</button>` : ''}
      <span class="muted count" id="count"></span>
      ${items.length ? `<button type="button" class="link" id="select">${selection.on ? 'Done' : 'Select'}</button>` : ''}
    </div>
    ${f.more ? `
      <div class="filter-row" aria-label="Type">
        ${items.some(needsTagging) ? chip('types', UNTAGGED, 'To tag', f.types.has(UNTAGGED)) : ''}
        ${TYPES.map((t) => chip('types', t.key, t.label, f.types.has(t.key))).join('')}
      </div>
      <div class="filter-row" aria-label="Color">
        ${COLORS.map((c) => chip('colors', c, colorDot(c) + capitalize(c), f.colors.has(c))).join('')}
      </div>
      <div class="filter-row" aria-label="Material">
        ${allMaterials().map((m) => chip('materials', m, capitalize(m), f.materials.has(m))).join('')}
      </div>
      <div class="filter-row" aria-label="Sleeve">
        ${SLEEVES.map((x) => chip('sleeves', x, capitalize(x), f.sleeves.has(x))).join('')}
      </div>
      <div class="filter-row" aria-label="Length">
        ${ALL_LENGTHS.map((x) => chip('lengths', x, capitalize(x), f.lengths.has(x))).join('')}
      </div>
      <input type="search" id="search" placeholder="Search brand, notes, tags…" value="${esc(f.q)}">` : ''}`;

  el.onclick = (e) => {
    const c = e.target.closest('.chip');
    if (c) {
      const { group, value } = c.dataset;
      const set = filters[group];
      if (group === 'seasons') {
        // Same rule as when tagging: All year and the four seasons exclude each other.
        if (value === ALL_YEAR) {
          const wasOn = set.has(ALL_YEAR);
          set.clear();
          if (!wasOn) set.add(ALL_YEAR);
        } else {
          set.delete(ALL_YEAR);
          set.has(value) ? set.delete(value) : set.add(value);
        }
      } else {
        set.has(value) ? set.delete(value) : set.add(value);
      }
      return renderFilters(), renderCards();
    }
    if (e.target.id === 'more') return (filters.more = !filters.more), renderFilters();
    if (e.target.id === 'select') return setSelecting(!selection.on);
    if (e.target.id === 'clear') {
      SET_FILTERS.forEach((k) => filters[k].clear());
      filters.q = '';
      return renderFilters(), renderCards();
    }
  };
  const search = el.querySelector('#search');
  if (search) {
    search.oninput = () => {
      filters.q = search.value.trim();
      renderCards();
    };
  }
}

function renderCards() {
  const grid = app.querySelector('#grid');
  const shown = items.filter(matches);
  app.querySelector('#count').textContent = `${shown.length} of ${items.length}`;
  if (!items.length) {
    grid.innerHTML = `<div class="empty"><p>Your wardrobe is empty.</p>
      <div class="empty-actions"><a class="btn btn-primary" href="#/import">Import photos</a><a class="btn" href="#/add">Add one piece</a></div></div>`;
    return;
  }
  if (!shown.length) {
    grid.innerHTML = `<div class="empty"><p>Nothing matches these filters.</p></div>`;
    return;
  }
  grid.innerHTML = shown
    .map(
      (i) => `
      <a class="card${selection.ids.has(i.id) ? ' selected' : ''}" href="#/item/${encodeURIComponent(i.id)}" data-id="${esc(i.id)}">
        <div class="card-img">${selection.on ? `<span class="check" aria-hidden="true">${selection.ids.has(i.id) ? '✓' : ''}</span>` : ''}${i.thumbUrl ? `<img src="${esc(i.thumbUrl)}" alt="" loading="lazy" crossorigin="anonymous">` : ''}</div>
        <div class="card-label">${needsTagging(i) ? '<span class="to-tag">To tag</span>' : esc(capitalize(i.subtype || typeLabel(i.type)))}</div>
      </a>`,
    )
    .join('');
  grid.classList.toggle('selecting', selection.on);
  grid.onclick = (e) => {
    const card = e.target.closest('.card');
    if (!card || !selection.on) return;
    e.preventDefault();
    const id = card.dataset.id;
    const on = !selection.ids.has(id);
    on ? selection.ids.add(id) : selection.ids.delete(id);
    // Update just this card; redrawing a grid of hundreds on every tap would be sluggish.
    card.classList.toggle('selected', on);
    card.querySelector('.check').textContent = on ? '✓' : '';
    paintSelectBar();
  };
}

// ---------- select many + edit together ----------

function setSelecting(on) {
  selection.on = on;
  selection.ids.clear();
  renderFilters();
  renderCards();
  paintSelectBar();
}

function paintSelectBar() {
  const bar = app.querySelector('#selectbar');
  if (!bar) return;
  bar.hidden = !selection.on;
  if (!selection.on) return;
  const n = selection.ids.size;
  bar.innerHTML = `
    <span>${n} selected</span>
    <button type="button" class="link" id="sel-all" title="Select everything currently shown">All</button>
    <span class="spacer-flex"></span>
    <button type="button" class="btn" id="sel-cancel">Cancel</button>
    <button type="button" class="btn btn-primary" id="sel-edit" ${n ? '' : 'disabled'}>Edit ${n || ''}</button>`;
  bar.querySelector('#sel-all').onclick = () => {
    items.filter(matches).forEach((i) => selection.ids.add(i.id));
    renderCards();
    paintSelectBar();
  };
  bar.querySelector('#sel-cancel').onclick = () => setSelecting(false);
  bar.querySelector('#sel-edit').onclick = openBatchSheet;
}

// Only the fields she touches are changed. Type, color and pattern are replaced;
// seasons are replaced if any are picked; occasions are added to what each item has.
function openBatchSheet() {
  const ids = [...selection.ids];
  if (!ids.length) return;
  const pick = { type: '', color: '', pattern: '', sleeve: '', length: '', seasons: [], occasions: [], materials: [], photo: '' };
  const withOriginal = ids.filter((id) => items.find((i) => i.id === id)?.original_photo_path).length;
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  document.body.append(sheet);
  const close = () => sheet.remove();
  const plural = ids.length === 1 ? '' : 's';

  function paint() {
    sheet.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Edit ${ids.length} items">
        <div class="sheet-head">
          <strong>Edit ${ids.length} item${plural}</strong>
          <button type="button" class="btn btn-ghost" data-act="close">Close</button>
        </div>
        <p class="muted small">Only what you pick here changes. Everything else stays as it is.</p>
        <fieldset><legend>Type</legend>
          <div class="chips">${TYPES.map((t) => chip('type', t.key, t.label, pick.type === t.key)).join('')}</div></fieldset>
        <fieldset><legend>Color</legend>
          <div class="chips">${COLORS.map((c) => chip('color', c, colorDot(c) + capitalize(c), pick.color === c)).join('')}</div></fieldset>
        <fieldset><legend>Pattern</legend>
          <div class="chips">${PATTERNS.map((x) => chip('pattern', x, capitalize(x), pick.pattern === x)).join('')}</div></fieldset>
        <fieldset><legend>Sleeve <span class="muted">(tops, dresses, outerwear)</span></legend>
          <div class="chips">${SLEEVES.map((x) => chip('sleeve', x, capitalize(x), pick.sleeve === x)).join('')}</div></fieldset>
        <fieldset><legend>Length <span class="muted">(only where it fits the type)</span></legend>
          <div class="chips">${ALL_LENGTHS.map((x) => chip('length', x, capitalize(x), pick.length === x)).join('')}</div></fieldset>
        <fieldset><legend>Season <span class="muted">(replaces their seasons)</span></legend>
          <div class="chips">${seasonChips(pick.seasons)}</div></fieldset>
        <fieldset><legend>Add occasion</legend>
          <div class="chips">${allOccasions().map((o) => chip('occasions', o, capitalize(o), pick.occasions.includes(o))).join('')}</div></fieldset>
        <fieldset><legend>Add material</legend>
          <div class="chips">${allMaterials().map((m) => chip('materials', m, capitalize(m), pick.materials.includes(m))).join('')}</div></fieldset>
        ${withOriginal ? `
        <fieldset><legend>Photo <span class="muted">(${withOriginal} of these ${withOriginal === 1 ? 'has' : 'have'} an original)</span></legend>
          <div class="chips">${chip('photo', 'cutout', 'Cut-out', pick.photo === 'cutout')}${chip('photo', 'original', 'Original (undo background removal)', pick.photo === 'original')}</div></fieldset>` : ''}
        <div class="editor-actions">
          <button type="button" class="btn btn-danger" data-act="delete">Delete ${ids.length}</button>
          <button type="button" class="btn btn-primary" data-act="apply">Apply</button>
        </div>
      </div>`;
  }

  async function applyChanges(button) {
    const updates = ids.map((id) => {
      const item = items.find((i) => i.id === id);
      const fields = {};
      if (pick.type) fields.type = pick.type;
      if (pick.color) fields.color = pick.color;
      if (pick.pattern) fields.pattern = pick.pattern;
      // Sleeve and length only go on items whose type (possibly set just now) has them.
      const type = fields.type ?? item.type;
      if (pick.sleeve && sleevesFor(type).includes(pick.sleeve)) fields.sleeve = pick.sleeve;
      if (pick.length && lengthsFor(type).includes(pick.length)) fields.length = pick.length;
      if (pick.seasons.length) fields.seasons = pick.seasons;
      if (pick.occasions.length) fields.occasions = [...new Set([...(item.occasions ?? []), ...pick.occasions])];
      if (pick.materials.length) fields.materials = [...new Set([...item.materials, ...pick.materials])];
      // Only items that kept an original can switch photos.
      if (pick.photo && item.original_photo_path) fields.use_original = pick.photo === 'original';
      return { id, fields };
    }).filter((u) => Object.keys(u.fields).length);
    if (!updates.length) return toast('Pick something to change first.', true);
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await store.updateItems(updates);
      for (const { id, fields } of updates) Object.assign(items.find((i) => i.id === id), fields);
      // A photo switch changes grid thumbnails, so reload the list.
      if (pick.photo) items = null;
      toast(`Updated ${updates.length} item${updates.length === 1 ? '' : 's'}`);
    } catch (err) {
      // Some may have saved before the failure; reload to show the real state.
      toast('Saving failed: ' + err.message, true);
      items = null;
    }
    close();
    renderGrid();
  }

  async function deleteSelected(button) {
    if (!confirm(`Delete ${ids.length} item${plural}? This cannot be undone.`)) return;
    button.disabled = true;
    try {
      await store.deleteItems(ids);
      items = items.filter((i) => !ids.includes(i.id));
      toast(`Deleted ${ids.length}`);
    } catch (err) {
      toast('Delete failed: ' + err.message, true);
      items = null;
    }
    close();
    renderGrid();
  }

  sheet.onclick = (e) => {
    if (e.target === sheet) return close();
    const c = e.target.closest('.chip');
    if (c) {
      const { group, value } = c.dataset;
      if (group === 'seasons') {
        pick.seasons = toggleSeason(pick.seasons, value);
      } else if (Array.isArray(pick[group])) {
        pick[group] = pick[group].includes(value) ? pick[group].filter((x) => x !== value) : [...pick[group], value];
      } else {
        pick[group] = pick[group] === value ? '' : value;
      }
      return paint();
    }
    const button = e.target.closest('[data-act]');
    if (button?.dataset.act === 'close') close();
    if (button?.dataset.act === 'delete') deleteSelected(button);
    if (button?.dataset.act === 'apply') applyChanges(button);
  };
  paint();
}

// ---------- backup ----------

const BACKUP_FIELDS = [
  'id', 'created_at', 'updated_at', 'seasons', 'occasions', 'type', 'subtype',
  'color', 'pattern', 'sleeve', 'length', 'materials', 'fabric', 'fit', 'brand', 'notes', 'tags',
];

// Everything she has entered plus each full-size photo, as one zip file.
async function downloadBackup(e) {
  const button = e.target;
  if (importState.running) return toast('Wait for the import to finish first.', true);
  button.disabled = true;
  const status = (t) => (button.textContent = t);
  try {
    status('Preparing…');
    const { zipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm');
    const all = await loadItems(true);
    const files = {};
    const records = [];
    const queue = [...all];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const record = Object.fromEntries(BACKUP_FIELDS.map((k) => [k, item[k] ?? null]));
        try {
          const blob = await store.downloadPhoto(item);
          const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
          record.photo_file = `photos/${item.id}.${ext}`;
          // Photos are already compressed; storing them as-is keeps zipping fast.
          files[record.photo_file] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
          record.use_original = !!item.use_original;
          if (item.original_photo_path) {
            const original = await store.downloadPhoto(item, 'original');
            record.original_file = `photos/${item.id}-original.jpg`;
            files[record.original_file] = [new Uint8Array(await original.arrayBuffer()), { level: 0 }];
          }
        } catch (err) {
          console.warn('Photo missing from backup', item.id, err);
          record.photo_file = null;
        }
        records.push(record);
        status(`Saving photos… ${records.length} of ${all.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    records.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const json = JSON.stringify({ app: 'wardrobe', version: 1, exported_at: new Date().toISOString(), items: records }, null, 2);
    files['items.json'] = new TextEncoder().encode(json);
    status('Zipping…');
    const zip = zipSync(files);
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `wardrobe-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    const missing = records.filter((r) => !r.photo_file).length;
    toast(missing ? `Backup saved; ${missing} photo${missing === 1 ? '' : 's'} could not be included.` : 'Backup saved');
  } catch (err) {
    console.error(err);
    toast('Backup failed: ' + err.message, true);
  } finally {
    button.disabled = false;
    status('Download backup');
  }
}

// ---------- add / edit ----------

const EMPTY = {
  seasons: [], occasions: [], type: '', subtype: '', sleeve: '', length: '', color: '', pattern: '', materials: [],
  fit: '', brand: '', notes: '', tags: [],
};

// Next untagged item after `id` in the queue, wrapping around; null when none are left.
// Uses the position among all items, so it still works once `id` itself has been tagged.
function nextToTag(id) {
  const all = [...(items ?? [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const at = all.findIndex((i) => i.id === id);
  const rotated = at < 0 ? all : [...all.slice(at + 1), ...all.slice(0, at)];
  return rotated.find((i) => i.id !== id && needsTagging(i)) ?? null;
}

async function startReview() {
  await loadItems();
  const first = tagQueue()[0];
  if (!first) {
    toast('Nothing left to tag.');
    return location.replace('#/');
  }
  location.replace(`#/review/${encodeURIComponent(first.id)}`);
}

function goToNextOrFinish(id) {
  const next = nextToTag(id);
  if (next) {
    location.hash = `#/review/${encodeURIComponent(next.id)}`;
  } else {
    toast('All photos tagged.');
    location.hash = '#/';
  }
}

// `review`: tagging imported photos one after another (Save & next, Skip, swipe to skip).
async function renderEditor(id, { review = false } = {}) {
  app.innerHTML = loader('Loading…');
  await loadItems();
  const existing = id ? await store.getItem(id) : null;
  const left = review ? tagQueue().length : 0;
  const draft = { ...EMPTY, ...(existing ? normalizeItem(existing) : {}) };
  let images = null; // set when a new photo was processed
  // The two versions of the photo: the cut-out (or only photo) and, when the background was
  // removed, the untouched original. `useOriginal` is which one the item shows.
  const versions = { cutout: existing?.cutoutUrl ?? null, original: existing?.originalUrl ?? null };
  let useOriginal = !!(existing?.use_original && versions.original);
  // Imported items only have a color if it was guessed from the photo.
  let colorGuessed = review && !!draft.color;
  const occasionChoices = allOccasions();
  const materialChoices = allMaterials();

  if (!review) warmUpBackgroundRemoval();

  app.innerHTML = `
    <header class="topbar">
      <a class="btn btn-ghost" href="#/">‹ Back</a>
      <h1 class="title">${review ? 'Tag photos' : existing ? 'Edit item' : 'Add item'}</h1>
      <span class="spacer muted">${review ? `${left} left` : ''}</span>
    </header>
    <form class="editor" id="editor" novalidate>
      <section class="photo-box">
        <div class="photo-preview${review ? ' compact' : ''}" id="preview"></div>
        <div class="segmented" id="version" role="group" aria-label="Which photo to show" hidden>
          <button type="button" data-version="cutout">Cut-out</button>
          <button type="button" data-version="original">Original</button>
        </div>
        <p class="muted status" id="status">${review ? 'Swipe the photo left to skip it for now.' : ''}</p>
        ${review ? '' : `
        <div class="photo-actions">
          <label class="btn">Take photo<input type="file" accept="image/*" capture="environment" hidden id="camera"></label>
          <label class="btn">Choose photo<input type="file" accept="image/*" hidden id="library"></label>
        </div>
        <label class="toggle"><input type="checkbox" id="removeBg" checked> Remove background</label>`}
      </section>

      <fieldset>
        <legend>Season <span class="muted">(pick any)</span></legend>
        <div class="chips" id="f-seasons"></div>
      </fieldset>

      <fieldset>
        <legend>Occasion</legend>
        <div class="chips" id="f-occasions"></div>
        <div class="inline-add">
          <input type="text" id="new-occasion" placeholder="Add your own occasion">
          <button type="button" class="btn" id="add-occasion">Add</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Type</legend>
        <div class="chips" id="f-type"></div>
        <div class="subclass" id="sub-sleeve"><span class="sublabel">Sleeve</span><div class="chips" id="f-sleeve"></div></div>
        <div class="subclass" id="sub-length"><span class="sublabel">Length</span><div class="chips" id="f-length"></div></div>
        <label class="field">Subtype
          <input type="text" name="subtype" list="subtypes" autocomplete="off">
          <datalist id="subtypes"></datalist>
        </label>
      </fieldset>

      <fieldset>
        <legend>Color <span class="hint" id="color-hint" hidden>guessed from the photo</span></legend>
        <div class="chips" id="f-color"></div>
      </fieldset>

      <fieldset>
        <legend>Pattern</legend>
        <div class="chips" id="f-pattern"></div>
      </fieldset>

      <fieldset>
        <legend>Material <span class="muted">(optional)</span></legend>
        <div class="chips" id="f-materials"></div>
        <div class="inline-add">
          <input type="text" id="new-material" placeholder="Add another material">
          <button type="button" class="btn" id="add-material">Add</button>
        </div>
      </fieldset>

      <details class="details" ${review ? '' : 'open'}>
        <summary>Details <span class="muted">(optional)</span></summary>
        <label class="field">Fit <input type="text" name="fit"></label>
        <label class="field">Brand <input type="text" name="brand"></label>
        <label class="field">Tags <input type="text" name="tags" placeholder="comma separated"></label>
        <label class="field">Notes <textarea name="notes" rows="3"></textarea></label>
      </details>

      <div class="editor-actions${review ? ' sticky' : ''}">
        ${existing ? `<button type="button" class="btn btn-danger" id="delete">Delete</button>` : ''}
        ${review ? `<button type="button" class="btn" id="skip">Skip</button>` : ''}
        <button type="submit" class="btn btn-primary" id="save">${review ? 'Save &amp; next' : 'Save'}</button>
      </div>
    </form>`;

  const form = app.querySelector('#editor');
  const $ = (sel) => form.querySelector(sel);
  const setStatus = (t) => ($('#status').textContent = t);

  // Text inputs ↔ draft
  for (const name of ['subtype', 'fit', 'brand', 'notes']) form.elements[name].value = draft[name] ?? '';
  form.elements.tags.value = (draft.tags ?? []).join(', ');

  function paintPreview() {
    const url = useOriginal ? versions.original : versions.cutout;
    $('#preview').innerHTML = url
      ? `<img src="${esc(url)}" alt="Item photo" crossorigin="anonymous">`
      : `<span class="muted">No photo yet</span>`;
    $('#version').hidden = !versions.original;
    for (const b of $('#version').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String((b.dataset.version === 'original') === useOriginal));
    }
  }
  $('#version').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    useOriginal = b.dataset.version === 'original';
    paintPreview();
  };

  function paintChips() {
    $('#f-seasons').innerHTML = seasonChips(draft.seasons);
    const mats = [...new Set([...materialChoices, ...draft.materials])];
    $('#f-materials').innerHTML = mats.map((m) => chip('materials', m, capitalize(m), draft.materials.includes(m))).join('');
    const occ = [...new Set([...occasionChoices, ...draft.occasions])];
    $('#f-occasions').innerHTML = occ.map((o) => chip('occasions', o, capitalize(o), draft.occasions.includes(o))).join('');
    $('#f-type').innerHTML = TYPES.map((t) => chip('type', t.key, t.label, draft.type === t.key)).join('');
    // Sleeve and length choices depend on the type; hide them when the type has none.
    const sleeves = sleevesFor(draft.type);
    const lengths = lengthsFor(draft.type);
    $('#sub-sleeve').hidden = !sleeves.length;
    $('#sub-length').hidden = !lengths.length;
    $('#f-sleeve').innerHTML = sleeves.map((x) => chip('sleeve', x, capitalize(x), draft.sleeve === x)).join('');
    $('#f-length').innerHTML = lengths.map((x) => chip('length', x, capitalize(x), draft.length === x)).join('');
    $('#f-color').innerHTML = COLORS.map((c) => chip('color', c, colorDot(c) + capitalize(c), draft.color === c)).join('');
    $('#f-pattern').innerHTML = PATTERNS.map((p) => chip('pattern', p, capitalize(p), draft.pattern === p)).join('');
    const subs = TYPES.find((t) => t.key === draft.type)?.subtypes ?? TYPES.flatMap((t) => t.subtypes);
    $('#subtypes').innerHTML = subs.map((s) => `<option value="${esc(s)}">`).join('');
    $('#color-hint').hidden = !colorGuessed;
  }

  form.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const { group, value } = c.dataset;
    if (group === 'seasons') {
      draft.seasons = toggleSeason(draft.seasons, value);
    } else if (group === 'occasions' || group === 'materials') {
      const list = draft[group];
      draft[group] = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    } else {
      draft[group] = draft[group] === value ? '' : value;
      if (group === 'color') colorGuessed = false;
    }
    paintChips();
  });

  // Typing your own occasion or material adds and selects it.
  for (const list of ['occasions', 'materials']) {
    const one = list === 'occasions' ? 'occasion' : 'material';
    const input = $(`#new-${one}`);
    $(`#add-${one}`).onclick = () => {
      const v = input.value.trim().toLowerCase();
      if (!v) return;
      if (!draft[list].includes(v)) draft[list].push(v);
      input.value = '';
      paintChips();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $(`#add-${one}`).click();
      }
    };
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    $('#save').disabled = true;
    try {
      const result = await processPhoto(file, { removeBackground: $('#removeBg').checked, onStatus: setStatus });
      images = { photo: result.photo, thumb: result.thumb, original: result.original };
      versions.cutout = URL.createObjectURL(result.photo);
      versions.original = result.original ? URL.createObjectURL(result.original.photo) : null;
      useOriginal = false;
      paintPreview();
      if (result.color && (!draft.color || colorGuessed)) {
        draft.color = result.color;
        colorGuessed = true;
        paintChips();
      }
      setStatus(result.backgroundRemoved || !$('#removeBg').checked ? '' : 'Background removal unavailable; kept the original photo.');
    } catch (err) {
      console.error(err);
      setStatus('Could not read that photo: ' + err.message);
    } finally {
      $('#save').disabled = false;
    }
  }
  if (!review) {
    $('#camera').onchange = onPhoto;
    $('#library').onchange = onPhoto;
  } else {
    $('#skip').onclick = () => goToNextOrFinish(existing.id);
    // Swipe left on the photo to skip.
    let startX = null;
    let startY = null;
    const preview = $('#preview');
    preview.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    preview.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      startX = null;
      if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) goToNextOrFinish(existing.id);
    });
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!images && !existing) return toast('Add a photo first.', true);
    if (!draft.seasons.length) return toast('Pick at least one season.', true);
    if (!draft.type) return toast('Pick a type.', true);
    const fields = {
      seasons: draft.seasons,
      occasions: draft.occasions,
      type: draft.type,
      subtype: form.elements.subtype.value.trim() || null,
      color: draft.color || null,
      pattern: draft.pattern || null,
      // Kept only if it fits the chosen type (e.g. no sleeve on shoes).
      sleeve: sleevesFor(draft.type).includes(draft.sleeve) ? draft.sleeve : null,
      length: lengthsFor(draft.type).includes(draft.length) ? draft.length : null,
      materials: draft.materials,
      fit: form.elements.fit.value.trim() || null,
      brand: form.elements.brand.value.trim() || null,
      notes: form.elements.notes.value.trim() || null,
      tags: form.elements.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
      use_original: useOriginal && !!versions.original,
    };
    $('#save').disabled = true;
    $('#save').textContent = 'Saving…';
    try {
      await store.saveItem(existing?.id ?? null, fields, images);
      // Patch the cached list instead of reloading it, so tagging many photos stays quick.
      // (Switching photo version changes the grid thumbnail, so that needs a reload.)
      const cached = existing && !images && items?.find((i) => i.id === existing.id);
      if (cached && !!cached.use_original === fields.use_original) Object.assign(cached, fields);
      else items = null;
      if (review && !items) await loadItems();
      if (review) {
        window.scrollTo(0, 0);
        return goToNextOrFinish(existing.id);
      }
      toast('Saved');
      location.hash = '#/';
    } catch (err) {
      console.error(err);
      toast('Save failed: ' + err.message, true);
      $('#save').disabled = false;
      $('#save').textContent = review ? 'Save & next' : 'Save';
    }
  };

  if (existing) {
    $('#delete').onclick = async () => {
      if (!confirm('Delete this item? This cannot be undone.')) return;
      try {
        await store.deleteItem(existing.id);
        toast('Deleted');
        if (review) {
          const next = nextToTag(existing.id);
          items = items.filter((i) => i.id !== existing.id);
          location.hash = next ? `#/review/${encodeURIComponent(next.id)}` : '#/';
          return;
        }
        items = null;
        location.hash = '#/';
      } catch (err) {
        toast('Delete failed: ' + err.message, true);
      }
    };
  }

  paintPreview();
  paintChips();
}

// ---------- bulk import ----------

const importDefaults = { seasons: [], occasions: [], removeBackground: true };

async function renderImport() {
  await loadItems();
  const d = importDefaults;
  const occasions = allOccasions();

  app.innerHTML = `
    <header class="topbar">
      <a class="btn btn-ghost" href="#/">‹ Back</a>
      <h1 class="title">Import photos</h1>
      <span class="spacer"></span>
    </header>
    <div class="editor" id="import"></div>`;
  const root = app.querySelector('#import');

  function paint() {
    if (!root.isConnected) return unsubscribe();
    const st = importState;
    if (st.running || st.finished) {
      const pct = st.total ? Math.round(((st.done + st.failed.length) / st.total) * 100) : 0;
      const toTag = st.running ? 0 : tagQueue().length;
      root.innerHTML = `
        <section class="import-progress">
          <p><strong>${st.running ? 'Importing' : st.stopRequested ? 'Stopped' : 'Done'}:</strong>
            ${st.done} of ${st.total} saved${st.failed.length ? `, ${st.failed.length} failed` : ''}</p>
          <div class="progress"><div style="width:${pct}%"></div></div>
          <p class="muted status">${esc(st.status)}</p>
          ${st.running ? `<p class="muted small">Keep the app open with the screen on. You can browse the wardrobe meanwhile.</p>` : ''}
          <div class="recent">${st.recent.map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>
          ${st.failed.length ? `<details class="small"><summary>Photos that failed</summary><p>${st.failed.map(esc).join(', ')}</p></details>` : ''}
          <div class="editor-actions">
            ${st.running
              ? `<button type="button" class="btn" id="stop" ${st.stopRequested ? 'disabled' : ''}>Stop</button>`
              : `<button type="button" class="btn" id="again">Import more</button>
                 ${toTag ? `<a class="btn btn-primary" href="#/review">Tag ${toTag} photo${toTag === 1 ? '' : 's'}</a>` : `<a class="btn btn-primary" href="#/">Done</a>`}`}
          </div>
        </section>`;
      root.querySelector('#stop')?.addEventListener('click', stopImport);
      root.querySelector('#again')?.addEventListener('click', () => {
        importState.finished = false;
        paint();
      });
      return;
    }

    root.innerHTML = `
      <p class="muted">Pick as many photos as you like. Each gets its background removed and is saved
        straight away; afterwards you tag them one by one.</p>
      <fieldset>
        <legend>Season for all of them <span class="muted">(optional)</span></legend>
        <div class="chips">${seasonChips(d.seasons)}</div>
      </fieldset>
      <fieldset>
        <legend>Occasion for all of them <span class="muted">(optional)</span></legend>
        <div class="chips">${occasions.map((o) => chip('occasions', o, capitalize(o), d.occasions.includes(o))).join('')}</div>
      </fieldset>
      <label class="toggle"><input type="checkbox" id="removeBg" ${d.removeBackground ? 'checked' : ''}> Remove backgrounds</label>
      <div class="editor-actions">
        <label class="btn btn-primary">Choose photos<input type="file" accept="image/*" multiple hidden id="files"></label>
      </div>`;

    root.onclick = (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      if (c.dataset.group === 'seasons') {
        d.seasons = toggleSeason(d.seasons, c.dataset.value);
      } else {
        const list = d[c.dataset.group];
        const v = c.dataset.value;
        d[c.dataset.group] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
      }
      paint();
    };
    root.querySelector('#removeBg').onchange = (e) => (d.removeBackground = e.target.checked);
    root.querySelector('#files').onchange = (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      root.onclick = null;
      if (d.removeBackground) warmUpBackgroundRemoval();
      startImport(store, files, { ...d })
        .catch((err) => toast('Import failed: ' + err.message, true))
        .finally(async () => {
          // Reload so the new photos (and the "to tag" count) show up.
          items = null;
          await loadItems().catch(() => {});
          paint();
        });
    };
  }

  const unsubscribe = onImportProgress(paint);
  paint();
}

// ---------- boot ----------

async function boot() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createSupabaseStore } = await import('./store-supabase.js');
    store = createSupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    const { createLocalStore } = await import('./store-local.js');
    store = createLocalStore();
  }
  let signedIn = !!(await store.init());
  // Re-render only when sign-in state actually flips (not on token refreshes).
  store.onAuthChange((session) => {
    if (!!session === signedIn) return;
    signedIn = !!session;
    items = null;
    route();
  });
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
