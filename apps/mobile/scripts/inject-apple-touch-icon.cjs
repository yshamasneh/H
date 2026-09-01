#!/usr/bin/env node
/**
 * Post-export step for `npm run build:web` (expo export --platform web).
 *
 * iOS Safari's "Add to Home Screen" only uses an app icon when the page's
 * <head> contains an explicit <link rel="apple-touch-icon" href="...">. Expo's
 * generated dist/index.html does not include this tag, and — because this app
 * does not use Expo Router — there is no supported +html.tsx head-customization
 * hook to add it. So we inject it here, automatically, after every export.
 *
 * The icon itself lives in apps/mobile/public/apple-touch-icon.png, which Expo
 * copies verbatim into dist/ during export (its supported static-passthrough
 * mechanism). That gives us a STABLE, non-content-hashed path — /apple-touch-icon.png
 * — that survives every rebuild. As a safety net, if Expo did not copy it we
 * copy it here so the referenced file is guaranteed to exist in dist/.
 *
 * This script is idempotent: running it twice will not duplicate the tag.
 */
const fs = require('fs');
const path = require('path');

const ICON_HREF = '/apple-touch-icon.png';
const ICON_FILENAME = 'apple-touch-icon.png';

const mobileRoot = path.resolve(__dirname, '..');
const distDir = path.join(mobileRoot, 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const sourceIconPath = path.join(mobileRoot, 'public', ICON_FILENAME);
const distIconPath = path.join(distDir, ICON_FILENAME);

function fail(message) {
  console.error(`[inject-apple-touch-icon] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(indexHtmlPath)) {
  fail(`dist/index.html not found at ${indexHtmlPath}. Did "expo export --platform web" run first?`);
}

// Ensure the icon file exists in dist/. Expo's public/ passthrough should have
// placed it there already; copy it as a fallback so the href never dangles.
if (!fs.existsSync(distIconPath)) {
  if (!fs.existsSync(sourceIconPath)) {
    fail(`Source icon missing at ${sourceIconPath}. Expected a committed 180x180 PNG.`);
  }
  fs.copyFileSync(sourceIconPath, distIconPath);
  console.log(`[inject-apple-touch-icon] Copied ${ICON_FILENAME} into dist/ (public passthrough did not).`);
}

let html = fs.readFileSync(indexHtmlPath, 'utf8');

// Idempotency: if an apple-touch-icon link is already present, leave it alone.
if (/<link[^>]+rel=["']apple-touch-icon["']/i.test(html)) {
  console.log('[inject-apple-touch-icon] apple-touch-icon link already present; nothing to do.');
  process.exit(0);
}

const linkTag = `<link rel="apple-touch-icon" href="${ICON_HREF}"/>`;

// Prefer inserting right before </head>; fall back to after <head> if needed.
if (/<\/head>/i.test(html)) {
  html = html.replace(/<\/head>/i, `${linkTag}</head>`);
} else if (/<head[^>]*>/i.test(html)) {
  html = html.replace(/(<head[^>]*>)/i, `$1${linkTag}`);
} else {
  fail('Could not find a <head> element in dist/index.html to inject into.');
}

fs.writeFileSync(indexHtmlPath, html);
console.log(`[inject-apple-touch-icon] Injected ${linkTag} into dist/index.html`);
