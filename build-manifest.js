#!/usr/bin/env node
/**
 * Build step for the face-painting gallery.
 *
 * For every image in designs/<category>/ this script:
 *   1. Writes a compressed full-size version -> generated/<category>/<name>.webp
 *   2. Writes a small square thumbnail       -> generated/<category>/<name>.thumb.webp
 *   3. Turns the filename into a friendly title (unicorn-rainbow.jpg -> "Unicorn Rainbow")
 *   4. Records everything in assets/designs.json
 *
 * It's incremental: an image is only reprocessed if the source is newer than
 * the generated file, so pushes with hundreds of existing photos stay fast.
 *
 * Run by GitHub Actions on every push, or by hand:  node build-manifest.js
 */
const fs = require("fs");
const path = require("path");

let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  console.warn("⚠  sharp not installed — copying originals without compression.");
  console.warn("   Run `npm install` (or let the GitHub Action handle it) for thumbnails + compression.");
}

const ROOT = __dirname;
const DESIGNS_DIR = path.join(ROOT, "designs");
const GEN_DIR = path.join(ROOT, "generated");
const OUT = path.join(ROOT, "assets", "designs.json");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

// Tunable output sizes
const FULL_MAX = 1200;   // longest edge of the full image shown in the lightbox
const THUMB = 400;       // square thumbnail edge shown in the grid
const FULL_QUALITY = 80;
const THUMB_QUALITY = 70;

// Small words that stay lowercase in titles (unless first word)
const MINOR = new Set(["and", "of", "the", "a", "an", "with", "in", "on"]);

// Valid festival price tiers (regular/card price in dollars). A trailing
// -12 / -17 / -22 in the filename sets the design's regular price and is
// removed from the displayed title. Cash price is $2 less (shown site-wide).
const PRICE_TIERS = new Set([12, 17, 22]);

function parsePrice(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const m = base.match(/[-_](\d{1,3})$/); // trailing -NN or _NN
  if (m) {
    const val = parseInt(m[1], 10);
    if (PRICE_TIERS.has(val)) return val;
  }
  return null;
}

function stripPriceToken(base) {
  // remove a trailing -NN / _NN only if it's a valid tier
  const m = base.match(/[-_](\d{1,3})$/);
  if (m && PRICE_TIERS.has(parseInt(m[1], 10))) {
    return base.slice(0, m.index);
  }
  return base;
}

