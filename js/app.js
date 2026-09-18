/* Territory Missions — main app
   Data flow:  live CSV (Google Sheet)  →  fallback to data/missions.json  */
(function () {
'use strict';

var CFG = window.TM_CONFIG, STAGES = window.TM_STAGES, I18N = window.TM_I18N;
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

/* ── cluster → administrative region ─────────────────────────────────────
   13 health clusters over the 13 ADM1 regions; Makkah province carries
   four of them (Makkah, Jeddah C1, Jeddah C2, Taif).                      */
var CLUSTER_DEFS = [
  { en: 'Makkah Cluster',           short: 'Makkah',     region: 'SA-02', aliases: ['تجمع مكة المكرمة الصحي', 'مكة', 'مكة المكرمة', 'makkah'] },
  { en: 'Jeddah Cluster 1',         short: 'Jeddah C1',  region: 'SA-02', aliases: ['تجمع جدة الصحي الأول', 'جدة 1', 'جدة الأول', 'جدة الاول', 'jeddah 1'] },
  { en: 'Jeddah Cluster 2',         short: 'Jeddah C2',  region: 'SA-02', aliases: ['تجمع جدة الصحي الثاني', 'جدة 2', 'جدة الثاني', 'jeddah 2'] },
  { en: 'Taif Cluster',             short: 'Taif',       region: 'SA-02', aliases: ['تجمع الطائف الصحي', 'الطائف', 'taif'] },
  { en: 'Madinah Cluster',          short: 'Madinah',    region: 'SA-03', aliases: ['تجمع المدينة المنورة الصحي', 'المدينة', 'المدينة المنورة', 'madinah'] },
  { en: 'Al Baha Cluster',          short: 'Baha',       region: 'SA-11', aliases: ['تجمع الباحة الصحي', 'الباحة', 'baha'] },
  { en: 'Aseer Cluster',            short: 'Aseer',      region: 'SA-14', aliases: ['تجمع عسير الصحي', 'عسير', 'aseer', 'asir'] },
  { en: 'Jazan Cluster',            short: 'Jazan',      region: 'SA-09', aliases: ['تجمع جازان الصحي', 'جازان', 'jazan'] },
  { en: 'Najran Cluster',           short: 'Najran',     region: 'SA-10', aliases: ['تجمع نجران الصحي', 'نجران', 'najran'] },
  { en: 'Tabuk Cluster',            short: 'Tabuk',      region: 'SA-07', aliases: ['تجمع تبوك الصحي', 'تبوك', 'tabuk'] },
  { en: 'Hail Cluster',             short: 'Hail',       region: 'SA-06', aliases: ['تجمع حائل الصحي', 'حائل', 'hail'] },
  { en: 'Jouf Cluster',             short: 'Jouf',       region: 'SA-12', aliases: ['تجمع الجوف الصحي', 'الجوف', 'jouf', 'al jouf'] },
  { en: 'Northern Borders Cluster', short: 'N. Borders', region: 'SA-08', aliases: ['تجمع الحدود الشمالية الصحي', 'الحدود الشمالية', 'northern borders'] }
];

/* The sheet has already been re-keyed once (full names → short names), so
   match on a normalised form with aliases instead of exact strings:
   strip Arabic diacritics, unify alef/ya/ta-marbuta, drop the filler words
   تجمع / الصحي / محافظة, and fold Arabic-Indic digits. */
function normAr(v) {
  return String(v == null ? '' : v)
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/[\u0649\u0626]/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/(تجمع|الصحي|الصحى|محافظة|cluster)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().toLowerCase();
}

var CLUSTER_INDEX = (function () {
  var ix = {};
  CLUSTER_DEFS.forEach(function (d) {
    d.aliases.concat([d.en, d.short]).forEach(function (a) {
      var k = normAr(a);
      if (k) ix[k] = d;
    });
  });
  return ix;
})();

var unmappedClusters = {};
function resolveCluster(raw) {
  var k = normAr(raw);
  if (!k) return null;
  if (CLUSTER_INDEX[k]) return CLUSTER_INDEX[k];
  /* then containment — but only accept it when every candidate points at
     the same cluster, so a bare "جدة" is reported rather than guessed */
  var keys = Object.keys(CLUSTER_INDEX), hits = [], i;
  for (i = 0; i < keys.length; i++) {
    if (keys[i].length < 3) continue;
    if (k.indexOf(keys[i]) > -1 || keys[i].indexOf(k) > -1) {
      if (hits.indexOf(CLUSTER_INDEX[keys[i]]) === -1) hits.push(CLUSTER_INDEX[keys[i]]);
    }
  }
  if (hits.length === 1) return hits[0];
  if (!unmappedClusters[raw]) {
    unmappedClusters[raw] = 1;
    console.warn('[TM] cluster not recognised, province shading will be missing for:', raw);
  }
  return null;
}

/* exposed for debugging/support: window.TM.map, window.TM.missions … */
/* Switch theme without a reload: palette, fog and labels all re-render. */
function applyPreset(key) {
  var P = window.TM_PRESETS || {};
  if (!P[key]) return;
  document.documentElement.setAttribute('data-preset', key);
  state.preset = P[key];
  state.presetKey = key;
  try { localStorage.setItem('tm_theme', key); } catch (e) {}
  if (state.fog) {
    var f = P[key].fog || {};
    state.fog.options.opacity = f.opacity != null ? f.opacity : CFG.FOG_OPACITY;
    state.fog.options.tint = f.color;
    state.fog.options.landOnly = !!P[key].fogLandOnly;
    state.fog.options.glow = P[key].glow;
    state.fog.setLand(P[key].fogLandOnly ? landRings() : []);
  }
  refresh();
  renderRegionLabels();
}

function activePreset() {
  var q = new URLSearchParams(location.search).get('preset');
  var saved = null;
  try { saved = localStorage.getItem('tm_theme'); } catch (e) {}
  var key = q || saved || CFG.PRESET || 'midnight';
  var P = window.TM_PRESETS || {};
  if (!P[key]) key = CFG.PRESET || 'mission';          // a dropped theme falls back
  if (!P[key]) key = 'mission';
  document.documentElement.setAttribute('data-preset', key);
  state.presetKey = key;
  return P[key] || {};
}

var state = window.TM = {
  missions: [], source: 'snapshot', stamp: '', lang: 'en',
  stageFilter: null, clusterFilter: null, classFilter: null, agentFilter: null, preview: false,
  markers: {}, map: null, fog: null, regionLayer: null, selected: null,
  products: [], warehouses: [], supplyLayers: [], showSupply: true,
  preset: null, spread: {}, contacts: {}, contactsFresh: {}, contactDelete: null, contactsOpen: false,
  leaderboardOpen: false, badgeDetail: null, labelLayer: null,
  history: [], historyOk: false, monthEstimated: false
};

/* ════════════════════════════════════════ CSV ═══ */
function parseCSV(text) {
  var rows = [], row = [], val = '', q = false, i, c, n;
  text = text.replace(/^﻿/, '');
  for (i = 0; i < text.length; i++) {
    c = text[i]; n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') { val += '"'; i++; }
      else if (c === '"') { q = false; }
      else { val += c; }
    } else if (c === '"') { q = true; }
    else if (c === ',') { row.push(val); val = ''; }
    else if (c === '\n') { row.push(val); rows.push(row); row = []; val = ''; }
    else if (c !== '\r') { val += c; }
  }
  if (val.length || row.length) { row.push(val); rows.push(row); }
  if (!rows.length) return [];
  var head = rows[0].map(function (h) { return h.trim(); });
  return rows.slice(1).map(function (r, i) {
    var o = {};
    head.forEach(function (h, j) { if (h) o[h] = (r[j] || '').trim(); });
    o.__row = i + 2;          // 1-based sheet row, header is row 1
    return o;
  }).filter(function (o) { return o['Hospital Name']; });
}

var STAGE_WORDS = { locked: 0, contact: 1, visited: 2, partial: 3, activated: 4 };
function parseStage(raw) {
  var r = String(raw || '').trim().toLowerCase();
  if (!r) return 0;
  var m = r.match(/^(\d)/);
  if (m) return Math.max(0, Math.min(4, +m[1]));
  for (var k in STAGE_WORDS) if (r.indexOf(k) > -1) return STAGE_WORDS[k];
  return 0;
}
function num(v) { var n = parseFloat(String(v == null ? '' : v).replace('%', '').trim()); return isNaN(n) ? null : n; }
function yes(v) { var s = String(v || '').trim().toLowerCase(); return s === 'yes' || s === 'true' || s === '1' || s === 'نعم'; }

function normalizeRows(rows) {
  var out = [];
  rows.forEach(function (r, i) {
    var lat = num(r['Latitude']), lng = num(r['Longitude']);
    if (lat === null || lng === null) return;
    var cl = (r['Cluster'] || '').trim();
    var meta = resolveCluster(cl) || { en: cl || 'Unassigned', short: cl || '—', region: null };
    out.push({
      id: 'h' + (i + 1),
      name: (r['Hospital Name'] || '').trim(),
      city: (r['City'] || '').trim(),
      cluster: cl, clusterEn: meta.en, clusterShort: meta.short, region: meta.region,
      stage: parseStage(r['Stage']),
      manager: (r['CSSD Manager Name'] || '').trim(),
      phone: (r['CSSD Manager Phone'] || '').trim(),
      lastVisit: (r['Last Visit Date'] || '').trim(),
      visitStatus: (r['Visit Status'] || '').trim(),
      remote: yes(r['Remote']),
      target: num(r['Products Target']),
      adopted: num(r['Products Adopted']),
      adoption: num(r['Adoption %']),
      agent: (r['Agent'] || '').trim(),
      notes: (r['Notes'] || '').trim(),
      nextStep: (r['Next Step'] || '').trim(),
      nextVisit: (r['Next Visit Due'] || '').trim(),
      cls: (r['Class'] || '').trim(),
      visitLog: (r['Visit Log'] || '').trim(),
      informed: (r['Informed'] || '').trim(),
      incubator: (r['Has Incubator'] || '').trim(),
      incubatorSerial: (r['Incubator Serial'] || '').trim(),
      dosing: (r['Dosing System'] || '').trim(),
      shortage: (r['Shortage Items'] || '').trim(),
      action: (r['Action Required'] || '').trim(),
      feedback: (r['Feedback - Missing Items'] || '').trim(),
      sheetRow: r.__row || (i + 2),
      lat: lat, lng: lng
    });
  });
  return decollide(out);
}

/* Every hospital in a city shares one city-centre coordinate in the sheet.
   Rather than a fixed offset in degrees — which overlaps when you zoom out
   and flies apart when you zoom in — each stack gets a golden-angle spiral
   measured in SCREEN PIXELS, recomputed on every zoom. They stay visibly
   neighbours at any scale without sitting on top of each other. */
function decollide(list) {
  var GOLDEN = Math.PI * (3 - Math.sqrt(5)), groups = {};
  list.forEach(function (m) {
    var k = m.lat.toFixed(4) + ',' + m.lng.toFixed(4);
    (groups[k] = groups[k] || []).push(m);
  });
  Object.keys(groups).forEach(function (k) {
    var grp = groups[k], n = grp.length;
    grp.sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
    grp.forEach(function (m, i) {
      m.stacked = n > 1;
      m.stackIndex = i;
      m.stackSize = n;
      m.dlat = m.lat;                 // replaced by spreadPins() once mapped
      m.dlng = m.lng;
      if (n > 1) {
        var ring = Math.floor(i / 8), ang = i * GOLDEN;
        m.spreadDir = [Math.cos(ang), Math.sin(ang)];
        m.spreadRing = ring;
      }
    });
  });
  return list;
}

/* ── land-aware spreading ─────────────────────────────────────────────────
   Stacked hospitals are placed greedily around their shared city point, in
   screen pixels, recomputed per zoom. Each candidate spot must be ON LAND
   (inside a Saudi region polygon) and at least one pin-width from every
   neighbour already placed. A fixed pixel offset alone threw Jeddah's
   coastal hospitals into the Red Sea at low zoom, where a pixel is ~4.5 km. */
function buildLandIndex() {
  var out = [];
  ((state.geo && state.geo.features) || []).forEach(function (f) {
    var g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    polys.forEach(function (poly) {
      var outer = poly[0];
      if (!outer || outer.length < 4) return;
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      outer.forEach(function (c) {
        if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
      });
      out.push({ ring: outer, holes: poly.slice(1), bbox: b });
    });
  });
  return out;
}

function inRing(x, y, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function onLand(lat, lng) {
  var idx = state.landIndex || (state.landIndex = buildLandIndex());
  if (!idx.length) return true;                 // no geometry yet: don't block
  for (var i = 0; i < idx.length; i++) {
    var p = idx[i], b = p.bbox;
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    if (!inRing(lng, lat, p.ring)) continue;
    for (var h = 0; h < p.holes.length; h++) if (inRing(lng, lat, p.holes[h])) return false;
    return true;
  }
  return false;
}

function pinScale(z) { return z <= 5 ? 0.72 : (z < 8 ? 0.88 : 1); }

/* Zoomed out, hospitals in the same city fan apart; zoomed in, they slide
   to their real locations.

   - City groups are formed once from TRUE geography: a seed hospital
     absorbs others within STACK_KM of the seed itself (never of another
     member), so groups can't chain across a region. Zoom-independent.
   - At zoom <= FAN_UNTIL each group fans out around its centre on land, a
     pin-width apart — the layout the team already uses.
   - Between FAN_UNTIL and TRUE_FROM each pin slides linearly from its fan
     spot to its real coordinate.
   - At zoom >= TRUE_FROM pins sit on their real coordinates; only hospitals
     that genuinely share a site get nudged apart, by about a pin-width.
   - Lone hospitals always sit exactly on their coordinate (island
     hospitals included — never dragged onto the mainland).
   Cached per zoom level; groups recomputed when data reloads. */
var STACK_KM = 15, FAN_UNTIL = 7, TRUE_FROM = 11;

function buildStacks() {
  var list = state.missions.slice().sort(function (a, b) {
    return a.name.localeCompare(b.name, 'ar') || (a.id < b.id ? -1 : 1);
  });
  var stacks = [];
  list.forEach(function (m) {
    var here = L.latLng(m.lat, m.lng), best = null, bestD = Infinity;
    for (var i = 0; i < stacks.length; i++) {
      var d = here.distanceTo(stacks[i].seed);
      if (d <= STACK_KM * 1000 && d < bestD) { best = stacks[i]; bestD = d; }
    }
    if (!best) { best = { seed: here, members: [] }; stacks.push(best); }
    best.members.push(m);
  });
  stacks.forEach(function (s) {
    var la = 0, lo = 0;
    s.members.forEach(function (m) { la += m.lat; lo += m.lng; });
    s.centre = [la / s.members.length, lo / s.members.length];
  });
  return stacks;
}

function spreadPins() {
  var map = state.map;
  if (!map || !state.missions.length) return false;
  if (!state.stacks) state.stacks = buildStacks();
  var z = map.getZoom(), key = String(Math.round(z * 100) / 100);
  var cache = (state.spreadCache = state.spreadCache || {})[key];

  if (!cache) {
    cache = state.spreadCache[key] = {};
    var sep = 22 * pinScale(z) * 0.95;
    var GOLDEN = Math.PI * (3 - Math.sqrt(5));
    var t = Math.max(0, Math.min(1, (z - FAN_UNTIL) / (TRUE_FROM - FAN_UNTIL)));

    /* nearest spot around C that is on land and clear of `placed` */
    var search = function (C, order, maxRing, placed) {
      var fallback = null, fallbackGap = -1;
      for (var ring = 0; ring <= maxRing; ring++) {
        var rad = sep * ring;
        var n = ring === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * rad) / sep));
        for (var s = 0; s < n; s++) {
          var ang = order * GOLDEN + s * (2 * Math.PI / n);
          var P = L.point(C.x + Math.cos(ang) * rad, C.y + Math.sin(ang) * rad);
          var ll = map.unproject(P, z);
          if (!onLand(ll.lat, ll.lng)) continue;
          var gap = Infinity;
          for (var q = 0; q < placed.length; q++) {
            var d = P.distanceTo(placed[q]);
            if (d < gap) gap = d;
          }
          if (gap >= sep) return P;
          if (gap > fallbackGap) { fallbackGap = gap; fallback = P; }
        }
      }
      return fallback;
    };

    state.stacks.forEach(function (stack) {
      var members = stack.members;
      if (members.length === 1) {                       // lone: exact, always
        cache[members[0].id] = [members[0].lat, members[0].lng];
        return;
      }
      var A = map.project(stack.centre, z), fanned = [], final = [];
      members.forEach(function (m, i) {
        /* 1 — the fan spot (today's layout) */
        var F = search(A, i, 9, fanned) || A;
        fanned.push(F);
        /* 2 — slide toward the true coordinate as zoom increases */
        var T = map.project([m.lat, m.lng], z);
        var P = t === 0 ? F : (t === 1 ? T : L.point(F.x + (T.x - F.x) * t, F.y + (T.y - F.y) * t));
        if (t > 0 && t < 1) {
          var pl = map.unproject(P, z);
          if (!onLand(pl.lat, pl.lng)) P = t >= 0.5 ? T : F;
        }
        /* 3 — only if it now sits on a group-mate: nudge by a ring or two */
        if (t > 0) {
          var clash = false;
          for (var q = 0; q < final.length; q++) {
            if (P.distanceTo(final[q]) < sep * 0.9) { clash = true; break; }
          }
          if (clash) P = search(P, i, 3, final) || P;
        }
        final.push(P);
        var ll = map.unproject(P, z);
        cache[m.id] = [ll.lat, ll.lng];
      });
    });
  }

  var moved = false;
  state.missions.forEach(function (m) {
    var c = cache[m.id];
    if (!c) return;
    if (c[0] !== m.dlat || c[1] !== m.dlng) { m.dlat = c[0]; m.dlng = c[1]; moved = true; }
  });
  return moved;
}

