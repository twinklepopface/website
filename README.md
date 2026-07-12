# Twinkle Pop Face — face painting website

A fast, free, static website with a searchable design gallery. Drop full-size
photos into folders, push to GitHub, and a build step automatically compresses
them, generates thumbnails, and updates the site. Hosting is free on GitHub Pages.

## How adding designs works

1. Put full-size photos (straight off your phone/camera is fine) into the right
   folder under `designs/`:
   - `designs/animals/`
   - `designs/princesses/`
   - `designs/superheroes/`
   - `designs/halloween/`
2. Name the file after the design. The **filename becomes the title**:
   `unicorn-rainbow.jpg` → "Unicorn Rainbow". Use dashes or underscores between
   words.
   **To set a price**, add the price tier to the end of the name:
   `unicorn-rainbow-17.jpg` → title "Unicorn Rainbow" with a **$17** badge.
   Valid tiers are `-12`, `-17`, and `-22`. A photo with no price tier (e.g.
   `unicorn-rainbow.jpg`) simply shows no badge — use that for hourly-booking
   designs that aren't sold per-piece.
3. To make a **new category**, create a new folder inside `designs/`
   (e.g. `designs/glitter/`) and drop photos in. It becomes a tab automatically.
4. Commit and push. The GitHub Action runs and, for each new photo:
   - compresses a web-optimized full image,
   - creates a small square thumbnail,
   - writes friendly titles and reads the price,
   - updates the gallery.
   Live in about a minute. You do **not** resize anything by hand.

Supported image types: `.jpg .jpeg .png .webp .gif .avif`

### Prices
- Festival/market designs use three tiers set by the filename. The number in
  the filename is the **regular (card) price**: $12 / $17 / $22.
- **Cash saves $2** on every design ($10 / $15 / $20). This is a single global
  rule shown on the site — you don't set cash prices per design.
- The badge on each design shows the card price; a note explains the cash saving.
- To change the tier prices, edit `PRICE_TIERS` near the top of
  `build-manifest.js` AND update the numbers in the Prices section of
  `index.html` (search for `$12`). Keep the two in sync.
- To change the cash discount amount, edit the "$2" references in the Prices
  section and the gallery hint in `index.html`.
- Hourly bookings have no per-design price; that's explained in the Prices
  section too.

### What the build step produces
Your originals in `designs/` are never modified. Processed versions are written
to `generated/`:
- thumbnails (`*.thumb.webp`) load in the grid — small and fast,
- full images (`*.webp`) load only when a customer taps a design.

The build is **incremental**: only new or changed photos are processed, so
adding one design to a library of hundreds is quick.

## First-time setup

1. Create a free GitHub account, then a new **public** repository.
2. Upload all these files (keep the folder structure).
3. In the repo: **Settings → Pages → Source: Deploy from a branch → main /
   (root)**. Save.
4. The site goes live at `https://YOURNAME.github.io/REPO/` within a minute.

The Action in `.github/workflows/build.yml` installs the image processor
(Sharp) and runs automatically on every push.

## Previewing locally (optional)
Because the gallery loads its data with a `fetch`, opening `index.html` by
double-clicking it shows an empty gallery (browsers block that on `file://`).
To preview, run a tiny local server from the project folder:

```
python3 -m http.server 8000
```
Then visit `http://localhost:8000`. To also process images locally first:
```
npm install
npm run build
```

## Editing text, prices, and contact
Open `index.html` and edit:
- The logo (`assets/logo.png`) — replace this file to change the header image
- The page title "Twinkle Pop Face" (browser tab text)
- The tagline
- The **Prices** section
- The booking email (`hello@example.com` → your real email)

## Tuning image quality (optional)
In `build-manifest.js`, near the top:
- `FULL_MAX` — longest edge of the full image (default 1200px)
- `THUMB` — thumbnail size (default 400px)
- `FULL_QUALITY` / `THUMB_QUALITY` — webp quality (higher = better/larger)

## Connecting a custom domain (later)
1. Buy a domain (~$15–25 CAD/yr) from Cloudflare Registrar or Porkbun.
2. Repo → **Settings → Pages → Custom domain**, enter your domain.
3. Add the DNS records GitHub shows you, at your registrar.
4. Tick **Enforce HTTPS** once ready.

## Favorites — how it works
Customers can tap the heart on any design to save it while browsing, then tap
"View favorites" to show just those. Favorites are stored on that customer's own
phone (browser storage) — it's a browsing aid for events, not something that
sends the list to you.
