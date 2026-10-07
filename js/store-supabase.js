// Cloud store: Supabase auth + Postgres table `items` + private storage bucket `photos`.
// Photos live at `<user id>/<item id>/photo-<time>.<ext>` and `.../thumb-<time>.<ext>`. The time
// makes every upload a new path, so the service worker can cache photos by path forever.
// When the background was removed, photo/thumb are the cut-out and original-*/original-thumb-*
// hold the untouched photo; `use_original` says which one to show.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const BUCKET = 'photos';
const URL_TTL = 60 * 60; // signed URLs last an hour

export function createSupabaseStore(url, anonKey) {
  const sb = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  let session = null;

  const userId = () => session?.user?.id;
  const ext = (blob) => (blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg');

  async function signUrls(paths) {
    const wanted = paths.filter(Boolean);
    if (!wanted.length) return {};
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(wanted, URL_TTL);
    if (error) throw error;
    return Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  }

  const FILE_COLUMNS = 'photo_path, thumb_path, original_photo_path, original_thumb_path';
  const filesOf = (row) =>
    row ? [row.photo_path, row.thumb_path, row.original_photo_path, row.original_thumb_path].filter(Boolean) : [];
  const shownThumb = (i) => (i.use_original && i.original_thumb_path) || i.thumb_path;
  const shownPhoto = (i) => (i.use_original && i.original_photo_path) || i.photo_path;

  async function upload(path, blob) {
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type,
      upsert: true,
      cacheControl: '31536000',
    });
    if (error) throw error;
  }

  return {
    mode: 'cloud',

    async init() {
      const { data } = await sb.auth.getSession();
      session = data.session;
      return session;
    },

    onAuthChange(cb) {
      sb.auth.onAuthStateChange((_event, s) => {
        session = s;
        cb(s);
      });
    },

    userLabel: () => session?.user?.email ?? 'Signed in',

    async signInWithEmail(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
    },

    // Password sign-in needs no email, so it doesn't count against Supabase's email limit.
    async signInWithPassword(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    // Sets (or changes) the password of the signed-in account.
    async setPassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    },

    async signOut() {
      await sb.auth.signOut();
      // Don't leave her photos cached on a device she has signed out of.
      await caches?.delete('photos').catch(() => {});
    },

    async listItems() {
      const { data, error } = await sb.from('items').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const urls = await signUrls(data.map(shownThumb));
      return data.map((i) => ({ ...i, thumbUrl: urls[shownThumb(i)] }));
    },

    async getItem(id) {
      const { data, error } = await sb.from('items').select('*').eq('id', id).single();
      if (error) throw error;
      const urls = await signUrls([data.photo_path, data.original_photo_path]);
      return {
        ...data,
        cutoutUrl: urls[data.photo_path],
        originalUrl: urls[data.original_photo_path],
        photoUrl: urls[shownPhoto(data)],
      };
    },

    // `fields` holds the editable columns; `images` ({ photo, thumb, original? }) is set only
    // when the photo changes.
    async saveItem(id, fields, images) {
      const itemId = id ?? crypto.randomUUID();
      const row = { ...fields, id: itemId, user_id: userId() };
      let oldPaths = [];
      if (images) {
        if (id) {
          const { data } = await sb.from('items').select(FILE_COLUMNS).eq('id', id).single();
          oldPaths = filesOf(data);
        }
        const base = `${userId()}/${itemId}`;
        const stamp = Date.now();
        row.photo_path = `${base}/photo-${stamp}.${ext(images.photo)}`;
        row.thumb_path = `${base}/thumb-${stamp}.${ext(images.thumb)}`;
        row.original_photo_path = images.original ? `${base}/original-${stamp}.${ext(images.original.photo)}` : null;
        row.original_thumb_path = images.original ? `${base}/original-thumb-${stamp}.${ext(images.original.thumb)}` : null;
        await Promise.all([
          upload(row.photo_path, images.photo),
          upload(row.thumb_path, images.thumb),
          images.original && upload(row.original_photo_path, images.original.photo),
          images.original && upload(row.original_thumb_path, images.original.thumb),
        ]);
      }
      const { error } = await sb.from('items').upsert(row);
      if (error) throw error;
      // The replaced photo's files are no longer referenced.
      if (oldPaths.length) await sb.storage.from(BUCKET).remove(oldPaths);
      return itemId;
    },

    // `updates`: [{ id, fields }]. A few at a time, to stay friendly to the free tier.
    async updateItems(updates) {
      for (let i = 0; i < updates.length; i += 8) {
        const results = await Promise.all(
          updates.slice(i, i + 8).map(({ id, fields }) => sb.from('items').update(fields).eq('id', id)),
        );
        const failed = results.find((r) => r.error);
        if (failed) throw failed.error;
      }
    },

    async deleteItems(ids) {
      const { data } = await sb.from('items').select(FILE_COLUMNS).in('id', ids);
      const { error } = await sb.from('items').delete().in('id', ids);
      if (error) throw error;
      const paths = (data ?? []).flatMap(filesOf);
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    },

    // `which`: 'photo' (the cut-out, or the only photo) or 'original'.
    async downloadPhoto(item, which = 'photo') {
      const path = which === 'original' ? item.original_photo_path : item.photo_path;
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error) throw error;
      return data;
    },

    async deleteItem(id) {
      const { data } = await sb.from('items').select(FILE_COLUMNS).eq('id', id).single();
      const { error } = await sb.from('items').delete().eq('id', id);
      if (error) throw error;
      if (data) await sb.storage.from(BUCKET).remove(filesOf(data));
    },
  };
}
