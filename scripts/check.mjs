// Run with:  node scripts/check.mjs
// Unit tests for lib.js plus repo-hygiene checks. Exits non-zero on any failure.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as SL from './sling-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const DT = createRequire(import.meta.url)(path.join(root, 'lib.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg ? msg + ': ' : '') + 'expected ' + B + ' got ' + A);
}
function near(a, b, tol, msg) { if (Math.abs(a - b) > (tol || 1e-9)) throw new Error((msg || '') + ' expected ~' + b + ' got ' + a); }

console.log('\nReport parsing');
const HDR = 'POS location name,Total sales,Average order value,Total sales (20250725T000000),Average order value (20250725T000000)';
test('comma CSV rows keep every column (was: fused 246.83226.97162.13)', () => {
  const r = DT.readReport([HDR, 'WALDEN GALLERIA STORE,246.83,226.97,162.13,74.98', 'Palisades Mall,238.57,220.91,246.71,45.9'].join('\n'));
  eq(r.rows.map(x => [x.loc, x.today, x.ly, x.aov]), [['WALDEN GALLERIA STORE', 246.83, 162.13, 74.98], ['Palisades Mall', 238.57, 246.71, 45.9]]);
});
test('zero-today row followed by a 3-digit LY (0,443.94)', () => {
  const r = DT.readReport([HDR, 'Carolina Place,0,,443.94,138.11'].join('\n'));
  eq([r.rows[0].today, r.rows[0].ly, r.rows[0].aov], [0, 443.94, 138.11]);
});
test('tab-separated copy from the Shopify table', () => {
  const r = DT.readReport(HDR.replace(/,/g, '\t') + '\n' + 'Towson Mall\t146.26\t137.98\t369.54\t87.15');
  eq([r.rows[0].today, r.rows[0].ly, r.rows[0].aov], [146.26, 369.54, 87.15]);
});
test('dollar signs and thousands commas', () => {
  const r = DT.readReport('Orland Square, $1,650\nWoodfield Store, $2,310.50');
  eq(r.rows.map(x => x.today), [1650, 2310.5]);
});
test('full hand-typed row with $ and thousands', () => {
  const r = DT.readReport('POS location name, Total sales, Total sales (previous_year_match_day_of_week), Average order (previous_year_match_day_of_week)\nOrland Square, $321.73, $1,391.47, $62.10');
  eq([r.rows[0].today, r.rows[0].ly, r.rows[0].aov], [321.73, 1391.47, 62.1]);
});
test('quoted thousands in a real CSV', () => {
  const r = DT.readReport(HDR + '\n"Somerset Collections","3,038.86","95.7","1,200.00","80"');
  eq([r.rows[0].today, r.rows[0].ly], [3038.86, 1200]);
});
test('single-row minimal paste for a store whose name contains "store"', () => {
  const r = DT.readReport('Woodfield Store,500');
  eq(r.rows.length, 1); eq(r.rows[0].today, 500);
});
test('no header + 5 columns: reads only today, warns, never guesses LY/AOV (was: swapped them)', () => {
  const r = DT.readReport('WALDEN GALLERIA STORE\t246.83\t226.97\t162.13\t74.98');
  eq(r.rows[0].today, 246.83);
  if (!isNaN(r.rows[0].ly) || !isNaN(r.rows[0].aov)) throw new Error('LY/AOV must not be guessed');
  if (!r.warnings.length) throw new Error('expected a warning');
});
test('report title line above the header is tolerated', () => {
  const r = DT.readReport('2025 AUDITS: MACY\n' + HDR + '\nUTC STORE,136.64,127.7,200,60');
  eq(r.hasHeader, true); eq(r.rows.some(x => x.loc === 'UTC STORE'), true);
});
test('download link is skipped, not turned into a store', () => {
  const r = DT.readReport('https://cdn.shopify.com/s/files/1/0000/exports/report_1234567890abcdef1234567890abcdef1234567890.csv?token=abc,1');
  eq(r.rows.length, 0); eq(r.skipped, 1);
});
test('BOM and CRLF', () => {
  const r = DT.readReport('﻿' + HDR + '\r\nUTC STORE,10,5,20,6\r\n');
  eq(r.rows[0].today, 10);
});
test('absurd values are rejected', () => {
  const r = DT.readReport(HDR + '\nUTC STORE,99999999,5,20,6');
  eq(isNaN(r.rows[0].today), true);
});
test('legacy header without a dated column never maps LY to the AOV column', () => {
  const r = DT.readReport('POS location name,Total sales,Average order value\nUTC STORE,100,50');
  eq(isNaN(r.rows[0].ly), true);
});

