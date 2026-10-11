// Copies the Sling schedule into Firebase so the app can pre-select who is opening and closing.
//
//   node scripts/sling-sync.mjs                         real run (needs SLING_ICS_URL and TEAM_PASSCODE in the environment)
//   node scripts/sling-sync.mjs --file feed.ics --dry   no network, no secrets: just prints counts
//
// Runs on a timer in GitHub Actions (.github/workflows/sling-sync.yml). The repository is public and
// so are its Action logs, so this script only ever prints counts — never names, links or passcodes.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseIcs, buildDays, localParts, toFirestoreValue } from './sling-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : '';

// Connection details come from sync.js so there is a single place to change them.
const syncSrc = fs.readFileSync(path.join(here, '..', 'sync.js'), 'utf8');
const pick = (re, what) => { const m = re.exec(syncSrc); if (!m) throw new Error('could not find ' + what + ' in sync.js'); return m[1]; };
const API_KEY = pick(/apiKey:\s*"([^"]+)"/, 'apiKey');
const PROJECT = pick(/projectId:\s*"([^"]+)"/, 'projectId');
const TEAM_EMAIL = pick(/TEAM_AUTH\s*=\s*\{[^}]*email:\s*'([^']+)'/, 'team email');

async function loadFeed() {
  if (fileArg) return fs.readFileSync(fileArg, 'utf8');
  const url = process.env.SLING_ICS_URL;
  if (!url) throw new Error('SLING_ICS_URL is not set');
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('Sling feed request failed: HTTP ' + res.status);
  return res.text();
}

async function signIn() {
  const pass = process.env.TEAM_PASSCODE;
  if (!pass) throw new Error('TEAM_PASSCODE is not set');
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(API_KEY), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TEAM_EMAIL, password: pass, returnSecureToken: true }),
    signal: AbortSignal.timeout(30000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.idToken) throw new Error('Team sign-in failed: ' + ((body.error && body.error.message) || 'HTTP ' + res.status));
  return body.idToken;
}

async function writeSchedule(idToken, doc) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(PROJECT) + '/databases/(default)/documents/roster/schedule';
  const fields = toFirestoreValue(doc).mapValue.fields;
  const res = await fetch(url, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + idToken },
    body: JSON.stringify({ fields }), signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error('Firestore write failed: ' + ((b.error && b.error.message) || 'HTTP ' + res.status));
  }
}

const text = await loadFeed();
if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('That does not look like a calendar feed (wrong link, or Sling returned a sign-in page).');
const { events, skipped } = parseIcs(text);
const today = localParts(new Date(), 'America/New_York').date;
const { days, stats } = buildDays(events, today, { daysBack: 1, daysAhead: 5 });
const perDay = Object.keys(days).sort().map((d) => d + ': ' + days[d].length).join(', ');
console.log('feed: ' + events.length + ' events (' + skipped + ' empty skipped), ' + stats.shifts + ' shifts in window, ' +
  stats.notShift + ' non-shift entries ignored, ' + stats.unparsed + ' unreadable');
console.log('shifts per day -> ' + perDay);

// Never replace a good schedule with an empty one (a broken link would otherwise blank the app).
if (!stats.shifts) throw new Error('No shifts found in the window — leaving the saved schedule as it was.');
if (dry) { console.log('dry run: nothing was written'); process.exit(0); }

await writeSchedule(await signIn(), { source: 'sling', fetchedAt: Date.now(), days });
console.log('schedule saved');
