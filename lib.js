/* District Texter — pure helpers (no DOM, no storage, no network).
   Loaded by index.html as window.DT and by scripts/check.mjs under Node, so everything
   here can be unit-tested. Anything that touches the page lives in app.js instead. */
(function (root) {
  'use strict';

  // ---------- text ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Names that are ALL CAPS or all lowercase get title-cased (unicode-aware, so José/Zoë/Núñez
  // survive). Names someone already typed in mixed case ("DeShawn", "McPhail") are left alone.
  function titleCase(s) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!s) return s;
    var mixed = s !== s.toUpperCase() && s !== s.toLowerCase();
    if (mixed) return s;
    return s.toLowerCase().replace(/\p{L}[\p{L}\p{M}]*/gu, function (w) {
      var out = w.charAt(0).toUpperCase() + w.slice(1);
      if (/^Mc[a-z]{3,}$/.test(out)) out = 'Mc' + out.charAt(2).toUpperCase() + out.slice(3);
      return out;
    }).replace(/(\b(?:O|D|L)['’])(\p{L})/gu, function (_, a, b) { return a + b.toUpperCase(); });
  }

  function firstName(full) {
    var t = titleCase(full);
    var f = t.split(' ')[0] || '';
    return f.replace(/^["“”]+|["“”]+$/g, '');
  }

  function digitsOnly(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function fmtPhone(d) { d = digitsOnly(d); if (!d) return ''; if (d.length === 10) d = '1' + d; return '+' + d; }
  function prettyPhone(d) {
    d = digitsOnly(d); if (!d) return '';
    var x = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
    if (x.length !== 10) return d;
    return '(' + x.slice(0, 3) + ') ' + x.slice(3, 6) + '-' + x.slice(6);
  }
  function isValidUsPhone(d) {
    d = digitsOnly(d);
    return d.length === 10 || (d.length === 11 && d[0] === '1');
  }
  function fmtHours(h) { var r = Math.round(h * 10) / 10; return (r % 1 === 0) ? r + '.0' : String(r); }
  function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function fmtClock(ts) {
    if (!ts) return '';
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'pm' : 'am'; h = h % 12; if (h === 0) h = 12;
    return h + ':' + String(m).padStart(2, '0') + ap;
  }
  function fmtTimeLabel(t) {
    var p = String(t || '20:00').split(':').map(Number), h = p[0], m = p[1] || 0;
    var ap = h >= 12 ? 'pm' : 'am', h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ap;
  }

  // ---------- report parsing ----------
  function cleanNumber(v) {
    if (v == null) return NaN;
    var s = String(v).replace(/[$,\s]/g, '');
    if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return NaN;
    return parseFloat(s);
  }

  // Split text into records on newlines that are NOT inside a quoted field.
  function splitRecords(text) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '"') { q = !q; cur += c; }
      else if (c === '\n' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  function splitFields(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  // "1,391" → "1391", but never touch "83,226" in "246.83,226.97" (the digits before the comma
  // belong to a decimal, so it is a field boundary, not a thousands separator).
  function collapseThousands(s) {
    return s.replace(/\d{1,3}(?:,\d{3})+(?!\d)/g, function (m, off, str) {
      if (off > 0 && /[\d.]/.test(str[off - 1])) return m;
      return m.replace(/,/g, '');
    });
  }

  function looksLikeHeader(row) {
    if (!row || row.length < 2) return false;
    var first = String(row[0] == null ? '' : row[0]).trim();
    if (!/^(pos location|location|store|mall)/i.test(first)) return false;
    return row.slice(1).every(function (v) { var t = String(v == null ? '' : v).trim(); return !t || isNaN(cleanNumber(t)); });
  }

  function parseCSVText(text) {
    text = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    var recs = splitRecords(text).filter(function (r) { return r.trim() !== ''; });
    // First pass: find a header (within the first few lines — Shopify's mobile view can put a
    // report title above it) so we know how many columns a well-formed row has.
    var expected = 0;
    for (var h = 0; h < Math.min(recs.length, 5); h++) {
      var d0 = recs[h].indexOf('\t') >= 0 ? '\t' : ',';
      var f0 = splitFields(recs[h], d0);
      if (looksLikeHeader(f0)) { expected = f0.length; break; }
    }
    return recs.map(function (rec) {
      if (rec.indexOf('\t') >= 0) return splitFields(rec, '\t');
      // $-prefixed money: the comma is always a thousands separator.
      var r = rec.replace(/\$\s*\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, function (m) { return m.replace(/,/g, ''); });
      var fields = splitFields(r, ',');
      if (expected && fields.length > expected) {
        var alt = splitFields(collapseThousands(r), ',');
        if (alt.length === expected) fields = alt;
      } else if (!expected && /^[^,]*[A-Za-z][^,]*,\s*\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*$/.test(r)) {
        fields = splitFields(collapseThousands(r), ',');
      }
      return fields;
    });
  }

  // Which column holds what. Shopify repeats each dated (last-year) column a second time holding
  // %-difference, so the first dated match per field wins.
  function detectColumns(headerRow) {
    var idx = { loc: 0, today: -1, ly: -1, aov: -1 };
    headerRow.forEach(function (cell, i) {
      var raw = String(cell == null ? '' : cell).trim(), c = raw.toLowerCase();
      var dated = /\(\d{8}t\d{6}\)/i.test(raw) || /previous_year|previous year|last year/.test(c);
      var isAov = /average order|aov/.test(c);
      var isSales = /(total|net|gross) sales/.test(c);
      if (dated) {
        if (isAov && idx.aov === -1) { idx.aov = i; return; }
        if (isSales && idx.ly === -1) { idx.ly = i; return; }
      } else if (isSales && idx.today === -1) { idx.today = i; }
    });
    if (idx.today === -1) idx.today = 1;
    return idx;
  }

  // Raw pasted/loaded text → { rows:[{loc,today,ly,aov}], hasHeader, warnings, skipped }.
  function readReport(raw) {
    var rows = parseCSVText(raw), warnings = [], out = [], skipped = 0;
    var hdr = -1;
    for (var i = 0; i < Math.min(rows.length, 5); i++) { if (looksLikeHeader(rows[i])) { hdr = i; break; } }
    var idx = { loc: 0, today: 1, ly: -1, aov: -1 };
    var data = rows;
    if (hdr >= 0) { idx = detectColumns(rows[hdr]); data = rows.slice(hdr + 1); }
    var maxCols = data.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    if (hdr < 0 && maxCols >= 3) {
      warnings.push('No header row, so only today\'s sales were read. Include the line that starts "POS location name" to update LY and AOV too.');
    }
    data.forEach(function (r) {
      var loc = String(r[idx.loc] == null ? '' : r[idx.loc]).trim();
      if (!loc) return;
      if (loc.length > 60 || /^https?:\/\//i.test(loc)) { skipped++; return; }
      var today = cleanNumber(r[idx.today]);
      var ly = idx.ly >= 0 ? cleanNumber(r[idx.ly]) : NaN;
      var aov = idx.aov >= 0 ? cleanNumber(r[idx.aov]) : NaN;
      if (!isNaN(today) && (today < 0 || today > 5e6)) today = NaN;
      if (!isNaN(ly) && (ly < 0 || ly > 5e6)) ly = NaN;
      if (!isNaN(aov) && (aov < 0 || aov > 1e5)) aov = NaN;
      out.push({ loc: loc, today: today, ly: ly, aov: aov });
    });
    return { rows: out, hasHeader: hdr >= 0, hasLy: idx.ly >= 0, hasAov: idx.aov >= 0, warnings: warnings, skipped: skipped };
  }

  // ---------- goal math ----------
  function computeGoal(o) {
    var ly = Number(o.ly) || 0, floor = Number(o.floor) || 0, sold = Number(o.sold) || 0;
    var hours = Math.max(0.5, Number(o.hoursLeft) || 0.5);
    var floored = ly < floor, target = floored ? floor : ly;
    var goal = Math.round(target - sold);
    return {
      ly: ly, floor: floor, floored: floored, target: target, sold: sold,
      goal: Math.max(0, goal), hit: goal <= 0, hours: hours,
      perHour: Math.round(Math.max(0, goal) / hours)
    };
  }

  // ---------- store clock / hours ----------
  var DEFAULT_CLOSE = ['20:00', '20:00', '20:00', '20:00', '21:00', '21:00', '19:00'];
  var CENTRAL = { 'ORLAND SQUARE': 1, 'GURNEE MILLS': 1, 'WOODFIELD STORE': 1 };
  var EASTERN = {
    'ARUNDEL MILLS STORE': 1, 'CAROLINA PLACE': 1, 'CASTLETON SQUARE': 1, 'GALLERIA FORT LAUDERDALE': 1,
    'KING OF PRUSSIA STORE': 1, 'PALISADES STORE': 1, 'SOMERSET COLLECTIONS': 1, 'TOWSON SQUARE STORE': 1,
    'TREASURE COAST': 1, 'UTC': 1, 'WALDEN GALLERIA': 1, 'SPRINGFIELD STORE': 1
  };
  // Best-guess zone for a store we know; anything unknown follows the phone's own clock.
  function defaultTzFor(mall) {
    var k = String(mall || '').toUpperCase();
    if (CENTRAL[k]) return 'America/Chicago';
    if (EASTERN[k]) return 'America/New_York';
    return 'device';
  }
  var TZ_CHOICES = [
    ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'],
    ['America/Denver', 'Mountain'], ['America/Los_Angeles', 'Pacific'], ['device', 'This phone\'s clock']
  ];
  var WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  // Wall-clock time in a store's zone → { h: hours since midnight (decimal), idx: Mon=0..Sun=6 }.
  function zoneClock(tz, date) {
    date = date || new Date();
    if (tz && tz !== 'device') {
      try {
        var parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23'
        }).formatToParts(date);
        var h = 0, m = 0, wd = 'Mon';
        parts.forEach(function (p) {
          if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
          else if (p.type === 'minute') m = parseInt(p.value, 10);
          else if (p.type === 'weekday') wd = p.value;
        });
        return { h: h + m / 60, idx: WD[wd] != null ? WD[wd] : 0 };
      } catch (e) { /* fall through to the phone's clock */ }
    }
    return { h: date.getHours() + date.getMinutes() / 60, idx: (date.getDay() + 6) % 7 };
  }
  function hoursLeft(closeTimes, tz, date) {
    var ck = zoneClock(tz, date);
    var ct = (closeTimes && closeTimes.length === 7 ? closeTimes : DEFAULT_CLOSE)[ck.idx] || '20:00';
    var p = ct.split(':').map(Number);
    return Math.max(0.5, (p[0] + (p[1] || 0) / 60) - ck.h);
  }
  function bucketForIdx(i) { return i === 5 ? 'sat' : (i === 4 || i === 6) ? 'frisun' : 'monthu'; }

  // ---------- shared roster ----------
  function cleanPerson(p) {
    var o = { name: String(p && p.name || '').trim(), phone: digitsOnly(p && p.phone) };
    var role = String(p && p.role || '').trim();
    if (role) o.role = role;
    return o;
  }
  // Applies ONE change to a roster array and returns a new array. The cloud applies this
  // inside a transaction against the freshest copy, so a stale phone can't wipe teammates' edits.
  function applyRosterOp(stores, op) {
    var list = (stores || []).map(function (s) { return { mall: s.mall, goal: s.goal, staff: (s.staff || []).slice() }; });
    var key = function (m) { return String(m || '').toUpperCase(); };
    var at = function (m) { for (var i = 0; i < list.length; i++) if (key(list[i].mall) === key(m)) return i; return -1; };
    if (op.type === 'setStaff') {
      var i = at(op.mall), staff = (op.staff || []).map(cleanPerson).filter(function (p) { return p.name; });
      if (i < 0) list.push({ mall: op.mall, staff: staff }); else list[i].staff = staff;
    } else if (op.type === 'upsertPerson' || op.type === 'removePerson') {
      var k = at(op.mall);
      if (k < 0) { if (op.type === 'upsertPerson') list.push({ mall: op.mall, staff: [cleanPerson(op.person)] }); }
      else {
        var m = op.match || {}, nm = String(m.name || '').trim().toLowerCase(), ph = digitsOnly(m.phone);
        var found = -1;
        list[k].staff.forEach(function (p, n) {
          if (found < 0 && String(p.name || '').trim().toLowerCase() === nm && (!ph || digitsOnly(p.phone) === ph || !digitsOnly(p.phone))) found = n;
        });
        if (op.type === 'removePerson') { if (found >= 0) list[k].staff.splice(found, 1); }
        else if (found >= 0) list[k].staff[found] = cleanPerson(op.person);
        else list[k].staff.push(cleanPerson(op.person));
      }
    } else if (op.type === 'addStore') {
      if (at(op.mall) < 0) list.push({ mall: op.mall, staff: [] });
    } else if (op.type === 'removeStore') {
      var j = at(op.mall); if (j >= 0) list.splice(j, 1);
    } else if (op.type === 'replaceAll') {
      list = (op.stores || []).map(function (s) { return { mall: s.mall, goal: s.goal, staff: (s.staff || []).map(cleanPerson) }; });
    }
    return list;
  }
  function countPeople(stores) { return (stores || []).reduce(function (n, s) { return n + ((s.staff || []).length); }, 0); }

  // Cloud-vs-local merge for per-store values stamped with a time: the newer stamp wins.
  function mergeStamped(local, localAt, cloud, cloudAt) {
    var changed = [];
    Object.keys(cloud || {}).forEach(function (k) {
      var ca = (cloudAt && cloudAt[k]) || 0, la = (localAt && localAt[k]) || 0;
      if (ca >= la && local[k] !== cloud[k]) { local[k] = cloud[k]; changed.push(k); }
      if (ca >= la && cloudAt && cloudAt[k]) localAt[k] = ca;
    });
    return changed;
  }

  var API = {
    esc: esc, titleCase: titleCase, firstName: firstName, digitsOnly: digitsOnly, fmtPhone: fmtPhone,
    prettyPhone: prettyPhone, isValidUsPhone: isValidUsPhone, fmtHours: fmtHours, money: money,
    fmtClock: fmtClock, fmtTimeLabel: fmtTimeLabel, cleanNumber: cleanNumber, parseCSVText: parseCSVText,
    looksLikeHeader: looksLikeHeader, detectColumns: detectColumns, readReport: readReport,
    computeGoal: computeGoal, DEFAULT_CLOSE: DEFAULT_CLOSE, defaultTzFor: defaultTzFor, TZ_CHOICES: TZ_CHOICES,
    zoneClock: zoneClock, hoursLeft: hoursLeft, bucketForIdx: bucketForIdx, applyRosterOp: applyRosterOp,
    countPeople: countPeople, mergeStamped: mergeStamped
  };
  root.DT = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