function friendlyTitle(filename) {
  let base = filename.replace(/\.[^.]+$/, "");     // drop extension
  base = stripPriceToken(base);                    // drop trailing price tier
  const words = base
    .replace(/[-_]+/g, " ")                          // dashes/underscores -> spaces
    .replace(/([a-z])([A-Z])/g, "$1 $2")             // camelCase -> two words
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  return words
    .map((w, i) => {
      // keep all-caps words (e.g. "USA") and words with digits as-is
      if (/^\d/.test(w) || w === w.toUpperCase()) return w;
      const lower = w.toLowerCase();
      if (i !== 0 && MINOR.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function titleCaseFolder(name) {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isStale(src, out) {
  // returns true if out is missing or older than src
  if (!fs.existsSync(out)) return true;
  return fs.statSync(src).mtimeMs > fs.statSync(out).mtimeMs;
}

async function processImage(srcPath, outFull, outThumb) {
  if (!sharp) {
    // Fallback: just copy the original to the full path, reuse it as thumb.
    fs.copyFileSync(srcPath, outFull);
    fs.copyFileSync(srcPath, outThumb);
    return;
  }
  const img = sharp(srcPath, { failOn: "none" }).rotate(); // rotate() respects EXIF orientation

  if (isStale(srcPath, outFull)) {
    await img
      .clone()
      .resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: FULL_QUALITY })
      .toFile(outFull);
  }
  if (isStale(srcPath, outThumb)) {
    await img
      .clone()
      .resize(THUMB, THUMB, { fit: "cover", position: "attention" }) // smart square crop
      .webp({ quality: THUMB_QUALITY })
      .toFile(outThumb);
  }
}

async function main() {
  if (!fs.existsSync(DESIGNS_DIR)) {
    console.error("No designs/ folder found.");
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const categoryDirs = fs
    .readdirSync(DESIGNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const categories = [];
  const counters = { processed: 0, reused: 0 };

  // Process every image file in one folder; returns an array of design objects.
  // `relDir` is the path under designs/ (e.g. "seasonal" or "seasonal/christmas").
  async function processFolder(relDir, subId) {
    const srcDir = path.join(DESIGNS_DIR, relDir);
    const genDir = path.join(GEN_DIR, relDir);

    const files = fs
      .readdirSync(srcDir, { withFileTypes: true })
      .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (files.length) fs.mkdirSync(genDir, { recursive: true });

    const designs = [];
    for (const f of files) {
      const stem = f.replace(/\.[^.]+$/, "");
      const srcPath = path.join(srcDir, f);
      const fullName = `${stem}.webp`;
      const thumbName = `${stem}.thumb.webp`;
      const outFull = path.join(genDir, fullName);
      const outThumb = path.join(genDir, thumbName);

      const wasStale = isStale(srcPath, outFull) || isStale(srcPath, outThumb);
      await processImage(srcPath, outFull, outThumb);
      if (wasStale) counters.processed++; else counters.reused++;

      const design = {
        name: friendlyTitle(f),
        price: parsePrice(f),
        thumb: `generated/${relDir}/${thumbName}`,
        full: `generated/${relDir}/${fullName}`,
      };
      if (subId) design.sub = subId; // tag with subcategory id when applicable
      designs.push(design);
    }
    return designs;
  }

  for (const dir of categoryDirs) {
    const catId = dir.name;
    const catSrc = path.join(DESIGNS_DIR, catId);

    // 1) Images sitting directly in the category folder (no subcategory)
    const directDesigns = await processFolder(catId, null);

    // 2) Subcategory folders inside this category
    const subDirs = fs
      .readdirSync(catSrc, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    const subcategories = [];
    let subDesigns = [];
    for (const sd of subDirs) {
      const subId = sd.name;
      const ds = await processFolder(path.join(catId, subId), subId);
      if (ds.length) {
        subcategories.push({ id: subId, name: titleCaseFolder(subId) });
        subDesigns = subDesigns.concat(ds);
      }
    }

    const allDesigns = directDesigns.concat(subDesigns);
    if (allDesigns.length) {
      const cat = { id: catId, name: titleCaseFolder(catId), designs: allDesigns };
      if (subcategories.length) cat.subcategories = subcategories;
      categories.push(cat);
    }
  }

  // Clean orphaned generated files whose source was deleted
  cleanOrphans(categories);

  const manifest = { generated: new Date().toISOString(), categories };
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));

  const total = categories.reduce((n, c) => n + c.designs.length, 0);
  console.log(
    `Wrote ${path.relative(ROOT, OUT)}: ${categories.length} categories, ${total} designs ` +
    `(${counters.processed} processed, ${counters.reused} reused).`
  );
}

function cleanOrphans(categories) {
  if (!fs.existsSync(GEN_DIR)) return;
  const keep = new Set();
  categories.forEach((c) =>
    c.designs.forEach((d) => { keep.add(d.full); keep.add(d.thumb); })
  );

  // Recursively remove generated files not in the keep set, then prune empty dirs.
  function walk(absDir, relDir) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else {
        if (!keep.has(`generated/${rel}`)) fs.unlinkSync(abs);
      }
    }
    // prune empty directory (but not the top generated/ root)
    if (absDir !== GEN_DIR && fs.readdirSync(absDir).length === 0) fs.rmdirSync(absDir);
  }
  walk(GEN_DIR, "");
}

main().catch((e) => { console.error(e); process.exit(1); });
