/* Fog of war — a canvas layer that blankets the map in darkness and
   punches soft, glowing holes around every discovered hospital.
   Positioning follows the leaflet-heat pattern: a viewport-sized canvas
   (plus padding) repositioned on moveend and transformed during zoom. */
L.FogLayer = L.Layer.extend({
  options: {
    pane: 'fog',
    padding: 0.35,      // extra canvas around the viewport, as a fraction
    opacity: 0.9,
    tint: null,                       // [r,g,b] base colour of the fog
    landOnly: false,                  // clip the fog to the land polygons
    radiusKm: { 1: 26, 2: 42, 3: 62, 4: 95 },
    minRadiusPx: 16,
    maxRadiusPx: 520
  },

  initialize: function (opts) {
    L.setOptions(this, opts);
    this._points = [];
    this._regions = [];
    this._noise = null;
  },

  setPoints: function (pts) {          // [{lat,lng,stage}]
    this._points = pts || [];
    return this._redraw();
  },

  /* Region-wide clearing: a cluster that is fully activated lifts the fog
     off its whole province, not just a circle around each hospital.
     [{rings:[[[lat,lng],...],...], clear:0..1, full:bool}]              */
  setRegions: function (regions) {
    this._regions = regions || [];
    return this._redraw();
  },

  /* outer rings of every land polygon, as [lat,lng] — used by landOnly */
  setLand: function (rings) {
    this._land = rings || [];
    return this._redraw();
  },

  _tracePath: function (ctx, rings, pad) {
    var m = this._map, i, j, ring, pt;
    ctx.beginPath();
    for (i = 0; i < rings.length; i++) {
      ring = rings[i];
      for (j = 0; j < ring.length; j++) {
        pt = m.latLngToContainerPoint(ring[j]).add(pad);
        if (j === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
    }
  },

  onAdd: function (map) {
    this._map = map;
    if (!this._canvas) {
      this._canvas = L.DomUtil.create('canvas', 'tm-fog');
      this._canvas.style.pointerEvents = 'none';
      this._ctx = this._canvas.getContext('2d');
      this._zoomAnimated = map.options.zoomAnimation && L.Browser.any3d;
      if (this._zoomAnimated) L.DomUtil.addClass(this._canvas, 'leaflet-zoom-animated');
    }
    this.getPane().appendChild(this._canvas);
    this._reset();
  },

  onRemove: function () {
    L.DomUtil.remove(this._canvas);
  },

  getEvents: function () {
    var ev = { viewreset: this._reset, moveend: this._reset, resize: this._reset };
    if (this._zoomAnimated) ev.zoomanim = this._animateZoom;
    return ev;
  },

  _animateZoom: function (e) {
    var scale = this._map.getZoomScale(e.zoom),
        offset = this._map._getCenterOffset(e.center)._multiplyBy(-scale)
                   .subtract(this._map._getMapPanePos());
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },

  _reset: function () {
    if (!this._map) return;
    var size = this._map.getSize(),
        pad = size.multiplyBy(this.options.padding).round(),
        w = size.x + pad.x * 2,
        h = size.y + pad.y * 2,
        dpr = Math.min(window.devicePixelRatio || 1, 2);

    this._pad = pad;
    this._dpr = dpr;

    if (this._canvas.width !== Math.round(w * dpr) || this._canvas.height !== Math.round(h * dpr)) {
      this._canvas.width = Math.round(w * dpr);
      this._canvas.height = Math.round(h * dpr);
    }
    this._canvas.style.width = w + 'px';
    this._canvas.style.height = h + 'px';

    L.DomUtil.setTransform(this._canvas, this._map.containerPointToLayerPoint(pad.multiplyBy(-1)), 1);
    this._redraw();
  },

  /* deterministic noise tile so the fog has grain instead of flat black */
  _noiseTile: function () {
    if (this._noise) return this._noise;
    var n = document.createElement('canvas'), s = 96;
    n.width = n.height = s;
    var c = n.getContext('2d'), img = c.createImageData(s, s), d = img.data, seed = 1337;
    var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (var i = 0; i < d.length; i += 4) {
      var v = 120 + rnd() * 135;
      d[i] = v * 0.35; d[i + 1] = v * 0.5; d[i + 2] = v * 0.75; d[i + 3] = 26;
    }
    c.putImageData(img, 0, 0);
    this._noise = n;
    return n;
  },

  _pxPerKm: function (lat) {
    var m = this._map,
        a = m.latLngToContainerPoint([lat, 0]),
        b = m.latLngToContainerPoint([lat + 1 / 111.32, 0]);
    return Math.abs(a.y - b.y);
  },

  _redraw: function () {
    if (!this._map || !this._ctx) return this;
    var ctx = this._ctx, dpr = this._dpr || 1,
        w = this._canvas.width / dpr, h = this._canvas.height / dpr,
        pad = this._pad || L.point(0, 0), o = this.options;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* 1 — the fog itself: deep blue-black, slightly lighter at the edges */
    var tint = o.tint || [5, 9, 15];
    var dark = [Math.max(0, tint[0] - 4), Math.max(0, tint[1] - 6), Math.max(0, tint[2] - 8)];
    var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15,
                                     w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(' + tint.join(',') + ',' + (o.opacity - 0.06) + ')');
    g.addColorStop(1, 'rgba(' + dark.join(',') + ',' + Math.min(1, o.opacity + 0.06) + ')');
    ctx.globalCompositeOperation = 'source-over';
    /* one path for all land rings: a nonzero clip unions them without seams
       along shared region borders */
    var clipped = !!(o.landOnly && this._land && this._land.length);
    if (clipped) {
      ctx.save();
      ctx.beginPath();
      for (var li = 0; li < this._land.length; li++) {
        var lring = this._land[li];
        for (var lj = 0; lj < lring.length; lj++) {
          var lp = this._map.latLngToContainerPoint(lring[lj]).add(pad);
          if (lj === 0) ctx.moveTo(lp.x, lp.y); else ctx.lineTo(lp.x, lp.y);
        }
        ctx.closePath();
      }
      ctx.clip('nonzero');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var pat = ctx.createPattern(this._noiseTile(), 'repeat');
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); }
    if (clipped) ctx.restore();

    /* 2a — lift the fog off provinces as their clusters get activated */
    var regs = this._regions, ri;
    ctx.globalCompositeOperation = 'destination-out';
    for (ri = 0; ri < regs.length; ri++) {
      if (!regs[ri].clear) continue;
      ctx.save();
      ctx.filter = 'blur(14px)';
      ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, regs[ri].clear) + ')';
      this._tracePath(ctx, regs[ri].rings, pad);
      ctx.fill('evenodd');
      ctx.restore();
    }

    /* 2b — punch holes where territory has been discovered */
    var ppk = this._pxPerKm(this._map.getCenter().lat), pts = this._points, i, p, r, hole;
    ctx.globalCompositeOperation = 'destination-out';
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (!p.stage) continue;
      var cp = this._map.latLngToContainerPoint([p.lat, p.lng]).add(pad);
      r = Math.max(o.minRadiusPx, Math.min(o.maxRadiusPx, (o.radiusKm[p.stage] || 26) * ppk));
      if (cp.x < -r || cp.y < -r || cp.x > w + r || cp.y > h + r) continue;
      /* higher stages clear more completely; contact leaves a haze */
      var clear = [0, 0.8, 0.9, 0.97, 1][p.stage] || 0.8;
      hole = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, r);
      hole.addColorStop(0, 'rgba(0,0,0,' + clear + ')');
      hole.addColorStop(0.55, 'rgba(0,0,0,' + clear * 0.72 + ')');
      hole.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hole;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 3 — conquered ground glows back through the cleared holes */
    ctx.globalCompositeOperation = 'lighter';
    for (ri = 0; ri < regs.length; ri++) {
      if (!regs[ri].full) continue;
      ctx.save();
      ctx.filter = 'blur(10px)';
      ctx.fillStyle = 'rgba(34,255,136,0.10)';
      this._tracePath(ctx, regs[ri].rings, pad);
      ctx.fill('evenodd');
      ctx.restore();
    }
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p.stage < 2) continue;
      var gp = this._map.latLngToContainerPoint([p.lat, p.lng]).add(pad);
      r = Math.max(o.minRadiusPx, Math.min(o.maxRadiusPx, (o.radiusKm[p.stage] || 26) * ppk)) * 0.7;
      if (gp.x < -r || gp.y < -r || gp.x > w + r || gp.y > h + r) continue;
      var tint = p.stage === 4 ? [34, 255, 136, 0.12]
               : p.stage === 3 ? [134, 239, 172, 0.09]
               : [251, 191, 36, 0.07];
      var gl = ctx.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, r);
      gl.addColorStop(0, 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ',' + tint[3] + ')');
      gl.addColorStop(1, 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ',0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(gp.x, gp.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    return this;
  }
});

L.fogLayer = function (opts) { return new L.FogLayer(opts); };
