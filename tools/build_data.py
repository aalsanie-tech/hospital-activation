#!/usr/bin/env python3
"""Build data/missions.json + data/regions.geojson from the Missions CSV
and the geoBoundaries SAU ADM1 source.

Usage:  python3 tools/build_data.py [path/to/missions.csv]
"""
import csv, json, math, sys, os, hashlib, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_IN = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'missions_raw.csv')
GEO_IN = os.path.join(ROOT, 'tools', 'sau_adm1_source.geojson')

# ---- cluster -> administrative region -------------------------------------
# 13 health clusters mapped onto the 13 ADM1 regions of Saudi Arabia.
# Makkah province carries four clusters (Makkah, Jeddah C1, Jeddah C2, Taif).
CLUSTERS = {
    'تجمع مكة المكرمة الصحي':    dict(en='Makkah Cluster',        short='Makkah',      region='SA-02'),
    'تجمع جدة الصحي الأول':      dict(en='Jeddah Cluster 1',      short='Jeddah C1',   region='SA-02'),
    'تجمع جدة الصحي الثاني':     dict(en='Jeddah Cluster 2',      short='Jeddah C2',   region='SA-02'),
    'تجمع الطائف الصحي':         dict(en='Taif Cluster',          short='Taif',        region='SA-02'),
    'تجمع المدينة المنورة الصحي': dict(en='Madinah Cluster',       short='Madinah',     region='SA-03'),
    'تجمع الباحة الصحي':         dict(en='Al Baha Cluster',       short='Baha',        region='SA-11'),
    'تجمع عسير الصحي':           dict(en='Aseer Cluster',         short='Aseer',       region='SA-14'),
    'تجمع جازان الصحي':          dict(en='Jazan Cluster',         short='Jazan',       region='SA-09'),
    'تجمع نجران الصحي':          dict(en='Najran Cluster',        short='Najran',      region='SA-10'),
    'تجمع تبوك الصحي':           dict(en='Tabuk Cluster',         short='Tabuk',       region='SA-07'),
    'تجمع حائل الصحي':           dict(en='Hail Cluster',          short='Hail',        region='SA-06'),
    'تجمع الجوف الصحي':          dict(en='Jouf Cluster',          short='Jouf',        region='SA-12'),
    'تجمع الحدود الشمالية الصحي': dict(en='Northern Borders Cluster', short='N. Borders', region='SA-08'),
}

REGION_NAMES = {
    'SA-01': ('Riyadh', 'الرياض'),            'SA-02': ('Makkah', 'مكة المكرمة'),
    'SA-03': ('Madinah', 'المدينة المنورة'),   'SA-04': ('Eastern Province', 'الشرقية'),
    'SA-05': ('Qassim', 'القصيم'),            'SA-06': ('Hail', 'حائل'),
    'SA-07': ('Tabuk', 'تبوك'),               'SA-08': ('Northern Borders', 'الحدود الشمالية'),
    'SA-09': ('Jazan', 'جازان'),              'SA-10': ('Najran', 'نجران'),
    'SA-11': ('Al Baha', 'الباحة'),           'SA-12': ('Al Jouf', 'الجوف'),
    'SA-14': ('Aseer', 'عسير'),
}

STAGE_BY_RAW = {'0-locked': 0, '1-contact': 1, '2-visited': 2, '3-partial': 3, '4-activated': 4}

def parse_stage(raw):
    r = (raw or '').strip().lower()
    if r in STAGE_BY_RAW:
        return STAGE_BY_RAW[r]
    if r and r[0].isdigit():
        return max(0, min(4, int(r[0])))
    for k, v in STAGE_BY_RAW.items():
        if k.split('-')[1] in r:
            return v
    return 0

def num(v):
    try:
        return float(str(v).strip().replace('%', ''))
    except (TypeError, ValueError):
        return None

# ---- read missions --------------------------------------------------------
with open(CSV_IN, encoding='utf-8-sig') as fh:
    rows = [r for r in csv.DictReader(fh) if (r.get('Hospital Name') or '').strip()]

missions, unknown = [], set()
for i, r in enumerate(rows):
    g = lambda k: (r.get(k) or '').strip()
    cl = g('Cluster')
    meta = CLUSTERS.get(cl)
    if not meta:
        unknown.add(cl)
        meta = dict(en=cl or 'Unassigned', short=cl or '—', region=None)
    lat, lng = num(g('Latitude')), num(g('Longitude'))
    if lat is None or lng is None:
        print(f'  ! skipped (no coords): {g("Hospital Name")}')
        continue
    missions.append({
        'id': 'h%03d' % (i + 1),
        'name': g('Hospital Name'),
        'city': g('City'),
        'cluster': cl,
        'clusterEn': meta['en'],
        'clusterShort': meta['short'],
        'region': meta['region'],
        'stage': parse_stage(g('Stage')),
        'manager': g('CSSD Manager Name'),
        'phone': g('CSSD Manager Phone'),
        'lastVisit': g('Last Visit Date'),
        'visitStatus': g('Visit Status'),
        'remote': g('Remote').lower() in ('yes', 'true', '1', 'نعم'),
        'target': num(g('Products Target')),
        'adopted': num(g('Products Adopted')),
        'adoption': num(g('Adoption %')),
        'agent': g('Agent'),
        'notes': g('Notes'),
        'nextStep': g('Next Step'),
        'nextVisit': g('Next Visit Due'),
        'lat': lat, 'lng': lng,
    })

