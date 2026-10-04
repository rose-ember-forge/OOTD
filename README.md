# Wardrobe

A web app that installs like an app (PWA) for keeping an inventory of clothes: photograph each piece,
the background is removed, tag it, and filter the wardrobe by season, then occasion, then type,
color and free text. Same data on iPhone and Mac.

No build step: plain HTML, CSS and JavaScript modules. Libraries load from jsDelivr.

```
index.html, css/, js/          the app
  js/config.js                 Supabase URL + anon key (empty = demo mode)
  js/store-supabase.js         cloud data: auth, items table, photo storage
  js/store-local.js            demo data in the browser (IndexedDB)
  js/image.js                  resize, background removal, thumbnails
  js/importer.js               bulk import runner
sw.js, manifest.webmanifest    install-to-home-screen + offline app shell
supabase/migrations/           database table, security rules, photo bucket
```

## Try it locally (demo mode)

With `js/config.js` left empty the app runs without any backend; items are stored in that browser only
and there is no sign-in.

```
python -m http.server 8080
```

Open http://localhost:8080.

## Set up the cloud backend (Supabase)

1. Create a project at https://supabase.com (the free tier is plenty for a few hundred items).
2. **Database:** open SQL Editor, paste `supabase/migrations/20261003000000_init.sql`, run it.
   This creates the `items` table, row-level security (each user only sees their own items)
   and a private `photos` storage bucket.
3. **App config:** Project Settings → API Keys. Copy the Project URL and the publishable key
   (`sb_publishable_…`, called the anon key in older projects) into `js/config.js`. That key is
   public by design. Never put the secret key (`sb_secret_…` / `service_role`) in the app.
4. **Sign in:** the app signs in with an emailed link (Supabase's built-in email). In
   Authentication → URL Configuration, set Site URL to where the app is hosted and add it to
   Redirect URLs (also `http://localhost:8080` for testing).
5. **Lock down sign-ups:** once everyone who needs an account has signed in once, turn off
   "Allow new users to sign up" in Authentication → Sign In / Providers, so strangers who find the
   site can't create accounts and use up your storage.

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

## Bulk import

**Import** on the wardrobe screen takes many photos at once. Optionally pick a season and occasion
for the whole batch first. Each photo has its background removed and is uploaded as soon as it's
ready, so a stopped import keeps everything finished so far. Keep the app open with the screen on
while it runs; you can browse the wardrobe meanwhile.

Imported photos have no type yet and show as *To tag*. **Tag photos** steps through them one by
one: pick type, color and pattern, then **Save & next**. **Skip** (or swiping the photo left) leaves a
photo for later.

## Not built yet

AI tag suggestions were dropped to keep the app free to run; they could come back later. Outfit
suggestions, an outfit builder, weather and sharing are deliberately left for later.
