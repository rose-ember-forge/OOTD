// Cloud store: Supabase auth + Postgres table `items` + private storage bucket `photos`.
// Photos live at `<user id>/<item id>/photo.<ext>` and `<user id>/<item id>/thumb.<ext>`.

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

    async signInWithApple() {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
    },

    async signInWithEmail(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async listItems() {
      const { data, error } = await sb.from('items').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const urls = await signUrls(data.map((i) => i.thumb_path));
      return data.map((i) => ({ ...i, thumbUrl: urls[i.thumb_path] }));
    },

    async getItem(id) {
      const { data, error } = await sb.from('items').select('*').eq('id', id).single();
      if (error) throw error;
      const urls = await signUrls([data.photo_path, data.thumb_path]);
      return { ...data, photoUrl: urls[data.photo_path], thumbUrl: urls[data.thumb_path] };
    },

    // `fields` holds the editable columns; `images` is set only when the photo changes.
    async saveItem(id, fields, images) {
      const itemId = id ?? crypto.randomUUID();
      const row = { ...fields, id: itemId, user_id: userId() };
      if (images) {
        const base = `${userId()}/${itemId}`;
        row.photo_path = `${base}/photo.${ext(images.photo)}`;
        row.thumb_path = `${base}/thumb.${ext(images.thumb)}`;
        await Promise.all([upload(row.photo_path, images.photo), upload(row.thumb_path, images.thumb)]);
      }
      const { error } = await sb.from('items').upsert(row);
      if (error) throw error;
      return itemId;
    },

    async deleteItem(id) {
      const { data } = await sb.from('items').select('photo_path, thumb_path').eq('id', id).single();
      const { error } = await sb.from('items').delete().eq('id', id);
      if (error) throw error;
      if (data) await sb.storage.from(BUCKET).remove([data.photo_path, data.thumb_path].filter(Boolean));
    },

    // Calls the `tag-item` Edge Function, which asks Claude for type/subtype/color/pattern.
    async suggestTags(imageBase64, mediaType) {
      const { data, error } = await sb.functions.invoke('tag-item', {
        body: { image: imageBase64, media_type: mediaType },
      });
      if (error) throw error;
      return data;
    },
  };
}
