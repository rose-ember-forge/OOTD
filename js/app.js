import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  SEASONS, DEFAULT_OCCASIONS, TYPES, COLORS, PATTERNS, COLOR_SWATCH,
  seasonLabel, typeLabel, capitalize,
} from './taxonomy.js';
import { processPhoto, warmUpBackgroundRemoval } from './image.js';
import { importState, startImport, stopImport, onImportProgress } from './importer.js';

const app = document.getElementById('app');

let store;
let items = null; // cached list; null means "needs loading"
let itemsLoadedAt = 0;
const ITEMS_MAX_AGE = 45 * 60 * 1000; // photo links from the cloud expire after an hour
const filters = { seasons: new Set(), occasions: new Set(), types: new Set(), colors: new Set(), q: '', more: false };

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

const colorDot = (c) => `<span class="dot" style="background:${COLOR_SWATCH[c] ?? '#ccc'}"></span>`;

function allOccasions() {
  const used = (items ?? []).flatMap((i) => i.occasions ?? []);
  return [...new Set([...DEFAULT_OCCASIONS, ...used])];
}

async function loadItems(force = false) {
  if (items && !force && Date.now() - itemsLoadedAt < ITEMS_MAX_AGE) return items;
  items = await store.listItems();
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
      <p class="muted">Sign in once on each device to see the same wardrobe on your iPhone and Mac.</p>
      <button class="btn btn-apple" id="apple">Sign in with Apple</button>
      <details class="email-signin">
        <summary>Use an email link instead</summary>
        <form id="email-form">
          <input type="email" name="email" required placeholder="you@example.com" autocomplete="email">
          <button class="btn">Send link</button>
        </form>
      </details>
    </div>`;
  app.querySelector('#apple').onclick = () => store.signInWithApple().catch((e) => toast(e.message, true));
  app.querySelector('#email-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await store.signInWithEmail(e.target.email.value);
      toast('Check your email for the sign-in link.');
    } catch (err) {
      toast(err.message, true);
    }
  };
}

// ---------- wardrobe grid ----------

function matches(item) {
  const f = filters;
  if (f.seasons.size) {
    const s = item.seasons ?? [];
    // All-year pieces belong in every season.
    if (!s.includes('all_year') && !s.some((x) => f.seasons.has(x))) return false;
  }
  if (f.occasions.size && !(item.occasions ?? []).some((o) => f.occasions.has(o))) return false;
  if (f.types.size && !f.types.has(item.type)) return false;
  if (f.colors.size && !f.colors.has(item.color)) return false;
  if (f.q) {
    const hay = [item.type, item.subtype, item.color, item.pattern, item.fabric, item.fit, item.brand, item.notes, ...(item.tags ?? [])]
      .join(' ')
      .toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const activeFilterCount = () =>
  filters.seasons.size + filters.occasions.size + filters.types.size + filters.colors.size + (filters.q ? 1 : 0);

async function renderGrid() {
  app.innerHTML = `<div class="page"><p class="muted">Loading…</p></div>`;
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
    <footer class="footer muted">
      <span>${esc(store.userLabel())}</span>
      ${store.mode === 'cloud' ? `<button type="button" class="link" id="signout">Sign out</button>` : ''}
    </footer>`;

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
    </div>
    ${f.more ? `
      <div class="filter-row" aria-label="Type">
        ${TYPES.map((t) => chip('types', t.key, t.label, f.types.has(t.key))).join('')}
      </div>
      <div class="filter-row" aria-label="Color">
        ${COLORS.map((c) => chip('colors', c, colorDot(c) + capitalize(c), f.colors.has(c))).join('')}
      </div>
      <input type="search" id="search" placeholder="Search brand, fabric, notes…" value="${esc(f.q)}">` : ''}`;

  el.onclick = (e) => {
    const c = e.target.closest('.chip');
    if (c) {
      const set = filters[c.dataset.group];
      set.has(c.dataset.value) ? set.delete(c.dataset.value) : set.add(c.dataset.value);
      return renderFilters(), renderCards();
    }
    if (e.target.id === 'more') return (filters.more = !filters.more), renderFilters();
    if (e.target.id === 'clear') {
      ['seasons', 'occasions', 'types', 'colors'].forEach((k) => filters[k].clear());
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
      <a class="card" href="#/item/${encodeURIComponent(i.id)}">
        <div class="card-img">${i.thumbUrl ? `<img src="${esc(i.thumbUrl)}" alt="" loading="lazy">` : ''}</div>
        <div class="card-label">${needsTagging(i) ? '<span class="to-tag">To tag</span>' : esc(capitalize(i.subtype || typeLabel(i.type)))}</div>
      </a>`,
    )
    .join('');
}

// ---------- add / edit ----------

