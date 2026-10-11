// Turns a Sling calendar-sync (.ics) feed into per-day shift lists in each store's own local time.
// Pure functions only — the network/Firebase part lives in sling-sync.mjs.

// "\," "\;" "\n" "\\" escapes, and lines folded with a leading space/tab.
export function unfold(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
}
function unescapeValue(v) {
  return String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

const UTC_STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
function parseUtc(s) {
  const m = UTC_STAMP.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

// → { events:[{ summary, start:Date, end:Date, location }], skipped:n }
export function parseIcs(text) {
  const blocks = unfold(text).split('BEGIN:VEVENT').slice(1);
  const events = []; let skipped = 0;
  blocks.forEach((b) => {
    b = b.split('END:VEVENT')[0];
    const get = (k) => { const m = new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'm').exec(b); return m ? unescapeValue(m[1]) : ''; };
    const start = parseUtc(get('DTSTART')), end = parseUtc(get('DTEND'));
    if (!start || !end || !(end > start)) { skipped++; return; }
    events.push({ summary: get('SUMMARY').trim(), start, end, location: get('LOCATION') });
  });
  return { events, skipped };
}

// "Jane Doe - STORE MANAGER - CASTLETON SQUARE" → { name, position, store }. Anything else → null.
export function parseSummary(summary) {
  const p = String(summary || '').split(' - ').map((s) => s.trim());
  if (p.length < 3 || !p[0] || !p[1]) return null;
  return { name: p[0], position: p[1], store: cleanStore(p.slice(2).join(' - ')) };
}

// Sling store labels carry emoji and district tags ("TOWSON STORE❤️‍🔥", "KING OF PRUSSIA STORE👑D2").
export function cleanStore(label) {
  return String(label || '')
    .replace(/[^\x20-\x7E]+/g, ' ')          // emoji / non-ASCII → space
    .replace(/\s+/g, ' ').trim()
    .replace(/\s+D\d$/i, '')                 // trailing district tag
    .replace(/^INSPIRATION CO\s*-\s*/i, '')  // "INSPIRATION CO - ORLAND SQUARE"
    .trim();
}

// Calendar entries that are not people working a store shift.
const NOT_A_SHIFT = /zoom|meeting|training session|corp(orate)?\.?\s*rep|\bvp\b/i;
export function isShiftPosition(position) { return !NOT_A_SHIFT.test(String(position || '')); }

const CENTRAL_STATES = new Set(['IL', 'WI', 'MN', 'IA', 'MO', 'AR', 'LA', 'MS', 'AL', 'OK', 'TX', 'KS', 'NE', 'SD', 'ND', 'TN']);
const MOUNTAIN_STATES = new Set(['CO', 'UT', 'NM', 'WY', 'MT', 'ID']);
const PACIFIC_STATES = new Set(['CA', 'WA', 'OR', 'NV']);
// The store's zone, from the state in its address ("…, Orland Park, IL 60462").
export function tzForLocation(location) {
  const m = /,\s*([A-Z]{2})\s+\d{5}/.exec(String(location || ''));
  const st = m && m[1];
  if (!st) return 'America/New_York';
  if (CENTRAL_STATES.has(st)) return 'America/Chicago';
  if (MOUNTAIN_STATES.has(st) || st === 'AZ') return st === 'AZ' ? 'America/Phoenix' : 'America/Denver';
  if (PACIFIC_STATES.has(st)) return 'America/Los_Angeles';
  return 'America/New_York';
}

// A Date in a zone → { date:'YYYY-MM-DD', time:'HH:MM' } (wall clock there).
export function localParts(d, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d);
  const o = {};
  parts.forEach((p) => { o[p.type] = p.value; });
  return { date: o.year + '-' + o.month + '-' + o.day, time: (o.hour === '24' ? '00' : o.hour) + ':' + o.minute };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// events → { 'YYYY-MM-DD': [{ name, position, store, start:'HH:MM', end:'HH:MM' }] } for
// [todayStr - daysBack, todayStr + daysAhead], using each shift's own store-local date and times.
export function buildDays(events, todayStr, opts) {
  const back = (opts && opts.daysBack) != null ? opts.daysBack : 1, ahead = (opts && opts.daysAhead) != null ? opts.daysAhead : 5;
  const lo = addDays(todayStr, -back), hi = addDays(todayStr, ahead);
  const days = {};
  for (let d = lo; d <= hi; d = addDays(d, 1)) days[d] = [];
  const stats = { shifts: 0, notShift: 0, unparsed: 0 };
  events.forEach((e) => {
    const s = parseSummary(e.summary);
    if (!s) { stats.unparsed++; return; }
    if (!isShiftPosition(s.position)) { stats.notShift++; return; }
    const tz = tzForLocation(e.location);
    const a = localParts(e.start, tz), b = localParts(e.end, tz);
    if (!days[a.date]) return;
    days[a.date].push({ name: s.name, position: s.position, store: s.store, start: a.time, end: b.time });
    stats.shifts++;
  });
  return { days, stats };
}

// JS value → Firestore REST "Value" JSON (plain objects, arrays, strings, numbers, booleans, null).
export function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  const fields = {};
  Object.keys(v).forEach((k) => { fields[k] = toFirestoreValue(v[k]); });
  return { mapValue: { fields } };
}