# ---- de-collide co-located hospitals --------------------------------------
# Every hospital in a city shares one city centroid in the sheet, so without
# this the 17 Makkah pins stack into a single unclickable dot. Deterministic
# golden-angle spiral: same input always yields the same layout.
GOLDEN = math.pi * (3 - math.sqrt(5))
groups = {}
for m in missions:
    groups.setdefault((round(m['lat'], 4), round(m['lng'], 4)), []).append(m)

for (lat, lng), grp in groups.items():
    n = len(grp)
    grp.sort(key=lambda m: m['id'])
    for k, m in enumerate(grp):
        m['stacked'] = n > 1
        if n == 1:
            m['dlat'], m['dlng'] = m['lat'], m['lng']
            continue
        # ring radius grows every 8 pins; ~1.6km base, scaled for latitude
        ring = k // 8
        rad = 0.014 + 0.011 * ring
        ang = k * GOLDEN
        m['dlat'] = round(lat + rad * math.sin(ang), 6)
        m['dlng'] = round(lng + rad * math.cos(ang) / max(0.2, math.cos(math.radians(lat))), 6)

# ---- geometry simplification (Douglas-Peucker) ----------------------------
def perp(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))

def dp(pts, tol):
    if len(pts) < 3:
        return pts
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = perp(pts[i], pts[0], pts[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return dp(pts[:idx + 1], tol)[:-1] + dp(pts[idx:], tol)
    return [pts[0], pts[-1]]

def simplify_ring(ring, tol):
    out = dp([tuple(p) for p in ring], tol)
    if len(out) < 4:
        return None
    if out[0] != out[-1]:
        out.append(out[0])
    return [[round(x, 4), round(y, 4)] for x, y in out]

def simplify_geom(geom, tol):
    t = geom['type']
    if t == 'Polygon':
        rings = [r for r in (simplify_ring(r, tol) for r in geom['coordinates']) if r]
        return {'type': 'Polygon', 'coordinates': rings} if rings else None
    polys = []
    for poly in geom['coordinates']:
        rings = [r for r in (simplify_ring(r, tol) for r in poly) if r]
        if rings:
            polys.append(rings)
    return {'type': 'MultiPolygon', 'coordinates': polys} if polys else None

sys.setrecursionlimit(20000)
src = json.load(open(GEO_IN, encoding='utf-8'))
feats = []
for f in src['features']:
    iso = f['properties'].get('shapeISO')
    en, ar = REGION_NAMES.get(iso, (f['properties'].get('shapeName', iso), ''))
    geom = simplify_geom(f['geometry'], 0.012)
    if not geom:
        continue
    clusters = sorted({v['short'] for v in CLUSTERS.values() if v['region'] == iso})
    feats.append({
        'type': 'Feature',
        'properties': {'iso': iso, 'nameEn': en, 'nameAr': ar,
                       'clusters': clusters, 'inTerritory': bool(clusters)},
        'geometry': geom,
    })

regions = {'type': 'FeatureCollection', 'features': feats}

# ---- write ----------------------------------------------------------------
payload = {
    'generated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'source': 'Google Sheet · Territory Missions — Hospital Activation (Missions tab)',
    'clusters': [dict(ar=k, **v) for k, v in CLUSTERS.items()],
    'regionNames': {k: {'en': v[0], 'ar': v[1]} for k, v in REGION_NAMES.items()},
    'missions': missions,
}
json.dump(payload, open(os.path.join(ROOT, 'data', 'missions.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
json.dump(regions, open(os.path.join(ROOT, 'data', 'regions.geojson'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

pts = sum(len(r) for f in feats for poly in ([f['geometry']['coordinates']] if f['geometry']['type'] == 'Polygon' else f['geometry']['coordinates']) for r in poly)
stacks = sum(1 for g in groups.values() if len(g) > 1)
print(f'missions: {len(missions)}  |  regions: {len(feats)}  |  geo vertices: {pts}')
print(f'co-located city groups fanned out: {stacks}')
if unknown:
    print('UNMAPPED CLUSTERS:', unknown)
by = {}
for m in missions:
    by[m['stage']] = by.get(m['stage'], 0) + 1
print('stage counts:', dict(sorted(by.items())))