/* keep pins from swallowing the map when zoomed out */
function applyZoomScale() {
  var z = state.map.getZoom();
  var el = state.map.getContainer();
  el.classList.toggle('z-far', z <= 5);
  el.classList.toggle('z-mid', z > 5 && z < 8);
  el.classList.toggle('z-near', z >= 8);
}

/* ════════════════════════════════════ loading ═══ */
function fetchWithTimeout(url, ms) {
  if (typeof AbortController === 'undefined') return fetch(url);
  var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, ms);
  return fetch(url, { signal: ac.signal, cache: 'no-store' })
    .then(function (r) { clearTimeout(t); return r; },
          function (e) { clearTimeout(t); throw e; });
}

function loadData() {
  var url = CFG.LIVE_CSV_URL;
  if (url && CFG.CSV_CACHE_BUST) url += (url.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now();
  var live = url
    ? fetchWithTimeout(url, CFG.CSV_TIMEOUT_MS || 8000).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (t) {
        if (/^\s*</.test(t)) throw new Error('got HTML, sheet is not public');
        var rows = parseCSV(t);
        if (!rows.length) throw new Error('empty CSV');
        return { missions: normalizeRows(rows), source: 'live', stamp: new Date().toISOString() };
      })
    : Promise.reject(new Error('no LIVE_CSV_URL'));

  return live.catch(function (err) {
    console.warn('[TM] live CSV unavailable → snapshot:', err.message);
    return fetch(CFG.SNAPSHOT_URL).then(function (r) { return r.json(); })
      .then(function (j) {
        return { missions: decollide(j.missions), source: 'snapshot', stamp: j.generated, error: err.message };
      });
  });
}

/* ════════════════════════════════════ stats ═══ */
/* Preview stages for design review. state.preview = 4 shows full conquest;
   state.sim spreads deterministic stages so a half-won map can be judged.
   Never writes anywhere and never leaves localhost (see boot()). */
function stageOf(m) {
  if (state.preview) return 4;
  if (state.sim) {
    var h = 0, str = m.id + m.name;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0x7fffffff;
    return [0, 0, 1, 1, 2, 2, 3, 3, 4, 4][h % 10];   /* averages 2.0 → ~50% */
  }
  return m.stage;
}

function stats(list) {
  var s = { total: list.length, sum: 0, byStage: [0, 0, 0, 0, 0], clusters: {}, regions: {} };
  list.forEach(function (m) {
    var st = stageOf(m);
    s.sum += st;
    s.byStage[st]++;
    var c = s.clusters[m.cluster] || (s.clusters[m.cluster] = {
      name: m.cluster, en: m.clusterEn, short: m.clusterShort, region: m.region,
      total: 0, sum: 0, byStage: [0, 0, 0, 0, 0], lat: 0, lng: 0
    });
    c.total++; c.sum += st; c.byStage[st]++; c.lat += m.lat; c.lng += m.lng;
    if (m.region) {
      var r = s.regions[m.region] || (s.regions[m.region] = { total: 0, sum: 0, activated: 0 });
      r.total++; r.sum += st; if (st === 4) r.activated++;
    }
  });
  Object.keys(s.clusters).forEach(function (k) {
    var c = s.clusters[k];
    c.pct = c.total ? c.sum / (c.total * 4) : 0;
    c.lat /= c.total; c.lng /= c.total;
  });
  Object.keys(s.regions).forEach(function (k) {
    var r = s.regions[k];
    r.pct = r.total ? r.sum / (r.total * 4) : 0;
  });
  s.pct = s.total ? s.sum / (s.total * 4) : 0;
  return s;
}

var BADGE_TIERS = [
  { key: 'blue',   icon: '🔵', minStage: 1 },
  { key: 'orange', icon: '🟠', minStage: 2 },
  { key: 'green',  icon: '🟢', minStage: 3 },
  { key: 'gold',   icon: '⭐', minStage: 4 }
];

/* The script logs every stage change to a Stage History tab. Counting real
   transitions is the only way "+1 contacted AND +1 visited" can be right
   for a hospital that moved twice in one month — current-stage counting
   can only ever see where it ended up. */
function loadHistory() {
  var url = (CFG.APPS_SCRIPT_URL || '').trim();
  state.historyOk = false;
  if (!url) { state.history = []; return Promise.resolve([]); }
  var month = currentMonthKey();
  return fetchWithTimeout(url + (url.indexOf('?') > -1 ? '&' : '?') +
                          'action=history&month=' + encodeURIComponent(month),
                          CFG.CSV_TIMEOUT_MS || 8000)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (j) {
      if (!j || j.success !== true) throw new Error((j && j.error) || 'history unavailable');
      var raw = j.transitions || j.history || j.entries || [];
      state.history = raw.map(function (h) {
        return {
          date: String(h.date || h.Date || '').slice(0, 10),
          hospital: String(h.hospital || h.Hospital || '').trim(),
          agent: String(h.agent || h.Agent || '').trim(),
          from: parseStage(h.from != null ? h.from : h.from_stage),
          to: parseStage(h.to != null ? h.to : h.to_stage)
        };
      }).filter(function (h) { return h.hospital || h.agent; });
      state.historyOk = true;
      state.historyMonth = month;
      return state.history;
    })
    .catch(function (e) {
      console.warn('[TM] stage history unavailable:', e.message);
      state.history = [];
      state.historyOk = false;
      return [];
    });
}

function refreshHistory() {
  return loadHistory().then(function () { renderLeaderboard(); });
}

function currentMonthKey() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

/* Per agent: how far each hospital has come, what moved this month, and a
   badge for every cluster where ALL of that agent's hospitals passed a
   stage. "This month" counts hospitals whose Last Visit falls in the
   current calendar month, grouped by the stage they are at now. */
function agentStats(list) {
  var mk = currentMonthKey(), byAgent = {};
  var useHistory = state.historyOk && (state.history || []).length > 0;
  state.monthEstimated = !useHistory;
  list.forEach(function (m) {
    var a = m.agent || '—';
    var s = byAgent[a] || (byAgent[a] = {
      agent: a, total: 0, reached: [0, 0, 0, 0, 0], month: [0, 0, 0, 0, 0], clusters: {}
    });
    s.total++;
    var st = stageOf(m);
    for (var i = 0; i <= st; i++) s.reached[i]++;
    /* fallback only: where a hospital visited this month stands now */
    if (!useHistory && String(m.lastVisit || '').slice(0, 7) === mk) s.month[st]++;
    var c = s.clusters[m.cluster] ||
      (s.clusters[m.cluster] = { name: m.cluster, short: m.clusterShort || m.cluster, total: 0, min: 4 });
    c.total++;
    if (st < c.min) c.min = st;
  });
  if (useHistory) {
    (state.history || []).forEach(function (h) {
      var s = byAgent[h.agent];
      if (!s || !h.to) return;
      s.month[h.to]++;                       // one count per transition, not per hospital
    });
  }

  return Object.keys(byAgent).sort().map(function (a) {
    var s = byAgent[a];
    s.badges = {};
    BADGE_TIERS.forEach(function (tier) { s.badges[tier.key] = []; });
    Object.keys(s.clusters).forEach(function (k) {
      var c = s.clusters[k];
      BADGE_TIERS.forEach(function (tier) {
        if (c.min >= tier.minStage) s.badges[tier.key].push(c.short);
      });
    });
    return s;
  });
}

function badgeKeys(stats) {
  var out = [];
  stats.forEach(function (s) {
    BADGE_TIERS.forEach(function (tier) {
      s.badges[tier.key].forEach(function (cl) { out.push(s.agent + '|' + tier.key + '|' + cl); });
    });
  });
  return out;
}

/* A badge that was not there last time is worth a moment on the map. */
function checkNewBadges(stats) {
  if (state.preview || state.sim) return;
  var now = badgeKeys(stats), prev = null;
  try { prev = JSON.parse(localStorage.getItem('tm_badges') || 'null'); } catch (e) {}
  try { localStorage.setItem('tm_badges', JSON.stringify(now)); } catch (e) {}
  if (!prev) return;
  var fresh = now.filter(function (k) { return prev.indexOf(k) === -1; });
  if (!fresh.length) return;
  var parts = fresh[0].split('|');
  var tier = BADGE_TIERS.filter(function (x) { return x.key === parts[1]; })[0];
  celebrate((tier ? tier.icon + ' ' : '') + parts[2] + ' · ' + shortAgent(parts[0]) +
            (fresh.length > 1 ? ' +' + (fresh.length - 1) : ''));
}

