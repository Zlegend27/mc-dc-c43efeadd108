// Build stamping. The version of the app is a short hash of every file that ships. It is written
// into the ?v= query on index.html's asset URLs (which is also how the page tells whether a newer
// copy is live) and into sw.js's cache name. Run `node scripts/stamp-build.mjs` before committing.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILES = ['index.html', 'style.css', 'lib.js', 'sync.js', 'app.js', 'sw.js', 'manifest.webmanifest'];

function normalize(name, text) {
  text = text.replace(/\r\n/g, '\n');
  if (name === 'index.html') {
    text = text.replace(/(\.(?:css|js)\?v=)[A-Za-z0-9]+/g, function (_, a) { return a + '0'; });
    text = text.replace(/(<meta name="build-date" content=")[^"]*(")/, function (_, a, b) { return a + b; });
  }
  if (name === 'sw.js') text = text.replace(/const VERSION = '[^']*';/, "const VERSION = '0';");
  return text;
}

function computeBuild(root) {
  const h = crypto.createHash('sha256');
  FILES.forEach(function (f) {
    const p = path.join(root, f);
    h.update(f + '\n');
    h.update(fs.existsSync(p) ? normalize(f, fs.readFileSync(p, 'utf8')) : '');
  });
  return h.digest('hex').slice(0, 10);
}

function currentStamps(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const vs = Array.from(html.matchAll(/\.(?:css|js)\?v=([A-Za-z0-9]+)/g)).map(function (m) { return m[1]; });
  const swp = path.join(root, 'sw.js');
  const sw = fs.existsSync(swp) ? (fs.readFileSync(swp, 'utf8').match(/const VERSION = '([^']*)';/) || [])[1] : null;
  return { vs: vs, sw: sw };
}

function stampState(root) {
  const want = computeBuild(root), cur = currentStamps(root);
  if (!cur.vs.length) return { ok: false, reason: 'index.html has no ?v= asset stamps', want: want };
  if (cur.vs.some(function (v) { return v !== want; })) return { ok: false, reason: 'asset stamps are stale (have ' + cur.vs[0] + ', want ' + want + ') - run: node scripts/stamp-build.mjs', want: want };
  if (cur.sw !== null && cur.sw !== want) return { ok: false, reason: 'sw.js VERSION is stale - run: node scripts/stamp-build.mjs', want: want };
  return { ok: true, want: want };
}

function stamp(root) {
  const want = computeBuild(root);
  if (stampState(root).ok) return want; // nothing changed since the last stamp
  const hp = path.join(root, 'index.html');
  let html = fs.readFileSync(hp, 'utf8');
  html = html.replace(/(\.(?:css|js)\?v=)[A-Za-z0-9]+/g, function (_, a) { return a + want; });
  html = html.replace(/(<meta name="build-date" content=")[^"]*(")/, function (_, a, b) { return a + new Date().toISOString() + b; });
  fs.writeFileSync(hp, html);
  const swp = path.join(root, 'sw.js');
  if (fs.existsSync(swp)) {
    fs.writeFileSync(swp, fs.readFileSync(swp, 'utf8').replace(/const VERSION = '[^']*';/, "const VERSION = '" + want + "';"));
  }
  return want;
}

module.exports = { FILES: FILES, computeBuild: computeBuild, stampState: stampState, stamp: stamp };