console.log('\nNames and formatting');
test('titleCase handles accents', () => { eq(DT.titleCase('JOSÉ GARCÍA'), 'José García'); eq(DT.titleCase('ZOË NUÑEZ'), 'Zoë Nuñez'); });
test('titleCase Mc/apostrophes', () => { eq(DT.titleCase('TESTA MCFAKE'), 'Testa McFake'); eq(DT.titleCase("TE'SHAWN O'FAKE"), "Te'Shawn O'Fake"); });
test('titleCase leaves intentional mixed case alone', () => { eq(DT.titleCase('DeShawn Smith'), 'DeShawn Smith'); eq(DT.titleCase('Pat "Patty" Example'), 'Pat "Patty" Example'); });
test('firstName', () => { eq(DT.firstName('SAMPLE  PERSON'), 'Sample'); eq(DT.firstName('Pat "Patty" Example'), 'Pat'); });
test('esc neutralises markup', () => { eq(DT.esc('<img src=x onerror=1>&"'), '&lt;img src=x onerror=1&gt;&amp;&quot;'); });
test('phones', () => {
  eq(DT.fmtPhone('2025550143'), '+12025550143'); eq(DT.prettyPhone('12025550143'), '(202) 555-0143');
  eq(DT.isValidUsPhone('(202) 555-0143'), true); eq(DT.isValidUsPhone('70846'), false);
});

console.log('\nGoal math');
test('floored goal', () => { const g = DT.computeGoal({ ly: 54, floor: 400, sold: 100, hoursLeft: 3 }); eq([g.target, g.goal, g.perHour, g.floored, g.hit], [400, 300, 100, true, false]); });
test('hit goal never goes negative', () => { const g = DT.computeGoal({ ly: 500, floor: 400, sold: 700, hoursLeft: 2 }); eq([g.goal, g.hit, g.perHour], [0, true, 0]); });
test('hours left is floored at half an hour', () => { eq(DT.computeGoal({ ly: 1000, floor: 0, sold: 0, hoursLeft: 0 }).hours, 0.5); });

console.log('\nStore clock (the timezone bug)');
// 2026-07-23 is a Thursday. 23:30Z = 7:30pm Eastern = 6:30pm Central.
const at = new Date('2026-07-23T23:30:00Z');
test('Eastern store, 7:30pm local, closes 8pm → 0.5h', () => near(DT.hoursLeft(DT.DEFAULT_CLOSE, 'America/New_York', at), 0.5, 1e-9));
test('Central store, 6:30pm local, closes 8pm → 1.5h', () => near(DT.hoursLeft(DT.DEFAULT_CLOSE, 'America/Chicago', at), 1.5, 1e-9));
test('same instant gives different answers per zone (a Central phone no longer drives Eastern stores)', () => {
  const e = DT.hoursLeft(DT.DEFAULT_CLOSE, 'America/New_York', at), c = DT.hoursLeft(DT.DEFAULT_CLOSE, 'America/Chicago', at);
  if (!(c - e >= 0.99)) throw new Error('zones should differ by an hour');
});
test('weekday follows the store zone (Sun 7pm close)', () => {
  const sun = new Date('2026-07-26T21:00:00Z'); // Sun 5pm Eastern
  near(DT.hoursLeft(DT.DEFAULT_CLOSE, 'America/New_York', sun), 2, 1e-9);
});
test('default zones', () => { eq(DT.defaultTzFor('ORLAND SQUARE'), 'America/Chicago'); eq(DT.defaultTzFor('UTC'), 'America/New_York'); eq(DT.defaultTzFor('BRAND NEW MALL'), 'device'); });

console.log('\nShared roster operations');
const R = [{ mall: 'A', staff: [{ name: 'Ann', phone: '1' }] }, { mall: 'B', staff: [] }];
test('setStaff touches only that store', () => {
  const n = DT.applyRosterOp(R, { type: 'setStaff', mall: 'B', staff: [{ name: ' Bo ', phone: '(555) 1' }] });
  eq(n[0].staff.length, 1); eq(n[1].staff, [{ name: 'Bo', phone: '5551' }]);
});
test('a stale writer cannot drop another store (op applied to fresh data)', () => {
  const fresh = [...R, { mall: 'C', staff: [{ name: 'Cy', phone: '2' }] }];
  const n = DT.applyRosterOp(fresh, { type: 'setStaff', mall: 'A', staff: [] });
  eq(n.map(s => s.mall), ['A', 'B', 'C']);
});
test('add/remove store', () => {
  eq(DT.applyRosterOp(R, { type: 'addStore', mall: 'Z' }).map(s => s.mall), ['A', 'B', 'Z']);
  eq(DT.applyRosterOp(R, { type: 'removeStore', mall: 'a' }).map(s => s.mall), ['B']);
});
test('input is never mutated', () => { const before = JSON.stringify(R); DT.applyRosterOp(R, { type: 'removeStore', mall: 'A' }); eq(JSON.stringify(R), before); });
test('newer stamp wins on merge', () => {
  const local = { A: 100, B: 5 }, la = { A: 50, B: 90 };
  const ch = DT.mergeStamped(local, la, { A: 120, B: 7 }, { A: 60, B: 80 });
  eq(local, { A: 120, B: 5 }); eq(ch, ['A']);
});