function celebrate(text) {
  var el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = '<span>' + esc(text) + '</span>';
  document.body.appendChild(el);
  setTimeout(function () { el.classList.add('go'); }, 20);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3400);
}

/* ════════════════════════════════════ map ═══ */
function initMap() {
  var map = L.map('map', {
    center: CFG.CENTER, zoom: CFG.ZOOM,
    minZoom: CFG.MIN_ZOOM, maxZoom: CFG.MAX_ZOOM,
    zoomControl: false, attributionControl: false,
    tap: true, touchZoom: true, bounceAtZoomLimits: false,
    preferCanvas: false, worldCopyJump: false
  });
  map.createPane('regions').style.zIndex = 300;      // terrain
  map.createPane('lockedPins').style.zIndex = 420;   // under the fog
  map.createPane('fogPane').style.zIndex = 450;
  map.createPane('supply').style.zIndex = 470;
  map.createPane('borders').style.zIndex = 455;      // just above the fog
  map.getPane('borders').style.pointerEvents = 'none';
  map.createPane('labels').style.zIndex = 465;
  map.getPane('labels').style.pointerEvents = 'none';
  if (CFG.MAX_BOUNDS) {
    map.setMaxBounds(L.latLngBounds(CFG.MAX_BOUNDS));   // no panning into empty ocean
    map.options.maxBoundsViscosity = 0.8;
  }
  map.getPane('fogPane').style.pointerEvents = 'none';
  map.getPane('regions').style.pointerEvents = 'auto';
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.on('zoomend', function () {
    applyZoomScale();
    if (spreadPins()) {
      Object.keys(state.markers).forEach(function (id) {
        var m = state.missions.filter(function (x) { return x.id === id; })[0];
        if (m) state.markers[id].setLatLng([m.dlat, m.dlng]);
      });
      updateFog(stats(state.missions));
    }
  });
  L.control.attribution({ position: 'bottomleft', prefix: false })
    .addAttribution('Leaflet · boundaries: geoBoundaries ADM1').addTo(map);
  state.map = map;
  return map;
}

function terrainStyle(pct, inTerritory) {
  var P = state.preset || {};
  if (!inTerritory) {
    var ob = P.outBorder;
    return { stroke: !(ob && ob.aboveFog),          // drawn in the borders pane instead
             color: (ob && ob.color) || P.outLine || '#3a5573',
             weight: ob ? ob.weight : 1.1, opacity: ob ? ob.opacity : 0.8,
             fillColor: P.outFill || '#1a2532',
             fillOpacity: 0.95, dashArray: ob ? ob.dash : '3 5', className: 'region-out' };
  }
  /* dark bronze-slate → vivid conquered green */
  var stops = (P.terrain || [
    [0.00, [32, 47, 63]], [0.25, [34, 98, 86]],
    [0.55, [36, 152, 98]], [0.80, [52, 210, 118]], [1.00, [86, 255, 162]]
  ]), i, a, b, t, c = stops[stops.length - 1][1];
  for (i = 0; i < stops.length - 1; i++) {
    if (pct <= stops[i + 1][0]) {
      a = stops[i]; b = stops[i + 1];
      t = (pct - a[0]) / (b[0] - a[0] || 1);
      c = [0, 1, 2].map(function (j) { return Math.round(a[1][j] + (b[1][j] - a[1][j]) * t); });
      break;
    }
  }
  var full = pct >= 0.999;
  return {
    color: full ? (P.lineFull || '#8fffc6')
                : (P.line || 'rgba(118,214,164,') + (0.55 + pct * 0.4) + ')',
    weight: full ? 2.4 : 1.5,
    fillColor: 'rgb(' + c.join(',') + ')',
    fillOpacity: 0.92,
    className: full ? 'region-conquered' : 'region-in'
  };
}

function renderRegions(geo, st) {
  if (state.regionLayer) state.map.removeLayer(state.regionLayer);
  state.regionLayer = L.geoJSON(geo, {
    pane: 'regions',
    style: function (f) {
      var r = st.regions[f.properties.iso];
      return terrainStyle(r ? r.pct : 0, f.properties.inTerritory && !!r);
    },
    onEachFeature: function (f, layer) {
      var r = st.regions[f.properties.iso];
      if (!r) return;
      layer.on('click', function () { showRegionToast(f.properties, r); });
    }
  }).addTo(state.map);

  /* regions outside the territory get their dashed outline above the fog */
  if (state.borderLayer) { state.map.removeLayer(state.borderLayer); state.borderLayer = null; }
  var ob = (state.preset || {}).outBorder;
  if (ob && ob.aboveFog) {
    state.borderLayer = L.geoJSON(geo, {
      pane: 'borders', interactive: false,
      filter: function (f) { return !(f.properties.inTerritory && st.regions[f.properties.iso]); },
      style: function () {
        return { color: ob.color, weight: ob.weight, opacity: ob.opacity,
                 dashArray: ob.dash, fill: false, lineCap: 'round', className: 'region-out-border' };
      }
    }).addTo(state.map);
  }
}

/* Arabic region names, drawn for themes that ask for them */
function renderRegionLabels() {
  if (state.labelLayer) { state.map.removeLayer(state.labelLayer); state.labelLayer = null; }
  var P = state.preset || {};
  if (!P.regionLabels || !state.geo) return;
  var names = (state.data && state.data.regionNames) || {};
  var group = L.layerGroup([], { pane: 'labels' });
  state.geo.features.forEach(function (f) {
    var rings = ringsOf(f);
    if (!rings.length) return;
    var best = rings[0], bestLen = 0;
    rings.forEach(function (r) { if (r.length > bestLen) { bestLen = r.length; best = r; } });
    var minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    best.forEach(function (c) {
      if (c[0] < minLat) minLat = c[0];
      if (c[0] > maxLat) maxLat = c[0];
      if (c[1] < minLng) minLng = c[1];
      if (c[1] > maxLng) maxLng = c[1];
    });
    var nameAr = (names[f.properties.iso] && names[f.properties.iso].ar) || f.properties.nameAr;
    if (!nameAr) return;
    L.marker([(minLat + maxLat) / 2, (minLng + maxLng) / 2], {
      pane: 'labels', interactive: false,
      icon: L.divIcon({ className: 'region-label-wrap', html: '<span class="region-label">' + esc(nameAr) + '</span>' })
    }).addTo(group);
  });
  group.addTo(state.map);
  state.labelLayer = group;
}

function landRings() {
  if (state.landRingsCache) return state.landRingsCache;
  var out = [];
  ((state.geo && state.geo.features) || []).forEach(function (f) {
    var g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    polys.forEach(function (poly) {
      if (poly[0]) out.push(poly[0].map(function (c) { return [c[1], c[0]]; }));
    });
  });
  return (state.landRingsCache = out);
}

/* ════════════════════════════════════ pins ═══ */
/* Aging → steady orange ring; Expiring/Expired → pulsing red ring */
function urgencyOf(m) {
  var v = String(m.visitStatus || '').trim().toLowerCase();
  if (v === 'aging') return 'aging';
  if (v === 'expiring' || v === 'expired') return 'expired';
  return '';
}

function needsAction(m) {
  var a = String(m.action || '').trim();
  return !!a && a.toLowerCase() !== 'none';
}

function pinIcon(m, st) {
  var stage = st;
  var star = stage === 4 ? '<span class="pin-star">✦</span>' : '';
  var urg = urgencyOf(m);
  var cls = String(m.cls || '').trim().toLowerCase();
  return L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin stage-' + stage + (cls ? ' cls-' + cls : '') +
            (urg ? ' urg-' + urg : '') + (m.stacked ? ' pin-stacked' : '') + '">' +
            '<span class="pin-halo"></span>' +
            (urg ? '<span class="pin-ring"></span>' : '') +
            (stage === 0
              ? '<span class="pin-lockdisc"></span><span class="pin-lock">🔒</span>'
              : '<span class="pin-core"></span>') +
            star +
            (needsAction(m) ? '<span class="pin-flag" aria-hidden="true">▲</span>' : '') +
          '</div>',
    iconSize: [stage === 4 ? 30 : 24, stage === 4 ? 30 : 24],
    iconAnchor: [stage === 4 ? 15 : 12, stage === 4 ? 15 : 12]
  });
}

function renderPins() {
  var map = state.map;
  Object.keys(state.markers).forEach(function (k) { map.removeLayer(state.markers[k]); });
  state.markers = {};

  visible().forEach(function (m) {
    var stage = stageOf(m);
    var mk = L.marker([m.dlat, m.dlng], {
      icon: pinIcon(m, stage),
      pane: stage === 0 ? 'lockedPins' : 'markerPane',
      keyboard: true,
      title: m.name,
      riseOnHover: true,
      zIndexOffset: stage * 100
    });
    mk.on('click', function () { selectMission(m); });
    mk.addTo(map);
    state.markers[m.id] = mk;
  });
}

/* Class and Agent define whose map this is: counts, conquest, province
   shading and fog all follow them. Stage and cluster only hide pins. */
function baseMissions(skip) {
  return state.missions.filter(function (m) {
    if (skip !== 'class' && state.classFilter &&
        String(m.cls || '').toUpperCase() !== state.classFilter) return false;
    if (skip !== 'agent' && state.agentFilter && m.agent !== state.agentFilter) return false;
    return true;
  });
}

function visible() {
  return baseMissions().filter(function (m) {
    if (state.stageFilter !== null && stageOf(m) !== state.stageFilter) return false;
    if (state.clusterFilter && m.cluster !== state.clusterFilter) return false;
    return true;
  });
}

function ringsOf(feature) {
  var g = feature.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates,
      out = [];
  polys.forEach(function (poly) {
    poly.forEach(function (ring) {
      out.push(ring.map(function (c) { return [c[1], c[0]]; }));
    });
  });
  return out;
}

function updateFog(st, base) {
  var pts = (base || baseMissions()).map(function (m) {
    return { lat: m.dlat, lng: m.dlng, stage: stageOf(m) };
  });

  var regs = [];
  if (state.geo && st) {
    state.geo.features.forEach(function (f) {
      var r = st.regions[f.properties.iso];
      if (!r) return;
      var full = r.pct >= 0.999;
      /* below ~20% the circles alone tell the story; past that the whole
         province starts lifting, and at 100% it clears completely */
      var clear = full ? 1 : Math.max(0, (r.pct - 0.2)) * 0.75;
      if (!clear) return;
      regs.push({ rings: ringsOf(f), clear: clear, full: full });
    });
  }
  if (!state.fog) {
    var P = state.preset || {};
    state.fog = L.fogLayer({
      pane: 'fogPane',
      opacity: (P.fog && P.fog.opacity != null) ? P.fog.opacity : CFG.FOG_OPACITY,
      tint: P.fog && P.fog.color,
      glow: P.glow,
      landOnly: !!P.fogLandOnly,
      radiusKm: CFG.FOG_RADIUS_KM
    }).addTo(state.map);
    if (P.fogLandOnly) state.fog.setLand(landRings());
  }
  state.fog.setPoints(pts);
  state.fog.setRegions(regs);
}

/* ════════════════════════════════════ UI ═══ */
function t(k) { return (I18N[state.lang] && I18N[state.lang][k]) || I18N.en[k] || k; }
function stageName(i) { return STAGES[i][state.lang] || STAGES[i].en; }
/* The CSV export can drop a leading zero: a bare 9-digit number gets it
   back, for display and for the tel: link alike. */
function fmtPhone(raw) {
  var txt = String(raw == null ? '' : raw).trim();
  var d = txt.replace(/\D/g, '');
  if (d.length === 9) return '0' + d;
  return txt;
}

