/* Territory Missions — configuration
   Edit this file to change the access code, the live data feed, or map defaults. */
window.TM_CONFIG = {

  /* ── Live data feed (primary source) ───────────────────────────────────
     The app fetches this CSV on EVERY page load. Rows added or edited in
     the Google Sheet (by hand, or by the Zapier + Claude backend) show up
     on the next load — no rebuild, no redeploy.

     data/missions.json is only a fallback, used when this fetch fails
     (sheet not published, CORS, offline, network error).

     REQUIREMENT: the sheet must be readable without a Google login —
     Share → General access → "Anyone with the link" = Viewer
     (and/or File → Share → Publish to web → Missions tab → CSV).        */
  LIVE_CSV_URL: 'https://docs.google.com/spreadsheets/d/1HBRcW_MYKdNy-YOjAbpMvYtx7wthTbPTAPlhV4uCKE8/gviz/tq?tqx=out:csv&gid=1970597427',

  /* Cache-bust the CSV so phones don't serve a stale copy */
  CSV_CACHE_BUST: true,
  /* Give up on the live feed after this many ms and use the snapshot */
  CSV_TIMEOUT_MS: 8000,

  SNAPSHOT_URL: 'data/missions.json',
  REGIONS_URL: 'data/regions.geojson',

  /* ── Access gate ───────────────────────────────────────────────────────
     SHA-256 of the access code. Default code: territory2030
     Change it with:  python3 tools/set_passcode.py "your new code"
     NOTE: a deterrent, not real security — the data is downloaded by the
     browser, so anyone determined can read it. Don't treat the URL as
     confidential.                                                        */
  PASSCODE_SHA256: 'a675f3f1a7c1fd64404115b8dfdfa0595a553cfcd7a0422270ac34ca397ef53d',
  GATE_ENABLED: true,

  /* ── Agent edit mode (writes back to the sheet) ────────────────────────
     Paste the /exec URL you get from deploying tools/apps-script/Code.gs
     (see README → "Turning on edit mode"). Until it is set, the Update
     button stays hidden and the map is read-only.                        */
  APPS_SCRIPT_URL: '',

  /* Must match SHARED_TOKEN in Code.gs. It ships in this file, so it only
     stops drive-by writes — it is not authentication. */
  WRITE_TOKEN: 'change-me',

  SAVE_TIMEOUT_MS: 20000,

  /* Shortage Items choices — read live from the Product Reference tab,
     falling back to data/products.json. */
  PRODUCTS_CSV_URL: 'https://docs.google.com/spreadsheets/d/1HBRcW_MYKdNy-YOjAbpMvYtx7wthTbPTAPlhV4uCKE8/gviz/tq?tqx=out:csv&headers=1&sheet=Product%20Reference',
  PRODUCTS_FALLBACK_URL: 'data/products.json',

  ACTION_OPTIONS: ['None', 'Broken Device', 'Training Needed', 'Product Complaint', 'Urgent Follow-up'],

  /* ── Map ───────────────────────────────────────────────────────────────*/
  CENTER: [23.5, 42.6],
  ZOOM: 5,
  MIN_ZOOM: 4,
  MAX_ZOOM: 12,

  /* Fog tuning — km of terrain cleared around a hospital, per stage */
  FOG_RADIUS_KM: { 1: 26, 2: 42, 3: 62, 4: 95 },
  FOG_OPACITY: 0.9
};