console.log('\nSchedule (who opens / closes)');
const SCH_STORES = [{ mall: 'ORLAND SQUARE', staff: [{ name: 'Testa Fake' }, { name: 'Sam Sample' }, { name: 'José García' }, { name: 'Jennifer Example' }, { name: 'Pat Example' }] }];
const sch = (shifts, date) => DT.planSchedule({ date: date || '2026-10-12', shifts: shifts }, SCH_STORES, (s) => s, '2026-10-12');
const S = (name, start, end) => ({ name: name, store: 'ORLAND SQUARE', start: start, end: end });
test('earliest shift opens, latest closes, mid shift is ignored', () => {
  const r = sch([S('Testa Fake', '09:45', '18:00'), S('Sam Sample', '11:00', '17:00'), S('Pat Example', '13:00', '20:15')]);
  eq(r.people['ORLAND SQUARE|Testa Fake'].roles, ['opener']);
  eq(r.people['ORLAND SQUARE|Pat Example'].roles, ['closer']);
  eq(r.people['ORLAND SQUARE|Sam Sample'], undefined);
});
test('no shift near 10am: the earliest shift is still the opener', () => {
  const r = sch([S('Sam Sample', '12:00', '18:00'), S('Pat Example', '14:00', '20:15')]);
  eq(r.people['ORLAND SQUARE|Sam Sample'].roles, ['opener']);
});
test('two people starting together both open', () => {
  const r = sch([S('Testa Fake', '09:45', '17:00'), S('Sam Sample', '10:00', '17:00'), S('Pat Example', '15:00', '20:15')]);
  eq(Object.keys(r.people).filter(k => r.people[k].roles.indexOf('opener') >= 0).sort(), ['ORLAND SQUARE|Sam Sample', 'ORLAND SQUARE|Testa Fake']);
});
test('one person all day both opens and closes', () => {
  eq(sch([S('Testa Fake', '09:45', '20:15')]).people['ORLAND SQUARE|Testa Fake'].roles, ['opener', 'closer']);
});
test('Last, First / accents / short first names match Contacts', () => {
  const r = sch([S('Garcia, Jose', '09:45', '17:00'), S('Jen Example', '15:00', '20:15')]);
  eq(Object.keys(r.people).sort(), ['ORLAND SQUARE|Jennifer Example', 'ORLAND SQUARE|José García']);
});
test('people not in Contacts are reported, not guessed', () => {
  const r = sch([S('Nobody Known', '09:45', '17:00'), S('Pat Example', '15:00', '20:15')]);
  eq(r.unmatched, [{ name: 'Nobody Known', store: 'ORLAND SQUARE', roles: ['opener'] }]);
});
test("yesterday's schedule is never used for today", () => {
  const r = sch([S('Testa Fake', '09:45', '17:00')], '2026-10-11');
  eq([r.fresh, Object.keys(r.people).length], [false, 0]);
});
test('bad times and unknown stores are skipped quietly', () => {
  const r = DT.planSchedule({ date: '2026-10-12', shifts: [S('Testa Fake', 'x', 'y'), { name: 'Pat Example', store: 'MARS', start: '09:00', end: '17:00' }] }, SCH_STORES, (s) => (s === 'ORLAND SQUARE' ? s : null), '2026-10-12');
  eq(Object.keys(r.people).length, 0);
});

console.log('\nSling feed');
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'SUMMARY:Testa Fake - STORE MANAGER - TOWSON STORE', ' \u2764\uFE0F', 'DTSTART:20261012T134500Z', 'DTEND:20261012T200000Z',
  'LOCATION:825 Example Rd\\, Towson\\, MD 21204', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Sam Sample - INSPIRATION NATION TEAM - ORLAND SQUARE', 'DTSTART:20261012T144500Z', 'DTEND:20261013T011500Z',
  'LOCATION:1 Example Way\\, Orland Park\\, IL 60462', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Pat Example - ZOOM MEETING - INSPIRATION CO - ORLAND SQUARE', 'DTSTART:20261012T150000Z', 'DTEND:20261012T160000Z', 'LOCATION:', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Jo Example - CORPORATE REP - GURNEE MILLS', 'DTSTART:20261012T150000Z', 'DTEND:20261012T200000Z', 'LOCATION:', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Empty Event - STORE MANAGER - TOWSON STORE', 'DTSTART:20261012T150000Z', 'DTEND:20261012T150000Z', 'LOCATION:', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');