const EMPTY = {
  seasons: [], occasions: [], type: '', subtype: '', color: '', pattern: '',
  fabric: '', fit: '', brand: '', notes: '', tags: [],
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
  app.innerHTML = `<div class="page"><p class="muted">Loading…</p></div>`;
  await loadItems();
  const existing = id ? await store.getItem(id) : null;
  const left = review ? tagQueue().length : 0;
  const draft = { ...EMPTY, ...(existing ?? {}) };
  let images = null; // set when a new photo was processed
  let previewUrl = existing?.photoUrl ?? null;
  const occasionChoices = allOccasions();

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
        <p class="muted status" id="status">${review ? 'Swipe the photo left to skip it for now.' : ''}</p>
        ${review ? '' : `
        <div class="photo-actions">
          <label class="btn">Take photo<input type="file" accept="image/*" capture="environment" hidden id="camera"></label>
          <label class="btn">Choose photo<input type="file" accept="image/*" hidden id="library"></label>
        </div>
        <label class="toggle"><input type="checkbox" id="removeBg" checked> Remove background</label>`}
      </section>

      <fieldset>
        <legend>Season <span class="muted">(pick one or more)</span></legend>
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
        <label class="field">Subtype
          <input type="text" name="subtype" list="subtypes" autocomplete="off">
          <datalist id="subtypes"></datalist>
        </label>
      </fieldset>

      <fieldset>
        <legend>Color</legend>
        <div class="chips" id="f-color"></div>
      </fieldset>

      <fieldset>
        <legend>Pattern</legend>
        <div class="chips" id="f-pattern"></div>
      </fieldset>

      <details class="details" ${review ? '' : 'open'}>
        <summary>Details <span class="muted">(optional)</span></summary>
        <label class="field">Fabric <input type="text" name="fabric"></label>
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
  for (const name of ['subtype', 'fabric', 'fit', 'brand', 'notes']) form.elements[name].value = draft[name] ?? '';
  form.elements.tags.value = (draft.tags ?? []).join(', ');

  function paintPreview() {
    $('#preview').innerHTML = previewUrl
      ? `<img src="${esc(previewUrl)}" alt="Item photo">`
      : `<span class="muted">No photo yet</span>`;
  }

  function paintChips() {
    $('#f-seasons').innerHTML = SEASONS.map((s) => chip('seasons', s.key, s.label, draft.seasons.includes(s.key))).join('');
    const occ = [...new Set([...occasionChoices, ...draft.occasions])];
    $('#f-occasions').innerHTML = occ.map((o) => chip('occasions', o, capitalize(o), draft.occasions.includes(o))).join('');
    $('#f-type').innerHTML = TYPES.map((t) => chip('type', t.key, t.label, draft.type === t.key)).join('');
    $('#f-color').innerHTML = COLORS.map((c) => chip('color', c, colorDot(c) + capitalize(c), draft.color === c)).join('');
    $('#f-pattern').innerHTML = PATTERNS.map((p) => chip('pattern', p, capitalize(p), draft.pattern === p)).join('');
    const subs = TYPES.find((t) => t.key === draft.type)?.subtypes ?? TYPES.flatMap((t) => t.subtypes);
    $('#subtypes').innerHTML = subs.map((s) => `<option value="${esc(s)}">`).join('');
  }

  form.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const { group, value } = c.dataset;
    if (group === 'seasons' || group === 'occasions') {
      const list = draft[group];
      draft[group] = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    } else {
      draft[group] = draft[group] === value ? '' : value;
    }
    paintChips();
  });

  $('#add-occasion').onclick = () => {
    const v = $('#new-occasion').value.trim().toLowerCase();
    if (!v) return;
    if (!draft.occasions.includes(v)) draft.occasions.push(v);
    $('#new-occasion').value = '';
    paintChips();
  };
  $('#new-occasion').onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#add-occasion').click();
    }
  };

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    $('#save').disabled = true;
    try {
      const result = await processPhoto(file, { removeBackground: $('#removeBg').checked, onStatus: setStatus });
      images = { photo: result.photo, thumb: result.thumb };
      previewUrl = URL.createObjectURL(result.photo);
      paintPreview();
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
      fabric: form.elements.fabric.value.trim() || null,
      fit: form.elements.fit.value.trim() || null,
      brand: form.elements.brand.value.trim() || null,
      notes: form.elements.notes.value.trim() || null,
      tags: form.elements.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    };
    $('#save').disabled = true;
    $('#save').textContent = 'Saving…';
    try {
      await store.saveItem(existing?.id ?? null, fields, images);
      // Patch the cached list instead of reloading it, so tagging many photos stays quick.
      const cached = existing && !images && items?.find((i) => i.id === existing.id);
      if (cached) Object.assign(cached, fields);
      else items = null;
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
        <div class="chips">${SEASONS.map((s) => chip('seasons', s.key, s.label, d.seasons.includes(s.key))).join('')}</div>
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
      const list = d[c.dataset.group];
      const v = c.dataset.value;
      d[c.dataset.group] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
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

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
