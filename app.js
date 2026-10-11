/* District Texter — app logic. Pure helpers are in lib.js (window.DT); team sync is in sync.js
   (window.districtSync). Everything here touches the page, storage, or both. */
(function () {
'use strict';
const DT = window.DT;
const $ = (id) => document.getElementById(id);
const esc = DT.esc;
const money = DT.money;

// ================= storage (never throws — private mode / full storage just means "not saved") =================
function lsGet(key, fb) { try { const v = localStorage.getItem(key); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }
function lsStr(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
function lsSetStr(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* ignore */ } }

// ================= dates =================
const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function localDateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const todayDateStr = localDateStr(new Date());
const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0..Sun=6
const BUCKET_LABEL = { monthu: 'Mon–Thu', frisun: 'Fri & Sun', sat: 'Saturday' };
const AUTO_BUCKET = DT.bucketForIdx(todayIdx);
let selectedBucket = AUTO_BUCKET;
let mode = 'openers'; // 'openers' | 'closers' | 'lowsales'

// Per-day keys pile up one set per day; keep two weeks.
(function pruneOldDays() {
  try {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
    const cut = localDateStr(cutoff);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      const m = k && k.match(/^districtTexter\.(today|tasks|salesAt|salesMeta|texts|schedTouched)\.(\d{4}-\d{2}-\d{2})$/);
      if (m && m[2] < cut) localStorage.removeItem(k);
    }
  } catch (e) { /* ignore */ }
})();

// ================= defaults =================
// Goals are old LY reference numbers (not personal data) used only until a real report is loaded.
const BAKED = [['ARUNDEL MILLS STORE', 546], ['CAROLINA PLACE', 54], ['CASTLETON SQUARE', 411], ['GURNEE MILLS', 533],
  ['KING OF PRUSSIA STORE', 624], ['ORLAND SQUARE', 1391], ['PALISADES STORE', 226], ['SOMERSET COLLECTIONS', 2001],
  ['TOWSON SQUARE STORE', 509], ['TREASURE COAST', 219], ['UTC', 0], ['WALDEN GALLERIA', 515], ['WOODFIELD STORE', 1105]];
const BAKED_GOAL = {}; BAKED.forEach(b => { BAKED_GOAL[b[0]] = b[1]; });
const defaultGoal = (mall) => BAKED_GOAL[mall] || 0;

const TEMPLATES_DEFAULT = {
  monthu: { floor: 400, msg: "Hey {name}! ☺️ Just checking in to be sure you saw the big bonuses up for grabs today😍 Currently we are a little behind where we need to be to reach last year's numbers, but I know we can hit it with just a couple big bundles! We only need ${amount} to beat LY! Text me the code word for today's morning message so I know you are ready to end the day strong, and what sales goal do you write to hit bonus tonight?" },
  frisun: { floor: 700, msg: "Hey {name}! 🎉 Happy {day}! Let's keep that energy up today😍 We only need ${amount} to beat LY — very doable with a couple solid bundles! Text me the code word for today's morning message so I know you're locked in, and what sales goal do you write to hit bonus tonight?" },
  sat: { floor: 900, msg: "Hey {name}! 🥳 It's Sales Saturday — our biggest day of the week, let's make it count! We only need ${amount} to beat LY. Focus on sales only today! Text me the code word for today's morning message so I know you're ready, and what sales goal do you write to hit bonus tonight?" }
};
const LOW_DEFAULT = { threshold: 100, msg: "Hey {name}! ☺️ Just checking in to be sure you saw the big bonuses up for grabs today😍 Currently we are a little behind where we need to be to reach last year's numbers, but I know we can hit it with just a couple big bundles! We only need ${amount} to beat LY! Text me the code word for today's morning message so I know you are ready to end the day strong, and what sales goal do you write to hit bonus tonight?" };

// ================= state =================
const K = {
  extra: 'districtTexter.extraStores.v1', roster: 'districtTexter.rosterCache.v1', tpl: 'districtTexter.templates.v2',
  ly: 'districtTexter.ly.v1', aov: 'districtTexter.aov.v1', hours: 'districtTexter.storeHours.v1',
  tz: 'districtTexter.storeTz.v1', ignored: 'districtTexter.ignored.v1', low: 'districtTexter.lowtemplate.v1',
  name: 'districtTexter.myName.v1', theme: 'districtTexter.theme.v1', seeded: 'districtTexter.settingsSeeded.v1',
  today: 'districtTexter.today.' + todayDateStr, salesAt: 'districtTexter.salesAt.' + todayDateStr,
  meta: 'districtTexter.salesMeta.' + todayDateStr, tasks: 'districtTexter.tasks.' + todayDateStr,
  texts: 'districtTexter.texts.' + todayDateStr,
  sched: 'districtTexter.schedule.v1', slingNames: 'districtTexter.slingNames.v1', schedTouched: 'districtTexter.schedTouched.' + todayDateStr
};

// Name matching for store names as Shopify spells them. These are consts, so they must be defined
// before the roster is built below (which already filters hidden stores).
function norm(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
const MALL_TOKENS = [['ORLAND', 'ORLAND SQUARE'], ['FORT LAUDERDALE', 'GALLERIA FORT LAUDERDALE'], ['GALLERIA FORT', 'GALLERIA FORT LAUDERDALE'],
  ['WOODFIELD', 'WOODFIELD STORE'], ['TREASURE', 'TREASURE COAST'], ['GURNEE', 'GURNEE MILLS'], ['CAROLINA', 'CAROLINA PLACE'],
  ['TOWSON', 'TOWSON SQUARE STORE'], ['CASTLETON', 'CASTLETON SQUARE'], ['PRUSSIA', 'KING OF PRUSSIA STORE'], ['ARUNDEL', 'ARUNDEL MILLS STORE'],
  ['PALISADES', 'PALISADES STORE'], ['WALDEN', 'WALDEN GALLERIA'], ['SOMERSET', 'SOMERSET COLLECTIONS'], ['SPRINGFIELD', 'SPRINGFIELD STORE'], ['UTC', 'UTC']];
const TOKEN_RES = MALL_TOKENS.map(([tok, mall]) => [new RegExp('\\b' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'), mall]);
function tokenCanon(U) { for (const [re, mall] of TOKEN_RES) if (re.test(U)) return mall; return null; }

// Stores Shopify reports but that were never part of this district.
const IGNORED_SEED = ['COUNTRYSIDE'];
const isSeedIgnored = (name) => { const U = String(name || '').toUpperCase(); return IGNORED_SEED.some(t => U.includes(t)); };
let ignoredStores = lsGet(K.ignored, {});          // { 'GALLERIA FORT LAUDERDALE': true } — shared with the team
let extraMalls = lsGet(K.extra, []).filter(m => !isSeedIgnored(m));

const data = BAKED.map(b => ({ mall: b[0], goal: b[1], staff: [] }));
const rosterCache = lsGet(K.roster, null);
if (Array.isArray(rosterCache) && rosterCache.length) {
  data.length = 0;
  rosterCache.forEach(s => { if (s && s.mall && !isSeedIgnored(s.mall)) data.push({ mall: s.mall, goal: s.goal, staff: Array.isArray(s.staff) ? s.staff : [] }); });
}
extraMalls.forEach(m => { if (!data.some(s => s.mall === m)) data.push({ mall: m, staff: [] }); });
for (let i = data.length - 1; i >= 0; i--) if (isHiddenName(data[i].mall)) data.splice(i, 1);

let templates = lsGet(K.tpl, null) || JSON.parse(JSON.stringify(TEMPLATES_DEFAULT));
['monthu', 'frisun', 'sat'].forEach(b => { if (!templates[b]) templates[b] = JSON.parse(JSON.stringify(TEMPLATES_DEFAULT[b])); });
let lowTemplate = lsGet(K.low, null) || JSON.parse(JSON.stringify(LOW_DEFAULT));

let lyStore = lsGet(K.ly, {});
let lyAov = lsGet(K.aov, {});
let storeHours = lsGet(K.hours, {});
let storeTz = lsGet(K.tz, {});
let todaySales = lsGet(K.today, {});
let salesAt = lsGet(K.salesAt, {});
let salesMeta = lsGet(K.meta, {});
let textLog = lsGet(K.texts, {});
let slingNames = lsGet(K.slingNames, {});     // schedule name → Contacts name (or '-'), shared by everyone
let scheduleDoc = lsGet(K.sched, null);      // today's shifts, written by the Sling job
let schedTouched = lsGet(K.schedTouched, {}); // people the user ticked/unticked by hand today
let myName = lsStr(K.name);

const TASK_DEFS = [
  { key: 'openers', label: 'Opener texts sent' }, { key: 'low1pm', label: '1pm low-sales check' },
  { key: 'low5pm', label: '5pm low-sales check' }, { key: 'closers', label: 'Closer texts sent' }
];
function defaultTasks() { const o = {}; TASK_DEFS.forEach(t => { o[t.key] = { done: false, by: null, at: null }; }); return o; }
let teamTasks = Object.assign(defaultTasks(), lsGet(K.tasks, {}));

function ensureStoreArrays(mall) {
  if (!Array.isArray(lyStore[mall])) lyStore[mall] = DAY_KEYS.map(() => defaultGoal(mall));
  if (!Array.isArray(lyAov[mall])) lyAov[mall] = DAY_KEYS.map(() => 0);
}
data.forEach(s => ensureStoreArrays(s.mall));
function saveLy() { lsSet(K.ly, lyStore); }
function saveAov() { lsSet(K.aov, lyAov); }
function saveSales() { lsSet(K.today, todaySales); lsSet(K.salesAt, salesAt); lsSet(K.meta, salesMeta); }
function saveRosterCache() { lsSet(K.roster, data.map(s => ({ mall: s.mall, goal: s.goal, staff: s.staff }))); }
function sync() { const S = window.districtSync; return S && S.configured ? S : null; }

// ================= hidden stores (shared) =================
function isHiddenName(name) {
  const U = norm(name);
  if (isSeedIgnored(U)) return true;
  for (const h of Object.keys(ignoredStores)) {
    if (!ignoredStores[h]) continue;
    if (U === h || U.includes(h) || tokenCanon(U) === h) return true;
  }
  return false;
}
function canonMall(loc) {
  const U = norm(loc);
  const exact = data.find(s => s.mall.toUpperCase() === U);
  if (exact) return exact.mall;
  for (const [re, mall] of TOKEN_RES) if (re.test(U) && data.some(s => s.mall === mall)) return mall;
  return null;
}

// ================= clock / goals =================
const tzFor = (mall) => storeTz[mall] || DT.defaultTzFor(mall);
const closeTimesFor = (mall) => { const ov = storeHours[mall]; return (ov && ov.length === 7) ? ov : DT.DEFAULT_CLOSE; };
const hoursLeftFor = (mall) => DT.hoursLeft(closeTimesFor(mall), tzFor(mall), new Date());
function goalInfo(mall) {
  const g = DT.computeGoal({ ly: (lyStore[mall] || [])[todayIdx], floor: templates[selectedBucket].floor, sold: todaySales[mall], hoursLeft: hoursLeftFor(mall) });
  g.aov = (lyAov[mall] || [])[todayIdx] || 0;
  return g;
}
function lowSalesInfo(mall) {
  const ly = (lyStore[mall] || [])[todayIdx] || 0, sold = Number(todaySales[mall]) || 0;
  return { ly: ly, sold: sold, gap: Math.max(0, Math.round(ly - sold)), under: sold < (Number(lowTemplate.threshold) || 0) };
}
function districtStat() {
  let sold = 0, ly = 0;
  data.forEach(s => { sold += Number(todaySales[s.mall]) || 0; ly += (lyStore[s.mall] || [])[todayIdx] || 0; });
  const diff = Math.round(sold - ly);
  return { sold: sold, ly: ly, diff: diff, pct: ly > 0 ? Math.round((sold / ly) * 100) : 0 };
}
function asOfText() {
  if (!salesMeta.at) return '';
  return 'Sales as of ' + DT.fmtClock(salesMeta.at) + (salesMeta.by ? ' · ' + salesMeta.by : '');
}
function hasAnySales() { return data.some(s => Number(todaySales[s.mall]) > 0); }

// ================= toast / undo =================
let undoTimer = null;
function showUndoSnack(text, onUndo, ms) {
  clearTimeout(undoTimer);
  const el = $('undoSnack');
  el.innerHTML = '<span>' + esc(text) + '</span>' + (onUndo ? '<button id="undoBtn">Undo</button>' : '');
  el.className = 'undosnack show';
  const b = $('undoBtn');
  if (b) b.addEventListener('click', () => { clearTimeout(undoTimer); el.className = 'undosnack'; onUndo(); });
  undoTimer = setTimeout(() => { el.className = 'undosnack'; }, ms || 6000);
}

// ================= stats popups =================
function renderDistrictStat() {
  const d = districtStat(), ahead = d.diff >= 0;
  const text = d.pct + '% of LY · ' + money(Math.abs(d.diff)) + (ahead ? ' ahead' : ' to go');
  document.querySelectorAll('.districtStatText').forEach(el => { el.textContent = text; });
  document.querySelectorAll('.districtStatFill').forEach(el => {
    el.style.width = Math.max(0, Math.min(100, d.pct)) + '%';
    el.classList.toggle('ahead', ahead);
  });
  const asOf = asOfText();
  document.querySelectorAll('.asOfLine').forEach(el => { el.textContent = asOf; el.hidden = !asOf; });
}
function openDistrictStats() {
  const d = districtStat(), ahead = d.diff >= 0;
  $('districtStatsDay').textContent = DAY_FULL[todayIdx];
  $('districtStatsPct').textContent = d.pct + '%';
  $('districtStatsPct').classList.toggle('ahead', ahead);
  $('districtStatsSub').textContent = ahead ? money(d.diff) + ' ahead of last year' : money(Math.abs(d.diff)) + ' to go to match last year';
  const fill = $('districtStatsBarFill');
  fill.style.width = Math.max(0, Math.min(100, d.pct)) + '%';
  fill.classList.toggle('ahead', ahead);
  $('districtStatsSoldLabel').textContent = 'Sold ' + money(d.sold);
  $('districtStatsLyLabel').textContent = 'LY ' + money(d.ly);
  const onTrack = data.filter(s => (Number(todaySales[s.mall]) || 0) >= ((lyStore[s.mall] || [])[todayIdx] || 0) && (lyStore[s.mall] || [])[todayIdx] > 0).length;
  const noData = data.filter(s => todaySales[s.mall] == null).length;
  const rows = [['Stores at or ahead of LY', onTrack + ' of ' + data.length]];
  if (noData) rows.push(['Stores with no sales loaded yet', String(noData)]);
  const asOf = asOfText(); if (asOf) rows.push(['Last report', asOf.replace('Sales as of ', '')]);
  $('districtStatsGrid').innerHTML = rows.map(r => '<div class="statrow"><span class="statlabel">' + esc(r[0]) + '</span><span class="statvalue">' + esc(r[1]) + '</span></div>').join('');
  $('districtStatsDlg').showModal();
}
function openStoreStats(mall) {
  const info = goalInfo(mall), target = info.target || 0;
  const pct = target > 0 ? Math.round((info.sold / target) * 100) : (info.sold > 0 ? 100 : 0);
  const ahead = info.hit;
  $('storeStatsMall').textContent = mall;
  $('storeStatsPct').textContent = pct + '%';
  $('storeStatsPct').classList.toggle('ahead', ahead);
  $('storeStatsSub').textContent = ahead ? 'Hit already — ' + money(info.sold - target) + ' over'
    : money(info.goal) + ' to go' + (info.floored ? ' (using minimum)' : '');
  const fill = $('storeStatsBarFill');
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  fill.classList.toggle('ahead', ahead);
  $('storeStatsSoldLabel').textContent = 'Sold ' + money(info.sold);
  $('storeStatsTargetLabel').textContent = 'Target ' + money(target);
  const tiles = [['LY', money(info.ly)], ['AOV', info.aov ? money(info.aov) : '—'], ['Minimum', money(info.floor)],
    ['Hours left', DT.fmtHours(info.hours)], ['Pace needed', money(info.perHour) + '/hr'],
    ['Status', ahead ? 'Hit ✓' : (info.floored ? 'Using minimum' : 'Below LY')]];
  $('storeStatsTiles').innerHTML = tiles.map(t => '<div class="statTile"><span class="stLabel">' + esc(t[0]) + '</span><span class="stValue">' + esc(t[1]) + '</span></div>').join('');
  $('storeStatsDlg').showModal();
}
$('districtStatBtnTop').addEventListener('click', openDistrictStats);
$('districtStatBtnSide').addEventListener('click', openDistrictStats);
['districtStatsCloseBtn', 'districtStatsCloseX'].forEach(id => $(id).addEventListener('click', () => $('districtStatsDlg').close()));
['storeStatsCloseBtn', 'storeStatsCloseX'].forEach(id => $(id).addEventListener('click', () => $('storeStatsDlg').close()));
// A click on the dim area (the <dialog> element itself, not its contents) closes any sheet.
document.querySelectorAll('dialog').forEach(dlg => dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }));

// ================= Shopify report import =================
$('todayLabel').textContent = DAY_KEYS[todayIdx];
const pasteMsgEl = $('pasteMsg');
function setPasteMsg(text, cls) { pasteMsgEl.textContent = text; pasteMsgEl.className = 'status' + (cls ? ' ' + cls : ''); }
let pendingPlan = null;

function planReport(raw) {
  const rep = DT.readReport(raw);
  const plan = { rows: [], warnings: rep.warnings.slice(), skipped: rep.skipped, hidden: 0, news: [], hasAov: rep.hasAov, hasLy: rep.hasLy };
  const seen = {};
  rep.rows.forEach(r => {
    if (isHiddenName(r.loc)) { plan.hidden++; return; }
    let mall = canonMall(r.loc), isNew = false;
    if (!mall) { mall = norm(r.loc); isNew = !data.some(s => s.mall === mall); if (isNew && plan.news.indexOf(mall) < 0) plan.news.push(mall); }
    if (seen[mall]) plan.warnings.push('"' + r.loc + '" appears more than once — the last row wins.');
    seen[mall] = true;
    plan.rows.push({ mall: mall, loc: r.loc, today: r.today, ly: r.ly, aov: r.aov });
  });
  plan.rows.forEach(r => {
    const prev = Number(todaySales[r.mall]) || 0;
    if (!isNaN(r.today) && prev - r.today >= 50 && r.today < prev * 0.8) {
      plan.warnings.push(r.mall + ' would go DOWN from ' + money(prev) + ' to ' + money(r.today) + ' — is this an older report?');
    }
  });
  if (plan.news.length) plan.warnings.push('New store' + (plan.news.length === 1 ? '' : 's') + ' (not in Contacts): ' + plan.news.join(', ') + '.');
  if (plan.skipped) plan.warnings.push(plan.skipped + ' row' + (plan.skipped === 1 ? '' : 's') + ' looked like a link or junk and will be skipped.');
  return plan;
}

function commitPlan(plan) {
  const now = Date.now();
  const undo = { sales: {}, at: {}, ly: {}, aov: {}, news: [], meta: Object.assign({}, salesMeta) };
  const salesPush = {}, atPush = {}, lyPatch = {}, aovPatch = {};
  const changed = [];
  let matched = 0, gotAov = false;
  plan.rows.forEach(r => {
    if (plan.news.indexOf(r.mall) >= 0 && !data.some(s => s.mall === r.mall)) {
      data.push({ mall: r.mall, staff: [] });
      if (extraMalls.indexOf(r.mall) < 0) extraMalls.push(r.mall);
      undo.news.push(r.mall);
    }
    ensureStoreArrays(r.mall);
    if (!isNaN(r.today)) {
      const prev = Number(todaySales[r.mall]) || 0, val = Math.round(r.today);
      undo.sales[r.mall] = todaySales[r.mall] == null ? null : todaySales[r.mall];
      undo.at[r.mall] = salesAt[r.mall] || 0;
      if (val !== prev) changed.push(r.mall + ' ' + money(prev) + ' → ' + money(val));
      todaySales[r.mall] = val; salesAt[r.mall] = now;
      salesPush[r.mall] = val; atPush[r.mall] = now;
    }
    if (!isNaN(r.ly)) {
      const v = Math.round(r.ly);
      if (lyStore[r.mall][todayIdx] !== v) { undo.ly[r.mall] = lyStore[r.mall][todayIdx]; lyStore[r.mall][todayIdx] = v; (lyPatch[r.mall] = lyPatch[r.mall] || {})[todayIdx] = v; }
    }
    if (!isNaN(r.aov)) {
      const v = Math.round(r.aov); gotAov = true;
      if (lyAov[r.mall][todayIdx] !== v) { undo.aov[r.mall] = lyAov[r.mall][todayIdx]; lyAov[r.mall][todayIdx] = v; (aovPatch[r.mall] = aovPatch[r.mall] || {})[todayIdx] = v; }
    }
    matched++;
  });
  if (Object.keys(salesPush).length) salesMeta = { at: now, by: myName || '' };
  lsSet(K.extra, extraMalls); saveSales(); saveLy(); saveAov();
  renderAll();
  const S = sync();
  if (S) {
    if (Object.keys(salesPush).length) S.setSalesBatch(todayDateStr, salesPush, atPush, myName).catch(() => {});
    const patch = {};
    if (Object.keys(lyPatch).length) patch.ly = lyPatch;
    if (Object.keys(aovPatch).length) patch.aov = aovPatch;
    if (patch.ly || patch.aov) S.patchSettings(patch).catch(() => {});
  }
  const bits = ['✓ ' + matched + ' store' + (matched === 1 ? '' : 's') + ' updated'];
  if (changed.length) bits.push(changed.slice(0, 4).join(' · ') + (changed.length > 4 ? ' · +' + (changed.length - 4) + ' more' : ''));
  if (plan.hidden) bits.push(plan.hidden + ' hidden store' + (plan.hidden === 1 ? '' : 's') + ' ignored');
  if (plan.hasLy === false && plan.rows.length) bits.push('LY and AOV not in this paste — kept the saved ones');
  else if (!gotAov) bits.push('no AOV column found');
  setPasteMsg(bits.join(' — '), (plan.news.length || plan.skipped || !gotAov) ? 'warn' : 'ok');
  if (matched) showUndoSnack('Report applied to ' + matched + ' store' + (matched === 1 ? '' : 's'), () => undoPlan(undo), 9000);
}

function undoPlan(undo) {
  const now = Date.now(), salesPush = {}, atPush = {}, lyPatch = {}, aovPatch = {};
  Object.keys(undo.sales).forEach(m => {
    todaySales[m] = undo.sales[m]; salesAt[m] = now; salesPush[m] = undo.sales[m]; atPush[m] = now;
  });
  Object.keys(undo.ly).forEach(m => { lyStore[m][todayIdx] = undo.ly[m]; (lyPatch[m] = lyPatch[m] || {})[todayIdx] = undo.ly[m]; });
  Object.keys(undo.aov).forEach(m => { lyAov[m][todayIdx] = undo.aov[m]; (aovPatch[m] = aovPatch[m] || {})[todayIdx] = undo.aov[m]; });
  undo.news.forEach(m => {
    const i = data.findIndex(s => s.mall === m); if (i >= 0 && !data[i].staff.length) data.splice(i, 1);
    extraMalls = extraMalls.filter(x => x !== m);
  });
  salesMeta = undo.meta;
  lsSet(K.extra, extraMalls); saveSales(); saveLy(); saveAov();
  renderAll();
  setPasteMsg('Undid the last report.', '');
  const S = sync();
  if (S) {
    if (Object.keys(salesPush).length) S.setSalesBatch(todayDateStr, salesPush, atPush, myName).catch(() => {});
    const patch = {}; if (Object.keys(lyPatch).length) patch.ly = lyPatch; if (Object.keys(aovPatch).length) patch.aov = aovPatch;
    if (patch.ly || patch.aov) S.patchSettings(patch).catch(() => {});
  }
}

function applyReportText(raw) {
  raw = (raw || '').trim();
  if (!raw) { setPasteMsg('That report looks empty — try again.', 'warn'); return false; }
  const plan = planReport(raw);
  if (!plan.rows.length) {
    const why = plan.skipped ? " — that looked like a link, not a report. Copy the report's text, not a download link." : (plan.hidden ? ' — every store in it is hidden.' : " — check it's the right report.");
    setPasteMsg("Couldn't match any stores in that" + why, 'warn');
    return false;
  }
  // Header-less pastes, new stores, suspicious drops: ask first. Everything else applies at once.
  if (plan.warnings.length) {
    pendingPlan = plan; pendingPlan.raw = raw;
    $('reportDlgList').innerHTML = plan.warnings.map(w => '<li>' + esc(w) + '</li>').join('');
    $('reportDlgCount').textContent = plan.rows.length + ' store' + (plan.rows.length === 1 ? '' : 's') + ' in this paste';
    $('reportDlg').showModal();
    return false;
  }
  commitPlan(plan);
  return true;
}
$('reportApplyBtn').addEventListener('click', () => {
  $('reportDlg').close();
  if (pendingPlan) {
    const p = pendingPlan; pendingPlan = null; commitPlan(p);
    if ($('pasteBox').value.trim() === p.raw) $('pasteBox').value = '';
  }
});
$('reportCancelBtn').addEventListener('click', () => { pendingPlan = null; $('reportDlg').close(); setPasteMsg('Nothing was changed.', ''); });
$('clearPaste').addEventListener('click', () => { $('pasteBox').value = ''; setPasteMsg('', ''); });
// The box is emptied once its report goes in, so the next paste can't pile onto the old text.
$('applyPaste').addEventListener('click', () => {
  const raw = $('pasteBox').value;
  if (applyReportText(raw)) $('pasteBox').value = '';
});
$('csvFileInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  setPasteMsg('Reading ' + file.name + '…', '');
  const reader = new FileReader();
  reader.onload = () => applyReportText(String(reader.result));
  reader.onerror = () => setPasteMsg("Couldn't open that file — try again or use paste instead.", 'warn');
  reader.readAsText(file);
  e.target.value = '';
});
$('pasteClipBtn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) { setPasteMsg('Clipboard is empty — copy the report first, then tap this.', 'warn'); return; }
    applyReportText(text);
  } catch (err) {
    setPasteMsg('Couldn\'t read the clipboard — copy the report again, or use "paste it by hand" below.', 'warn');
  }
});

// ================= Send tab =================
const list = $('list');
const sel = new Set();
const kindOfMode = () => mode === 'closers' ? 'closers' : (mode === 'lowsales' ? 'low' : 'openers');
const personKey = (mall, name) => mall + '|' + name;
function textedInfo(mall, name) {
  const e = (textLog[personKey(mall, name)] || {})[kindOfMode()];
  return e ? e : null;
}
function pillHtml(mall) {
  const enc = encodeURIComponent(mall);
  if (mode === 'lowsales') {
    const i = lowSalesInfo(mall);
    const label = i.gap > 0 ? 'Gap to LY' : 'At or past LY';
    return '<button type="button" class="goalpill ' + (i.under ? '' : 'hit') + '" data-stats-mall="' + enc + '" aria-label="' + esc(mall) + ' details"><small>' + label + '</small>' + money(i.gap) + '</button>';
  }
  const g = goalInfo(mall);
  const cls = g.hit ? 'hit' : (g.floored ? 'floor' : '');
  return '<button type="button" class="goalpill ' + cls + '" data-stats-mall="' + enc + '" aria-label="' + esc(mall) + ' details"><small>' +
    (g.hit ? 'Hit already' : (g.floored ? 'Goal (minimum)' : 'Goal left')) + '</small>' + money(g.goal) + '</button>';
}
function extrasHtml(mall) {
  if (mode !== 'lowsales') return '';
  const i = lowSalesInfo(mall);
  return i.under ? '<div class="badgepill">⚠ under ' + money(lowTemplate.threshold) + ' today</div>' : '';
}
function numInput(kind, mall, value, label) {
  return '<input type="number" inputmode="decimal" min="0" data-' + kind + '-mall="' + encodeURIComponent(mall) + '" aria-label="' + esc(label + ' — ' + mall) + '" value="' + (value == null ? '' : value) + '"' + (kind === 'today' ? ' placeholder="0"' : '') + '>';
}
function inputsHtml(mall) {
  const ly = (lyStore[mall] || [])[todayIdx] || 0, aov = (lyAov[mall] || [])[todayIdx] || 0;
  const sold = todaySales[mall] != null ? todaySales[mall] : '';
  if (mode === 'lowsales') {
    return '<div class="inputs"><div class="field quiet"><label>LY ' + DAY_KEYS[todayIdx] + '</label>' + numInput('ly', mall, ly, 'LY') + '</div>' +
      '<div class="field"><label>Today</label>' + numInput('today', mall, sold, 'Today') + '</div></div>';
  }
  return '<div class="inputs"><div class="field quiet"><label>LY</label>' + numInput('ly', mall, ly, 'LY') + '</div>' +
    '<div class="field quiet"><label>AOV</label>' + numInput('aov', mall, aov, 'AOV') + '</div>' +
    '<div class="field"><label>Today</label>' + numInput('today', mall, sold, 'Today') + '</div></div>';
}
let lastSig = '';
function signature() {
  return mode + '|' + data.map(s => s.mall + ':' + s.staff.map(p => p.name + '~' + p.phone).join(',')).join('|') +
    '|' + JSON.stringify(textLog) + '|' + selectedBucket + '|' + (scheduleDoc ? (scheduleDoc.fetchedAt || scheduleDoc.date) : '');
}
// ---- who is opening / closing today (from the Sling schedule) ----
const schedPlan = () => DT.planSchedule(scheduleDoc, data, canonMall, todayDateStr, Date.now(), slingNames);
const schedRole = () => mode === 'closers' ? 'closer' : (mode === 'openers' ? 'opener' : null);
// Ticks the people the schedule says are opening/closing, except anyone the user already decided about
// by hand today, anyone without a number, and anyone already texted in this round.
const autoSel = new Set();   // ticks that came from the schedule (so a changed schedule can take them back)
function applySchedulePreselect(plan) {
  const role = schedRole();
  [...autoSel].forEach(id => {
    const info = plan.fresh && role ? plan.people[id] : null;
    if (!info || info.roles.indexOf(role) < 0 || schedTouched[mode + '|' + id]) { sel.delete(id); autoSel.delete(id); }
  });
  if (!role || !plan.fresh) return;
  Object.keys(plan.people).forEach(id => {
    if (plan.people[id].roles.indexOf(role) < 0) return;
    if (schedTouched[mode + '|' + id]) return;
    const cut = id.indexOf('|'), mall = id.slice(0, cut), name = id.slice(cut + 1);
    const store = data.find(s => s.mall === mall), p = store && store.staff.find(x => x.name === name);
    if (!p || !p.phone || textedInfo(mall, name)) return;
    sel.add(id); autoSel.add(id);
  });
}
function updateSchedNote(plan) {
  const el = $('schedNote');
  if (!scheduleDoc || !schedRole()) { el.hidden = true; return; }
  const upd = scheduleDoc.fetchedAt ? ' · updated ' + DT.fmtClock(scheduleDoc.fetchedAt) : '';
  if (!plan.fresh) {
    el.className = 'schedNote warn';
    el.textContent = "The Sling schedule hasn't updated for today" + upd + ' — pick people by hand.';
  } else {
    const old = scheduleDoc.fetchedAt && Date.now() - scheduleDoc.fetchedAt > 12 * 3600 * 1000;
    const parts = ['Pre-selected from the Sling schedule' + upd + (old ? ' (may be out of date)' : '') + '. Tap anyone to change.'];
    const role = schedRole();
    const list = (names) => names.slice(0, 3).join(', ') + (names.length > 3 ? ' +' + (names.length - 3) + ' more' : '');
    // New hires: on the schedule but not in Contacts yet, or in Contacts without a number.
    const missing = plan.unmatched.filter(u => u.roles.indexOf(role) >= 0).map(u => DT.titleCase(u.name));
    const noPhone = Object.keys(plan.people).filter(id => plan.people[id].roles.indexOf(role) >= 0).map(id => {
      const cut = id.indexOf('|'), store = data.find(s => s.mall === id.slice(0, cut)), p = store && store.staff.find(x => x.name === id.slice(cut + 1));
      return p && !p.phone ? DT.titleCase(p.name) : null;
    }).filter(Boolean);
    if (missing.length) parts.push('⚠ Not in Contacts yet, so they can\'t be texted: ' + list(missing) + '.');
    if (noPhone.length) parts.push('⚠ No phone number saved for: ' + list(noPhone) + ' — add it in Contacts.');
    el.className = 'schedNote' + (missing.length || noPhone.length ? ' warn' : '');
    el.textContent = parts.join(' ');
    if (plan.unmatched.length) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'linkbtn'; b.id = 'fixNamesBtn'; b.textContent = 'Fix names';
      el.appendChild(b);
    }
  }
  el.hidden = false;
}
function shiftTag(info) {
  if (!info) return '';
  const o = info.roles.indexOf('opener') >= 0, c = info.roles.indexOf('closer') >= 0;
  const label = o && c ? '☀️🌙 Opening + closing' : (o ? '☀️ Opening' : '🌙 Closing');
  return '<div class="shiftTag">' + label + ' · ' + esc(DT.fmtTimeLabel(info.start) + '–' + DT.fmtTimeLabel(info.end)) + '</div>';
}
function render() {
  list.innerHTML = '';
  const known = new Set();
  const plan = schedPlan();
  applySchedulePreselect(plan);
  updateSchedNote(plan);
  data.forEach(s => {
    const el = document.createElement('div');
    el.className = 'store'; el.dataset.mall = s.mall;
    el.innerHTML = '<div class="storehead"><h2>' + esc(s.mall) + '</h2><span class="pillHost">' + pillHtml(s.mall) + '</span></div>' +
      inputsHtml(s.mall) + '<div class="cardExtras">' + extrasHtml(s.mall) + '</div><div class="roster"></div>';
    const roster = el.querySelector('.roster');
    s.staff.forEach(p => {
      const id = personKey(s.mall, p.name);
      known.add(id);
      const row = document.createElement('div');
      row.className = 'person' + (sel.has(id) ? ' sel' : '');
      row.setAttribute('role', 'checkbox'); row.setAttribute('aria-checked', sel.has(id) ? 'true' : 'false'); row.tabIndex = p.phone ? 0 : -1;
      const initials = (p.name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
      const t = textedInfo(s.mall, p.name);
      row.innerHTML = '<div class="avatar">' + esc(initials) + '</div><div class="pinfo"><div class="nm">' + esc(DT.titleCase(p.name)) + '</div>' + shiftTag(plan.people[id]) +
        (p.phone ? '<div class="ph">' + esc(DT.prettyPhone(p.phone)) + (t ? ' · <span class="texted">texted ' + esc(DT.fmtClock(t.at)) + (t.by ? ' by ' + esc(t.by) : '') + '</span>' : '') + '</div>' : '') + '</div>' +
        (p.phone ? '' : '<div class="badge">no #</div>') + '<div class="cbx">✓</div>';
      if (p.phone) {
        const toggle = () => {
          sel.has(id) ? sel.delete(id) : sel.add(id); row.classList.toggle('sel'); row.setAttribute('aria-checked', sel.has(id)); updateCount();
          autoSel.delete(id); schedTouched[mode + '|' + id] = true; lsSet(K.schedTouched, schedTouched);   // the user's choice beats the schedule from now on
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
      } else { row.style.opacity = .55; }
      roster.appendChild(row);
    });
    list.appendChild(el);
  });
  [...sel].forEach(id => { if (!known.has(id)) sel.delete(id); });
  updateCount();
  lastSig = signature();
  refreshCards();
}
// Cheap in-place refresh: updates pills, badges, banners and district numbers WITHOUT rebuilding the
// inputs, so a phone keyboard is never dismissed mid-entry and a tap is never swallowed.
function refreshCards() {
  list.querySelectorAll('.store').forEach(el => {
    const mall = el.dataset.mall, info = mode === 'lowsales' ? null : goalInfo(mall);
    el.querySelector('.pillHost').innerHTML = pillHtml(mall);
    el.querySelector('.cardExtras').innerHTML = extrasHtml(mall);
    el.classList.toggle('hitstore', !!(info && info.hit));
  });
  $('noReportBanner').hidden = hasAnySales() || !!salesMeta.at;
  renderDistrictStat();
}
function syncInputsFromState() {
  list.querySelectorAll('input').forEach(inp => {
    if (inp === document.activeElement) return;
    const d = inp.dataset;
    let mall, v;
    if (d.todayMall) { mall = decodeURIComponent(d.todayMall); v = todaySales[mall] != null ? todaySales[mall] : ''; }
    else if (d.lyMall) { mall = decodeURIComponent(d.lyMall); v = ((lyStore[mall] || [])[todayIdx]) || 0; }
    else if (d.aovMall) { mall = decodeURIComponent(d.aovMall); v = ((lyAov[mall] || [])[todayIdx]) || 0; }
    else return;
    if (String(inp.value) !== String(v)) inp.value = v;
  });
}
// Called when data changed under the user's fingers (cloud updates): rebuild only if the layout
// actually changed or nothing is being typed.
function renderLive() {
  const typing = list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  if (typing && signature() === lastSig) { syncInputsFromState(); refreshCards(); }
  else render();
}
function renderAll() { render(); renderContacts(); renderToday(); }
function updateCount() { $('n').textContent = sel.size; $('go').disabled = !sel.size; }

// Delegated handlers (survive in-place refreshes).
list.addEventListener('click', e => {
  const b = e.target.closest('[data-stats-mall]');
  if (b) { e.stopPropagation(); openStoreStats(decodeURIComponent(b.dataset.statsMall)); }
});
list.addEventListener('change', e => {
  const inp = e.target; if (!inp.matches || !inp.matches('input[type="number"]')) return;
  const d = inp.dataset, S = sync(), now = Date.now();
  if (d.todayMall) {
    const mall = decodeURIComponent(d.todayMall), val = inp.value === '' ? null : Math.max(0, Number(inp.value));
    todaySales[mall] = val; salesAt[mall] = now; salesMeta = { at: now, by: myName || '' }; saveSales();
    if (S) S.setSalesBatch(todayDateStr, { [mall]: val }, { [mall]: now }, myName).catch(() => {});
  } else if (d.lyMall) {
    const mall = decodeURIComponent(d.lyMall), v = Math.max(0, Number(inp.value) || 0);
    ensureStoreArrays(mall); lyStore[mall][todayIdx] = v; saveLy();
    if (S) S.patchSettings({ ly: { [mall]: { [todayIdx]: v } } }).catch(() => {});
  } else if (d.aovMall) {
    const mall = decodeURIComponent(d.aovMall), v = Math.max(0, Number(inp.value) || 0);
    ensureStoreArrays(mall); lyAov[mall][todayIdx] = v; saveAov();
    if (S) S.patchSettings({ aov: { [mall]: { [todayIdx]: v } } }).catch(() => {});
  } else return;
  refreshCards(); renderToday();
});

// ================= mode, nav, header =================
const todaySummaryBtn = $('todaySummaryBtn'), todayDetailEl = $('floorlineOpeners'), headerBucketSeg = $('headerBucketSeg');
function collapseTodayDetail() { todayDetailEl.classList.remove('open'); todaySummaryBtn.setAttribute('aria-expanded', 'false'); }
todaySummaryBtn.addEventListener('click', () => {
  const open = todayDetailEl.classList.toggle('open');
  todaySummaryBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
});
headerBucketSeg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { selectedBucket = b.dataset.bucket; renderFloorLine(); render(); }));
function renderFloorLine() {
  headerBucketSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.bucket === selectedBucket));
  const floorAmt = money(templates[selectedBucket].floor);
  $('floorLabel').textContent = floorAmt;
  const tag = $('autoTag'), isAuto = selectedBucket === AUTO_BUCKET;
  if (isAuto) { tag.className = ''; tag.textContent = "today's default"; }
  else {
    tag.className = 'manual'; tag.innerHTML = 'overridden — <a href="#" id="resetAutoBtn">use today</a>';
    $('resetAutoBtn').addEventListener('click', e => { e.preventDefault(); selectedBucket = AUTO_BUCKET; renderFloorLine(); render(); });
  }
  $('lowThreshLabel').textContent = money(lowTemplate.threshold);
  $('todaySummaryText').textContent = BUCKET_LABEL[selectedBucket] + ' · minimum ' + floorAmt + (isAuto ? '' : ' · overridden');
}
document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#modeSeg button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  mode = b.dataset.mode;
  sel.clear(); autoSel.clear();
  const isLow = mode === 'lowsales';
  todaySummaryBtn.style.display = isLow ? 'none' : 'flex';
  $('floorlineLow').style.display = isLow ? 'flex' : 'none';
  if (isLow) collapseTodayDetail();
  renderFloorLine(); render();
}));

