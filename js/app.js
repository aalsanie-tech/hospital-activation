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
var CLUSTERS = {
  'تجمع مكة المكرمة الصحي':      { en: 'Makkah Cluster',            short: 'Makkah',     region: 'SA-02' },
  'تجمع جدة الصحي الأول':        { en: 'Jeddah Cluster 1',          short: 'Jeddah C1',  region: 'SA-02' },
  'تجمع جدة الصحي الثاني':       { en: 'Jeddah Cluster 2',          short: 'Jeddah C2',  region: 'SA-02' },
  'تجمع الطائف الصحي':           { en: 'Taif Cluster',              short: 'Taif',       region: 'SA-02' },
  'تجمع المدينة المنورة الصحي':  { en: 'Madinah Cluster',           short: 'Madinah',    region: 'SA-03' },
  'تجمع الباحة الصحي':           { en: 'Al Baha Cluster',           short: 'Baha',       region: 'SA-11' },
  'تجمع عسير الصحي':             { en: 'Aseer Cluster',             short: 'Aseer',      region: 'SA-14' },
  'تجمع جازان الصحي':            { en: 'Jazan Cluster',             short: 'Jazan',      region: 'SA-09' },
  'تجمع نجران الصحي':            { en: 'Najran Cluster',            short: 'Najran',     region: 'SA-10' },
  'تجمع تبوك الصحي':             { en: 'Tabuk Cluster',             short: 'Tabuk',      region: 'SA-07' },
  'تجمع حائل الصحي':             { en: 'Hail Cluster',              short: 'Hail',       region: 'SA-06' },
  'تجمع الجوف الصحي':            { en: 'Jouf Cluster',              short: 'Jouf',       region: 'SA-12' },
  'تجمع الحدود الشمالية الصحي':  { en: 'Northern Borders Cluster',  short: 'N. Borders', region: 'SA-08' }
};

/* exposed for debugging/support: window.TM.map, window.TM.missions … */
var state = window.TM = {
  missions: [], source: 'snapshot', stamp: '', lang: 'en',
  stageFilter: null, clusterFilter: null, preview: false,
  markers: {}, map: null, fog: null, regionLayer: null, selected: null
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
  return rows.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, j) { o[h] = (r[j] || '').trim(); });
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
    var meta = CLUSTERS[cl] || { en: cl || 'Unassigned', short: cl || '—', region: null };
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
      lat: lat, lng: lng
    });
  });
  return decollide(out);
}

/* Every hospital in a city shares one centroid in the sheet, so pins would
   stack into a single unclickable dot. Golden-angle spiral, deterministic. */
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
      if (n === 1) { m.dlat = m.lat; m.dlng = m.lng; return; }
      var rad = 0.014 + 0.011 * Math.floor(i / 8), ang = i * GOLDEN;
      m.dlat = m.lat + rad * Math.sin(ang);
      m.dlng = m.lng + rad * Math.cos(ang) / Math.max(0.2, Math.cos(m.lat * Math.PI / 180));
    });
  });
  return list;
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
function stageOf(m) { return state.preview ? 4 : m.stage; }

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
  map.getPane('fogPane').style.pointerEvents = 'none';
  map.getPane('regions').style.pointerEvents = 'auto';
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomleft', prefix: false })
    .addAttribution('Leaflet · boundaries: geoBoundaries ADM1').addTo(map);
  state.map = map;
  return map;
}

function terrainStyle(pct, inTerritory) {
  if (!inTerritory) {
    return { color: '#3a5573', weight: 1.1, opacity: 0.8, fillColor: '#1a2532',
             fillOpacity: 0.95, dashArray: '3 5', className: 'region-out' };
  }
  /* dark bronze-slate → vivid conquered green */
  var stops = [
    [0.00, [32, 47, 63]], [0.25, [34, 98, 86]],
    [0.55, [36, 152, 98]], [0.80, [52, 210, 118]], [1.00, [86, 255, 162]]
  ], i, a, b, t, c = stops[stops.length - 1][1];
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
    color: full ? '#8fffc6' : 'rgba(118,214,164,' + (0.55 + pct * 0.4) + ')',
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
}

