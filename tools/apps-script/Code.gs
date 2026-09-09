/**
 * Territory Missions — write endpoint for the map's agent edit mode.
 *
 * Deploy:  Extensions → Apps Script → paste this file → Deploy → New
 *          deployment → Web app → Execute as: Me → Who has access: Anyone
 *          → copy the /exec URL into js/config.js as APPS_SCRIPT_URL.
 *
 * The map POSTs JSON as text/plain (avoids a CORS preflight Apps Script
 * cannot answer) and falls back to JSONP via doGet if that is blocked.
 */

var SHEET_ID     = '1HBRcW_MYKdNy-YOjAbpMvYtx7wthTbPTAPlhV4uCKE8';
var SHEET_NAME   = 'Hospital Activation';
var SHARED_TOKEN = 'change-me';   // must equal WRITE_TOKEN in js/config.js

/* Columns the form may write. Any that the sheet does not have yet are
   appended as new headers on first use. */
var WRITABLE = [
  'CSSD Manager Name', 'CSSD Manager Phone', 'Last Visit Date', 'Visit Log',
  'Products Adopted', 'Informed', 'Has Incubator', 'Incubator Serial',
  'Dosing System', 'Shortage Items', 'Action Required',
  'Feedback - Missing Items', 'Next Step', 'Visit Status'
];

function doPost(e) {
  var out = handle_(parse_(e));
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* JSONP fallback: ?callback=fn&payload=<url-encoded json> */
function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  var cb = p.callback;
  if (!p.payload) {
    var info = { ok: true, service: 'territory-missions', sheet: SHEET_NAME };
    return cb ? js_(cb, info) : ContentService.createTextOutput(JSON.stringify(info))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var out;
  try { out = handle_(JSON.parse(p.payload)); }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return cb ? js_(cb, out) : ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function js_(cb, obj) {
  return ContentService
    .createTextOutput(cb + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function parse_(e) {
  if (e && e.postData && e.postData.contents) return JSON.parse(e.postData.contents);
  if (e && e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  throw new Error('no payload');
}

function handle_(body) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);                       // serialise concurrent agents
  } catch (err) {
    return { ok: false, error: 'sheet busy, try again' };
  }
  try {
    if (SHARED_TOKEN && body.token !== SHARED_TOKEN) {
      return { ok: false, error: 'bad token' };
    }
    var updates = body.updates || {};
    var keys = Object.keys(updates);
    if (!keys.length) return { ok: false, error: 'nothing to update' };

    var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sh) return { ok: false, error: 'sheet "' + SHEET_NAME + '" not found' };

    var lastCol = Math.max(sh.getLastColumn(), 1);
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];

    /* add any missing columns once, at the end */
    keys.forEach(function (k) {
      if (WRITABLE.indexOf(k) === -1) return;
      if (indexOfHeader_(header, k) === -1) {
        header.push(k);
        sh.getRange(1, header.length).setValue(k);
      }
    });

    var row = locateRow_(sh, header, body);
    if (!row) return { ok: false, error: 'hospital not found in the sheet' };

    var written = [];
    keys.forEach(function (k) {
      if (WRITABLE.indexOf(k) === -1) return;         // ignore anything else
      var col = indexOfHeader_(header, k) + 1;
      if (col < 1) return;
      var v = updates[k];

      if (k === 'Visit Log') {
        var when = updates['Last Visit Date'] || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
        var prev = String(sh.getRange(row, col).getValue() || '');
        v = '[' + when + '] ' + v + (prev ? '\n' + prev : '');   // newest first
      }
      sh.getRange(row, col).setValue(v);
      written.push(k);
    });

    /* keep Adoption % consistent when both numbers are known */
    var iAdopted = indexOfHeader_(header, 'Products Adopted');
    var iTarget  = indexOfHeader_(header, 'Products Target');
    var iPct     = indexOfHeader_(header, 'Adoption %');
    if (iAdopted > -1 && iTarget > -1 && iPct > -1) {
      var a = Number(sh.getRange(row, iAdopted + 1).getValue());
      var tg = Number(sh.getRange(row, iTarget + 1).getValue());
      if (!isNaN(a) && !isNaN(tg) && tg > 0) {
        sh.getRange(row, iPct + 1).setValue(Math.round((a / tg) * 100));
        written.push('Adoption %');
      }
    }

    SpreadsheetApp.flush();
    return { ok: true, row: row, updated: written };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function tz_() {
  return SpreadsheetApp.openById(SHEET_ID).getSpreadsheetTimeZone() || 'Asia/Riyadh';
}

function indexOfHeader_(header, name) {
  for (var i = 0; i < header.length; i++) {
    if (String(header[i]).trim() === name) return i;
  }
  return -1;
}

/**
 * Trust the row number the map sent, but verify the hospital name still
 * matches — rows get sorted and inserted. If it does not, fall back to a
 * name (+ cluster) search, and refuse rather than guess when ambiguous.
 */
function locateRow_(sh, header, body) {
  var iName = indexOfHeader_(header, 'Hospital Name');
  var iCluster = indexOfHeader_(header, 'Cluster');
  if (iName === -1) return null;

  var want = norm_(body.hospitalName);
  var row = Number(body.row);

  if (row >= 2 && row <= sh.getLastRow()) {
    var atRow = norm_(sh.getRange(row, iName + 1).getValue());
    if (atRow && atRow === want) return row;
  }

  var names = sh.getRange(2, iName + 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  var clusters = iCluster > -1
    ? sh.getRange(2, iCluster + 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues()
    : null;
  var hits = [];
  for (var i = 0; i < names.length; i++) {
    if (norm_(names[i][0]) !== want) continue;
    if (clusters && body.cluster && norm_(clusters[i][0]) !== norm_(body.cluster)) continue;
    hits.push(i + 2);
  }
  return hits.length === 1 ? hits[0] : null;
}

function norm_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

/** Run once from the editor to confirm access and add missing columns. */
function setup() {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('sheet "' + SHEET_NAME + '" not found');
  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var added = [];
  WRITABLE.forEach(function (k) {
    if (indexOfHeader_(header, k) === -1) {
      header.push(k);
      sh.getRange(1, header.length).setValue(k);
      added.push(k);
    }
  });
  Logger.log(added.length ? 'added columns: ' + added.join(', ') : 'all columns present');
  Logger.log('rows: ' + (sh.getLastRow() - 1));
}