function telHref(raw) {
  return 'tel:' + fmtPhone(raw).replace(/\s/g, '');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function renderHUD(st) {
  var pct = Math.round(st.pct * 100);
  $('#conquest-fill').style.width = pct + '%';
  $('#conquest-pct').textContent = pct + '%';
  $('#conquest-pct').classList.toggle('is-full', pct >= 100);
  document.body.classList.toggle('full-conquest', pct >= 100);
  $('#hud-sub').innerHTML =
    '<b>' + st.byStage[4] + '</b> ' + t('activated') +
    ' · <b>' + (st.byStage[1] + st.byStage[2] + st.byStage[3]) + '</b> ' + t('contacted') +
    ' · <b>' + st.byStage[0] + '</b> ' + t('locked');
  var src = $('#src-chip');
  if (src) {
    src.className = 'src src-' + state.source;
    src.textContent = state.source === 'live' ? t('live') : t('snapshot');
    src.title = state.source === 'live' ? 'Live Google Sheet feed' : 'Bundled snapshot — live feed unavailable';
  }
}

function renderLegend(st) {
  var el = $('#legend');
  el.innerHTML = STAGES.map(function (s) {
    var on = state.stageFilter === s.id;
    var label = (state.lang === 'ar' ? s.chipAr : s.chip) || stageName(s.id);
    return '<button class="lg stage-' + s.id + (on ? ' on' : '') + '" data-stage="' + s.id + '" ' +
           'title="' + esc(stageName(s.id)) + '" aria-label="' + esc(stageName(s.id)) + '" ' +
           'aria-pressed="' + on + '"><i></i><span>' + esc(label) +
           '</span><b>' + st.byStage[s.id] + '</b></button>';
  }).join('');
  $$('.lg', el).forEach(function (b) {
    b.addEventListener('click', function () {
      var s = +b.dataset.stage;
      state.stageFilter = state.stageFilter === s ? null : s;
      refresh();
    });
  });
}

function agentList() {
  var seen = [];
  state.missions.forEach(function (m) {
    if (m.agent && seen.indexOf(m.agent) === -1) seen.push(m.agent);
  });
  return seen.sort();
}

function shortAgent(name) {
  var parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

function renderLeaderboard() {
  var el = $('#leaderboard'), btn = $('#lb-toggle');
  if (!el || !btn) return;
  var stats = agentStats(state.missions);
  btn.setAttribute('aria-expanded', !!state.leaderboardOpen);
  btn.classList.toggle('on', !!state.leaderboardOpen);
  el.hidden = !state.leaderboardOpen;
  if (!state.leaderboardOpen) return;

  var label = ['locked', 'contacted', 'visited', 'partial', 'activated'];
  el.innerHTML = stats.map(function (s) {
    var badges = BADGE_TIERS.map(function (tier) {
      var n = s.badges[tier.key].length;
      return n ? '<button type="button" class="badge" data-agent="' + esc(s.agent) +
        '" data-tier="' + tier.key + '">' + tier.icon + '<b>×' + n + '</b></button>' : '';
    }).join('');
    var month = [1, 2, 3, 4].filter(function (i) { return s.month[i]; })
      .map(function (i) { return '+' + s.month[i] + ' ' + t(label[i]); }).join(' · ') || '—';
    var total = [1, 2, 3, 4].filter(function (i) { return s.reached[i]; })
      .map(function (i) { return s.reached[i] + '/' + s.total + ' ' + t(label[i]); }).join(' · ') ||
      ('0/' + s.total);
    var detail = '';
    if (state.badgeDetail && state.badgeDetail.agent === s.agent) {
      var tier = BADGE_TIERS.filter(function (x) { return x.key === state.badgeDetail.tier; })[0];
      detail = '<div class="badge-detail">' + (tier ? tier.icon + ' ' : '') +
        esc(s.badges[state.badgeDetail.tier].join(' · ')) + '</div>';
    }
    var est = state.monthEstimated ? ' <em class="lb-est">' + esc(t('estTag')) + '</em>' : '';
    return '<div class="lb-row">' +
      '<div class="lb-top"><span class="lb-name" dir="auto">' + esc(s.agent) +
        ' <em>(' + s.total + ' ' + esc(t('hospitalsLbl')) + ')</em></span>' +
        '<span class="lb-badges">' + (badges || '') + '</span></div>' +
      '<div class="lb-line"><b>' + esc(t('thisMonth')) + ':</b> ' + esc(month) + est + '</div>' +
      '<div class="lb-line"><b>' + esc(t('totalLbl')) + ':</b> ' + esc(total) + '</div>' +
      detail +
    '</div>';
  }).join('') + '<p class="lb-hint">' +
    (state.monthEstimated ? esc(t('estNote')) + '<br>' : '') + esc(t('badgeHint')) + '</p>';

  $$('.badge', el).forEach(function (b) {
    b.addEventListener('click', function () {
      var same = state.badgeDetail && state.badgeDetail.agent === b.dataset.agent &&
                 state.badgeDetail.tier === b.dataset.tier;
      state.badgeDetail = same ? null : { agent: b.dataset.agent, tier: b.dataset.tier };
      renderLeaderboard();
    });
  });
  checkNewBadges(stats);
}

function installThemeSwitch() {
  var drawer = $('#drawer');
  if (!drawer || $('#theme-switch')) return;
  var box = document.createElement('div');
  box.id = 'theme-switch';
  box.className = 'theme-switch';
  var themes = (window.TM_THEMES || []);
  var paint = function () {
    box.innerHTML = '<span class="fgroup-k">' + esc(t('theme')) + '</span>' +
      themes.map(function (th) {
        return '<button type="button" class="tbtn' +
          (state.presetKey === th.key ? ' on' : '') + '" data-key="' + th.key + '">' +
          '<i style="background:' + th.swatch + '"></i>' + esc(th.label) + '</button>';
      }).join('');
    $$('.tbtn', box).forEach(function (b) {
      b.addEventListener('click', function () { applyPreset(b.dataset.key); paint(); });
    });
  };
  paint();
  state.themePaint = paint;
  drawer.insertBefore(box, $('#cluster-list'));
}

function renderFilters() {
  var el = $('#filters');
  if (!el) return;
  var byClass = baseMissions('class'), byAgent = baseMissions('agent');
  var count = function (list, test) {
    var n = 0;
    list.forEach(function (m) { if (test(m)) n++; });
    return n;
  };
  var chip = function (kind, value, label, n, on) {
    return '<button class="fchip' + (on ? ' on' : '') + ' f-' + kind + '" data-kind="' + kind +
      '" data-value="' + esc(value || '') + '" aria-pressed="' + !!on + '">' +
      esc(label) + '<b>' + n + '</b></button>';
  };

  var html = '<span class="fgroup-k">' + esc(t('klass')) + '</span>' +
    chip('class', '', t('all'), byClass.length, !state.classFilter);
  ['A', 'B', 'C'].forEach(function (c) {
    html += chip('class', c, c,
      count(byClass, function (m) { return String(m.cls || '').toUpperCase() === c; }),
      state.classFilter === c);
  });

  html += '<span class="fsep"></span><span class="fgroup-k">' + esc(t('agentF')) + '</span>' +
    chip('agent', '', t('all'), byAgent.length, !state.agentFilter);
  agentList().forEach(function (a) {
    html += chip('agent', a, shortAgent(a),
      count(byAgent, function (m) { return m.agent === a; }),
      state.agentFilter === a);
  });
  el.innerHTML = html;

  $$('.fchip', el).forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.dataset.value || null;
      if (b.dataset.kind === 'class') state.classFilter = (state.classFilter === v) ? null : v;
      else state.agentFilter = (state.agentFilter === v) ? null : v;
      if (state.selected) closePanel();
      refresh();
    });
  });
}

function renderDrawer(st) {
  var arr = Object.keys(st.clusters).map(function (k) { return st.clusters[k]; })
    .sort(function (a, b) { return b.pct - a.pct || b.total - a.total; });

  $('#drawer-stats').innerHTML =
    '<div class="ds"><b>' + st.total + '</b><span>' + t('missions') + '</span></div>' +
    '<div class="ds"><b>' + arr.length + '</b><span>' + t('clusters') + '</span></div>' +
    '<div class="ds"><b>' + Math.round(st.pct * 100) + '%</b><span>' + t('conquered') + '</span></div>';

  $('#cluster-list').innerHTML = arr.map(function (c) {
    var pct = Math.round(c.pct * 100), on = state.clusterFilter === c.name;
    return '<li><button class="cl' + (on ? ' on' : '') + (pct >= 100 ? ' cl-full' : '') +
      '" data-cluster="' + esc(c.name) + '">' +
      '<div class="cl-top"><span class="cl-name">' + esc(state.lang === 'ar' ? c.name : c.en) + '</span>' +
      '<span class="cl-pct">' + pct + '%</span></div>' +
      '<div class="cl-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="cl-meta">' + c.total + ' ' + t('hospitals') +
      (pct >= 100 ? ' · <b class="cl-flag">' + t('fullyActivated') + '</b>' : '') + '</div></button></li>';
  }).join('');

  $$('.cl', $('#cluster-list')).forEach(function (b) {
    b.addEventListener('click', function () {
      var name = b.dataset.cluster;
      state.clusterFilter = state.clusterFilter === name ? null : name;
      refresh();
      var c = st.clusters[name];
      if (state.clusterFilter && c) {
        var pts = state.missions.filter(function (m) { return m.cluster === name; })
          .map(function (m) { return [m.dlat, m.dlng]; });
        if (pts.length) state.map.fitBounds(L.latLngBounds(pts).pad(0.35), { animate: true });
      }
      closeDrawer();
    });
  });

  $('#data-stamp').textContent =
    (state.source === 'live' ? t('live') : t('snapshot')) + ' · ' + t('updated') + ' ' +
    (state.stamp ? new Date(state.stamp).toLocaleString(state.lang === 'ar' ? 'ar-SA' : 'en-GB') : '—');
}

function row(label, value, cls) {
  if (!value && value !== 0) value = t('none');
  return '<div class="row ' + (cls || '') + '"><span class="row-k">' + esc(label) +
         '</span><span class="row-v">' + esc(value) + '</span></div>';
}

function contactsHtml(m) {
  var list = contactsFor(m), open = state.contactsOpen, del = state.contactDelete;
  var rows = list.length
    ? list.map(function (c, i) {
        var arming = del && del.hospital === m.name && del.index === i;
        return '<div class="ct' + (c.primary ? ' ct-primary' : '') + (arming ? ' ct-arming' : '') + '">' +
          '<span class="ct-role">' + esc(c.role || t('contact')) +
            (c.primary ? ' <em>' + esc(t('fromSheetRow')) + '</em>' : '') + '</span>' +
          '<span class="ct-name" dir="auto">' + esc(c.name || t('none')) + '</span>' +
          (c.phone
            ? '<a class="ct-tel" href="' + esc(telHref(c.phone)) + '">' + esc(fmtPhone(c.phone)) + '</a>'
            : '<span class="ct-tel ct-muted">' + esc(t('none')) + '</span>') +
          (c.notes ? '<span class="ct-notes" dir="auto">' + esc(c.notes) + '</span>' : '') +
          (!c.primary && editEnabled()
            ? (arming
                ? '<span class="ct-confirm">' + esc(t('confirmDelete')) +
                    '<button type="button" class="ct-no" data-i="' + i + '">' + esc(t('cancel')) + '</button>' +
                    '<button type="button" class="ct-yes" data-i="' + i + '">' + esc(t('deleteLbl')) + '</button>' +
                  '</span>'
                : '<button type="button" class="ct-del" data-i="' + i + '" aria-label="' +
                  esc(t('deleteLbl')) + '">✕</button>')
            : '') +
        '</div>';
      }).join('')
    : '<p class="ct-empty">' + esc(t('noContacts')) + '</p>';

  return '<div class="contacts' + (open ? ' open' : '') + '">' +
    '<button type="button" class="contacts-head" id="contacts-toggle" aria-expanded="' + !!open + '">' +
      '<span>' + esc(t('contacts')) + ' <b>' + list.length + '</b></span>' +
      '<i class="ct-caret">▾</i></button>' +
    '<div class="contacts-body"' + (open ? '' : ' hidden') + '>' + rows +
      (editEnabled() ? '<button type="button" class="ct-add" id="contact-add">+ ' +
        esc(t('addContact')) + '</button>' : '') +
    '</div></div>';
}

function deleteContact(m, contact) {
  state.contactDelete = null;
  toast(t('saving'));
  postUpdate({
    hospital_name: m.name, delete_contact: true,
    contact_role: contact.role, contact_name: contact.name
  }).then(function (res) {
    if (!res || res.success !== true) {
      throw new Error((res && res.error) || 'the script rejected the delete');
    }
    return fetchContacts(m.name).catch(function () {
      /* fall back to removing it locally if the re-read fails */
      state.contacts[m.name] = (state.contacts[m.name] || []).filter(function (c) {
        return !(c.name === contact.name && c.role === contact.role);
      });
    });
  }).then(function () {
    toast('✓ ' + t('contactDeleted'));
    selectMission(m);
  }).catch(function (e) {
    toast(t('saveFailed') + ' — ' + e.message);
    console.error('[TM] delete contact failed', e);
    selectMission(m);
  });
}

function openContactForm(m) {
  if (!editEnabled()) { toast(t('editOff')); return; }
  var roles = (CFG.CONTACT_ROLES || ['Other']).map(function (r) {
    return '<option value="' + esc(r) + '">' + esc(r) + '</option>';
  }).join('');
  $('#panel-body').innerHTML =
    '<form id="ct-form" class="edit">' +
      '<div class="edit-head"><h2>' + esc(t('addContact')) + '</h2>' +
        '<p dir="auto">' + esc(m.name) + '</p></div>' +
      '<div class="fld"><label class="fld-k" for="ct-role">' + esc(t('role')) + '</label>' +
        '<select class="in" id="ct-role" data-name="role">' + roles + '</select></div>' +
      '<div class="fld"><label class="fld-k" for="ct-name">' + esc(t('nameLbl')) + '</label>' +
        '<input class="in" id="ct-name" data-name="name" type="text" dir="auto"></div>' +
      '<div class="fld"><label class="fld-k" for="ct-phone">' + esc(t('phone')) + '</label>' +
        '<input class="in" id="ct-phone" data-name="phone" type="tel" inputmode="tel"></div>' +
      '<div class="fld"><label class="fld-k" for="ct-notes">' + esc(t('notesLbl')) + '</label>' +
        '<input class="in" id="ct-notes" data-name="notes" type="text" dir="auto"></div>' +
      '<p class="edit-err" id="ct-err" hidden role="alert"></p>' +
      '<div class="edit-actions">' +
        '<button type="button" class="act" id="ct-cancel">' + esc(t('cancel')) + '</button>' +
        '<button type="submit" class="act act-call" id="ct-save">' + esc(t('save')) + '</button>' +
      '</div>' +
    '</form>';
  var form = $('#ct-form');
  $('#ct-cancel').addEventListener('click', function () { selectMission(m); });
  form.addEventListener('submit', function (e) { e.preventDefault(); saveContact(m, form); });
  $('#panel').scrollTop = 0;
  $('#ct-name').focus();
}

