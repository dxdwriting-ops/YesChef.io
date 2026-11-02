# Publishing chef.io

Three steps: put the code on GitHub, run the server (and your own website) on Render, then upload a build to itch.io. Ads are optional and go on your own website only.

## 1. GitHub (about 5 minutes)

1. Create a free account at <https://github.com> and a new **empty** repository (for example `chef-io`).
2. In this folder:

```bash
git init
git add .
git commit -m "chef.io"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/chef-io.git
git push -u origin main
```

## 2. Render: game server and your own website (about 10 minutes)

1. Create a free account at <https://render.com> and connect your GitHub.
2. Click **New → Blueprint**, pick your `chef-io` repository and **Apply**. It reads `render.yaml`, builds the game and starts the server.
3. When it says **Live**, open the URL it shows (like `https://chef-io.onrender.com`). That's your own website: the full game, playable by anyone.

Notes:

- The free plan sleeps after about 15 minutes with no players, so the first visit after a quiet spell takes up to a minute to wake. The paid "Starter" plan stays awake.
- **Custom domain:** buy one (for example from Namecheap or Cloudflare), then in Render open your service → **Settings → Custom Domains** and follow the DNS steps. `chef.io` itself is taken (it belongs to the Chef software company), so pick something else, like `chefs-io.com` or `linecook.io`.

## 3. itch.io (about 10 minutes)

1. Build the itch version, pointing it at your Render server (note `wss://`, not `https://`):

```bash
npm run build:itch -- wss://chef-io.onrender.com
```

   This creates `chef-io-itch.zip`.

2. On <https://itch.io>, create an account, then **Dashboard → Create new project**:
   - **Kind of project:** HTML
   - **Upload files:** `chef-io-itch.zip`, and tick **This file will be played in the browser**
   - **Embed options:** viewport `1280 × 720`, tick **Fullscreen button**
   - **Genre / tags:** Simulation, co-op, multiplayer, cooking, io, pixel art
   - **Pricing:** free, or "No payments" / "Donate" if you'd like tips
3. Save as **Draft**, play it on the page to check it connects, then set it to **Public**.

Rebuild and re-upload the ZIP whenever you update the game. If your Render URL changes, rebuild with the new address.

## 4. Ads on your own website (optional)

Ads only ever show on your own website, never on itch.io, and never during a shift: a banner on the menus, a short break between shifts, and an optional "watch an ad to double your coins" button.

1. Apply for Google AdSense at <https://adsense.google.com> with your website (a custom domain helps approval). Then, in AdSense, sign up for **H5 Games Ads** (the "Ad Placement API").
2. Edit `privacy.html` (in `public/`) and put in your contact email. AdSense requires a privacy policy.
3. In Render → your service → **Environment**, add:
   - `VITE_ADSENSE_CLIENT` = your publisher id (`ca-pub-...`)
   - `VITE_ADSENSE_BANNER_SLOT` = a display ad unit id for the menu banner (optional)
   - `VITE_ADSENSE_TEST` = `on` while testing, then remove it
4. Click **Manual Deploy → Clear build cache & deploy**. The ad settings are baked in at build time.

Other good routes for .io games: submit the game to **CrazyGames** or **Poki**. They host it, handle the ads, and pay you a revenue share, and they bring a lot of players. **AdinPlay** is another ad network popular with .io games on their own sites.
