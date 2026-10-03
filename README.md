# Wardrobe

A web app that installs like an app (PWA) for keeping an inventory of clothes: photograph each piece,
the background is removed, AI suggests type/subtype/color/pattern, and the wardrobe can be filtered by
season, then occasion, then type, color and free text. Same data on iPhone and Mac.

No build step: plain HTML, CSS and JavaScript modules. Libraries load from jsDelivr.

```
index.html, css/, js/          the app
  js/config.js                 Supabase URL + anon key (empty = demo mode)
  js/store-supabase.js         cloud data: auth, items table, photo storage, AI tagging
  js/store-local.js            demo data in the browser (IndexedDB)
  js/image.js                  resize, background removal, thumbnails
sw.js, manifest.webmanifest    install-to-home-screen + offline app shell
supabase/migrations/           database table, security rules, photo bucket
supabase/functions/tag-item/   Edge Function that asks Claude to tag a photo
```

## Try it locally (demo mode)

With `js/config.js` left empty the app runs without any backend; items are stored in that browser only
and there are no AI suggestions.

```
python -m http.server 8080
```

Open http://localhost:8080.

## Set up the cloud backend (Supabase)

1. Create a project at https://supabase.com (the free tier is plenty for a few hundred items).
2. **Database:** open SQL Editor, paste `supabase/migrations/20261003000000_init.sql`, run it.
   This creates the `items` table, row-level security (each user only sees their own items)
   and a private `photos` storage bucket.
3. **App config:** Project Settings → API. Copy the Project URL and the `anon` public key into
   `js/config.js`.
4. **AI tagging:** install the Supabase CLI, then from this folder:
   ```
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase secrets set ANTHROPIC_API_KEY=<key from console.anthropic.com>
   supabase functions deploy tag-item
   ```
   The function uses `claude-opus-5-5` at low effort; set a `CLAUDE_MODEL` secret to use another model.
   It sends a 512px JPEG per photo, so each tag request is small.
5. **Sign in:** Authentication → URL Configuration: set Site URL to where the app is hosted and add
   it to Redirect URLs (also `http://localhost:8080` for testing).
   - **Sign in with Apple** needs an Apple Developer account (paid). Create a Services ID and key in
     the Apple developer portal, then enable the Apple provider in Authentication → Providers.
     Supabase's guide: https://supabase.com/docs/guides/auth/social-login/auth-apple
   - **Email link** works out of the box and is on the sign-in screen as a fallback.

## Host it

Any static host with HTTPS works (the service worker and camera need HTTPS): GitHub Pages,
Netlify, Cloudflare Pages or Vercel. Publish the repository root as-is.

On the iPhone: open the site in Safari → Share → Add to Home Screen. On the Mac: Safari → File →
Add to Dock, or just bookmark it.

When you ship changes, bump `VERSION` in `sw.js` so installed copies refresh.

## Notes

- **Background removal** runs on the device with `@imgly/background-removal`. The first use downloads
  a model of a few tens of MB (cached afterwards); each photo takes a few seconds on a recent iPhone.
  If it fails, the original photo is kept. It can be turned off per photo. The library is
  AGPL-3.0 licensed, which is fine for personal use; check its terms before offering the app to others.
- **Seasons:** an item can have several. Items marked *All year* show up under any season filter.
- **Occasions:** six defaults; custom ones typed into an item become filter chips automatically.

## Not built yet

Bulk import (select many photos, tag all, swipe to confirm) is the next piece. Outfit suggestions,
an outfit builder, weather and sharing are deliberately left for later.