function saveContact(m, form) {
  var role = $('#ct-role').value, name = String($('#ct-name').value).trim(),
      phone = String($('#ct-phone').value).trim(), notes = String($('#ct-notes').value).trim();
  var err = $('#ct-err'), btn = $('#ct-save');
  if (!name && !phone) {
    err.textContent = t('noteRequired');
    err.hidden = false;
    return;
  }
  err.hidden = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(t('saving'));
  form.classList.add('is-saving');

  postUpdate({
    hospital_name: m.name, add_contact: true,
    contact_role: role, contact_name: name, contact_phone: fmtPhone(phone),
    contact_notes: notes
  }).then(function (res) {
    if (!res || res.success !== true) {
      throw new Error((res && res.error) || 'the script rejected the contact');
    }
    return fetchContacts(m.name).catch(function () {
      (state.contacts[m.name] = state.contacts[m.name] || []).push({
        role: role, name: name, phone: fmtPhone(phone), notes: notes
      });
    });
  }).then(function () {
    form.classList.remove('is-saving');
    state.contactsOpen = true;
    toast('✓ ' + t('contactSaved'));
    selectMission(m);
  }).catch(function (e) {
    form.classList.remove('is-saving');
    btn.disabled = false;
    btn.textContent = t('retry');
    err.textContent = t('saveFailed') + ' — ' + e.message;
    err.hidden = false;
    console.error('[TM] add contact failed', e);
  });
}

/* The sheet keeps the whole history in one cell, one entry per line,
   each stamped by the script. Show them all, not just the newest. */
function visitLogHtml(log) {
  var lines = String(log || '').split(/\r?\n/)
    .map(function (l) { return l.trim(); }).filter(Boolean);
  if (!lines.length) return '';
  return '<div class="log-head">' + esc(t('fVisitLog')) +
    ' <span>' + lines.length + ' ' + esc(t('entries')) + '</span></div>' +
    '<ul class="log-list">' + lines.map(function (ln) {
      var mm = ln.match(/^\[?\s*(\d{4}-\d{2}-\d{2})\s*\]?\s*[-–—:]?\s*([\s\S]*)$/);
      return '<li><time>' + esc(mm ? mm[1] : '·') + '</time><span>' +
             esc(mm ? mm[2] : ln) + '</span></li>';
    }).join('') + '</ul>';
}

function selectMission(m) {
  state.selected = m.id;
  var stage = stageOf(m), s = STAGES[stage];
  var target = m.target != null ? m.target : CFG.PUSH_TARGET;
  var prod = (m.adopted != null && target != null)
    ? m.adopted + ' / ' + target + (m.adoption != null ? ' (' + m.adoption + '%)' : '')
    : (m.adopted != null ? String(m.adopted) : '');

  $('#panel-body').innerHTML =
    '<div class="p-head stage-' + stage + '">' +
      '<span class="p-badge">' + esc(stageName(stage)) + '</span>' +
      '<h2 class="p-name">' + esc(m.name) + '</h2>' +
      '<p class="p-loc">' + esc(m.city) + ' · ' + esc(state.lang === 'ar' ? m.cluster : m.clusterEn) +
        (m.remote ? ' · <span class="p-remote">' + t('remote') + '</span>' : '') + '</p>' +
      '<div class="p-track">' + STAGES.map(function (x) {
          return '<i class="tk stage-' + x.id + (x.id <= stage ? ' done' : '') + '"></i>';
        }).join('') + '</div>' +
    '</div>' +
    contactsHtml(m) +
    '<div class="p-rows">' +
      row(t('agent'), m.agent) +
      row(t('lastVisit'), m.lastVisit) +
      row(t('nextVisit'), m.nextVisit) +
      row(t('products'), prod) +
      row(t('nextStep'), m.nextStep) +
      (m.cls ? row(t('cls'), m.cls) : '') +
      (m.incubator ? row(t('fIncubator'), m.incubator + (m.incubatorSerial ? ' · ' + m.incubatorSerial : '')) : '') +
      (m.shortage ? row(t('fShortage'), m.shortage) : '') +
      (m.action ? row(t('fAction'), m.action) : '') +
      (m.feedback ? row(t('fFeedback'), m.feedback) : '') +
      (m.notes ? row(t('notes'), m.notes) : '') +
      visitLogHtml(m.visitLog) +
    '</div>' +
    '<div class="p-actions">' +
      (m.phone ? '<a class="act act-call" href="' + esc(telHref(m.phone)) + '">☎ ' + t('call') + '</a>' : '') +
      '<a class="act" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
        m.lat + ',' + m.lng + '">➤ ' + t('directions') + '</a>' +
    '</div>' +
    (editEnabled() ? '<div class="p-actions p-edit-row">' +
      '<button type="button" class="act act-visit" id="btn-quick">✓ ' + esc(t('quickVisit')) + '</button>' +
      '<button type="button" class="act act-edit" id="btn-update">✎ ' + esc(t('update')) + '</button>' +
    '</div>' : '');

  var ctog = $('#contacts-toggle');
  if (ctog) ctog.addEventListener('click', function () {
    state.contactsOpen = !state.contactsOpen;
    selectMission(m);
  });
  var cadd = $('#contact-add');
  if (cadd) cadd.addEventListener('click', function () { openContactForm(m); });

  var clist = contactsFor(m);
  $$('.ct-del').forEach(function (b) {
    b.addEventListener('click', function () {
      state.contactDelete = { hospital: m.name, index: +b.dataset.i };
      selectMission(m);
    });
  });
  $$('.ct-no').forEach(function (b) {
    b.addEventListener('click', function () { state.contactDelete = null; selectMission(m); });
  });
  $$('.ct-yes').forEach(function (b) {
    b.addEventListener('click', function () { deleteContact(m, clist[+b.dataset.i]); });
  });

  refreshContacts(m);

  var upd = $('#btn-update');
  if (upd) upd.addEventListener('click', function () { openEditForm(m); });
  var qv = $('#btn-quick');
  if (qv) qv.addEventListener('click', function () { openQuickVisit(m); });

  $('#panel').classList.add('open');
  $('#panel').setAttribute('aria-hidden', 'false');
  /* on phones the sheet covers the lower screen, so bias the pan to keep
     the selected pin in the visible strip above it */
  var z = state.map.getZoom(), pt = state.map.project([m.dlat, m.dlng], z);
  if (window.innerWidth < 820) pt.y += state.map.getSize().y * 0.22;
  state.map.panTo(state.map.unproject(pt, z), { animate: true });
  Object.keys(state.markers).forEach(function (k) {
    var el = state.markers[k].getElement();
    if (el) el.classList.toggle('is-selected', k === m.id);
  });
}

function closePanel() {
  $('#panel').classList.remove('open');
  $('#panel').setAttribute('aria-hidden', 'true');
  state.selected = null;
  $$('.pin-wrap.is-selected').forEach(function (e) { e.classList.remove('is-selected'); });
}

function showRegionToast(props, r) {
  var el = $('#toast');
  el.innerHTML = '<b>' + esc(state.lang === 'ar' ? props.nameAr : props.nameEn) + '</b> · ' +
                 Math.round(r.pct * 100) + '% · ' + r.total + ' ' + t('hospitals');
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.hidden = true; }, 2600);
}

function openDrawer() { $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false; }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }

/* ── search ── */
function runSearch(q) {
  q = q.trim().toLowerCase();
  var ul = $('#search-results');
  if (!q) { ul.innerHTML = ''; return; }
  var hits = state.missions.filter(function (m) {
    return (m.name + ' ' + m.city + ' ' + m.cluster + ' ' + m.clusterEn + ' ' +
            m.manager + ' ' + m.phone).toLowerCase().indexOf(q) > -1;
  }).slice(0, 40);
  ul.innerHTML = hits.length
    ? hits.map(function (m) {
        return '<li><button data-id="' + m.id + '"><i class="dot stage-' + stageOf(m) + '"></i>' +
               '<span><b>' + esc(m.name) + '</b><em>' + esc(m.city) + ' · ' +
               esc(m.clusterShort) + '</em></span></button></li>';
      }).join('')
    : '<li class="empty">' + t('noResults') + '</li>';
  $$('button', ul).forEach(function (b) {
    b.addEventListener('click', function () {
      var m = state.missions.filter(function (x) { return x.id === b.dataset.id; })[0];
      if (!m) return;
      closeSearch();
      state.map.setView([m.dlat, m.dlng], Math.max(state.map.getZoom(), 9), { animate: true });
      selectMission(m);
    });
  });
}
function openSearch() { $('#search-wrap').hidden = false; $('#search-input').focus(); }
function closeSearch() { $('#search-wrap').hidden = true; $('#search-input').value = ''; $('#search-results').innerHTML = ''; }

/* ── language ── */
function applyLang() {
  var d = I18N[state.lang];
  document.documentElement.lang = d.lang;
  document.documentElement.dir = d.dir;
  $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
  $('#search-input').placeholder = t('searchPh');
  $('#btn-lang').textContent = state.lang === 'en' ? 'ع' : 'EN';
  try { localStorage.setItem('tm_lang', state.lang); } catch (e) {}
}

/* ── refresh everything that depends on data/filters ── */
function refresh() {
  var base = baseMissions();
  var st = stats(base);
  renderHUD(st);
  renderLegend(st);
  renderFilters();
  renderLeaderboard();
  renderDrawer(st);
  renderRegions(state.geo, st);
  renderPins();
  renderWarehouses();
  updateFog(st, base);
}

/* ════════════════════════════════════ boot ═══ */
function boot() {
  try { state.lang = localStorage.getItem('tm_lang') || 'en'; } catch (e) {}
  try {
    var pref = localStorage.getItem('tm_supply');
    state.showSupply = pref === null ? (CFG.SHOW_SUPPLY_DEFAULT !== false) : pref === '1';
  } catch (e) { state.showSupply = CFG.SHOW_SUPPLY_DEFAULT !== false; }
  applyLang();
  state.preset = activePreset();
  initMap();

  $('#lb-toggle').addEventListener('click', function () {
    state.leaderboardOpen = !state.leaderboardOpen;
    if (!state.leaderboardOpen) state.badgeDetail = null;
    renderLeaderboard();
  });
  $('#btn-clusters').addEventListener('click', openDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', function () { closeDrawer(); closeSearch(); });
  $('#panel-close').addEventListener('click', closePanel);
  $('#btn-search').addEventListener('click', openSearch);
  $('#search-close').addEventListener('click', closeSearch);
  $('#search-input').addEventListener('input', function (e) { runSearch(e.target.value); });
  $('#btn-lang').addEventListener('click', function () {
    state.lang = state.lang === 'en' ? 'ar' : 'en';
    applyLang();
    refresh();
    if (state.supplyLabel) state.supplyLabel();
    if (state.themePaint) state.themePaint();
    if (state.selected) {
      var m = state.missions.filter(function (x) { return x.id === state.selected; })[0];
      if (m) selectMission(m);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePanel(); closeDrawer(); closeSearch(); }
  });

  /* phone rotation / browser chrome showing and hiding */
  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (state.map) state.map.invalidateSize(false); }, 180);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.map) state.map.invalidateSize(false);
  });

  loadProducts();
  loadContacts();
  loadHistory().then(function () { renderLeaderboard(); });
  var whReady = loadWarehouses();
  Promise.all([loadData(), fetch(CFG.REGIONS_URL).then(function (r) { return r.json(); })])
    .then(function (res) {
      var d = res[0];
      state.missions = d.missions;
      state.source = d.source;
      state.stamp = d.stamp;
      state.geo = res[1];
      spreadPins();
      applyZoomScale();
      refresh();
      if (!applyDeepLink()) frameTerritory();
      spreadPins();
      renderPins();
      installPreviewToggle();
      installThemeSwitch();
      whReady.then(function () {
        installWarehouseToggle();
        renderWarehouses();
      });
      if (d.error) console.info('[TM] snapshot in use because: ' + d.error);
    })
    .catch(function (e) {
      console.error(e);
      $('#hud-sub').textContent = 'Data failed to load — ' + e.message;
    });
}

/* Deep links, so a rep can send a colleague straight to a hospital:
     ?h=<hospital id>          open that hospital's panel
     ?at=<lat>,<lng>,<zoom>    open at a specific view
   Returns true when a link set the view.                                  */
function applyDeepLink() {
  var q = new URLSearchParams(location.search), handled = false;
  var at = q.get('at');
  if (at) {
    var p = at.split(',').map(parseFloat);
    if (p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) {
      state.map.setView([p[0], p[1]], isFinite(p[2]) ? p[2] : 9, { animate: false });
      handled = true;
    }
  }
  var id = q.get('h');
  if (id) {
    var m = state.missions.filter(function (x) { return x.id === id; })[0];
    if (m) {
      if (!handled) state.map.setView([m.dlat, m.dlng], 10, { animate: false });
      selectMission(m);
      handled = true;
    }
  }
  return handled;
}

