# Territory Missions

An interactive fog-of-war map of **197 hospital activation missions** across the
13 Saudi health clusters. Built mobile-first, deployed as a static site on
GitHub Pages, and fed live from a Google Sheet.

---

## How the data flows

```
Google Sheet ("Missions" tab)  ──CSV──▶  the app in the browser
        │                                        │
        │ (fetched on EVERY page load)           │ if that fetch fails
        ▼                                        ▼
  Zapier + Claude backend              data/missions.json (snapshot)
```

* **Primary source** — the published CSV feed, fetched on every page load.
  Rows added or edited in the sheet appear on the next load. No rebuild,
  no redeploy.
* **Fallback** — `data/missions.json`, a snapshot committed to the repo. Used
  only when the live fetch fails (sheet not published, CORS, offline, timeout).
* The header chip in the app shows which one is in use: **LIVE** or **SNAPSHOT**.

### ⚠️ The sheet must be readable without a Google login

Right now the sheet is private, so the browser fetch is blocked by CORS and the
app runs on the snapshot. To switch it to live:

1. Open the sheet → **Share** → **General access** → *Anyone with the link* → **Viewer**.
2. Optionally also **File → Share → Publish to web → "Missions" tab → CSV → Publish**.
3. Reload the app. The chip should read **LIVE**.

If you publish to web and get a different URL, paste it into `LIVE_CSV_URL`
in [`js/config.js`](js/config.js).

Note that either step makes that tab readable by anyone holding the link,
including the CSSD manager names and phone numbers.

### Cluster names

Clusters are matched by a normalised alias, not an exact string — the sheet
has already been re-keyed once from `تجمع مكة المكرمة الصحي` to `مكة`, and
that rename silently un-mapped every province until the aliases went in. Both
spellings now resolve, along with the English names. Add a new spelling to
`CLUSTER_DEFS` in `js/app.js` (and `tools/build_data.py`) if the sheet
changes again. An unrecognised cluster logs a console warning and simply
loses its province shading, rather than guessing.

### Expected CSV columns (in order)

`Hospital Name, Cluster, City, Agent, Stage, CSSD Manager Name,
CSSD Manager Phone, Last Visit Date, Visit Status, Remote, Products Target,
Products Adopted, Adoption %, Notes, Next Step, Next Visit Due, Latitude, Longitude`

Columns are matched **by header name**, not position, so you can reorder or add
columns without breaking the map. Only `Hospital Name`, `Latitude` and
`Longitude` are required for a row to appear.

---

## Stages

| Stage value in the sheet | Shown as | Colour |
|---|---|---|
| `0-Locked` | Locked — under the fog | slate |
| `1-Contact` | Contact | blue glow |
| `2-Visited` | Visited | amber |
| `3-Partial` | Partial adoption | light green |
| `4-Activated` | Fully activated | vivid green + star |

Parsing is lenient: a leading digit wins (`0`, `2-Visited`, `4 – activated`),
otherwise the word is matched. Anything unrecognised is treated as Locked.

As stages rise, fog lifts around each hospital. When a whole province reaches
100%, the fog lifts off the entire province and the terrain turns vivid green.

---

## Access code

The app is behind a client-side passcode. Default: **`territory2030`**

```bash
python3 tools/set_passcode.py "your new code"
```

**This is a deterrent, not security.** The page is public on GitHub Pages and
all data is downloaded by the browser, so anyone determined can read it.
Treat the URL as semi-public and don't put anything in the sheet you couldn't
live with leaking.

---

## Agent edit mode

Open a hospital → **Update** → fill the form → **Save**. It posts to the
Apps Script web app in `APPS_SCRIPT_URL` ([`js/config.js`](js/config.js)),
which writes to the "Hospital Activation" tab and returns the stage it
derived. Blank that URL to make the map read-only again — the Update button
disappears with it.

### The contract

`POST` a flat JSON body (sent as `text/plain`, so no CORS preflight — Apps
Script cannot answer one). `hospital_name` must match column A exactly:

```json
{ "hospital_name": "مستشفى الملك فيصل ( الششه)",
  "cssd_manager": "…", "phone": "…", "last_visit": "2026-09-09",
  "visit_log": "…", "push_adopted": "3", "informed": "Y",
  "has_incubator": "Y", "incubator_serial": "30", "dosing_system": "N",
  "shortage_items": "BT224, GUL Ultra Pouch", "action_required": "None",
  "feedback": "", "next_step": "…" }
```

Reply: `{"success": true, "row": 5, "updated": [...], "stage": "2-Visited"}`
or `{"success": false, "error": "…"}`.

**The script owns Stage and Visit Status.** The form never sends them; it
sends the visit facts and reads the stage back. That stage is applied to the
map immediately — the pin re-colours, the legend and conquest bar update,
and the promoted pin pulses once so the change is visible. The stage is also
shown in the save confirmation.

