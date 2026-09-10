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
  }
};