/* exposed for tests + support debugging in the field */
state.deepLink = applyDeepLink;
state.postUpdate = postUpdate;   /* TM.postUpdate({...}) to test the endpoint */
state.parseCSV = parseCSV;
state.normalizeRows = normalizeRows;
state.reload = function () { return loadData().then(function (d) {
  state.missions = d.missions; state.source = d.source; state.stamp = d.stamp;
  state.spreadCache = {}; state.stacks = null; spreadPins();
  refresh(); return d.source;
}); };

/* Frame the mission territory. Guarded because a map built inside a
   hidden/zero-size container measures 0x0 — fitBounds would then snap to
   max zoom and, worse, pin minZoom there. Wait for a real size first. */
function frameTerritory(tries) {
  tries = tries || 0;
  var map = state.map;
  if (!map || !state.missions.length) return;
  map.invalidateSize(false);
  var size = map.getSize();
  if ((size.x < 40 || size.y < 40) && tries < 40) {
    return setTimeout(function () { frameTerritory(tries + 1); }, 120);
  }
  var b = L.latLngBounds(state.missions.map(function (m) { return [m.dlat, m.dlng]; }));
  map.setMinZoom(CFG.MIN_ZOOM);
  map.fitBounds(b, { animate: false, paddingTopLeft: [18, 96], paddingBottomRight: [18, 80] });
  var z = map.getZoom();
  if (z >= CFG.MIN_ZOOM && z <= CFG.MAX_ZOOM) map.setMinZoom(Math.max(3, z - 2));
}

/* Lets you show stakeholders what 100% conquest looks like without
   touching the sheet. Purely visual; never writes anywhere. */
function installPreviewToggle() {
  var btn = document.createElement('button');
  btn.className = 'preview-toggle';
  btn.innerHTML = '<span>▶</span> Preview 100%';
  btn.addEventListener('click', function () {
    state.preview = !state.preview;
    btn.classList.toggle('on', state.preview);
    btn.innerHTML = state.preview ? '<span>■</span> Exit preview' : '<span>▶</span> Preview 100%';
    refresh();
  });
  $('#drawer').appendChild(btn);
}

/* ═══════════════════════════════════════ edit mode ═══ */
function loadProducts() {
  var url = (CFG.APPS_SCRIPT_URL || '').trim();
  var live = url
    ? fetchWithTimeout(url + (url.indexOf('?') > -1 ? '&' : '?') + 'action=products',
                       CFG.CSV_TIMEOUT_MS || 8000)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || j.success !== true || !j.products || !j.products.length) {
            throw new Error((j && j.error) || 'no products returned');
          }
          return j.products.map(normProduct).filter(function (p) { return p.label; });
        })
    : Promise.reject(new Error('no endpoint'));

  return live.catch(function (e) {
    console.warn('[TM] product list from the web app failed (' + e.message + '), using the bundled copy');
    return fetch(CFG.PRODUCTS_FALLBACK_URL).then(function (r) { return r.json(); })
      .then(function (j) { return (j.products || []).map(normProduct).filter(function (p) { return p.label; }); });
  }).then(function (list) {
    state.products = list;
    return list;
  }).catch(function (e) {
    console.warn('[TM] product list unavailable:', e.message);
    state.products = [];
    return [];
  });
}

/* Products come back as {code, name_ar, name_en, category, moh, nupco}.
   Agents read the Arabic name; the sheet stores "English name — code" so
   the column stays orderable. Older payloads (name/category/code, or the
   shuffled variant) are still accepted so a script change can't blank the
   picker. */
function normProduct(p) {
  var pick = function () {
    for (var i = 0; i < arguments.length; i++) {
      var v = p[arguments[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  var arabic = /[\u0600-\u06FF]/;
  var code = pick('code', 'Catalogue Number', 'catalogue');
  var nameAr = pick('name_ar', 'nameAr');
  var nameEn = pick('name_en', 'nameEn');
  var cat = pick('category', 'Category');
  var legacy = pick('name', 'Product Name');

  if (!nameAr && arabic.test(legacy)) nameAr = legacy;
  if (!nameAr && arabic.test(cat)) { nameAr = cat; cat = ''; }          // shuffled payload
  if (!nameEn && legacy && !arabic.test(legacy) && legacy !== code) nameEn = legacy;
  if (!code && legacy && !arabic.test(legacy)) code = legacy;

  var label = nameAr || nameEn || code;
  /* what lands in the sheet's Shortage Items */
  var value = (nameEn && code) ? nameEn + ' — ' + code : (nameEn || code || label);
  var moh = pick('moh', 'MOH', 'moh_code'), nupco = pick('nupco', 'Nupco', 'nupco_code');

  return {
    label: label, value: value, code: code, nameEn: nameEn, nameAr: nameAr,
    group: cat, moh: moh, nupco: nupco,
    /* anything a sheet cell might already hold for this product */
    aliases: [value, nameEn, nameAr, code, legacy].filter(Boolean)
  };
}

function loadContacts() {
  var url = (CFG.CONTACTS_CSV_URL || '').trim();
  if (!url) { state.contacts = {}; return Promise.resolve({}); }
  return fetchWithTimeout(url + (url.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now(),
                          CFG.CSV_TIMEOUT_MS || 8000)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (txt) {
      if (/^\s*</.test(txt)) throw new Error('Contacts tab is not public');
      var by = {};
      parseCSV(txt).forEach(function (r) {
        var h = String(r['Hospital Name'] || '').trim();
        if (!h) return;
        (by[h] = by[h] || []).push({
          role: String(r['Role'] || '').trim(),
          name: String(r['Name'] || '').trim(),
          phone: String(r['Phone'] || '').trim(),
          notes: String(r['Notes'] || '').trim()
        });
      });
      state.contacts = by;
      return by;
    })
    .catch(function (e) {
      console.warn('[TM] contacts unavailable:', e.message);
      state.contacts = {};
      return {};
    });
}

/* The Contacts tab CSV gives every hospital at once, which is what makes
   the panel open instantly. ?action=contacts&hospital= is authoritative,
   so each hospital is refreshed from it once per session — and again right
   after an add or a delete. */
function fetchContacts(name) {
  var url = (CFG.APPS_SCRIPT_URL || '').trim();
  if (!url) return Promise.reject(new Error('no endpoint'));
  return fetchWithTimeout(url + (url.indexOf('?') > -1 ? '&' : '?') +
                          'action=contacts&hospital=' + encodeURIComponent(name),
                          CFG.CSV_TIMEOUT_MS || 8000)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (j) {
      if (!j || j.success !== true) throw new Error((j && j.error) || 'contacts lookup failed');
      state.contacts[name] = (j.contacts || []).map(function (c) {
        return {
          role: String(c.role || '').trim(), name: String(c.name || '').trim(),
          phone: String(c.phone || '').trim(), notes: String(c.notes || '').trim()
        };
      });
      state.contactsFresh[name] = true;
      return state.contacts[name];
    });
}

function refreshContacts(m, force) {
  if (!force && state.contactsFresh[m.name]) return;
  fetchContacts(m.name).then(function () {
    if (state.selected === m.id) selectMission(m);
  }).catch(function (e) {
    console.warn('[TM] contacts lookup failed, using the sheet copy:', e.message);
  });
}

/* The CSSD manager lives on the hospital row; everyone else on the
   Contacts tab. Show the manager first, then the rest, without repeats. */
function contactsFor(m) {
  var out = [];
  if (m.manager || m.phone) {
    out.push({ role: t('manager'), name: m.manager, phone: m.phone, primary: true });
  }
  (state.contacts[m.name] || []).forEach(function (c) {
    var dup = out.some(function (x) {
      return (x.name && x.name === c.name) ||
             (x.phone && fmtPhone(x.phone) === fmtPhone(c.phone));
    });
    if (!dup) out.push(c);
  });
  return out;
}

function editEnabled() { return !!(CFG.APPS_SCRIPT_URL || '').trim(); }

function todayISO() {
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* Y / N / — where — means "leave whatever the sheet already has" */
function triGroup(name, label, value) {
  var v = String(value || '').trim().toUpperCase();
  v = (v === 'Y' || v === 'YES' || v === 'TRUE') ? 'Y'
    : (v === 'N' || v === 'NO' || v === 'FALSE') ? 'N' : '';
  return '<div class="fld"><label class="fld-k">' + esc(label) + '</label>' +
    '<div class="tri" data-name="' + name + '" role="group" aria-label="' + esc(label) + '">' +
      ['', 'Y', 'N'].map(function (opt) {
        return '<button type="button" class="tri-b' + (v === opt ? ' on' : '') + '" data-v="' + opt + '">' +
          (opt === '' ? '—' : opt === 'Y' ? esc(t('yes')) : esc(t('no'))) + '</button>';
      }).join('') +
    '</div></div>';
}

function productPicker(selectedCsv) {
  var chosen = String(selectedCsv || '').split(',').map(function (x) { return x.trim(); })
                 .filter(Boolean);
  var list = state.products || [];
  if (!list.length) {
    return '<div class="fld"><label class="fld-k">' + esc(t('fShortage')) + '</label>' +
      '<input type="text" class="in" data-name="shortage" value="' + esc(chosen.join(', ')) + '"></div>';
  }

  /* only a repeating category is a real grouping */
  var counts = {};
  list.forEach(function (p) { if (p.group) counts[p.group] = (counts[p.group] || 0) + 1; });
  var groups = Object.keys(counts);
  var grouped = groups.length > 1 && groups.some(function (g) { return counts[g] > 1; });

  /* a cell may hold the new "name — code", or just a name or code from before */
  var isChosen = function (p) {
    return chosen.some(function (c) {
      return p.aliases.some(function (a) { return a === c; });
    });
  };
  var chipFor = function (p) {
    var codes = [p.code, p.moh && 'MOH ' + p.moh, p.nupco && 'Nupco ' + p.nupco].filter(Boolean);
    return '<button type="button" class="chip' + (isChosen(p) ? ' on' : '') + '" ' +
      'data-p="' + esc(p.value) + '" title="' + esc([p.nameEn].concat(codes).join(' · ')) + '" dir="auto">' +
      esc(p.label) + (p.code ? '<em>' + esc(p.code) + '</em>' : '') + '</button>';
  };

  var body;
  if (grouped) {
    var order = ['Push', 'Selective', 'Inform'];
    var cats = groups.slice().sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    body = cats.map(function (c) {
      return '<div class="pick-cat">' + esc(c) + ' <b>' + counts[c] + '</b></div><div class="pick-row">' +
        list.filter(function (p) { return p.group === c; }).map(chipFor).join('') + '</div>';
    }).join('');
  } else {
    body = '<div class="pick-row">' + list.map(chipFor).join('') + '</div>';
  }

  return '<div class="fld"><label class="fld-k">' + esc(t('fShortage')) +
    ' <span class="fld-count" id="shortage-count">' + chosen.length + ' ' + esc(t('selected')) + '</span></label>' +
    '<div class="picker" data-name="shortage">' + body + '</div></div>';
}

function openQuickVisit(m) {
  if (!editEnabled()) { toast(t('editOff')); return; }
  $('#panel-body').innerHTML =
    '<form id="qv-form" class="edit">' +
      '<div class="edit-head"><h2>' + esc(m.name) + '</h2>' +
        '<p>' + esc(m.city) + ' · ' + esc(state.lang === 'ar' ? m.cluster : m.clusterEn) + '</p></div>' +
      '<div class="fld"><label class="fld-k" for="qv-note">' + esc(t('visitNote')) + ' *</label>' +
        '<textarea class="in" id="qv-note" rows="3" autocomplete="off"></textarea></div>' +
      '<p class="edit-err" id="qv-err" hidden role="alert"></p>' +
      '<div class="edit-actions">' +
        '<button type="button" class="act" id="qv-cancel">' + esc(t('cancel')) + '</button>' +
        '<button type="submit" class="act act-visit" id="qv-save">' + esc(t('save')) + '</button>' +
      '</div>' +
    '</form>';
  var form = $('#qv-form');
  $('#qv-cancel').addEventListener('click', function () { selectMission(m); });
  form.addEventListener('submit', function (e) { e.preventDefault(); saveQuickVisit(m, form); });
  $('#panel').scrollTop = 0;
  $('#qv-note').focus();
}

function saveQuickVisit(m, form) {
  var note = String($('#qv-note').value).trim();
  var err = $('#qv-err'), btn = $('#qv-save');
  if (!note) {
    err.textContent = t('noteRequired');
    err.hidden = false;
    $('#qv-note').focus();
    return;
  }
  err.hidden = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(t('saving'));
  form.classList.add('is-saving');

  postUpdate({ hospital_name: m.name, quick_visit: true, visit_note: note })
    .then(function (res) {
      if (!res || res.success !== true) {
        throw new Error((res && res.error) || 'the script rejected the visit');
      }
      var today = todayISO();
      m.lastVisit = today;
      m.visitLog = '[' + today + '] ' + note + (m.visitLog ? '\n' + m.visitLog : '');
      var moved = false;
      if (res.stage) {
        var ns = parseStage(res.stage);
        moved = ns !== m.stage;
        m.stage = ns;
        m.stageLabel = res.stage;
      }
      form.classList.remove('is-saving');
      toast('✓ ' + t('visitSaved') + (res.stage ? ' · ' + t('stage2') + ' ' + res.stage : ''));
      selectMission(m);
      refresh();
      if (moved) flashPin(m);
      if (res.stage) refreshHistory();
    })
    .catch(function (e) {
      form.classList.remove('is-saving');
      btn.disabled = false;
      btn.textContent = t('retry');
      err.textContent = t('saveFailed') + ' — ' + e.message;
      err.hidden = false;
      console.error('[TM] quick visit failed', e);
    });
}

function openEditForm(m) {
  if (!editEnabled()) { toast(t('editOff')); return; }
  var total = m.target != null ? m.target : (CFG.PUSH_TARGET != null ? CFG.PUSH_TARGET : '');
  var labels = { 'None': t('actNone'), 'Broken Device': t('actBroken'),
                 'Training Needed': t('actTraining'), 'Product Complaint': t('actComplaint'),
                 'Urgent Follow-up': t('actUrgent') };
  var actions = (CFG.ACTION_OPTIONS || []).map(function (o) {
    return '<option value="' + esc(o) + '"' + (m.action === o ? ' selected' : '') + '>' +
           esc(labels[o] || o) + '</option>';
  }).join('');

  $('#panel-body').innerHTML =
    '<form id="edit-form" class="edit" novalidate data-orig="' + esc(m.name) + '">' +
      '<div class="edit-head">' +
        '<h2>' + esc(m.name) + '</h2>' +
        '<p>' + esc(m.city) + ' · ' + esc(state.lang === 'ar' ? m.cluster : m.clusterEn) + '</p>' +
      '</div>' +
      '<div class="fld"><label class="fld-k" for="f-name">' + esc(t('fNameEdit')) + '</label>' +
        '<input class="in" id="f-name" data-name="nameEdit" type="text" dir="auto" value="' + esc(m.name) + '"></div>' +
      '<div class="fld" id="loc-fld"><label class="fld-k">' + esc(t('fLocation')) + '</label>' +
        '<div class="loc-row"><span class="loc-now" id="loc-now" dir="ltr">' +
          m.lat.toFixed(5) + ', ' + m.lng.toFixed(5) + '</span>' +
          '<button type="button" class="act loc-btn" id="loc-btn">📍 ' + esc(t('useMyLocation')) + '</button></div>' +
        '<p class="loc-msg" id="loc-msg" hidden></p>' +
        '<input type="hidden" data-name="gpsLat"><input type="hidden" data-name="gpsLng"></div>' +
      '<div class="fld"><label class="fld-k" for="f-mgr">' + esc(t('fManager')) + '</label>' +
        '<input class="in" id="f-mgr" data-name="manager" type="text" value="' + esc(m.manager) + '"></div>' +
      '<div class="fld"><label class="fld-k" for="f-phone">' + esc(t('fPhone')) + '</label>' +
        '<input class="in" id="f-phone" data-name="phone" type="tel" inputmode="tel" value="' + esc(fmtPhone(m.phone)) + '"></div>' +
      '<div class="fld"><label class="fld-k" for="f-date">' + esc(t('fLastVisit')) + '</label>' +
        '<input class="in" id="f-date" data-name="lastVisit" type="date" value="' + esc(todayISO()) + '"></div>' +
      '<div class="fld"><label class="fld-k" for="f-log">' + esc(t('fVisitLog')) + '</label>' +
        '<textarea class="in" id="f-log" data-name="visitLog" rows="3"></textarea></div>' +
      '<div class="fld"><label class="fld-k" for="f-adopted">' + esc(t('fPushAdopted')) + '</label>' +
        '<div class="num-row"><input class="in num" id="f-adopted" data-name="adopted" type="number" min="0" ' +
          'inputmode="numeric" value="' + (m.adopted != null ? m.adopted : '') + '">' +
          '<span class="num-of">' + esc(t('outOf')) + ' <b>' + (total === '' ? '—' : esc(total)) + '</b></span></div></div>' +
      triGroup('informed', t('fInformed'), m.informed) +
      triGroup('incubator', t('fIncubator'), m.incubator) +
      '<div class="fld" id="serial-fld"><label class="fld-k" for="f-serial">' + esc(t('fSerial')) + '</label>' +
        '<input class="in" id="f-serial" data-name="incubatorSerial" type="text" value="' + esc(m.incubatorSerial) + '"></div>' +
      triGroup('dosing', t('fDosing'), m.dosing) +
      productPicker(m.shortage) +
      '<div class="fld"><label class="fld-k" for="f-action">' + esc(t('fAction')) + '</label>' +
        '<select class="in" id="f-action" data-name="action"><option value=""></option>' + actions + '</select></div>' +
      '<div class="fld"><label class="fld-k" for="f-feedback">' + esc(t('fFeedback')) + '</label>' +
        '<input class="in" id="f-feedback" data-name="feedback" type="text" value="' + esc(m.feedback) + '"></div>' +
      '<div class="fld"><label class="fld-k" for="f-next">' + esc(t('fNextStep')) + '</label>' +
        '<input class="in" id="f-next" data-name="nextStep" type="text" value="' + esc(m.nextStep) + '"></div>' +
      '<p class="edit-err" id="edit-err" hidden role="alert"></p>' +
      '<div class="edit-actions">' +
        '<button type="button" class="act" id="edit-cancel">' + esc(t('cancel')) + '</button>' +
        '<button type="submit" class="act act-call" id="edit-save">' + esc(t('save')) + '</button>' +
      '</div>' +
    '</form>';

  var form = $('#edit-form');
  $('#loc-btn').addEventListener('click', function () { captureLocation(m, form); });

  var syncSerial = function () {
    var g = form.querySelector('.tri[data-name="incubator"] .tri-b.on');
    $('#serial-fld').hidden = !(g && g.dataset.v === 'Y');
  };
  syncSerial();

  $$('.tri', form).forEach(function (grp) {
    $$('.tri-b', grp).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.tri-b', grp).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (grp.dataset.name === 'incubator') syncSerial();
      });
    });
  });

  $$('.picker .chip', form).forEach(function (c) {
    c.addEventListener('click', function () {
      c.classList.toggle('on');
      var n = $$('.picker .chip.on', form).length, el = $('#shortage-count');
      if (el) el.textContent = n + ' ' + t('selected');
    });
  });

  $('#edit-cancel').addEventListener('click', function () { selectMission(m); });
  form.addEventListener('submit', function (e) { e.preventDefault(); saveEdit(m, form); });
  $('#panel').scrollTop = 0;
}