The `—` on each Y/N toggle means "leave the sheet's value alone", so those
keys are omitted unless the agent picked Y or N. Shortage Items is the
exception: clearing every chip sends an empty string and clears the cell.

### The web app's other endpoints

| GET | Returns |
|---|---|
| `?action=test` | health check + hospital count |
| `?action=products` | the Shortage Items choices (the map loads these on start, falling back to `data/products.json`) |
| `?action=warehouses` | Nupco warehouses with `lat`/`lng` and the clusters each serves — **not used by the map yet** |

Check the endpoint from the browser console on the live site:

```js
TM.postUpdate({ hospital_name: '__nope__' })   // → {success:false, error:'Hospital not found: __nope__'}
```

### Security

The web app is deployed as "Anyone", which is what lets phones post without
a Google login, and its URL ships inside `js/config.js` on a public Pages
site. **Anyone who reads that JavaScript can write to those columns.** There
is no token on the endpoint. If that matters, add a shared-secret check in
the script and send it from `config.js` — a deterrent, not authentication —
or move writes behind something that can actually authenticate.

## The map's look

Four presets live in [`js/themes.js`](js/themes.js): `midnight`, `twilight`,
`desert`, `tactical`. Each one sets the page palette (CSS, via
`<html data-preset>`) and the terrain + fog palette (JS, since those colours
are interpolated per cluster).

Set the default in `PRESET` ([`js/config.js`](js/config.js)), or preview any
of them on the live site without a deploy:

```
…/hospital-activation/?preset=twilight
```

### Design-preview switches (localhost only)

`?sim=half` and `?sim=full` paint deterministic stages over the real data so
a half-won or fully-won map can be judged, and `?nogate=1` skips the
passcode. All three are ignored unless the hostname is localhost, so they
cannot reach the field build. They only affect rendering — nothing is
written anywhere.

To regenerate the comparison screenshots:

```bash
python3 -m http.server 8123          # from the repo root
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --force-device-scale-factor=2 --window-size=460,900 --virtual-time-budget=15000 \
  --screenshot=out.png "http://127.0.0.1:8123/index.html?nogate=1&sim=half&preset=twilight"
```

### Pin spacing

Hospitals in a city share one coordinate in the sheet. Each stack is spread
on a golden-angle spiral measured in **screen pixels** and recomputed on
every zoom, so neighbours stay neighbours at city zoom without stacking into
one dot when you pull back. Pins also scale down below zoom 6. Tune with
`spreadRadius()` in `js/app.js`.

## Deploying to GitHub Pages

```bash
cd ~/territory-missions
git remote add origin https://github.com/<you>/territory-missions.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch `main` / root → Save.** The site appears at
`https://<you>.github.io/territory-missions/` within a minute or two.

Every later change is just `git push`.

---

## Refreshing the fallback snapshot

The snapshot only matters when the live feed is down, but it is worth
refreshing occasionally:

```bash
# export the Missions tab to tools/missions_raw.csv, then:
python3 tools/build_data.py
git commit -am "refresh snapshot" && git push
```

`tools/build_data.py` also rebuilds `data/regions.geojson` from
`tools/sau_adm1_source.geojson` (geoBoundaries ADM1, simplified to ~2,300
vertices so it stays light on mobile).

---

## Layout

```
index.html            shell, gate, HUD, panel markup
css/app.css           all styling (mobile-first, RTL-aware)
js/config.js          feed URL, passcode hash, map + fog tuning   ← edit this
js/i18n.js            EN/AR strings and the 5 stage definitions
js/fog.js             the fog-of-war canvas layer
js/app.js             CSV parsing, data loading, map, UI
data/missions.json    fallback snapshot
data/regions.geojson  13 Saudi ADM1 regions
tools/                snapshot builder + passcode setter
```

## Notes on the data

* Every hospital in a city carries the same city-centre coordinate in the
  sheet, so 90 of the 197 pins would stack into unclickable dots. The app fans
  co-located hospitals into a deterministic golden-angle spiral (~1.5–3 km) so
  each is tappable. The info panel and the Directions link always use the
  **original** coordinate.
* Four clusters (Makkah, Jeddah C1, Jeddah C2, Taif) sit inside Makkah
  province; province shading is the average of all hospitals in it.
* Riyadh, Eastern Province and Qassim carry no missions and render as
  out-of-territory.

## Deep links

Share a specific view or hospital:

```
…/index.html?h=h042                    open that hospital's panel
…/index.html?at=21.5433,39.1728,9      open at a lat,lng,zoom
```

Hospital ids are row order in the sheet (`h001` … `h197`), so they shift if
rows are reordered. For a durable link, prefer `?at=`.

## Debugging in the field

`window.TM` exposes live state — `TM.missions`, `TM.map`, `TM.source`,
and `TM.reload()` to re-pull the feed without a page refresh.
