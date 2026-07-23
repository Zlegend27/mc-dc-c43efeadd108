// District Texter — Google Sheet sync backend.
// Paste this whole file into Extensions > Apps Script on the roster sheet, then follow
// SETUP.md in this same folder. Do not edit the two constants below unless your
// contacts tab or hours tab are actually named something else.

var HOURS_SHEET_NAME = 'Store Hours';
var DEFAULT_CLOSE = ['20:00', '21:00', '21:00', '19:00']; // Mon-Thu, Fri, Sat, Sun

// Run this once from the Apps Script editor (select "setup" in the function
// dropdown, click Run). It creates the Store Hours tab if missing and generates
// your secret sync key — copy that key into the app's SHEETS_KEY constant.
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoursSheet = ss.getSheetByName(HOURS_SHEET_NAME);
  if (!hoursSheet) {
    hoursSheet = ss.insertSheet(HOURS_SHEET_NAME);
    hoursSheet.appendRow(['MALL NAME', 'MON-THU CLOSE', 'FRI CLOSE', 'SAT CLOSE', 'SUN CLOSE']);
    hoursSheet.appendRow(['DEFAULT', DEFAULT_CLOSE[0], DEFAULT_CLOSE[1], DEFAULT_CLOSE[2], DEFAULT_CLOSE[3]]);
  }
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SYNC_KEY');
  if (!key) {
    key = Utilities.getUuid();
    props.setProperty('SYNC_KEY', key);
  }
  Logger.log('Your secret sync key (copy this into the app once): ' + key);
}

function getContactsSheet_() {
  // Always the first tab — whatever your existing roster tab happens to be named.
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}
function getHoursSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOURS_SHEET_NAME);
}

function readContacts_() {
  var sheet = getContactsSheet_();
  var rows = sheet.getDataRange().getValues();
  var byMall = {}, order = [];
  for (var i = 1; i < rows.length; i++) {
    var mall = String(rows[i][0] || '').trim();
    var name = String(rows[i][1] || '').trim();
    if (!mall || !name) continue; // blank separator rows, or a mall row with no name yet
    var mallKey = mall.toUpperCase();
    if (!byMall[mallKey]) { byMall[mallKey] = { mall: mallKey, staff: [] }; order.push(mallKey); }
    var phone = String(rows[i][2] || '').replace(/\D/g, '');
    byMall[mallKey].staff.push({ name: name, phone: phone, email: String(rows[i][3] || '').trim(), role: String(rows[i][4] || '').trim() });
  }
  var out = [];
  for (var j = 0; j < order.length; j++) out.push(byMall[order[j]]);
  return out;
}

function fmtTime_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(v || '').trim();
}

function readHours_() {
  var sheet = getHoursSheet_();
  var out = {};
  if (!sheet) return out;
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var mall = String(rows[i][0] || '').trim();
    if (!mall) continue;
    var mt = fmtTime_(rows[i][1]), fr = fmtTime_(rows[i][2]), sa = fmtTime_(rows[i][3]), su = fmtTime_(rows[i][4]);
    out[mall.toUpperCase()] = [mt, mt, mt, mt, fr, sa, su];
  }
  return out;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = (e.parameter && e.parameter.action) || 'contacts';
  var payload = action === 'hours' ? readHours_() : readContacts_();
  return jsonOut_({ ok: true, data: payload });
}

function checkKey_(body) {
  var expected = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  return !!expected && body.key === expected;
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return jsonOut_({ ok: false, error: 'bad json' }); }
  if (!checkKey_(body)) return jsonOut_({ ok: false, error: 'unauthorized' });
  try {
    if (body.type === 'setStaff') setStaff_(body.mall, body.staff || []);
    else if (body.type === 'deleteStore') deleteStore_(body.mall);
    else if (body.type === 'setHours') setHours_(body.mall, body.hours || DEFAULT_CLOSE_FULL_());
    else return jsonOut_({ ok: false, error: 'unknown type' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
  return jsonOut_({ ok: true });
}
function DEFAULT_CLOSE_FULL_() { return ['20:00','20:00','20:00','20:00','21:00','21:00','19:00']; }

// Replaces every row for this mall with the given staff array — mirrors the app's own
// model, where a store's staff list is always saved as one full replacement, never a
// single-row patch. Keeps the sheet's existing block position for that mall when possible.
function setStaff_(mall, staffArr) {
  var sheet = getContactsSheet_();
  var rows = sheet.getDataRange().getValues();
  var mallU = mall.toUpperCase();
  var firstRow = -1, lastRow = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toUpperCase() === mallU) {
      if (firstRow === -1) firstRow = i;
      lastRow = i;
    }
  }
  if (firstRow !== -1) {
    sheet.deleteRows(firstRow + 1, lastRow - firstRow + 1);
  }
  var insertAt = firstRow !== -1 ? firstRow + 1 : sheet.getLastRow() + 1;
  if (staffArr.length === 0) {
    if (firstRow === -1) return; // nothing to add, nothing to remove
    return;
  }
  var values = staffArr.map(function (p) { return [mall, p.name || '', p.phone || '', p.email || '', p.role || '']; });
  sheet.insertRowsBefore(insertAt, values.length);
  sheet.getRange(insertAt, 1, values.length, 5).setValues(values);
}

function deleteStore_(mall) {
  setStaff_(mall, []);
  var hoursSheet = getHoursSheet_();
  if (!hoursSheet) return;
  var rows = hoursSheet.getDataRange().getValues();
  var mallU = mall.toUpperCase();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0] || '').trim().toUpperCase() === mallU) hoursSheet.deleteRow(i + 1);
  }
}

function setHours_(mall, hours) {
  var sheet = getHoursSheet_();
  if (!sheet) throw new Error('Store Hours tab missing — run setup() once from the Apps Script editor.');
  var rows = sheet.getDataRange().getValues();
  var mallU = mall.toUpperCase();
  var vals = [mall, hours[0], hours[4], hours[5], hours[6]];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toUpperCase() === mallU) {
      sheet.getRange(i + 1, 1, 1, 5).setValues([vals]);
      return;
    }
  }
  sheet.appendRow(vals);
}
