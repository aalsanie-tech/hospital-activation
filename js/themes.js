/* Map presets. Each one sets the page palette (CSS, via <html data-preset>)
   and the terrain + fog palette (JS, because those colours are computed).
   Switch with ?preset=<key>, or set PRESET in js/config.js. */
window.TM_PRESETS = {

  /* deep space — the original look, lifted just off pure black */
  midnight: {
    label: 'Midnight',
    fog: { color: [7, 13, 22], opacity: 0.88 },
    /* conquest 0 → 1 */
    terrain: [
      [0.00, [34, 50, 68]], [0.25, [34, 100, 92]],
      [0.55, [36, 152, 100]], [0.80, [52, 210, 120]], [1.00, [92, 255, 168]]
    ],
    outFill: '#141d29', outLine: '#38506c',
    line: 'rgba(120,215,170,',    lineFull: '#8fffc6'
  },

  /* indigo dusk — atmospheric, the land clearly sits above the sky */
  twilight: {
    label: 'Twilight',
    fog: { color: [18, 18, 46], opacity: 0.8 },
    terrain: [
      [0.00, [58, 66, 104]], [0.25, [52, 116, 124]],
      [0.55, [48, 166, 118]], [0.80, [70, 220, 130]], [1.00, [126, 255, 178]]
    ],
    outFill: '#232a4a', outLine: '#5a5f8f',
    line: 'rgba(150,225,190,',    lineFull: '#a6ffd4'
  },

  /* desert night — warm ground under a cool sky, sand where nothing is won */
  desert: {
    label: 'Desert',
    fog: { color: [28, 20, 16], opacity: 0.82 },
    terrain: [
      [0.00, [86, 68, 50]], [0.25, [104, 96, 54]],
      [0.55, [86, 148, 76]], [0.80, [80, 206, 110]], [1.00, [130, 255, 160]]
    ],
    outFill: '#2a2119', outLine: '#6b5540',
    line: 'rgba(214,196,140,',    lineFull: '#ffe9a8'
  },

  /* command table — a lit tactical surface; the least dark of the four */
  tactical: {
    label: 'Tactical',
    fog: { color: [30, 44, 62], opacity: 0.66 },
    terrain: [
      [0.00, [92, 112, 134]], [0.25, [82, 150, 148]],
      [0.55, [70, 186, 130]], [0.80, [86, 224, 138]], [1.00, [150, 255, 186]]
    ],
    outFill: '#3d4a5c', outLine: '#8199b4',
    line: 'rgba(190,225,205,',    lineFull: '#c9ffe4'
  },

  /* ── Tactical variations ─────────────────────────────────────────── */

  /* brighter table, thinner fog, lighter unconquered ground */
  'tactical-bright': {
    label: 'Tactical · Bright',
    /* fog covers the kingdom only, so the background stays a clean blue and
       Saudi Arabia reads as a grey slab lifted off it */
    fog: { color: [74, 77, 82], opacity: 0.46 },
    fogLandOnly: true,
    terrain: [
      [0.00, [150, 154, 160]], [0.25, [126, 168, 156]],
      [0.55, [96, 206, 150]], [0.80, [112, 236, 158]], [1.00, [176, 255, 204]]
    ],
    outFill: '#80848b', outLine: '#ffffff',
    /* regions outside your territory (Riyadh, Qassim, Eastern): bold white
       dashes, drawn ABOVE the fog so it cannot dim them */
    outBorder: { color: '#ffffff', weight: 2.6, opacity: 0.95, dash: '8 6', aboveFog: true },
    line: 'rgba(232,240,236,',    lineFull: '#e8fff2'
  },

  /* same brightness, more contrast: darker table, crisper edges, richer greens */
  'tactical-sharp': {
    label: 'Tactical · Sharp',
    fog: { color: [20, 30, 44], opacity: 0.7 },
    terrain: [
      [0.00, [88, 106, 128]], [0.25, [60, 150, 150]],
      [0.55, [40, 196, 120]], [0.80, [48, 236, 128]], [1.00, [110, 255, 160]]
    ],
    outFill: '#2c3748', outLine: '#9fb6d0',
    line: 'rgba(225,245,235,',    lineFull: '#ffffff'
  },

  /* neutral steel instead of blue — cleaner, more "instrument" */
  'tactical-steel': {
    label: 'Tactical · Steel',
    fog: { color: [36, 40, 46], opacity: 0.62 },
    terrain: [
      [0.00, [110, 116, 124]], [0.25, [96, 150, 138]],
      [0.55, [80, 186, 124]], [0.80, [94, 222, 134]], [1.00, [156, 255, 182]]
    ],
    outFill: '#454a52', outLine: '#8f98a3',
    line: 'rgba(205,222,212,',    lineFull: '#d8ffe8'
  },

  /* khaki field-map warmth on the same lit table */
  'tactical-sand': {
    label: 'Tactical · Sand',
    fog: { color: [52, 46, 36], opacity: 0.6 },
    terrain: [
      [0.00, [138, 126, 100]], [0.25, [116, 150, 108]],
      [0.55, [88, 184, 110]], [0.80, [92, 220, 128]], [1.00, [160, 255, 176]]
    ],
    outFill: '#5a5140', outLine: '#b0a07e',
    line: 'rgba(236,226,196,',    lineFull: '#f4ffd8'
  }
};