/* ════════════════════════════════════ pins ═══ */
function pinIcon(m, st) {
  var stage = st, s = STAGES[stage];
  var star = stage === 4
    ? '<span class="pin-star">✦</span>'
    : '';
  return L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin stage-' + stage + (m.stacked ? ' pin-stacked' : '') + '">' +
            '<span class="pin-halo"></span>' +
            '<span class="pin-core"></span>' +
            (stage === 0 ? '<span class="pin-lock">🔒</span>' : '') +
            star +
          '</div>',
    iconSize: [stage === 4 ? 30 : 22, stage === 4 ? 30 : 22],
    iconAnchor: [stage === 4 ? 15 : 11, stage === 4 ? 15 : 11]
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

function visible() {
  return state.missions.filter(function (m) {
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

function updateFog(st) {
  var pts = state.missions.map(function (m) {
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
    state.fog = L.fogLayer({
      pane: 'fogPane',
      opacity: CFG.FOG_OPACITY,
      radiusKm: CFG.FOG_RADIUS_KM
    }).addTo(state.map);
  }
  state.fog.setPoints(pts);
  state.fog.setRegions(regs);
}

/* ════════════════════════════════════ UI ═══ */
function t(k) { return (I18N[state.lang] && I18N[state.lang][k]) || I18N.en[k] || k; }
function stageName(i) { return STAGES[i][state.lang] || STAGES[i].en; }
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

function selectMission(m) {
  state.selected = m.id;
  var stage = stageOf(m), s = STAGES[stage];
  var prod = (m.adopted != null && m.target != null)
    ? m.adopted + ' / ' + m.target + (m.adoption != null ? ' (' + m.adoption + '%)' : '')
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
    '<div class="p-rows">' +
      row(t('manager'), m.manager) +
      (m.phone ? '<div class="row"><span class="row-k">' + t('phone') + '</span>' +
        '<span class="row-v"><a class="tel" href="tel:' + esc(m.phone.replace(/\s/g, '')) + '">' +
        esc(m.phone) + '</a></span></div>' : row(t('phone'), '')) +
      row(t('agent'), m.agent) +
      row(t('lastVisit'), m.lastVisit) +
      row(t('nextVisit'), m.nextVisit) +
      row(t('products'), prod) +
      row(t('nextStep'), m.nextStep) +
      (m.notes ? row(t('notes'), m.notes) : '') +
    '</div>' +
    '<div class="p-actions">' +
      (m.phone ? '<a class="act act-call" href="tel:' + esc(m.phone.replace(/\s/g, '')) + '">☎ ' + t('call') + '</a>' : '') +
      '<a class="act" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
        m.lat + ',' + m.lng + '">➤ ' + t('directions') + '</a>' +
    '</div>';

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
  var st = stats(state.missions);
  renderHUD(st);
  renderLegend(st);
  renderDrawer(st);
  renderRegions(state.geo, st);
  renderPins();
  updateFog(st);
}

/* ════════════════════════════════════ boot ═══ */
function boot() {
  try { state.lang = localStorage.getItem('tm_lang') || 'en'; } catch (e) {}
  applyLang();
  initMap();

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

  Promise.all([loadData(), fetch(CFG.REGIONS_URL).then(function (r) { return r.json(); })])
    .then(function (res) {
      var d = res[0];
      state.missions = d.missions;
      state.source = d.source;
      state.stamp = d.stamp;
      state.geo = res[1];
      refresh();
      frameTerritory();
      installPreviewToggle();
      if (d.error) console.info('[TM] snapshot in use because: ' + d.error);
    })
    .catch(function (e) {
      console.error(e);
      $('#hud-sub').textContent = 'Data failed to load — ' + e.message;
    });
}

/* exposed for tests + support debugging in the field */
state.parseCSV = parseCSV;
state.normalizeRows = normalizeRows;
state.reload = function () { return loadData().then(function (d) {
  state.missions = d.missions; state.source = d.source; state.stamp = d.stamp;
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

function initGate() {
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