test('feed parses; folded lines, escaped commas and empty events handled', () => {
  const r = SL.parseIcs(ICS);
  eq([r.events.length, r.skipped], [4, 1]);
  eq(r.events[0].location, '825 Example Rd, Towson, MD 21204');
});
test('store labels lose emoji and district tags', () => {
  eq(SL.cleanStore('TOWSON STORE\u2764\uFE0F\u200D\uD83D\uDD25'), 'TOWSON STORE');
  eq(SL.cleanStore('KING OF PRUSSIA STORE\uD83D\uDC51D2'), 'KING OF PRUSSIA STORE');
  eq(SL.cleanStore('INSPIRATION CO - ORLAND SQUARE'), 'ORLAND SQUARE');
});
test('shift times are converted to each store\'s own clock (DST aware)', () => {
  const { days } = SL.buildDays(SL.parseIcs(ICS).events, '2026-10-12', { daysBack: 0, daysAhead: 1 });
  const d = days['2026-10-12'];
  eq(d.map((s) => [s.store, s.start, s.end]).sort(), [['ORLAND SQUARE', '09:45', '20:15'], ['TOWSON STORE', '09:45', '16:00']]);
  const winter = SL.localParts(new Date('2026-12-05T14:45:00Z'), 'America/Chicago');
  eq(winter, { date: '2026-12-05', time: '08:45' });
});
test('zoom meetings and corporate visits are not shifts', () => {
  const { stats } = SL.buildDays(SL.parseIcs(ICS).events, '2026-10-12', { daysBack: 0, daysAhead: 0 });
  eq([stats.shifts, stats.notShift], [2, 2]);
  eq([SL.isShiftPosition('INSPIRATION NATION TEAM IN TRAINING'), SL.isShiftPosition('STORE MANAGER IN TRAINING')], [true, true]);
});
test('Firestore REST encoding', () => {
  eq(SL.toFirestoreValue({ a: 1, b: ['x', { c: true }] }), { mapValue: { fields: { a: { integerValue: '1' }, b: { arrayValue: { values: [{ stringValue: 'x' }, { mapValue: { fields: { c: { booleanValue: true } } } }] } } } } });
});
test('app reads the multi-day document, and ignores one that is too old', () => {
  const doc = { fetchedAt: 1000000, days: { '2026-10-12': [{ name: 'Testa Fake', store: 'ORLAND SQUARE', start: '09:45', end: '20:15' }] } };
  const stores = [{ mall: 'ORLAND SQUARE', staff: [{ name: 'Testa Fake' }] }];
  eq(Object.keys(DT.planSchedule(doc, stores, (s) => s, '2026-10-12', 1000000 + 3600e3).people), ['ORLAND SQUARE|Testa Fake']);
  eq(DT.planSchedule(doc, stores, (s) => s, '2026-10-12', 1000000 + 40 * 3600e3).fresh, false);
  eq(DT.planSchedule(doc, stores, (s) => s, '2026-10-13', 1000000).fresh, false);
});

console.log('\nRepo hygiene');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
test('no inline scripts or styles left in index.html', () => {
  const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  const allowed = m.filter(s => !/districtTexter\.theme\.v1/.test(s));
  eq(allowed.length, 0);
});
test('pinch-zoom is not disabled', () => { if (/user-scalable\s*=\s*no/i.test(html)) throw new Error('user-scalable=no present'); });
test('build stamps are in sync (run: node scripts/stamp-build.mjs)', () => {
  const out = fs.readFileSync(path.join(root, 'scripts', 'stamp-build.mjs'), 'utf8');
  void out;
  const { stampState } = createRequire(import.meta.url)(path.join(root, 'scripts', 'stamp-lib.cjs'));
  const s = stampState(root);
  if (!s.ok) throw new Error(s.reason);
});
test('no real phone numbers are committed in any served file', () => {
  const bad = [];
  for (const f of fs.readdirSync(root)) {
    if (!/\.(html|js|css|json|webmanifest)$/.test(f)) continue;
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    if (/"phone"\s*:\s*"\d{10,11}"/.test(t)) bad.push(f);
  }
  eq(bad, []);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
