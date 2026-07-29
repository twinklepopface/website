#!/usr/bin/env node
/**
 * Build step for the Twinkle Pop Face gallery.
 *
 * For every image in designs/<category>/ (and designs/<category>/<subcategory>/):
 *   1. Writes a compressed full-size version  -> generated/.../<name>.webp
 *   2. Writes a small square thumbnail        -> generated/.../<name>.thumb.webp
 *   3. Turns the filename into a friendly title
 *   4. Reads the pricing TIER from a trailing -1 / -2 / -3
 *        -1 = Simple, -2 = Extra, -3 = Super
 *   5. Records everything in assets/designs.json
 *
 * Incremental: only new/changed images are reprocessed.
 * Run by GitHub Actions on every push, or by hand:  node build-manifest.js
 */
const fs = require("fs");
const path = require("path");

let sharp = null;
try { sharp = require("sharp"); }
catch (e) {
  console.warn("⚠  sharp not installed — copying originals without compression.");
}

const ROOT = __dirname;
const DESIGNS_DIR = path.join(ROOT, "designs");
const GEN_DIR = path.join(ROOT, "generated");
const OUT = path.join(ROOT, "assets", "designs.json");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

const FULL_MAX = 1200;
const THUMB = 400;
const FULL_QUALITY = 80;
const THUMB_QUALITY = 70;

// Valid tiers: 1 = Simple, 2 = Extra, 3 = Super. A trailing -1/-2/-3 (or _1 etc.)
// in the filename sets the tier and is removed from the displayed title.
const TIERS = new Set([1, 2, 3]);

const MINOR = new Set(["and", "of", "the", "a", "an", "with", "in", "on"]);

function parseTier(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const m = base.match(/[-_]([123])$/);
  if (m) { const v = parseInt(m[1], 10); if (TIERS.has(v)) return v; }
  return null;
}

function stripTierToken(base) {
  const m = base.match(/[-_]([123])$/);
  if (m && TIERS.has(parseInt(m[1], 10))) return base.slice(0, m.index);
  return base;
}

function friendlyTitle(filename) {
  let base = filename.replace(/\.[^.]+$/, "");
  base = stripTierToken(base);
  const words = base
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words
    .map((w, i) => {
      if (/^\d/.test(w) || w === w.toUpperCase()) return w;
      const lower = w.toLowerCase();
      if (i !== 0 && MINOR.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function titleCaseFolder(name) {
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isStale(src, out) {
  if (!fs.existsSync(out)) return true;
  return fs.statSync(src).mtimeMs > fs.statSync(out).mtimeMs;
}

async function processImage(srcPath, outFull, outThumb) {
  if (!sharp) {
    fs.copyFileSync(srcPath, outFull);
    fs.copyFileSync(srcPath, outThumb);
    return;
  }
  const img = sharp(srcPath, { failOn: "none" }).rotate();
  if (isStale(srcPath, outFull)) {
    await img.clone().resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: FULL_QUALITY }).toFile(outFull);
  }
  if (isStale(srcPath, outThumb)) {
    await img.clone().resize(THUMB, THUMB, { fit: "cover", position: "attention" })
      .webp({ quality: THUMB_QUALITY }).toFile(outThumb);
  }
}

async function main() {
  if (!fs.existsSync(DESIGNS_DIR)) { console.error("No designs/ folder found."); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const categoryDirs = fs.readdirSync(DESIGNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

  const categories = [];
  const counters = { processed: 0, reused: 0 };

  async function processFolder(relDir, subId) {
    const srcDir = path.join(DESIGNS_DIR, relDir);
    const genDir = path.join(GEN_DIR, relDir);
    const files = fs.readdirSync(srcDir, { withFileTypes: true })
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
        tier: parseTier(f),
        thumb: `generated/${relDir}/${thumbName}`,
        full: `generated/${relDir}/${fullName}`,
      };
      if (subId) design.sub = subId;
      designs.push(design);
    }
    return designs;
  }

  for (const dir of categoryDirs) {
    const catId = dir.name;
    const catSrc = path.join(DESIGNS_DIR, catId);
    const directDesigns = await processFolder(catId, null);
    const subDirs = fs.readdirSync(catSrc, { withFileTypes: true })
      .filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const subcategories = [];
    let subDesigns = [];
    for (const sd of subDirs) {
      const ds = await processFolder(path.join(catId, sd.name), sd.name);
      if (ds.length) {
        subcategories.push({ id: sd.name, name: titleCaseFolder(sd.name) });
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

  cleanOrphans(categories);
  const manifest = { generated: new Date().toISOString(), categories };
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));
  const total = categories.reduce((n, c) => n + c.designs.length, 0);
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${categories.length} categories, ${total} designs (${counters.processed} processed, ${counters.reused} reused).`);
}

function cleanOrphans(categories) {
  if (!fs.existsSync(GEN_DIR)) return;
  const keep = new Set();
  categories.forEach((c) => c.designs.forEach((d) => { keep.add(d.full); keep.add(d.thumb); }));
  function walk(absDir, relDir) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (!keep.has(`generated/${rel}`)) fs.unlinkSync(abs);
    }
    if (absDir !== GEN_DIR && fs.readdirSync(absDir).length === 0) fs.rmdirSync(absDir);
  }
  walk(GEN_DIR, "");
}

main().catch((e) => { console.error(e); process.exit(1); });
