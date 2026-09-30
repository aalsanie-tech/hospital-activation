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

## Signing in

Each person has their own code. The gate posts `{login: true, passcode}` to
the Apps Script, which answers `{user: {name, role, theme}, previous_login}`.
The phone keeps that `user` in `localStorage` — never the code — so people
stay signed in; **Switch user** in the drawer forgets it and returns to the
gate. No codes, and no hash of one, live in this repository.

From then on every write carries `updated_by: <user.name>` (added in one
place, `postUpdate()`), the user's saved theme is applied, and a change of
theme is sent back as `{save_theme: true, user, theme}`.

**This is attribution, not security.** The page is public on GitHub Pages and
all data is downloaded by the browser, so anyone determined can read it, and
a name in `localStorage` can be edited. Treat the URL as semi-public and
don't put anything in the sheet you couldn't live with leaking.

---

## Agent edit mode

Open a hospital → **Update** → fill the form → **Save**. It posts to the
Apps Script web app in `APPS_SCRIPT_URL` ([`js/config.js`](js/config.js)),
which writes to the "Hospital Activation" tab and returns the stage it
derived. Blank that URL to make the map read-only again — the Update button
disappears with it.

### The contract

`POST` a flat JSON body (sent as `text/plain`, so no CORS preflight — Apps
Script cannot answer one). Every hospital write sends the row's
`hospital_id` (the sheet's Hospital ID column, `H001`…) **and** its
`hospital_name`; the script matches on the ID, refuses a name that is
ambiguous, and refuses a rename that would create a duplicate. Its `error`
text is shown to the agent as-is, in the form and in a toast.

```json
{ "hospital_id": "H017", "hospital_name": "مستشفى الملك فيصل ( الششه)",
  "updated_by": "Abdullah Alshehri",
  "cssd_manager": "…", "phone": "…", "push_adopted": "3", "informed": "Y",
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

**An update is not a visit.** The script turns any row with a Last Visit
Date into `2-Visited`, and the Update form used to send today's date with
every save — so fixing a phone number logged a visit. The form no longer
has Last Visit Date or Visit Log and never sends `last_visit` / `visit_log`;
saving contact details moves a hospital to Contact and no further. Only
**✓ Visited** records a visit.

**Contact means a CSSD manager.** The CSSD Manager cell is what separates
Locked from Contact; people on the Contacts tab alone do not move the stage.

The `—` on each Y/N toggle means "leave the sheet's value alone", so those
keys are omitted unless the agent picked Y or N. Shortage Items is the
exception: clearing every chip sends an empty string and clears the cell.

### Renaming a hospital

The form's first field is the hospital name. `hospital_name` stays the lookup
key (the name as it is now); when the agent changes the field, the new name
goes alongside it as `hospital_name_edit`. It is only sent when it actually
changed, and never blank. After a successful rename the map uses the new
name as the key for the next save.

### Products and the push target

`?action=products` returns `{code, name_ar, name_en, category, moh, nupco}`
for 31 items. The picker groups by `category` (Push / Selective / Inform, in
that order), labels each chip with the Arabic name and its code, and puts
the English name plus the MOH and Nupco numbers in the chip's tooltip.

`Shortage Items` is written as **`name_en — code`**, e.g.
`BI Steam Challenge Pack — KPCD224-C`. Cells written before this — a bare
code, an English name or an Arabic name — still tick the right chip, so
older rows keep working (`aliases` in `normProduct`).

`normProduct()` also accepts the two earlier payload shapes the endpoint has
served, and the picker only groups when `category` actually repeats, so a
future change to the script degrades to a flat list instead of breaking.

`PUSH_TARGET` in [`js/config.js`](js/config.js) mirrors the script's push
target (12 — the same as the number of Push products) and is used only when
the sheet's own `Products Target` cell is blank.

### Contacts

The hospital panel opens with a collapsible **Contacts** section: the CSSD
manager from the hospital row first, then everyone on the sheet's
**Contacts** tab (`Hospital Name, Cluster, City, Role, Name, Phone, Notes`),
read straight from the published CSV — the script has no `?action=contacts`.
Opening a hospital refreshes its contacts from
`?action=contacts&hospital=…` once per session — the CSV keeps the panel
instant, the endpoint keeps it correct — and again right after any change.

* **+ Add contact** → `{hospital_name, add_contact: true, contact_role,
  contact_name, contact_phone, contact_notes}`
* **✕ on a contact** → a confirm step, then
  `{hospital_name, delete_contact: true, contact_role, contact_name}`

Only contacts from the Contacts tab can be deleted; the CSSD manager comes
from the hospital row and is marked as such.

Phone numbers are formatted server-side; `fmtPhone` in `js/app.js` still
restores a dropped leading zero for anything read from the CSV or typed
into a form.

### Leaderboard and badges

**🏆 Progress** under the header opens a stats screen: a scrollable month
selector (last three months, this one, then the rest of the year greyed
out), and a card per agent ranked 🥇🥈🥉 by the share of their hospitals
that are no longer Locked. Each card carries the agent's name, badge icons,
a segmented bar of their stages, that month's transitions and their
all-time totals.

Accent colours inside the panel are blue for contacted and green for
visited, which is deliberate but differs from the map legend, where Visited
is amber.

"This month" counts real transitions from `?action=history&month=YYYY-MM`,
so a hospital that went Locked → Contact → Visited inside one month counts
once as contacted **and** once as visited. While a month has no logged
transitions the strip falls back to counting hospitals by their Last Visit
date and marks every row `est.`, with a note saying so — the numbers are
never silently approximate. The log is re-read after any save that moves a
stage. It reads every agent out of the data, so a fourth agent
appears on their own the day they own a hospital.

History rows carry `updated_by`. A move is credited to **whoever made it**,
not to the hospital's owner; someone who only works other people's hospitals
gets a card showing that month's moves and no territory.

A badge is earned per cluster when **all** of that agent's hospitals in it
pass a stage — First Contact, Field Visit, Foothold, Full Conquest. Badges
stay with the territory's owner whoever did the work. Counts sit beside the
agent's name and tapping one lists its clusters.

When a phone notices a badge that was not there last time, it celebrates and
posts `{log_achievement: true, agent, badge, cluster}` (`badge` is
`blue|orange|green|gold`; the script ignores repeats). On opening the app,
`?action=achievements&since=…` is replayed one banner at a time — "While
you were away: Hamthi earned First Contact · Aseer" — skipping the ones the
reader logged themselves; a tap skips the rest. `since` is the script's
`previous_login` after a real sign-in, or the last time this phone opened
the app when it stayed signed in. A first-ever login replays nothing.

Visit-log entries arrive as `[2026-09-30 · Alshehri] note`; the name is
shown as a chip beside the note, and lines without a stamp are treated as
the rest of the note above them.

### Themes

**Mission** (dark blue, default), **Desert** (warm sand, earth and gold —
markers glow amber, fog is warm brown, fully-won ground turns gold) and
**Saudi** (national green and white, with Arabic region names drawn on the
map). The switcher is in the drawer; the choice is remembered in
localStorage and applies without a reload. Themes are presets in
[`js/themes.js`](js/themes.js) — `ui: 'light'` drives the light chrome,
`regionLabels: true` draws the Arabic names.

Panning is limited to `MAX_BOUNDS` in `js/config.js` (Saudi Arabia plus a
buffer), so the map can't be dragged into empty ocean.

### Filters, urgency and the quick visit

**Class and Agent filters** sit in a row above the stage legend. They define
whose map you are looking at: the header counts, conquest %, province
shading and fog all recompute from the filtered set, so an agent tapping
their own name sees their own progress. Stage and cluster filters stack on
top and only hide pins. Chip counts update against the other filter, so
"Class" counts reflect the agent currently selected.

**Marker size follows Class** — A largest, C smallest (`--cs` in
`css/app.css`, multiplied by the zoom factor `--zs`).

**Urgency rings** come from `Visit Status`: `Aging` draws a steady orange
ring, `Expiring` or `Expired` a pulsing red one. Any `Action Required`
other than `None`/blank turns the hospital's own pin red — same dot, same
size, drawn above the fog even when the hospital is Locked.

**✓ Visited** on the hospital panel logs a visit in one step: a mandatory
one-line note, then Save posts
`{hospital_name, quick_visit: true, visit_note}`. The script stamps the date
and appends it to the Visit Log; the panel lists every entry, newest first,
each on its own dated line (the script appends, so the app reverses the cell
to put the newest on top).

**Visited only works at the hospital.** The form reads the phone's GPS and
keeps Save disabled unless the agent is within `VISIT_RADIUS_KM` (3 km) of
the pin. Pins that are plainly a town centre — coordinates rounded to two
decimals or fewer, or shared with another hospital — use
`VISIT_RADIUS_APPROX_KM` (15 km) instead, because an agent in the right car
park can be kilometres from those. The measured distance is appended to the
note (`… [GPS 0.4 km]`) so visits can be audited in the sheet. This is
enforced in the app, not the script: it stops mis-taps and shortcuts, not
someone posting to the endpoint directly.

### Setting a hospital's location from the field

The Update form shows the hospital's current coordinates and a
**📍 Set to my location** button. Standing at the hospital, one tap records
the phone's GPS fix; it is sent as `latitude` / `longitude` alongside
`hospital_name` on Save, and the pin moves immediately.

* Readings less accurate than ±1 km are refused ("step outside and try again").
* A fix more than 60 km from the listed location needs a second, explicit
  tap ("Yes, I'm at the hospital"), so a tap from the office can't move a
  hospital across the region.
* Nothing is sent unless the button was used.

Tune with `GPS_MAX_ACCURACY_M` and `GPS_FAR_KM` in `js/app.js`. The browser
asks for location permission the first time; GitHub Pages is HTTPS, which
phones require for GPS.

### Editing a Nupco warehouse

Tap a depot → **Update** → Contact Name, Contact Phone, أمين العهدة Name,
أمين العهدة Phone → **Save**:

```json
{ "warehouse_name": "Nupco Jeddah (Maersk)",
  "contact_name": "…", "contact_phone": "…",
  "custody_name": "…", "custody_phone": "…" }
```

Reply: `{"success": true, "row": 3, "updated": [...], "type": "warehouse"}`.
A reply whose `type` is anything other than `warehouse` is shown as an error,
since the same endpoint also writes hospitals. `warehouse_name` must match
the depot's name exactly.

The warehouse list has come back in two shapes (`name`/`lat`/`serves` and
the sheet's own `Warehouse`/`Latitude`/`Serves Clusters` headers); the loader
reads either, so a header rename in that tab won't blank the depots.

### The web app's other endpoints

| GET | Returns |
|---|---|
| `?action=test` | health check + hospital count |
| `?action=products` | the Shortage Items choices (the map loads these on start, falling back to `data/products.json`) |
| `?action=warehouses` | Nupco depots — drawn on the map and editable (see below) |

Check the endpoint from the browser console on the live site:

```js
TM.postUpdate({ hospital_name: '__nope__' })   // → {success:false, error:'Hospital not found: __nope__'}
```

### Cluster offices

`?action=clusters` returns each health cluster's office — `name`, `key`,
`city`, `lat`, `lng`. `key` is the same string the hospitals carry in their
Cluster column, which is how an office is tied to its hospitals. Offices are
drawn as the blue health-cluster emblem above the fog, with their own toggle under the
Nupco one. Because an office is entered at its city's centre — the point the
city's hospitals fan out from, and often the depot's point — it is always
drawn one marker's width off its coordinate, and offices sharing a point
take different corners.

The panel shows the cluster's name, how far its hospitals have come, a
collapsible **Contacts (n)** read from `?action=contacts&site=<name>`, and
**+ Add contact**, which posts `add_contact` with `site_name` = the cluster
name (roles in `CLUSTER_ROLES`); ✕ removes one with `delete_contact` and the
same `site_name`. **Set to my location** posts
`{cluster_name, latitude, longitude}` with the same guards as a hospital:
a weak fix is refused and a far one needs a second tap.
`data/clusters.json` is the offline copy.

### Security

The web app is deployed as "Anyone", which is what lets phones post without
a Google login, and its URL ships inside `js/config.js` on a public Pages
site. **Anyone who reads that JavaScript can write to those columns.** There
is no token on the endpoint. If that matters, add a shared-secret check in
the script and send it from `config.js` — a deterrent, not authentication —
or move writes behind something that can actually authenticate.

## The map's look

Presets live in [`js/themes.js`](js/themes.js). The default is `tactical`, with
four variations — `tactical-bright`, `tactical-sharp`, `tactical-steel`,
`tactical-sand` — plus the earlier `midnight`, `twilight` and `desert`. Each one sets the page palette (CSS, via
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
sign-in. All three are ignored unless the hostname is localhost, so they
cannot reach the field build. They only affect rendering — nothing is
written anywhere.

To regenerate the comparison screenshots:

```bash
python3 -m http.server 8123          # from the repo root
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --force-device-scale-factor=2 --window-size=460,900 --virtual-time-budget=15000 \
  --screenshot=out.png "http://127.0.0.1:8123/index.html?nogate=1&sim=half&preset=twilight"
```

### Pin placement: apart when zoomed out, real location when zoomed in

Hospitals within ~15 km of each other (true geography) form a city group,
computed once per data load. A seed hospital absorbs others near the seed
itself, never near another member, so groups can't chain across a region.

* **Zoom ≤ 7** — each group fans out around its centre, on land, a pin-width
  apart.
* **Zoom 8–10** — each pin slides linearly from its fan spot toward its real
  coordinate.
* **Zoom ≥ 11** — pins sit on their real coordinates. Only hospitals that
  genuinely share a site are nudged apart, by about a pin-width (< 1 km at
  the closest zoom).
* Lone hospitals always sit exactly on their coordinate, island hospitals
  included.

Tune with `STACK_KM`, `FAN_UNTIL` and `TRUE_FROM` in `js/app.js`.

**This is only as accurate as the sheet's Latitude/Longitude.** Many rows
still carry a city-centre coordinate shared by several hospitals, and those
cannot converge on a real location until the sheet has one.

### Nothing is drawn in the sea

Every marker — hospital, depot, cluster office — is placed per zoom level so
that its centre **and** a ring a few pixels round it fall inside a region
polygon (`inlandAt()` / `pullInland()` in `js/app.js`). A point that is on
land but hugging the coast moves a few pixels inland; a point the sheet puts
outside the simplified coastline or border is drawn at the nearest spot
inside it. A hospital on a small island is left on its island rather than
moved to the mainland. Cluster offices, which are drawn a marker's width
off their city-centre point, choose that spot the same way instead of using
a fixed offset.

This is display only: the sheet's coordinates, Directions links and the
Visited distance check all use the real values.

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
js/config.js          feed URL, script URL, map + fog tuning     ← edit this
js/i18n.js            EN/AR strings and the 5 stage definitions
js/fog.js             the fog-of-war canvas layer
js/app.js             CSV parsing, data loading, map, UI
data/missions.json    fallback snapshot
data/regions.geojson  13 Saudi ADM1 regions
data/clusters.json    fallback copy of the cluster offices
tools/                snapshot builder
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
