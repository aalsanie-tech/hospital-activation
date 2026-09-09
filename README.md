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

## Turning on edit mode

Agents can update a hospital from the map: open a hospital → **Update** →
fill the form → **Save**. It writes straight back to the "Hospital
Activation" tab. Until the endpoint below is configured the button stays
hidden and the map is read-only.

**1 — Add the script**

Open the sheet → **Extensions → Apps Script** → replace the contents of
`Code.gs` with [`tools/apps-script/Code.gs`](tools/apps-script/Code.gs).

**2 — Set a shared token**

In `Code.gs` change `SHARED_TOKEN` from `change-me` to something private,
and put the identical string in `WRITE_TOKEN` in
[`js/config.js`](js/config.js).

**3 — Check access**

Run the `setup` function once from the Apps Script editor. Approve the
permission prompt. It reports the row count and adds any columns the form
needs that the sheet does not have yet (`Informed`, `Dosing System`, …).

**4 — Deploy**

**Deploy → New deployment → Web app**
* Execute as: **Me**
* Who has access: **Anyone**

Copy the `/exec` URL into `APPS_SCRIPT_URL` in `js/config.js`, then commit
and push. Re-deploy (**Manage deployments → Edit → Version: New**) whenever
you change `Code.gs`.

**Check it from the browser console** on the live site:

```js
TM.postUpdate({ token: TM_CONFIG.WRITE_TOKEN, row: 2,
                hospitalName: TM.missions[0].name,
                updates: { 'Next Step': 'endpoint test' } })
```

`{ok: true, row: 2, updated: [...]}` means it is wired up.

### What the form writes

| Form field | Sheet column |
|---|---|
| CSSD Manager Name | `CSSD Manager Name` |
| Phone | `CSSD Manager Phone` |
| Last Visit Date (defaults to today) | `Last Visit Date` |
| Visit Log | `Visit Log` — prepended as `[date] text`, older entries kept |
| Push Adopted | `Products Adopted` (+ recomputes `Adoption %` when a target exists) |
| Informed / Has Incubator / Dosing System | `Informed` / `Has Incubator` / `Dosing System` |
| Incubator Serial (only when Has Incubator = Y) | `Incubator Serial` |
| Shortage Items | `Shortage Items`, comma separated |
| Action Required | `Action Required` |
| Feedback — Missing Items | `Feedback - Missing Items` |
| Next Step | `Next Step` |

The Y/N toggles have three states; **—** means "leave the sheet alone", so
an agent never overwrites a known value with a guess. Shortage Items is the
exception: clearing every chip clears the cell.

Rows are addressed by sheet row number, and the script re-checks the
hospital name at that row before writing. If rows were sorted or inserted
in the meantime it searches by name + cluster instead, and refuses rather
than guesses when that is ambiguous.

**Edit mode does not change Stage.** A visit logged from the field will not
turn a pin from blue to amber — stage stays under your control in the sheet.

**The write endpoint is public.** "Who has access: Anyone" is what lets
phones post to it without a Google login; the token ships inside
`js/config.js`, so it stops drive-by writes but is not authentication.
Anyone who reads the deployed JavaScript can write to those columns. Rotate
the token by changing both files and re-deploying.

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