/* One tap while standing at the hospital records the phone's GPS fix.
   Guards: readings worse than ±1 km are refused, and a fix more than 60 km
   from the listed location needs a second, explicit tap — a mis-tap from the
   office must not move a hospital across the region. */
var GPS_MAX_ACCURACY_M = 1000, GPS_FAR_KM = 60;

function captureLocation(m, form) {
  var btn = $('#loc-btn'), msg = $('#loc-msg');
  var say = function (text, kind) {
    msg.textContent = text; msg.className = 'loc-msg loc-' + kind; msg.hidden = false;
  };
  var idle = function (label) {
    btn.disabled = false;
    btn.innerHTML = '📍 ' + esc(label || t('useMyLocation'));
  };
  var accept = function (lat, lng, acc) {
    form.querySelector('[data-name="gpsLat"]').value = lat.toFixed(6);
    form.querySelector('[data-name="gpsLng"]').value = lng.toFixed(6);
    $('#loc-now').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
    $('#loc-fld').classList.add('loc-set');
    delete form.dataset.pendingLoc;
    say(t('gpsSet').replace('{m}', acc), 'ok');
    idle();
  };

  /* second tap after a "you're far away" warning */
  if (form.dataset.pendingLoc) {
    var p = form.dataset.pendingLoc.split(',');
    accept(+p[0], +p[1], +p[2]);
    return;
  }
  if (!navigator.geolocation) { say(t('gpsUnsupported'), 'err'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(t('locating'));
  navigator.geolocation.getCurrentPosition(function (pos) {
    var lat = pos.coords.latitude, lng = pos.coords.longitude;
    var acc = Math.round(pos.coords.accuracy || 0);
    if (acc > GPS_MAX_ACCURACY_M) { idle(); say(t('gpsWeak').replace('{m}', acc), 'err'); return; }
    var km = L.latLng(m.lat, m.lng).distanceTo([lat, lng]) / 1000;
    if (km > GPS_FAR_KM) {
      form.dataset.pendingLoc = lat + ',' + lng + ',' + acc;
      idle(t('useAnyway'));
      say(t('gpsFar').replace('{km}', Math.round(km)), 'warn');
      return;
    }
    accept(lat, lng, acc);
  }, function (err) {
    idle();
    say(err && err.code === 1 ? t('gpsDenied') : t('gpsFailed'), 'err');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

function collectEdit(form) {
  var val = function (n) {
    var el = form.querySelector('[data-name="' + n + '"]');
    return el ? String(el.value).trim() : '';
  };
  var tri = function (n) {
    var b = form.querySelector('.tri[data-name="' + n + '"] .tri-b.on');
    return b ? b.dataset.v : '';
  };
  var picker = form.querySelector('.picker[data-name="shortage"]');

  /* Flat snake_case, exactly what the web app expects. Stage and Visit
     Status are deliberately absent — the script derives those. */
  var u = {
    cssd_manager: val('manager'),
    phone: val('phone'),
    last_visit: val('lastVisit'),
    visit_log: val('visitLog'),
    push_adopted: val('adopted'),
    action_required: val('action'),
    feedback: val('feedback'),
    next_step: val('nextStep'),
    shortage_items: picker
      ? $$('.chip.on', picker).map(function (c) { return c.dataset.p; }).join(', ')
      : val('shortage')
  };

  /* the Y/N/— toggles: "—" means leave the sheet's value alone, so send
     those keys only when the agent actually picked Y or N */
  /* rename: hospital_name stays the lookup key; only send the new name when
     the agent actually changed it (and never blank a hospital's name) */
  var renamed = val('nameEdit');
  if (renamed && renamed !== form.dataset.orig) u.hospital_name_edit = renamed;

  var gLat = val('gpsLat'), gLng = val('gpsLng');
  if (gLat && gLng) { u.latitude = gLat; u.longitude = gLng; }

  if (tri('informed')) u.informed = tri('informed');
  if (tri('dosing')) u.dosing_system = tri('dosing');
  if (tri('incubator')) {
    u.has_incubator = tri('incubator');
    if (tri('incubator') === 'Y') u.incubator_serial = val('incubatorSerial');
  }
  return u;
}

function saveEdit(m, form) {
  var btn = $('#edit-save'), err = $('#edit-err');
  var fields = collectEdit(form);
  err.hidden = true;

  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(t('saving'));
  form.classList.add('is-saving');

  var payload = { hospital_name: m.name };
  Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });

  postUpdate(payload).then(function (res) {
    if (!res || res.success !== true) {
      throw new Error((res && res.error) || 'the script rejected the update');
    }

    /* reflect the visit locally so the panel is right straight away */
    m.manager = fields.cssd_manager;
    m.phone = fields.phone;
    m.lastVisit = fields.last_visit;
    m.adopted = num(fields.push_adopted);
    m.action = fields.action_required;
    m.feedback = fields.feedback;
    m.nextStep = fields.next_step;
    m.shortage = fields.shortage_items;
    if (fields.hospital_name_edit) m.name = fields.hospital_name_edit;   // it is the lookup key next time
    if (fields.latitude && fields.longitude) {
      m.lat = +fields.latitude; m.lng = +fields.longitude;
      state.stacks = null; state.spreadCache = {};                        // regroup around the new spot
      spreadPins();
    }
    if (fields.informed) m.informed = fields.informed;
    if (fields.dosing_system) m.dosing = fields.dosing_system;
    if (fields.has_incubator) {
      m.incubator = fields.has_incubator;
      if (fields.incubator_serial != null) m.incubatorSerial = fields.incubator_serial;
    }
    if (fields.visit_log) {
      m.visitLog = '[' + fields.last_visit + '] ' + fields.visit_log +
                   (m.visitLog ? '\n' + m.visitLog : '');
    }

    /* the script decides the stage — take it back and let the pin move */
    var moved = false;
    if (res.stage) {
      var ns = parseStage(res.stage);
      moved = ns !== m.stage;
      m.stage = ns;
      m.stageLabel = res.stage;
    }

    form.classList.remove('is-saving');
    toast('✓ ' + t('saved') + (res.stage ? ' · ' + t('stage2') + ' ' + res.stage : ''));
    selectMission(m);
    refresh();
    if (moved) flashPin(m);
    if (res.stage) refreshHistory();                 // the script just logged it
  }).catch(function (e) {
    form.classList.remove('is-saving');
    btn.disabled = false;
    btn.textContent = t('retry');
    err.textContent = t('saveFailed') + ' — ' + e.message;
    err.hidden = false;
    console.error('[TM] save failed', e);
  });
}

/* a promoted hospital should be visible on the map, not just in the panel */
function flashPin(m) {
  var mk = state.markers[m.id];
  if (!mk) return;
  var el = mk.getElement();
  if (!el) return;
  el.classList.remove('just-moved');
  void el.offsetWidth;
  el.classList.add('just-moved');
  setTimeout(function () { el.classList.remove('just-moved'); }, 2600);
}

/* Apps Script cannot answer a CORS preflight, so the body goes as
   text/plain — a "simple" request. The /exec URL answers with a 302 to
   script.googleusercontent.com; the script has already run by then and the
   redirect just carries the JSON back, so `redirect: follow` is required.
   There is no JSONP fallback on purpose: this web app's doGet only serves
   test/products/warehouses, so a retry over GET would not write anything
   and could look like success. A failed POST is reported as a failure. */
function postUpdate(payload) {
  var url = (CFG.APPS_SCRIPT_URL || '').trim();
  if (!url) return Promise.reject(new Error('APPS_SCRIPT_URL is not set'));
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, CFG.SAVE_TIMEOUT_MS || 20000);

  return fetch(url, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow',
    signal: ctl ? ctl.signal : undefined
  }).then(function (r) {
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function (txt) {
    try { return JSON.parse(txt); }
    catch (e) { throw new Error('unexpected reply from the script'); }
  }, function (e) {
    clearTimeout(timer);
    throw new Error(e.name === 'AbortError' ? 'timed out' : 'network unreachable');
  });
}

function toast(msg) {
  var el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.hidden = true; }, 3200);
}