const dockEl = $('dock');
function syncDockPadding() {
  document.body.style.paddingBottom = (dockEl.offsetHeight + 14) + 'px';
  document.documentElement.style.setProperty('--dock-h', dockEl.offsetHeight + 'px');
}
window.addEventListener('resize', syncDockPadding);
window.addEventListener('orientationchange', syncDockPadding);
function showPage(page) {
  document.querySelectorAll('nav.tabbar button, .sidebarNav button').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('[data-page="' + page + '"]').forEach(x => x.classList.add('on'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  $(page).classList.add('on');
  $('sendBar').style.display = page === 'pageSend' ? 'flex' : 'none';
  $('appHeader').classList.toggle('on-send', page === 'pageSend');
  if (page === 'pageContacts') renderContacts();
  if (page === 'pageToday') { updateMyNameLabel(); renderToday(); if (!myName) openNameDlg(); }
  syncDockPadding();
}
document.querySelectorAll('nav.tabbar button, .sidebarNav button').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));

// ================= Setup: templates, low sales, theme, version =================
let editingBucket = selectedBucket, tplKind = 'openers';
function tplText(bucket, kind) {
  const t = templates[bucket];
  return kind === 'closers' && typeof t.closerMsg === 'string' ? t.closerMsg : t.msg;
}
function loadEditor() {
  $('floorInput').value = templates[editingBucket].floor;
  $('tmplBox').value = tplText(editingBucket, tplKind);
  document.querySelectorAll('#tmplKindSeg button').forEach(b => b.classList.toggle('on', b.dataset.kind === tplKind));
  document.querySelectorAll('#editBucketSeg button').forEach(b => b.classList.toggle('on', b.dataset.bucket === editingBucket));
  $('tmplKindNote').textContent = tplKind === 'closers' && typeof templates[editingBucket].closerMsg !== 'string'
    ? 'Closers use the opener wording until you edit this one.' : '';
}
document.querySelectorAll('#editBucketSeg button').forEach(b => b.addEventListener('click', () => { editingBucket = b.dataset.bucket; loadEditor(); }));
document.querySelectorAll('#tmplKindSeg button').forEach(b => b.addEventListener('click', () => { tplKind = b.dataset.kind; loadEditor(); }));
$('floorInput').addEventListener('input', e => {
  templates[editingBucket].floor = Number(e.target.value) || 0; lsSet(K.tpl, templates);
  if (editingBucket === selectedBucket) { renderFloorLine(); refreshCards(); }
});
$('tmplBox').addEventListener('input', e => {
  if (tplKind === 'closers') templates[editingBucket].closerMsg = e.target.value; else templates[editingBucket].msg = e.target.value;
  lsSet(K.tpl, templates);
  $('tmplKindNote').textContent = '';
});
function loadLowEditor() { $('lowThreshInput').value = lowTemplate.threshold; $('lowTmplBox').value = lowTemplate.msg; }
function lowChanged() { lsSet(K.low, lowTemplate); renderFloorLine(); if (mode === 'lowsales') refreshCards(); }
$('lowThreshInput').addEventListener('input', e => { lowTemplate.threshold = Number(e.target.value) || 0; lowChanged(); });
$('lowTmplBox').addEventListener('input', e => { lowTemplate.msg = e.target.value; lsSet(K.low, lowTemplate); });
$('lowPreset1pm').addEventListener('click', () => { lowTemplate.threshold = 100; loadLowEditor(); lowChanged(); });
$('lowPreset5pm').addEventListener('click', () => { lowTemplate.threshold = 300; loadLowEditor(); lowChanged(); });

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
  else document.documentElement.removeAttribute('data-theme');
}
let themeChoice = lsStr(K.theme) || 'auto';
applyTheme(themeChoice);
document.querySelectorAll('#themeSeg button').forEach(b => {
  b.classList.toggle('on', b.dataset.themeChoice === themeChoice);
  b.addEventListener('click', () => {
    themeChoice = b.dataset.themeChoice;
    document.querySelectorAll('#themeSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); applyTheme(themeChoice); lsSetStr(K.theme, themeChoice);
  });
});

// ---- version + updates ----
const loadedV = (() => { const s = [...document.scripts].find(x => /app\.js/.test(x.src)); try { return s ? new URL(s.src).searchParams.get('v') || '' : ''; } catch (e) { return ''; } })();
const buildDate = (document.querySelector('meta[name="build-date"]') || {}).content || '';
function renderVersion() {
  const when = buildDate ? new Date(buildDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  $('versionLabel').textContent = 'Version ' + (loadedV && loadedV !== '0' ? loadedV : 'dev') + (when ? ' · updated ' + when : '');
}
let updateBannerShown = false;
async function checkForUpdate(manual) {
  const msg = $('updateMsg');
  try {
    if (manual) { msg.textContent = 'Checking…'; }
    const res = await fetch(location.pathname + '?_=' + Date.now(), { cache: 'no-store' });
    const html = await res.text();
    const m = html.match(/app\.js\?v=([A-Za-z0-9]+)/);
    if (m && loadedV && loadedV !== '0' && m[1] !== loadedV) {
      if (manual) { msg.textContent = 'A newer version is ready.'; }
      if (!updateBannerShown) {
        updateBannerShown = true;
        const b = document.createElement('div');
        b.id = 'updateBanner';
        b.innerHTML = '🔄 A newer version is ready<button id="updateNowBtn">Update now</button>';
        document.body.prepend(b);
        $('updateNowBtn').addEventListener('click', hardRefresh);
      }
    } else if (manual) { msg.textContent = "You're on the latest version."; }
  } catch (e) { if (manual) msg.textContent = "Couldn't check right now — are you online?"; }
}
async function hardRefresh() {
  try {
    if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.indexOf('dt-') === 0).map(k => caches.delete(k))); }
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch (e) { /* fall through to a plain reload */ }
  location.href = location.pathname + '?r=' + Date.now();
}
$('checkUpdateBtn').addEventListener('click', () => checkForUpdate(true));

