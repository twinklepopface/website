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

function friendlyTitle(filename) {
  const base = filename.replace(/\.[^.]+$/, "");     // drop extension
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
  let processed = 0;
  let reused = 0;

  for (const dir of categoryDirs) {
    const srcDir = path.join(DESIGNS_DIR, dir.name);
    const genDir = path.join(GEN_DIR, dir.name);
    fs.mkdirSync(genDir, { recursive: true });

    const files = fs
      .readdirSync(srcDir)
      .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

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
      if (wasStale) processed++; else reused++;

      designs.push({
        name: friendlyTitle(f),
        thumb: `generated/${dir.name}/${thumbName}`,
        full: `generated/${dir.name}/${fullName}`,
      });
    }

    if (designs.length) {
      categories.push({ id: dir.name, name: titleCaseFolder(dir.name), designs });
    }
  }

  // Clean orphaned generated files whose source was deleted
  cleanOrphans(categories);

  const manifest = { generated: new Date().toISOString(), categories };
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));

  const total = categories.reduce((n, c) => n + c.designs.length, 0);
  console.log(
    `Wrote ${path.relative(ROOT, OUT)}: ${categories.length} categories, ${total} designs ` +
    `(${processed} processed, ${reused} reused).`
  );
}

function cleanOrphans(categories) {
  if (!fs.existsSync(GEN_DIR)) return;
  const keep = new Set();
  categories.forEach((c) =>
    c.designs.forEach((d) => { keep.add(d.full); keep.add(d.thumb); })
  );
  for (const cat of fs.readdirSync(GEN_DIR, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    const catPath = path.join(GEN_DIR, cat.name);
    for (const f of fs.readdirSync(catPath)) {
      const rel = `generated/${cat.name}/${f}`;
      if (!keep.has(rel)) {
        fs.unlinkSync(path.join(catPath, f));
      }
    }
    if (fs.readdirSync(catPath).length === 0) fs.rmdirSync(catPath);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