/* ══════════════════════════════════ Nupco warehouses ═══ */
/* Depots sit above the fog — logistics you already know about. The web app
   has returned two shapes for the same data (name/lat… and the sheet's own
   headers Warehouse/Latitude…), so read either. */
function pickField(o, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = o[keys[i]];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

function normWarehouse(w) {
  var lat = num(pickField(w, ['lat', 'Latitude', 'latitude']));
  var lng = num(pickField(w, ['lng', 'Longitude', 'longitude']));
  return {
    name: String(pickField(w, ['name', 'Warehouse', 'warehouse'])).trim(),
    city: String(pickField(w, ['city', 'City'])).trim(),
    contact: String(pickField(w, ['contact', 'Contact Name', 'contact_name'])).trim(),
    phone: String(pickField(w, ['phone', 'Contact Phone', 'contact_phone'])).trim(),
    custodyName: String(pickField(w, ['custody_name', 'أمين العهدة - Name', 'أمين العهدة Name'])).trim(),
    custodyPhone: String(pickField(w, ['custody_phone', 'أمين العهدة - Phone', 'أمين العهدة Phone'])).trim(),
    lat: lat, lng: lng,
    serves: String(pickField(w, ['serves', 'Serves Clusters', 'serves_clusters']))
      .split(',').map(function (x) { return x.trim(); }).filter(Boolean)
      .map(function (raw) {
        var def = resolveCluster(raw);
        return { raw: raw, def: def, short: def ? def.short : raw };
      })
  };
}

function loadWarehouses() {
  var url = (CFG.APPS_SCRIPT_URL || '').trim();
  var live = url
    ? fetchWithTimeout(url + (url.indexOf('?') > -1 ? '&' : '?') + 'action=warehouses',
                       CFG.CSV_TIMEOUT_MS || 8000)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || j.success !== true || !j.warehouses || !j.warehouses.length) {
            throw new Error((j && j.error) || 'no warehouses returned');
          }
          var list = j.warehouses.map(normWarehouse).filter(validWarehouse);
          if (!list.length) throw new Error('warehouse rows had no usable name/coordinates');
          return list;
        })
    : Promise.reject(new Error('no endpoint'));

  return live.catch(function (e) {
    console.warn('[TM] warehouses from the web app failed (' + e.message + '), using the bundled copy');
    return fetch(CFG.WAREHOUSES_FALLBACK_URL).then(function (r) { return r.json(); })
      .then(function (j) { return (j.warehouses || []).map(normWarehouse).filter(validWarehouse); });
  }).then(function (list) {
    state.warehouses = list;
    return list;
  }).catch(function (e) {
    console.warn('[TM] warehouses unavailable:', e.message);
    state.warehouses = [];
    return [];
  });
}

/* num('') is null and isFinite(null) is true, so check null explicitly */
function validWarehouse(w) {
  return !!w.name && w.lat !== null && w.lng !== null && isFinite(w.lat) && isFinite(w.lng);
}

function warehouseIcon() {
  return L.divIcon({
    className: 'wh-wrap',
    html: '<div class="wh"><span class="wh-glyph">▣</span></div>',
    iconSize: [21, 21], iconAnchor: [10, 10]
  });
}

function renderWarehouses() {
  var map = state.map;
  (state.supplyLayers || []).forEach(function (l) { map.removeLayer(l); });
  state.supplyLayers = [];
  if (!state.showSupply || !(state.warehouses || []).length) return;

  state.warehouses.forEach(function (w) {
    var mk = L.marker([w.lat, w.lng], {
      icon: warehouseIcon(), title: w.name, zIndexOffset: 500, riseOnHover: true
    }).addTo(map);
    mk.on('click', function () { selectWarehouse(w); });
    state.supplyLayers.push(mk);
  });
}

function contactRow(label, name, phone) {
  if (!name && !phone) return row(label, '');
  return '<div class="row"><span class="row-k">' + esc(label) + '</span><span class="row-v">' +
    (name ? esc(name) : '') +
    (phone ? (name ? '<br>' : '') + '<a class="tel" href="' + esc(telHref(phone)) + '">' +
             esc(fmtPhone(phone)) + '</a>' : '') +
    '</span></div>';
}

function selectWarehouse(w) {
  var st = stats(state.missions), centres = {};
  Object.keys(st.clusters).forEach(function (k) { centres[st.clusters[k].short] = st.clusters[k]; });
  state.selected = null;

  var serves = w.serves.map(function (sv) {
    var c = centres[sv.short];
    var km = c ? Math.round(state.map.distance([w.lat, w.lng], [c.lat, c.lng]) / 1000) : null;
    return '<div class="row"><span class="row-k">' +
      esc(state.lang === 'ar' ? sv.raw : sv.short) + '</span><span class="row-v">' +
      (c ? c.total + ' ' + esc(t('hospitals')) + ' · ' + Math.round(c.pct * 100) + '%' +
           (km != null ? ' · ' + km + ' km' : '')
         : esc(t('none'))) + '</span></div>';
  }).join('');

  $('#panel-body').innerHTML =
    '<div class="p-head wh-head">' +
      '<span class="p-badge">' + esc(t('warehouse')) + '</span>' +
      '<h2 class="p-name">' + esc(w.name) + '</h2>' +
      '<p class="p-loc">' + esc(w.city) + ' · ' + w.serves.length + ' ' +
        esc(state.lang === 'ar' ? t('clusters') : (w.serves.length === 1 ? 'cluster' : 'clusters')) + '</p>' +
    '</div>' +
    '<div class="p-rows">' +
      contactRow(t('whContactShort'), w.contact, w.phone) +
      contactRow(t('custody'), w.custodyName, w.custodyPhone) +
      '<div class="rows-head">' + esc(t('serves')) + '</div>' + serves +
    '</div>' +
    '<div class="p-actions">' +
      (w.phone ? '<a class="act act-call" href="' + esc(telHref(w.phone)) + '">☎ ' + esc(t('whContactShort')) + '</a>' : '') +
      (w.custodyPhone ? '<a class="act act-call" href="' + esc(telHref(w.custodyPhone)) + '">☎ ' + esc(t('custody')) + '</a>' : '') +
      '<a class="act" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
        w.lat + ',' + w.lng + '">➤ ' + t('directions') + '</a>' +
    '</div>' +
    (editEnabled() ? '<div class="p-actions p-edit-row">' +
      '<button type="button" class="act act-edit" id="btn-wh-update">✎ ' + esc(t('update')) + '</button>' +
    '</div>' : '');

  var upd = $('#btn-wh-update');
  if (upd) upd.addEventListener('click', function () { openWarehouseForm(w); });

  $('#panel').classList.add('open');
  $('#panel').setAttribute('aria-hidden', 'false');
  $$('.pin-wrap.is-selected').forEach(function (e) { e.classList.remove('is-selected'); });
}

function openWarehouseForm(w) {
  if (!editEnabled()) { toast(t('editOff')); return; }
  var input = function (id, name, label, type, value) {
    return '<div class="fld"><label class="fld-k" for="' + id + '">' + esc(label) + '</label>' +
      '<input class="in" id="' + id + '" data-name="' + name + '" type="' + type + '"' +
      (type === 'tel' ? ' inputmode="tel"' : '') + ' value="' + esc(value) + '"></div>';
  };
  $('#panel-body').innerHTML =
    '<form id="wh-form" class="edit" novalidate>' +
      '<div class="edit-head"><h2>' + esc(w.name) + '</h2>' +
        '<p>' + esc(t('warehouse')) + ' · ' + esc(w.city) + '</p></div>' +
      input('w-cn', 'contactName', t('whContact'), 'text', w.contact) +
      input('w-cp', 'contactPhone', t('whContactPhone'), 'tel', w.phone) +
      input('w-un', 'custodyName', t('whCustody'), 'text', w.custodyName) +
      input('w-up', 'custodyPhone', t('whCustodyPhone'), 'tel', w.custodyPhone) +
      '<p class="edit-err" id="wh-err" hidden role="alert"></p>' +
      '<div class="edit-actions">' +
        '<button type="button" class="act" id="wh-cancel">' + esc(t('cancel')) + '</button>' +
        '<button type="submit" class="act act-call" id="wh-save">' + esc(t('save')) + '</button>' +
      '</div>' +
    '</form>';

  var form = $('#wh-form');
  $('#wh-cancel').addEventListener('click', function () { selectWarehouse(w); });
  form.addEventListener('submit', function (e) { e.preventDefault(); saveWarehouse(w, form); });
  $('#panel').scrollTop = 0;
}

function saveWarehouse(w, form) {
  var btn = $('#wh-save'), err = $('#wh-err');
  var val = function (n) { return String(form.querySelector('[data-name="' + n + '"]').value).trim(); };
  var fields = {
    contact_name: val('contactName'),
    contact_phone: val('contactPhone'),
    custody_name: val('custodyName'),
    custody_phone: val('custodyPhone')
  };
  err.hidden = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(t('saving'));
  form.classList.add('is-saving');

  var payload = { warehouse_name: w.name };
  Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });

  postUpdate(payload).then(function (res) {
    if (!res || res.success !== true) {
      throw new Error((res && res.error) || 'the script rejected the update');
    }
    /* the same endpoint serves hospitals; make sure this landed on a depot */
    if (res.type && res.type !== 'warehouse') {
      throw new Error('unexpected reply type "' + res.type + '" — check the sheet');
    }
    w.contact = fields.contact_name;
    w.phone = fields.contact_phone;
    w.custodyName = fields.custody_name;
    w.custodyPhone = fields.custody_phone;
    form.classList.remove('is-saving');
    toast('✓ ' + t('saved'));
    selectWarehouse(w);
  }).catch(function (e) {
    form.classList.remove('is-saving');
    btn.disabled = false;
    btn.textContent = t('retry');
    err.textContent = t('saveFailed') + ' — ' + e.message;
    err.hidden = false;
    console.error('[TM] warehouse save failed', e);
  });
}

function installWarehouseToggle() {
  var drawer = $('#drawer'), btn = document.createElement('button');
  btn.className = 'supply-toggle' + (state.showSupply ? ' on' : '');
  btn.innerHTML = '<span>▣</span> <b></b>';
  var label = function () {
    btn.querySelector('b').textContent =
      t('warehouses') + ' · ' + (state.warehouses || []).length;
  };
  label();
  btn.addEventListener('click', function () {
    state.showSupply = !state.showSupply;
    btn.classList.toggle('on', state.showSupply);
    try { localStorage.setItem('tm_supply', state.showSupply ? '1' : '0'); } catch (e) {}
    renderWarehouses();
  });
  drawer.insertBefore(btn, $('#cluster-list'));
  state.supplyLabel = label;
}


/* ════════════════════════════════════ gate ═══ */
function sha256(str) {
  var enc = new TextEncoder().encode(str);
  return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ('00' + b.toString(16)).slice(-2);
    }).join('');
  });
}

function startApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  boot();
}

/* Design-preview switches. Localhost only, so they can never reach the
   field build: ?sim=half | full and ?nogate=1. They only affect rendering. */
function applyDevSwitches() {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  var qs = new URLSearchParams(location.search);
  if (qs.get('sim') === 'half') state.sim = true;
  if (qs.get('sim') === 'full') state.preview = true;
  if (qs.get('nogate') === '1') CFG.GATE_ENABLED = false;
}

function initGate() {
  applyDevSwitches();
  if (!CFG.GATE_ENABLED) return startApp();
  var ok = false;
  try { ok = localStorage.getItem('tm_auth') === CFG.PASSCODE_SHA256; } catch (e) {}
  if (ok) return startApp();

  $('#gate').hidden = false;
  $('#gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('#gate-input').value;
    sha256(v).then(function (h) {
      if (h === CFG.PASSCODE_SHA256) {
        try { localStorage.setItem('tm_auth', h); } catch (e2) {}
        startApp();
      } else {
        $('#gate-error').hidden = false;
        $('#gate-input').value = '';
        $('#gate-card') && $('#gate-card').classList.add('shake');
        $('.gate-card').classList.remove('shake');
        void $('.gate-card').offsetWidth;
        $('.gate-card').classList.add('shake');
      }
    });
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGate);
else initGate();

})();