// ================= Contacts =================
function hoursSummary(mall) {
  const ct = closeTimesFor(mall), mt = ct[0], fr = ct[4], sa = ct[5], su = ct[6], L = DT.fmtTimeLabel;
  if (mt === fr && fr === sa && sa === su) return 'Closes ' + L(mt) + ' every day';
  if (fr === sa) return 'Closes ' + L(mt) + ' Mon–Thu · ' + L(fr) + ' Fri & Sat · ' + L(su) + ' Sun';
  return 'Closes ' + L(mt) + ' Mon–Thu · ' + L(fr) + ' Fri · ' + L(sa) + ' Sat · ' + L(su) + ' Sun';
}
const contactsListEl = $('contactsList'), contactSearchEl = $('contactSearch');
function renderContacts() {
  const q = (contactSearchEl.value || '').trim().toLowerCase();
  contactsListEl.innerHTML = '';
  let shown = 0;
  data.slice().sort((a, b) => a.mall.localeCompare(b.mall)).forEach(store => {
    const mallMatches = !q || store.mall.toLowerCase().includes(q);
    const people = (q && !mallMatches) ? store.staff.filter(p => (p.name || '').toLowerCase().includes(q)) : store.staff;
    if (q && !mallMatches && !people.length) return;
    shown++;
    const card = document.createElement('div'); card.className = 'ccard';
    card.innerHTML = '<div class="cc-head"><div class="cc-title">' + esc(store.mall) + '</div>' +
      '<div class="cc-count">' + store.staff.length + ' ' + (store.staff.length === 1 ? 'person' : 'people') + '</div>' +
      '<button class="cc-remove" aria-label="Remove ' + esc(store.mall) + '" title="Remove store">✕</button></div>' +
      '<button type="button" class="cc-hours">' + esc(hoursSummary(store.mall)) + ' <span class="edit-ic">Edit</span></button>' +
      '<div class="cc-people"></div>';
    const wrap = card.querySelector('.cc-people');
    if (!people.length) wrap.innerHTML = '<div class="cc-empty">No one here yet.</div>';
    people.forEach(p => {
      const sub = p.phone ? (DT.prettyPhone(p.phone) + (p.role ? ' · ' + p.role : '')) : (p.role || 'No number yet — tap to add');
      const row = document.createElement('button'); row.type = 'button'; row.className = 'cc-person';
      const initials = (p.name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
      row.innerHTML = '<div class="cc-avatar">' + esc(initials) + '</div><div class="cc-pinfo"><div class="cc-pname">' + esc(DT.titleCase(p.name)) +
        '</div><div class="cc-psub">' + esc(sub) + '</div></div>' + (p.phone ? '' : '<div class="cc-nophone">No #</div>');
      row.addEventListener('click', () => openPersonEditor(store.mall, p));
      wrap.appendChild(row);
    });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'cc-addperson'; add.textContent = '+ Add person';
    add.addEventListener('click', () => openPersonEditor(store.mall, null));
    wrap.appendChild(add);
    card.querySelector('.cc-remove').addEventListener('click', () => removeStore(store.mall));
    card.querySelector('.cc-hours').addEventListener('click', () => openHoursEditor(store.mall));
    contactsListEl.appendChild(card);
  });
  if (!shown) contactsListEl.innerHTML = '<div class="cc-empty">' + (q ? 'No matches for "' + esc(contactSearchEl.value) + '".' : 'No stores yet — add one below.') + '</div>';
}
contactSearchEl.addEventListener('input', renderContacts);

// One roster change = one small operation applied to the freshest cloud copy (never "overwrite everything").
function rosterOp(op) {
  const S = sync();
  data.splice(0, data.length, ...DT.applyRosterOp(data, op).map(s => { const old = data.find(x => x.mall.toUpperCase() === s.mall.toUpperCase()); return { mall: s.mall, goal: old ? old.goal : s.goal, staff: s.staff }; }));
  data.forEach(s => ensureStoreArrays(s.mall));
  saveRosterCache(); saveLy(); saveAov();
  if (S) S.rosterOp(op, myName).then(() => updateBadges()).catch(() => {});
}

const personDlg = $('personDlg');
let editingMall = null, editingPerson = null;
function currentPhoneDigits() { let d = DT.digitsOnly($('personPhoneInput').value); if (d.length === 10) d = '1' + d; return d; }
function formatPhoneAsYouType(raw) {
  let d = DT.digitsOnly(raw);
  if (d.length > 10 && d[0] === '1') d = d.slice(1);
  d = d.slice(0, 10);
  let out = '';
  if (d.length > 0) out = '(' + d.slice(0, 3);
  if (d.length >= 3) out += ') ';
  if (d.length > 3) out += d.slice(3, 6);
  if (d.length >= 6) out += '-';
  if (d.length > 6) out += d.slice(6, 10);
  return out;
}
function updatePhoneValidBadge() {
  const badge = $('phoneValidBadge'), raw = DT.digitsOnly($('personPhoneInput').value);
  if (!raw) { badge.textContent = ''; badge.className = 'phonebadge'; return; }
  if (DT.isValidUsPhone(raw)) { badge.textContent = '✓ US number'; badge.className = 'phonebadge ok'; }
  else { badge.textContent = 'Check number'; badge.className = 'phonebadge warn'; }
}
$('personPhoneInput').addEventListener('input', e => { e.target.value = formatPhoneAsYouType(e.target.value); updatePhoneValidBadge(); });
function openPersonEditor(mall, person) {
  editingMall = mall; editingPerson = person;
  $('personDlgTitle').textContent = person ? 'Edit person' : 'Add person';
  $('personNameInput').value = person ? person.name || '' : '';
  $('personPhoneInput').value = person && person.phone ? formatPhoneAsYouType(person.phone) : '';
  $('personRoleInput').value = person ? person.role || '' : '';
  $('personDeleteBtn').style.display = person ? '' : 'none';
  updatePhoneValidBadge();
  personDlg.showModal();
}
$('personSaveBtn').addEventListener('click', () => {
  const name = $('personNameInput').value.trim();
  if (!name) { $('personNameInput').focus(); return; }
  const typed = DT.digitsOnly($('personPhoneInput').value);
  if (typed && !DT.isValidUsPhone(typed)) {
    // A half-typed number saved silently would later open Messages with a bogus recipient.
    const badge = $('phoneValidBadge'); badge.textContent = 'Needs all 10 digits'; badge.className = 'phonebadge warn';
    $('personPhoneInput').focus();
    return;
  }
  const next ={ name: name, phone: currentPhoneDigits(), role: $('personRoleInput').value.trim() };
  rosterOp({ type: 'upsertPerson', mall: editingMall, match: editingPerson ? { name: editingPerson.name, phone: editingPerson.phone } : { name: next.name, phone: next.phone }, person: next });
  personDlg.close(); render(); renderContacts();
});
$('personDeleteBtn').addEventListener('click', () => {
  if (!editingPerson) { personDlg.close(); return; }
  const removed = { name: editingPerson.name, phone: editingPerson.phone, role: editingPerson.role }, mall = editingMall;
  rosterOp({ type: 'removePerson', mall: mall, match: { name: removed.name, phone: removed.phone } });
  personDlg.close(); render(); renderContacts();
  showUndoSnack('Removed ' + DT.titleCase(removed.name), () => {
    rosterOp({ type: 'upsertPerson', mall: mall, match: { name: removed.name, phone: removed.phone }, person: removed });
    render(); renderContacts();
  });
});
$('personCancelBtn').addEventListener('click', () => personDlg.close());

// ---- store hours + time zone sheet ----
const hoursDlg = $('hoursDlg');
let editingHoursMall = null;
(function fillTz() {
  $('hoursTz').innerHTML = DT.TZ_CHOICES.map(c => '<option value="' + c[0] + '">' + esc(c[1]) + '</option>').join('');
})();
function openHoursEditor(mall) {
  editingHoursMall = mall;
  $('hoursDlgMall').textContent = mall;
  const ct = closeTimesFor(mall);
  $('hoursMonThu').value = ct[0]; $('hoursFri').value = ct[4]; $('hoursSat').value = ct[5]; $('hoursSun').value = ct[6];
  $('hoursTz').value = tzFor(mall);
  hoursDlg.showModal();
}
function commitHours() {
  if (!editingHoursMall) return;
  const d = DT.DEFAULT_CLOSE;
  const mt = $('hoursMonThu').value || d[0], fr = $('hoursFri').value || d[4], sa = $('hoursSat').value || d[5], su = $('hoursSun').value || d[6];
  const nextHours = [mt, mt, mt, mt, fr, sa, su], nextTz = $('hoursTz').value || 'device';
  if (JSON.stringify(nextHours) === JSON.stringify(closeTimesFor(editingHoursMall)) && nextTz === tzFor(editingHoursMall)) return;   // nothing changed
  storeHours[editingHoursMall] = nextHours;
  storeTz[editingHoursMall] = nextTz;
  lsSet(K.hours, storeHours); lsSet(K.tz, storeTz);
  renderContacts(); refreshCards();
  const S = sync();
  if (S) S.patchSettings({ hours: { [editingHoursMall]: storeHours[editingHoursMall] }, tz: { [editingHoursMall]: storeTz[editingHoursMall] } }).catch(() => {});
}
['hoursMonThu', 'hoursFri', 'hoursSat', 'hoursSun', 'hoursTz'].forEach(id => $(id).addEventListener('change', commitHours));
$('hoursDoneBtn').addEventListener('click', () => { commitHours(); hoursDlg.close(); });

// ---- add / remove store ----
const addStoreTile = $('addStoreTile'), addStoreRow = $('addStoreRow');
addStoreTile.addEventListener('click', () => { addStoreTile.style.display = 'none'; addStoreRow.style.display = 'flex'; $('newStoreName').focus(); });
$('cancelAddStoreBtn').addEventListener('click', () => { $('newStoreName').value = ''; addStoreRow.style.display = 'none'; addStoreTile.style.display = 'flex'; });
$('addStoreBtn').addEventListener('click', () => {
  const input = $('newStoreName'), raw = input.value.trim();
  if (!raw) { input.focus(); return; }
  const mall = norm(raw);
  if (isSeedIgnored(mall)) { input.value = ''; return; }
  if (ignoredStores[mall]) {   // adding a store back un-hides it
    ignoredStores[mall] = false; lsSet(K.ignored, ignoredStores);
    const S = sync(); if (S) S.patchSettings({ ignored: { [mall]: false } }).catch(() => {});
  }
  if (!data.some(s => s.mall === mall)) rosterOp({ type: 'addStore', mall: mall });
  input.value = ''; addStoreRow.style.display = 'none'; addStoreTile.style.display = 'flex';
  renderAll();
});
function removeStore(mall) {
  const store = data.find(s => s.mall === mall); if (!store) return;
  const n = store.staff.length;
  const warn = n ? ' It has ' + n + ' staff member' + (n === 1 ? '' : 's') + ' on file — they\'ll be removed for everyone.' : '';
  if (!confirm('Remove ' + mall + ' from the district?' + warn)) return;
  const snapshot = { mall: store.mall, goal: store.goal, staff: store.staff.slice() };
  rosterOp({ type: 'removeStore', mall: mall });
  extraMalls = extraMalls.filter(m => m !== mall); lsSet(K.extra, extraMalls);
  // Hide it everywhere so the next Shopify report that still lists it can't bring it back.
  ignoredStores[mall] = true; lsSet(K.ignored, ignoredStores);
  delete todaySales[mall]; saveSales();
  const S = sync(); if (S) S.patchSettings({ ignored: { [mall]: true } }).catch(() => {});
  renderAll();
  showUndoSnack('Removed ' + mall, () => {
    ignoredStores[mall] = false; lsSet(K.ignored, ignoredStores);
    const S2 = sync(); if (S2) S2.patchSettings({ ignored: { [mall]: false } }).catch(() => {});
    rosterOp({ type: 'setStaff', mall: snapshot.mall, staff: snapshot.staff });
    renderAll();
  }, 8000);
}

// ---- roster safety: copy everything, and restore an earlier version ----
$('copyContactsBtn').addEventListener('click', async () => {
  const lines = ['Store,Name,Phone,Role'];
  data.slice().sort((a, b) => a.mall.localeCompare(b.mall)).forEach(s => s.staff.forEach(p => {
    lines.push([s.mall, p.name, DT.prettyPhone(p.phone), p.role || ''].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
  }));
  try { await navigator.clipboard.writeText(lines.join('\n')); showUndoSnack('Copied ' + (lines.length - 1) + ' contacts to your clipboard'); }
  catch (e) { showUndoSnack("Couldn't copy — your browser blocked the clipboard"); }
});
$('historyBtn').addEventListener('click', async () => {
  const S = sync();
  $('historyList').innerHTML = '<div class="cc-empty">Loading…</div>';
  $('historyDlg').showModal();
  if (!S) { $('historyList').innerHTML = '<div class="cc-empty">Version history needs the team connection.</div>'; return; }
  try {
    const versions = await S.getRosterHistory();
    if (!versions.length) { $('historyList').innerHTML = '<div class="cc-empty">No earlier versions yet — one is saved automatically each time contacts change.</div>'; return; }
    $('historyList').innerHTML = versions.map((v, i) => '<div class="hiddenRow"><span>' + esc(new Date(v.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) +
      (v.by ? ' · ' + esc(v.by) : '') + '<br><small>' + v.count + ' stores · ' + v.people + ' people</small></span>' +
      '<button type="button" class="btn-clear" data-restore="' + i + '">Restore</button></div>').join('');
    $('historyList')._versions = versions;
  } catch (e) { $('historyList').innerHTML = '<div class="cc-empty">Couldn\'t load history — try again when you\'re online.</div>'; }
});
$('historyList').addEventListener('click', e => {
  const b = e.target.closest('[data-restore]'); if (!b) return;
  const v = ($('historyList')._versions || [])[Number(b.dataset.restore)]; if (!v) return;
  if (!confirm('Restore the contacts from ' + new Date(v.at).toLocaleString() + '? Today\'s version is saved first, so you can undo this.')) return;
  rosterOp({ type: 'replaceAll', stores: v.stores });
  $('historyDlg').close(); renderAll();
  showUndoSnack('Contacts restored');
});
$('historyCloseBtn').addEventListener('click', () => $('historyDlg').close());

// ================= Today =================
function updateMyNameLabel() { document.querySelectorAll('.myNameLabel').forEach(el => { el.textContent = myName || 'not set'; }); }
const nameDlg = $('nameDlg');
function openNameDlg() { $('myNameInput').value = myName; nameDlg.showModal(); }
$('myNameSaveBtn').addEventListener('click', () => {
  const v = $('myNameInput').value.trim();
  if (!v) { $('myNameInput').focus(); return; }
  myName = v; lsSetStr(K.name, myName); updateMyNameLabel(); nameDlg.close();
});
document.querySelectorAll('.changeNameLink').forEach(el => el.addEventListener('click', e => { e.preventDefault(); openNameDlg(); }));

function setTask(key, done) {
  teamTasks[key] = { done: done, by: myName || 'Someone', at: Date.now() };
  lsSet(K.tasks, teamTasks); renderToday();
  const S = sync(); if (S) S.setTask(todayDateStr, key, done, myName || 'Someone').catch(() => {});
}
function renderToday() {
  const el = $('taskList'); el.innerHTML = '';
  TASK_DEFS.forEach(def => {
    const t = teamTasks[def.key] || { done: false };
    const row = document.createElement('button'); row.type = 'button';
    row.className = 'taskrow' + (t.done ? ' done' : '');
    row.setAttribute('aria-pressed', t.done ? 'true' : 'false');
    row.innerHTML = '<div class="taskcbx">' + (t.done ? '✓' : '') + '</div><div class="taskinfo"><div class="tasklabel">' + esc(def.label) + '</div>' +
      (t.done ? '<div class="tasksub">Done by ' + esc(DT.titleCase(t.by || 'someone')) + ' · ' + esc(DT.fmtClock(t.at)) + '</div>' : '<div class="tasksub">Not done yet</div>') + '</div>';
    row.addEventListener('click', () => setTask(def.key, !t.done));
    el.appendChild(row);
  });
  $('todayAsOf').textContent = asOfText();
  const ov = $('todayOverviewList'); ov.innerHTML = '';
  data.forEach(s => {
    const info = goalInfo(s.mall), sold = Number(todaySales[s.mall]) || 0;
    const row = document.createElement('div'); row.className = 'ovrow';
    row.innerHTML = '<div class="ovname">' + esc(s.mall) + '</div><div class="ovnum' + (info.hit ? ' hit' : '') + '">' + money(sold) + ' — ' +
      (info.hit ? 'hit ✓' : money(info.goal) + ' to go') + '</div>';
    ov.appendChild(row);
  });
}

// ================= Send queue =================
function statDropBlock(info) {
  const lines = ['📊 Stat Drop', 'LY total sales: ' + money(info.ly)];
  if (info.aov) lines.push('LY average order: ' + money(info.aov));
  lines.push('Amt/hr to beat: ' + money(info.perHour) + ' (' + DT.fmtHours(info.hours) + 'hrs left)');
  return lines.join('\n');
}
function taskKeyForMode() {
  if (mode === 'openers') return 'openers';
  if (mode === 'closers') return 'closers';
  const th = Number(lowTemplate.threshold);
  if (th === 100) return 'low1pm';
  if (th === 300) return 'low5pm';
  return new Date().getHours() < 15 ? 'low1pm' : 'low5pm';
}
$('go').addEventListener('click', () => {
  const q = $('queue'); q.innerHTML = '';
  let hitCount = 0, repeatCount = 0, total = 0;
  data.forEach(s => s.staff.forEach(p => {
    const id = personKey(s.mall, p.name);
    if (!sel.has(id) || !p.phone) return;
    total++;
    const first = DT.firstName(p.name);
    let amount, body, alreadyHit = false;
    if (mode === 'lowsales') {
      const i = lowSalesInfo(s.mall); amount = i.gap;
      body = lowTemplate.msg.replace(/{name}/g, () => first).replace(/{amount}/g, () => amount.toLocaleString()).replace(/{day}/g, () => DAY_FULL[todayIdx]);
      alreadyHit = i.gap === 0;
    } else {
      const g = goalInfo(s.mall); amount = g.goal; alreadyHit = g.hit;
      body = tplText(selectedBucket, mode).replace(/{name}/g, () => first).replace(/{amount}/g, () => amount.toLocaleString()).replace(/{day}/g, () => DAY_FULL[todayIdx]) + '\n\n' + statDropBlock(g);
    }
    if (alreadyHit) hitCount++;
    const t = textedInfo(s.mall, p.name);
    if (t) repeatCount++;
    const row = document.createElement('div'); row.className = 'qrow';
    row.innerHTML = '<div><div class="qname">' + esc(DT.titleCase(p.name)) + '</div><div class="qmall">' + esc(s.mall) + ' • ' + money(amount) +
      (alreadyHit ? ' · <span class="qwarn">already hit</span>' : '') +
      (t ? ' · <span class="qwarn">texted ' + esc(DT.fmtClock(t.at)) + (t.by ? ' by ' + esc(t.by) : '') + '</span>' : '') + '</div></div>' +
      '<a class="send" href="sms:' + esc(DT.fmtPhone(p.phone)) + '&amp;body=' + encodeURIComponent(body) + '">Text ›</a>';
    row.querySelector('.send').addEventListener('click', () => {
      setTimeout(() => row.classList.add('done'), 400);
      const kind = kindOfMode(), now = Date.now();
      (textLog[id] = textLog[id] || {})[kind] = { by: myName || '', at: now };
      lsSet(K.texts, textLog);
      const S = sync(); if (S) S.logText(todayDateStr, id, kind, myName).catch(() => {});
      const key = taskKeyForMode();
      if (!(teamTasks[key] && teamTasks[key].done)) setTask(key, true);   // first real send marks the check-in
      render();
    });
    q.appendChild(row);
  }));
  const notes = [];
  if (hitCount) notes.push(hitCount === 1 ? 'One of these people is at a store that has already hit goal — their text will say $0.'
    : hitCount + ' of these people are at stores that have already hit goal — their texts will say $0.');
  if (repeatCount) notes.push(repeatCount === 1 ? 'One person was already texted in this round today.'
    : repeatCount + ' people were already texted in this round today.');
  $('queueNote').innerHTML = notes.map(n => '<div>' + esc(n) + '</div>').join('');
  $('queueNote').hidden = !notes.length;
  if (!total) { q.innerHTML = '<div class="cc-empty">Nobody selected has a phone number.</div>'; }
  $('dlg').showModal();
});
$('close').addEventListener('click', () => $('dlg').close());

// ================= team sync wiring =================
const STATUS_TEXT = {
  live: ['synced', 'Live with team ✓'], saving: ['syncing', 'Saving…'], connecting: ['syncing', 'Connecting…'],
  offline: ['offline', 'Offline — saved on this phone'], error: ['offline', 'Sync problem — tap to retry'],
  'needs-passcode': ['offline', 'Enter team passcode'], local: ['', '']
};
function updateBadges() {
  const S = window.districtSync;
  let st = S && S.configured ? S.status : 'local';
  let [cls, text] = STATUS_TEXT[st] || ['', ''];
  if ((st === 'offline' || st === 'saving') && S && S.pendingCount && S.pendingCount()) text += ' (' + S.pendingCount() + ' pending)';
  document.querySelectorAll('.syncbadge').forEach(el => {
    el.textContent = text;
    el.className = 'syncbadge' + (el.classList.contains('teamSyncBadge') ? ' teamSyncBadge' : '') + (cls ? ' ' + cls : '');
    if (st === 'error' || st === 'offline' || st === 'needs-passcode') el.setAttribute('role', 'button'); else el.removeAttribute('role');
  });
  if (typeof maybeAskPasscode === 'function') maybeAskPasscode();
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.syncbadge');
  if (!b) return;
  const S = sync(); if (!S) return;
  if (S.needsPasscode) { if (!$('passDlg').open) $('passDlg').showModal(); return; }
  if (S.status === 'error' || S.status === 'offline') S.retry().then(() => bootSync());
});

function applyDayDoc(d) {
  d = d || {};   // a day with no document yet still uploads what this phone already has
  let changed = false;
  {
    const cs = d.todaySales || {}, ca = d.salesAt || {};
    const ch = DT.mergeStamped(todaySales, salesAt, cs, ca);
    if (ch.length) changed = true;
    // Anything this phone has that's newer than the cloud (e.g. pasted while offline) goes up.
    const up = {}, upAt = {};
    Object.keys(todaySales).forEach(k => {
      const la = salesAt[k] || 0;
      if (la > (ca[k] || 0) && todaySales[k] !== cs[k]) { up[k] = todaySales[k]; upAt[k] = la; }
    });
    const S = sync(); if (S && Object.keys(up).length) S.setSalesBatch(todayDateStr, up, upAt, myName).catch(() => {});
  }
  if (d.salesMeta && d.salesMeta.at && (d.salesMeta.at > (salesMeta.at || 0))) { salesMeta = d.salesMeta; changed = true; }
  {
    const cloudTasks = d.tasks || {}, S = sync();
    Object.keys(cloudTasks).forEach(k => {
      const c = cloudTasks[k], l = teamTasks[k];
      if (c && (!l || (c.at || 0) >= (l.at || 0)) && JSON.stringify(c) !== JSON.stringify(l)) { teamTasks[k] = Object.assign({ done: false, by: null, at: null }, c); changed = true; }
    });
    // A tick made while this phone couldn't reach the cloud (e.g. before the passcode) goes up now.
    Object.keys(teamTasks).forEach(k => {
      const l = teamTasks[k], c = cloudTasks[k];
      if (S && l && l.at && (!c || l.at > (c.at || 0)) && !!l.done !== !!(c && c.done)) S.setTask(todayDateStr, k, !!l.done, l.by, l.at).catch(() => {});
    });
    lsSet(K.tasks, teamTasks);
  }
  if (d.texts) {
    Object.keys(d.texts).forEach(pk => { Object.keys(d.texts[pk] || {}).forEach(kind => {
      const c = d.texts[pk][kind], l = (textLog[pk] || {})[kind];
      if (c && (!l || (c.at || 0) > (l.at || 0))) { (textLog[pk] = textLog[pk] || {})[kind] = c; changed = true; }
    }); });
  }
  {
    const S = sync(), cloudTexts = d.texts || {};
    Object.keys(textLog).forEach(pk => Object.keys(textLog[pk] || {}).forEach(kind => {
      const l = textLog[pk][kind], c = (cloudTexts[pk] || {})[kind];
      if (S && l && l.at && (!c || l.at > (c.at || 0))) S.logText(todayDateStr, pk, kind, l.by, l.at).catch(() => {});
    }));
    lsSet(K.texts, textLog);
  }
  saveSales();
  if (changed) { renderLive(); renderToday(); }
}
// ---- matching schedule names to Contacts ----
function renderNameFix() {
  const plan = schedPlan(), el = $('nameFixList');
  if (!plan.unmatched.length) { el.innerHTML = '<div class="cc-empty">Every name on today\'s schedule is matched. 🎉</div>'; return; }
  el.innerHTML = plan.unmatched.map((u, i) => {
    const store = data.find(s => s.mall === u.store), staff = store ? store.staff : [];
    const roles = u.roles.map(r => r === 'opener' ? 'opening' : 'closing').join(' + ');
    return '<div class="nfRow"><div class="nfName">' + esc(DT.titleCase(u.name)) + '<small>' + esc(u.store) + ' · ' + esc(roles) + '</small></div>' +
      '<select data-nf-key="' + esc(u.key) + '" aria-label="Who is ' + esc(u.name) + '?"><option value="">Who is this in Contacts?</option>' +
      staff.map(p => '<option value="' + esc(p.name) + '">' + esc(DT.titleCase(p.name)) + '</option>').join('') +
      '<option value="-">Not someone we text</option></select>' +
      '<button type="button" class="btn-clear" data-nf-add="' + i + '">Add to Contacts instead</button></div>';
  }).join('');
}
function openNameFix() { renderNameFix(); $('nameFixDlg').showModal(); }
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#fixNamesBtn')) openNameFix(); });
$('nameFixCloseBtn').addEventListener('click', () => $('nameFixDlg').close());
$('nameFixList').addEventListener('change', e => {
  const sel2 = e.target; if (!sel2.matches || !sel2.matches('select[data-nf-key]') || !sel2.value) return;
  const key = sel2.dataset.nfKey;
  slingNames[key] = sel2.value; lsSet(K.slingNames, slingNames);
  const S = sync(); if (S) S.patchSettings({ slingNames: { [key]: sel2.value } }).catch(() => {});
  render(); renderNameFix();
});
$('nameFixList').addEventListener('click', e => {
  const b = e.target.closest('[data-nf-add]'); if (!b) return;
  const u = schedPlan().unmatched[Number(b.dataset.nfAdd)]; if (!u) return;
  $('nameFixDlg').close();
  openPersonEditor(u.store, null);
  $('personNameInput').value = DT.titleCase(u.name);
  $('personPhoneInput').focus();
});

function applyScheduleDoc(d, meta) {
  if (meta && meta.fromCache && !d) return;   // an empty cache snapshot says nothing
  scheduleDoc = d || null;
  lsSet(K.sched, scheduleDoc);
  renderLive();
}
function applyRosterDoc(stores, meta) {
  if (meta && meta.fromCache && (!stores || !stores.length)) return;
  data.length = 0;
  (stores || []).forEach(s => { if (s && s.mall && !isSeedIgnored(s.mall) && !isHiddenName(s.mall)) data.push({ mall: s.mall, goal: s.goal, staff: Array.isArray(s.staff) ? s.staff : [] }); });
  extraMalls.forEach(m => { if (!data.some(s => s.mall === m) && !isHiddenName(m)) data.push({ mall: m, staff: [] }); });
  data.forEach(s => ensureStoreArrays(s.mall));
  saveRosterCache(); saveLy(); saveAov();
  renderLive(); renderContacts(); renderToday();
}
function applySettingsDoc(s, meta) {
  s = s || {};
  let changed = false;
  const slots = (obj, store, def) => {
    Object.keys(obj || {}).forEach(mall => {
      ensureStoreArrays(mall);
      const m = obj[mall] || {};
      Object.keys(m).forEach(i => { const v = Number(m[i]); if (!isNaN(v) && store[mall][Number(i)] !== v) { store[mall][Number(i)] = v; changed = true; } });
    });
  };
  slots(s.ly, lyStore); slots(s.aov, lyAov);
  Object.keys(s.hours || {}).forEach(m => { if (Array.isArray(s.hours[m]) && JSON.stringify(storeHours[m]) !== JSON.stringify(s.hours[m])) { storeHours[m] = s.hours[m]; changed = true; } });
  Object.keys(s.tz || {}).forEach(m => { if (storeTz[m] !== s.tz[m]) { storeTz[m] = s.tz[m]; changed = true; } });
  Object.keys(s.ignored || {}).forEach(m => { if (!!ignoredStores[m] !== !!s.ignored[m]) { ignoredStores[m] = !!s.ignored[m]; changed = true; } });
  Object.keys(s.slingNames || {}).forEach(k => { if (slingNames[k] !== s.slingNames[k]) { slingNames[k] = s.slingNames[k]; changed = true; } });
  // First phone to connect seeds anything the shared settings don't have yet (real values only —
  // never the stale built-in defaults, which would overwrite a teammate's real numbers).
  const S = sync();
  if (S && meta && !meta.fromCache && !lsGet(K.seeded, false)) {
    const patch = {};
    const real = (mall, arr) => { const o = {}; (arr || []).forEach((v, i) => { if (v > 0 && v !== defaultGoal(mall)) o[i] = v; }); return o; };
    const lyUp = {}, aovUp = {};
    Object.keys(lyStore).forEach(m => { const o = real(m, lyStore[m]); if (Object.keys(o).length && !(s.ly && s.ly[m])) lyUp[m] = o; });
    Object.keys(lyAov).forEach(m => { const o = {}; (lyAov[m] || []).forEach((v, i) => { if (v > 0) o[i] = v; }); if (Object.keys(o).length && !(s.aov && s.aov[m])) aovUp[m] = o; });
    if (Object.keys(lyUp).length) patch.ly = lyUp;
    if (Object.keys(aovUp).length) patch.aov = aovUp;
    const hrs = {}; Object.keys(storeHours).forEach(m => { if (!(s.hours && s.hours[m])) hrs[m] = storeHours[m]; });
    if (Object.keys(hrs).length) patch.hours = hrs;
    const tzs = {}; Object.keys(storeTz).forEach(m => { if (!(s.tz && s.tz[m])) tzs[m] = storeTz[m]; });
    if (Object.keys(tzs).length) patch.tz = tzs;
    const ign = {}; Object.keys(ignoredStores).forEach(m => { if (ignoredStores[m] && !(s.ignored && s.ignored[m])) ign[m] = true; });
    if (Object.keys(ign).length) patch.ignored = ign;
    lsSet(K.seeded, true);
    if (Object.keys(patch).length) S.patchSettings(patch).catch(() => {});
  }
  if (changed) {
    saveLy(); saveAov(); lsSet(K.hours, storeHours); lsSet(K.tz, storeTz); lsSet(K.ignored, ignoredStores); lsSet(K.slingNames, slingNames);
    for (let i = data.length - 1; i >= 0; i--) if (isHiddenName(data[i].mall)) data.splice(i, 1);
    renderLive(); renderContacts(); renderToday();
  }
}
let unsubs = [], statusHooked = false;
function bootSync() {
  const S = window.districtSync;
  updateBadges();
  if (!S || !S.configured) return;
  if (!statusHooked) { statusHooked = true; S.onStatus(updateBadges); }
  unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } }); unsubs = [];
  if (S.needsPasscode) { if (!$('passDlg').open) $('passDlg').showModal(); return; }
  if (!S.authed) return;
  unsubs.push(S.onDay(todayDateStr, applyDayDoc));
  unsubs.push(S.onRoster(applyRosterDoc));
  unsubs.push(S.onSettings(applySettingsDoc));
  if (S.onSchedule) unsubs.push(S.onSchedule(applyScheduleDoc));
}
async function submitPasscode() {
  const val = $('passInput').value.trim();
  if (!val) { $('passMsg').textContent = 'Type the team passcode first.'; return; }
  const btn = $('passSaveBtn'); btn.disabled = true; $('passMsg').textContent = 'Checking…';
  const S = window.districtSync;
  const ok = await S.signInWithPasscode(val);
  btn.disabled = false;
  const code = S.lastAuthError || '';
  $('passMsg').textContent = ok ? '' :
    code === 'auth/network-request-failed' ? "Can't reach the server — check your signal and try again." :
    code === 'auth/too-many-requests' ? 'Too many tries — wait a few minutes, then try again.' :
    "That passcode didn't work — check it with whoever manages the team account.";
  if (ok) { $('passInput').value = ''; $('passDlg').close(); bootSync(); }
}
$('passSaveBtn').addEventListener('click', submitPasscode);
$('passInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitPasscode(); } });
let passShownOnce = false;
function maybeAskPasscode() {
  const S = window.districtSync;
  if (S && S.configured && S.needsPasscode && !passShownOnce && !$('passDlg').open) { passShownOnce = true; $('passDlg').showModal(); }
}
window.addEventListener('online', () => {
  const S = sync();
  if (S && !S.authed) S.reconnect().then(() => bootSync());
});
if (window.districtSync) bootSync();
else window.addEventListener('districtsync-ready', bootSync, { once: true });

// ================= day rollover + updates + offline =================
function maybeRollover() { if (localDateStr(new Date()) !== todayDateStr) location.reload(); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { maybeRollover(); checkForUpdate(false); }
});
window.addEventListener('pageshow', maybeRollover);
setInterval(maybeRollover, 60000);
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

// ================= boot =================
$('dayLabel').textContent = DAY_FULL[todayIdx];
updateMyNameLabel();
loadEditor(); renderFloorLine(); loadLowEditor(); renderVersion();
renderContacts(); renderToday();
render(); syncDockPadding(); updateBadges();
checkForUpdate(false);

window.DTApp = { data, get todaySales() { return todaySales; }, get lyStore() { return lyStore; }, get storeTz() { return storeTz; },
  get ignoredStores() { return ignoredStores; }, get textLog() { return textLog; }, get teamTasks() { return teamTasks; },
  planReport, commitPlan, applyReportText, goalInfo, hoursLeftFor, render, renderLive, canonMall, isHiddenName,
  applyDayDoc, applyRosterDoc, applySettingsDoc, applyScheduleDoc, schedPlan, openStoreStats, openDistrictStats };
})();
