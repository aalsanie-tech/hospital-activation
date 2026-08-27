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

## Debugging in the field

`window.TM` exposes live state — `TM.missions`, `TM.map`, `TM.source`,
and `TM.reload()` to re-pull the feed without a page refresh.
