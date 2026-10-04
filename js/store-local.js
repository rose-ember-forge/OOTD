// Demo store: everything in this browser's IndexedDB. Used when js/config.js has no
// Supabase settings, so the UI can be tried without any backend.

const DB_NAME = 'ootd-demo';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('items', mode);
    const req = fn(t.objectStore('items'));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
  });
}

export function createLocalStore() {
  let db;
  const urls = new Map(); // blob → object URL, so we don't leak a URL per render

  const urlFor = (blob) => {
    if (!blob) return undefined;
    if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
    return urls.get(blob);
  };
  // Same shape as the cloud store: photo/thumb are the cut-out (or only photo), the
  // original-* blobs the untouched photo, and `use_original` picks which one is shown.
  const withUrls = (i) => {
    const showOriginal = i.use_original && i.originalPhoto;
    return {
      ...i,
      cutoutUrl: urlFor(i.photo),
      originalUrl: urlFor(i.originalPhoto),
      photoUrl: urlFor(showOriginal ? i.originalPhoto : i.photo),
      thumbUrl: urlFor(showOriginal ? i.originalThumb : i.thumb),
    };
  };

  return {
    mode: 'demo',

    async init() {
      db = await openDb();
      return { demo: true };
    },
    onAuthChange() {},
    userLabel: () => 'Demo mode (this browser only)',
    async signOut() {},

    async listItems() {
      const all = await tx(db, 'readonly', (s) => s.getAll());
      return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(withUrls);
    },

    async getItem(id) {
      const item = await tx(db, 'readonly', (s) => s.get(id));
      if (!item) throw new Error('Item not found');
      return withUrls(item);
    },

    async saveItem(id, fields, images) {
      const existing = id ? await tx(db, 'readonly', (s) => s.get(id)) : null;
      const now = new Date().toISOString();
      const item = {
        ...existing,
        ...fields,
        id: id ?? crypto.randomUUID(),
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      if (images) {
        Object.assign(item, {
          photo: images.photo,
          thumb: images.thumb,
          originalPhoto: images.original?.photo ?? null,
          originalThumb: images.original?.thumb ?? null,
          // Mirrors the cloud column, so the app can check for an original the same way.
          original_photo_path: images.original ? 'local' : null,
        });
      }
      await tx(db, 'readwrite', (s) => s.put(item));
      return item.id;
    },

    async deleteItem(id) {
      await tx(db, 'readwrite', (s) => s.delete(id));
    },

    async updateItems(updates) {
      for (const { id, fields } of updates) await this.saveItem(id, fields, null);
    },

    async deleteItems(ids) {
      for (const id of ids) await this.deleteItem(id);
    },

    async downloadPhoto(item, which = 'photo') {
      const stored = await tx(db, 'readonly', (s) => s.get(item.id));
      return which === 'original' ? stored.originalPhoto : stored.photo;
    },
  };
}
