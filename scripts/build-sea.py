#!/usr/bin/env python3
"""
Builds data/<sea>.source.json — the layout of data/baltic.source.json — for another sea, straight
from HydroSHEDS and Natural Earth:

    sh data/raw/download.sh            (HydroBASINS lev12, HydroRIVERS af, Natural Earth, GeoNames)
    + GHSL population grid in data/raw/ghsl_pop_2025/ (optional: basin populations)
    python -I scripts/build-sea.py north|black|caspian|med

Then `node scripts/build-data.mjs <sea>` turns it into the web files.

How a sea's drainage basin is found
  · Every HydroRIVERS outlet (NEXT_DOWN = 0) whose mouth lies within a few km of the sea's water
    (Natural Earth ocean inside a rough polygon of the sea; for the Caspian: the water inside its
    polygon that is not land) and inside that polygon drains to the sea. Its sub-basin is the first
    of the sea's sub-basin polygons that holds the mouth.
  · A river system = all reaches with that outlet as MAIN_RIV. Its catchment = the HydroBASINS
    level-12 units whose largest reach belongs to it; units without reaches follow NEXT_DOWN to a
    unit that has one, and coastal units without any go to the coastal strip of their sub-basin.
  · Catchments are simplified as one coverage (shared borders stay shared).
  · Names: Wikidata rivers whose mouth (P403) is the sea or a part of it, matched to an outlet by
    their mouth coordinates (snapshot in data/wikidata/<sea>.csv); otherwise Natural Earth river
    lines (name_pl / name_en) along the lower half of the main stem; places:
    the nearest GeoNames town (≥ 1000 people) to the mouth; countries: Natural Earth admin-0
    (NAME_PL / NAME_EN); population: GHSL GHS-POP 2025 (JRC), summed per catchment.
  · Rivers: the HydroRIVERS lines, smoothed (two Chaikin passes) and simplified (Douglas–Peucker
    80 m) as in scripts/build-rivers.py; size class = 7 − ORD_FLOW (≥ 1000 m³/s → class 4).
  · `clip_lat` (Mediterranean): reaches and units south of it are left out — the Nile is shown in
    Egypt only, without its upstream basin.
  · `lake_water` (North Sea): the Natural Earth lakes inside this box count as the sea's water —
    the IJsselmeer and Markermeer, which drain through the Afsluitdijk sluices into the Wadden Sea;
    HydroRIVERS ends the IJssel, the Vecht and the polder rivers there, 25–55 km from open water.
  · `delta_water` (North Sea): a rough outline of estuary water Natural Earth draws as land — the
    Haringvliet, Hollands Diep and Volkerak, where HydroRIVERS ends the Meuse and the Mark–Dintel.
    Used only to find mouths (all outlets there reach the North Sea), never drawn.
"""
import base64, json, math, sys, time
from pathlib import Path

import numpy as np
import pandas as pd
import geopandas as gpd
import pyogrio
import shapely
from shapely.geometry import Point, Polygon, box
from shapely.ops import polylabel
from pyproj import Geod

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data/raw'
HYDRORIVERS = {
    'eu': ROOT / 'data/hydrorivers/HydroRIVERS_v10_eu_shp/HydroRIVERS_v10_eu.shp',
    'af': RAW / 'hydrorivers_af/HydroRIVERS_v10_af_shp/HydroRIVERS_v10_af.shp',
}
HYBAS = {'eu': RAW / 'hybas_eu_lev12/hybas_eu_lev12_v1c.shp', 'af': RAW / 'hybas_af_lev12/hybas_af_lev12_v1c.shp'}
NE = lambda name: RAW / name / f'{name}.shp'
GHSL = RAW / 'ghsl_pop_2025/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif'

# ─── seas ────────────────────────────────────────────────────────────────────
# `poly`: a rough outline of the sea (generous over land; only its water counts). `subs`: tested in
# order, the first polygon holding a mouth wins (the last is the fallback); `lbl`: sea-name position.
SEAS = {
    'north': dict(
        read=(-6.0, 45.5, 17.5, 62.5), tiles=['eu'], water='ocean', tol_km=12, lake_water=(5.0, 52.2, 6.1, 53.1),
        delta_water=[(3.95, 51.62), (4.75, 51.62), (4.75, 51.86), (3.95, 51.86)],
        poly=[(-3.40, 58.70), (-3.00, 59.30), (-1.80, 60.10), (-1.00, 61.00), (13.0, 61.0), (13.0, 58.20), (11.45, 57.90),
              (10.60, 57.73), (10.2, 57.4), (9.6, 56.8), (9.4, 56.0), (9.3, 55.4), (9.15, 54.8), (9.5, 54.3), (10.0, 53.7),
              (10.5, 51.0), (3.0, 50.8), (1.92, 50.99), (1.40, 51.17), (1.0, 51.15), (0.0, 51.2), (-1.5, 51.5), (-2.4, 52.5),
              (-2.6, 53.6), (-2.75, 54.4), (-2.9, 55.0), (-3.3, 55.6), (-3.9, 56.0), (-4.3, 56.3), (-4.4, 57.0), (-4.6, 57.5),
              (-4.4, 58.0)],
        subs=[
            dict(pl='Skagerrak', en='Skagerrak', lbl=(9.2, 57.95), poly=[(7.0, 57.6), (13.0, 57.6), (13.0, 61.0), (7.0, 61.0)]),
            dict(pl='Północna część Morza Północnego', en='Northern North Sea', lbl=(2.0, 59.2), poly=[(-6.0, 56.0), (7.0, 56.0), (7.0, 61.5), (-6.0, 61.5)]),
            # with the IJsselmeer and Markermeer, which empty into the Wadden Sea
            dict(pl='Zatoka Niemiecka i Morze Wattowe', en='German Bight & Wadden Sea', lbl=(7.3, 54.6),
                 poly=[(4.6, 52.9), (5.0, 52.9), (5.0, 52.2), (6.2, 52.2), (6.2, 52.9), (13.0, 52.9), (13.0, 57.6), (4.6, 57.6)]),
            dict(pl='Południowa część Morza Północnego', en='Southern North Sea', lbl=(2.7, 52.4), poly=[(-0.2, 50.5), (13.0, 50.5), (13.0, 52.9), (0.5, 52.9), (0.5, 51.95), (-0.2, 51.95)]),  # with the Thames estuary
            dict(pl='Zachodnia część Morza Północnego', en='Western North Sea', lbl=(0.6, 54.9), poly=[(-6.0, 50.5), (4.6, 50.5), (4.6, 56.0), (-6.0, 56.0)]),
        ]),
    'black': dict(
        read=(7.5, 39.0, 49.0, 57.5), tiles=['eu'], water='ocean', tol_km=12,
        poly=[(27.2, 42.0), (27.0, 44.0), (28.0, 46.5), (31.0, 47.2), (35.0, 47.4), (39.6, 47.6), (40.2, 46.5), (42.5, 43.8),
              (42.5, 41.0), (36.0, 40.8), (31.0, 40.8), (29.3, 41.12), (28.9, 41.22), (28.0, 41.5)],
        subs=[
            dict(pl='Morze Azowskie', en='Sea of Azov', lbl=(36.6, 46.1), poly=[(34.8, 45.25), (40.5, 45.25), (40.5, 48.0), (34.8, 48.0)]),
            dict(pl='Szelf północno-zachodni', en='North-western shelf', lbl=(31.2, 45.4), poly=[(26.5, 44.25), (33.8, 44.25), (33.8, 48.0), (26.5, 48.0)]),
            dict(pl='Wschodnia część (Kaukaz)', en='Eastern Black Sea (Caucasus)', lbl=(39.3, 42.8),
                 poly=[(37.5, 42.0), (37.5, 45.25), (43.0, 45.25), (43.0, 40.5), (40.0, 40.5), (40.0, 42.0)]),
            dict(pl='Zachodnia część', en='Western Black Sea', lbl=(29.6, 43.2), poly=[(26.5, 40.5), (29.0, 40.5), (29.0, 44.25), (26.5, 44.25)]),
            dict(pl='Południowa część (Anatolia)', en='Southern Black Sea (Anatolia)', lbl=(34.2, 42.4), poly=[(29.0, 40.0), (40.0, 40.0), (40.0, 42.0), (29.0, 42.0)]),
        ]),
    'caspian': dict(
        read=(32.0, 34.5, 63.0, 62.8), tiles=['eu'], water='inland', tol_km=35,
        poly=[(46.2, 47.6), (54.8, 47.6), (54.8, 36.4), (48.6, 36.4), (48.0, 38.5), (46.2, 41.5)],
        subs=[
            dict(pl='Północny Kaspij', en='North Caspian', lbl=(49.6, 45.6), poly=[(44.0, 44.4), (56.0, 44.4), (56.0, 48.5), (44.0, 48.5)]),
            dict(pl='Środkowy Kaspij', en='Middle Caspian', lbl=(50.6, 42.6), poly=[(44.0, 40.6), (56.0, 40.6), (56.0, 44.4), (44.0, 44.4)]),
            dict(pl='Południowy Kaspij', en='South Caspian', lbl=(51.0, 38.7), poly=[(44.0, 35.0), (56.0, 35.0), (56.0, 40.6), (44.0, 40.6)]),
        ]),
    'med': dict(
        read=(-6.6, 21.5, 39.5, 48.5), tiles=['eu', 'af'], water='ocean', tol_km=12, clip_lat=22.0,
        poly=[(-5.95, 35.0), (-5.95, 37.2), (-4.0, 41.0), (-1.5, 42.8), (0.5, 43.2), (3.0, 45.0), (7.0, 46.6), (10.5, 47.0),
              (14.0, 47.0), (19.0, 46.0), (23.0, 43.0), (26.0, 42.3), (27.2, 41.6), (28.9, 41.22), (29.3, 41.12), (31.0, 40.8),
              (36.0, 40.0), (38.5, 37.5), (37.5, 33.0), (35.5, 31.0), (34.0, 30.7), (32.6, 30.65), (25.0, 29.5), (10.0, 30.0),
              (-2.0, 34.0)],
        subs=[
            dict(pl='Morze Adriatyckie', en='Adriatic Sea', lbl=(15.2, 43.0),
                 poly=[(11.0, 46.6), (15.0, 46.6), (20.6, 42.6), (20.4, 40.0), (20.0, 39.7), (18.37, 39.79), (18.2, 40.3), (17.5, 40.6),
                       (16.4, 41.0), (15.2, 41.6), (13.6, 42.6), (11.6, 43.8), (11.0, 44.3)]),
            dict(pl='Morze Tyrreńskie', en='Tyrrhenian Sea', lbl=(12.2, 39.9),
                 poly=[(9.45, 37.9), (9.45, 42.85), (11.3, 42.85), (12.6, 42.4), (14.0, 41.6), (15.4, 40.7), (16.1, 39.6), (16.1, 38.6),
                       (15.66, 38.26), (15.7, 37.9)]),
            dict(pl='Morze Egejskie i Marmara', en='Aegean & Marmara', lbl=(25.0, 38.9),
                 poly=[(22.0, 41.5), (27.2, 41.6), (28.9, 41.22), (29.3, 41.12), (31.0, 40.8), (31.0, 39.0), (28.2, 37.2), (28.0, 36.6),
                       (26.3, 35.25), (23.5, 35.4), (23.0, 36.4), (22.6, 37.2), (23.0, 38.1), (22.6, 38.9), (21.5, 40.0), (21.5, 40.5)]),
            dict(pl='Morze Lewantyńskie', en='Levantine Sea', lbl=(31.0, 33.6),
                 poly=[(28.2, 37.3), (38.5, 37.5), (37.5, 33.0), (35.5, 31.0), (34.0, 30.7), (32.6, 30.65), (26.0, 29.5), (26.0, 35.25), (28.0, 36.6)]),
            dict(pl='Basen zachodni', en='Western basin', lbl=(3.6, 38.9),
                 poly=[(-6.5, 34.5), (9.45, 34.5), (9.45, 42.85), (11.0, 42.85), (11.0, 46.5), (-6.5, 46.5)]),
            dict(pl='Morze Jońskie i środkowe', en='Ionian & Central Med.', lbl=(18.3, 35.8),
                 poly=[(9.45, 29.0), (26.0, 29.0), (26.0, 40.6), (9.45, 40.6)]),
        ]),
}

SEA = sys.argv[1]
C = SEAS[SEA]
GEOD = Geod(ellps='WGS84')
T0 = time.time()
sys.stdout.reconfigure(encoding="utf-8")
log = lambda *a: print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)
READ = C['read']
SEA_POLY = Polygon(C['poly'])
SUB_POLYS = [Polygon(s['poly']) for s in C['subs']]
CLIP = C.get('clip_lat')

# ─── HydroRIVERS ─────────────────────────────────────────────────────────────
cols = ['HYRIV_ID', 'NEXT_DOWN', 'MAIN_RIV', 'LENGTH_KM', 'DIST_UP_KM', 'UPLAND_SKM', 'DIS_AV_CMS', 'ORD_FLOW', 'HYBAS_L12']
riv = pd.concat([pyogrio.read_dataframe(HYDRORIVERS[t], bbox=READ, columns=cols) for t in C['tiles']], ignore_index=True)
riv = riv.drop_duplicates('HYRIV_ID').reset_index(drop=True)
coords = [np.asarray(g.coords if g.geom_type == 'LineString' else [c for part in g.geoms for c in part.coords]) for g in riv.geometry]
riv['mid_lat'] = [c[len(c) // 2, 1] for c in coords]
log(f'HydroRIVERS: {len(riv)} reaches in the read box')

# ─── the sea's water ─────────────────────────────────────────────────────────
land_all = gpd.read_file(NE('ne_10m_land'), bbox=READ)
land_u = shapely.union_all(land_all.geometry.values)
if C['water'] == 'ocean':
    ocean = gpd.read_file(NE('ne_10m_ocean'), bbox=READ)
    water = shapely.intersection(shapely.union_all(ocean.geometry.values), SEA_POLY)
else:
    water = shapely.difference(SEA_POLY, land_u)
if C.get('lake_water'):
    lb = box(*C['lake_water'])
    lk_w = pd.concat([gpd.read_file(NE(n), bbox=lb.bounds) for n in ('ne_10m_lakes', 'ne_10m_lakes_europe')], ignore_index=True)
    lw = shapely.union_all([shapely.make_valid(g) for g in lk_w.geometry.values if g is not None and g.intersects(lb)])
    water = shapely.union_all([water, shapely.intersection(lw, lb)])
    log(f'lakes counted as the sea: {shapely.intersection(lw, lb).area:.2f} deg²')
if C.get('delta_water'):
    water = shapely.union_all([water, Polygon(C['delta_water'])])
water = shapely.make_valid(water)
K = math.cos(math.radians((READ[1] + READ[3]) / 2))
scale = lambda geom: shapely.transform(geom, lambda xy: xy * np.array([K, 1.0]))
water_s = scale(water)
shapely.prepare(water_s)
sub_water_s = [scale(shapely.intersection(water, p)) for p in SUB_POLYS]
log(f'water: {water.area:.1f} deg²')

def sub_of(lon, lat):
    pt = Point(lon, lat)
    for i, p in enumerate(SUB_POLYS):
        if p.contains(pt):
            return i
    ps = scale(pt)
    return int(np.argmin([ps.distance(w) if not w.is_empty else 1e9 for w in sub_water_s]))

# ─── outlets that drain to this sea ──────────────────────────────────────────
tol = C['tol_km'] / 111.0
out_idx = np.flatnonzero(riv.NEXT_DOWN.values == 0)
mouths = {}
for i in out_idx:
    lon, lat = coords[i][-1]
    if CLIP and lat < CLIP:
        continue
    if not SEA_POLY.contains(Point(lon, lat)):
        continue
    if water_s.distance(scale(Point(lon, lat))) > tol:
        continue
    mouths[int(riv.HYRIV_ID[i])] = (float(lon), float(lat), sub_of(lon, lat), i)
log(f'outlets to the sea: {len(mouths)}')

sel = riv.MAIN_RIV.isin(mouths.keys()).values
if CLIP:
    sel &= riv.mid_lat.values >= CLIP
log(f'reaches in those systems: {int(sel.sum())}')

# ─── HydroBASINS level 12 → catchments ───────────────────────────────────────
bas = pd.concat([pyogrio.read_dataframe(HYBAS[t], bbox=READ, columns=['HYBAS_ID', 'NEXT_DOWN', 'COAST', 'SUB_AREA']) for t in C['tiles']], ignore_index=True)
bas = bas.drop_duplicates('HYBAS_ID').reset_index(drop=True)
log(f'HydroBASINS lev12: {len(bas)} units')
# system of each unit: the MAIN_RIV of its largest reach (over all reaches, selected or not)
top = riv.loc[riv.groupby('HYBAS_L12').UPLAND_SKM.idxmax(), ['HYBAS_L12', 'MAIN_RIV']]
unit_sys = dict(zip(top.HYBAS_L12.astype(np.int64), top.MAIN_RIV.astype(np.int64)))
nxt = dict(zip(bas.HYBAS_ID.astype(np.int64), bas.NEXT_DOWN.astype(np.int64)))

def system_of(uid):
    seen = 0
    while uid and seen < 10000:
        s = unit_sys.get(uid)
        if s is not None:
            return s
        uid = nxt.get(uid, 0); seen += 1
    return None

reps = shapely.point_on_surface(bas.geometry.values)
rep_xy = shapely.get_coordinates(reps)
unit_group = {}   # HYBAS_ID → outlet id (river system) or ('coast', sub)
for k, uid in enumerate(bas.HYBAS_ID.astype(np.int64)):
    if CLIP and rep_xy[k, 1] < CLIP:
        continue
    s = system_of(int(uid))
    if s is not None:
        if s in mouths:
            unit_group[int(uid)] = s
        continue
    if bas.COAST.values[k] == 1 or nxt.get(int(uid), 0) == 0:
        x, y = rep_xy[k]
        if SEA_POLY.contains(Point(x, y)) and water_s.distance(scale(Point(x, y))) < tol * 2:
            unit_group[int(uid)] = ('coast', sub_of(x, y))
log(f'units in the drainage basin: {len(unit_group)}')

# systems that own no unit join the system owning the unit their reaches lie in
owners = {}
for uid, g in unit_group.items():
    owners.setdefault(g, []).append(uid)
reach_group = np.full(len(riv), None, dtype=object)
for i in np.flatnonzero(sel):
    m = int(riv.MAIN_RIV[i])
    if m in owners:
        reach_group[i] = m
    else:
        g = unit_group.get(int(riv.HYBAS_L12[i]))
        if g is not None and not isinstance(g, tuple):
            reach_group[i] = g
kept = np.array([g is not None for g in reach_group])
log(f'reaches kept: {int(kept.sum())}, river systems with a catchment: {sum(1 for g in owners if not isinstance(g, tuple))}')

# ─── catchment polygons (one coverage, simplified together) ──────────────────
geom_of = dict(zip(bas.HYBAS_ID.astype(np.int64), bas.geometry.values))
keys = sorted(owners.keys(), key=lambda g: (isinstance(g, tuple), str(g)))
polys = [shapely.make_valid(shapely.union_all([geom_of[u] for u in owners[g]])) for g in keys]
log('catchments merged')
cov = shapely.coverage_simplify(np.array(polys, dtype=object), 0.004, simplify_boundary=True)
cov = [shapely.make_valid(p) for p in cov]
log('coverage simplified')

def area_km2(g):
    return abs(GEOD.geometry_area_perimeter(shapely.orient_polygons(g))[0]) / 1e6

# ─── river stats per system ──────────────────────────────────────────────────
up_of = riv.UPLAND_SKM.values
by_next = {}
for i in np.flatnonzero(kept):
    by_next.setdefault(int(riv.NEXT_DOWN[i]), []).append(i)
row_of = {int(riv.HYRIV_ID[i]): i for i in np.flatnonzero(kept)}

def main_stem(outlet_row):
    """Reach rows from the mouth upstream, always into the largest tributary."""
    rows, cur = [], outlet_row
    while cur is not None and len(rows) < 20000:
        rows.append(cur)
        ups = by_next.get(int(riv.HYRIV_ID[cur]), [])
        cur = max(ups, key=lambda j: up_of[j]) if ups else None
    return rows

groups = []
for g, poly in zip(keys, cov):
    if poly.is_empty:
        continue
    pa = area_km2(poly)
    if isinstance(g, tuple):
        groups.append(dict(key=g, kind='coast', sub=g[1], poly=poly, parea=pa))
        continue
    lon, lat, sub, orow = mouths[g]
    rows = np.flatnonzero(reach_group == g)
    stem = main_stem(orow)
    clipped = CLIP is not None and bool((riv.mid_lat.values[riv.MAIN_RIV.values == g] < CLIP).any())
    groups.append(dict(
        key=g, kind='basin', sub=sub, poly=poly, parea=pa, mouth=(lon, lat), orow=orow, rows=rows, stem=stem,
        area=pa if clipped else float(riv.UPLAND_SKM[orow]),
        dis=float(riv.DIS_AV_CMS[orow]), nreach=int(len(rows)), rkm=float(riv.LENGTH_KM.values[rows].sum()),
        len=float(sum(riv.LENGTH_KM.values[j] for j in stem)) if clipped else float(riv.DIST_UP_KM[orow]),
        clipped=bool(clipped)))
groups.sort(key=lambda d: (d['kind'] == 'coast', -(d.get('area') or d['parea'])))
log(f'groups: {sum(d["kind"] == "basin" for d in groups)} basins, {sum(d["kind"] == "coast" for d in groups)} coastal strips')

# ─── names: Wikidata (by mouth), then Natural Earth (along the lower main stem) ─
WD_ROOTS = {'north': ['Q1693', 'Q1695'], 'black': ['Q166', 'Q35000'], 'caspian': ['Q5484'], 'med': ['Q4918']}
WD_MOUTH = 'Q1233637'

def sparql(q):
    import urllib.parse, urllib.request
    req = urllib.request.Request('https://query.wikidata.org/sparql', data=urllib.parse.urlencode({'query': q}).encode(),
                                 headers={'Accept': 'text/csv', 'User-Agent': 'watershed-data-build/1.0 (river basin visualisation)'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read().decode('utf-8')

def wikidata_rivers():
    cache = ROOT / f'data/wikidata/{SEA}.csv'  # committed snapshot: rebuilds give the same names
    if not cache.exists():
        roots = ' '.join(f'wd:{q}' for q in WD_ROOTS[SEA])
        parts = sparql(f'''SELECT DISTINCT ?x WHERE {{ VALUES ?r {{ {roots} }}
          {{ ?x wdt:P361 ?r }} UNION {{ ?x wdt:P361/wdt:P361 ?r }}
          UNION {{ ?x wdt:P403 ?r . FILTER NOT EXISTS {{ ?x wdt:P31 wd:Q4022 }} }} }}''')
        qids = set(WD_ROOTS[SEA]) | {l.rsplit('/', 1)[1].strip() for l in parts.splitlines()[1:] if '/entity/' in l}
        rows = sparql(f'''SELECT DISTINCT ?river ?en ?pl ?mouth ?coord ?links ?area WHERE {{
          VALUES ?m {{ {' '.join('wd:' + q for q in sorted(qids))} }}
          ?river wdt:P403 ?m .
          OPTIONAL {{ ?river wikibase:sitelinks ?links }}
          OPTIONAL {{ ?river wdt:P2053 ?area }}
          OPTIONAL {{ ?river p:P625 ?st . ?st ps:P625 ?mouth . ?st pq:P518 wd:{WD_MOUTH} . }}
          OPTIONAL {{ ?river wdt:P625 ?coord }}
          OPTIONAL {{ ?river rdfs:label ?en FILTER(lang(?en) = "en") }}
          OPTIONAL {{ ?river rdfs:label ?pl FILTER(lang(?pl) = "pl") }} }}''')
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(rows, encoding='utf-8')
        log(f'Wikidata: {len(qids)} water bodies, {len(rows.splitlines()) - 1} river rows')
    import csv, re
    pt = lambda w: tuple(map(float, re.findall(r'[-0-9.]+', w)[:2])) if w else None
    tidy_en = lambda v: re.sub(r'^River |\s+(River|river)$', '', v).strip() if v else None
    tidy_pl = lambda v: re.sub(r'\s*\((rzeka|dopływ.*|.*rzeka.*)\)$', '', v).strip() if v else None
    out = {}
    for r in csv.DictReader(cache.read_text(encoding='utf-8').splitlines()):
        d = out.setdefault(r['river'], dict(en=tidy_en(r['en']), pl=tidy_pl(r['pl']), links=int(r.get('links') or 0), area=None, mouth=set(), coord=set()))
        if r.get('area'):
            try: d['area'] = max(d['area'] or 0, float(r['area']))
            except ValueError: pass
        if r['mouth']: d['mouth'].add(pt(r['mouth']))
        if r['coord']: d['coord'].add(pt(r['coord']))
    return out

wd = wikidata_rivers()
import re
m_ids = np.array(list(mouths.keys()))
m_lon = np.radians([mouths[k][0] for k in m_ids]); m_lat = np.radians([mouths[k][1] for k in m_ids])
# Each Wikidata river goes to one outlet (mouth coordinate within 15 km, any other coordinate within
# 3 km): the one whose upstream area best matches the river's drainage area (P2053) when Wikidata
# has it, otherwise the nearest. An outlet with several takes the best known (most Wikipedia
# sitelinks): the Rhine rather than the Scheur channel at its mouth.
m_up = np.array([float(riv.UPLAND_SKM[mouths[k][3]]) for k in m_ids])
cands = {}
for qid, d in wd.items():
    if not (d['en'] or d['pl']) or re.search(r'watershed|catchment|drainage|basin|vassdrag', f"{d['en']} {d['pl']}", re.I):
        continue
    best = None
    for pts, limit in ((d['mouth'], 15.0), (d['coord'] - d['mouth'], 3.0)):
        for lon, lat in pts:
            la, lo = math.radians(lat), math.radians(lon)
            h = np.sin((m_lat - la) / 2) ** 2 + np.cos(la) * np.cos(m_lat) * np.sin((m_lon - lo) / 2) ** 2
            dist_all = 2 * 6371 * np.arcsin(np.sqrt(h))
            near = np.flatnonzero(dist_all <= limit)
            if not len(near):
                continue
            if d['area']:
                cost = np.abs(np.log(m_up[near] / d['area'])) + dist_all[near] / limit * 0.3
            else:
                cost = dist_all[near]
            k = int(near[np.argmin(cost)]); dist = float(dist_all[k])
            if best is None or dist < best[1] or d['area']:
                best = (int(m_ids[k]), dist)
    if best:
        cands.setdefault(best[0], []).append((d['links'], -best[1], qid))
best_at = {o: [q for _, _, q in sorted(c, reverse=True)] for o, c in cands.items()}
log(f'Wikidata rivers matched to outlets: {sum(len(c) for c in best_at.values())} at {len(best_at)} outlets')

ner = pd.concat([gpd.read_file(NE(n), bbox=READ) for n in ('ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe')], ignore_index=True)
ner = ner[ner.geometry.notna()].explode(index_parts=False).reset_index(drop=True)
ner_tree = shapely.STRtree(ner.geometry.values)
clean = lambda v: v.strip() if isinstance(v, str) and v.strip() else None
names_en = {}
used = set()
for d in groups:
    d['name'] = None
    if d['kind'] != 'basin' or d['area'] < 150:
        continue
    for qid in best_at.get(d['key'], []):
        w = wd[qid]
        pl, en = w['pl'] or w['en'], w['en'] or w['pl']
        if pl not in used:
            d['name'] = pl; names_en[pl] = en; used.add(pl)
            break
    if d['name']:
        continue
    # the lower half of the main stem: a river's name is the one it has where it reaches the sea
    lens = np.cumsum([riv.LENGTH_KM.values[j] for j in d['stem']])
    lower = [j for j, L in zip(d['stem'], lens) if L <= max(lens[-1] * 0.5, lens[0])]
    stem_u = shapely.union_all([riv.geometry.values[j] for j in lower])
    stem_len = stem_u.length
    buf = stem_u.buffer(0.025)
    score = {}
    for j in ner_tree.query(buf):
        ov = ner.geometry.values[j].intersection(buf).length
        if ov <= 0:
            continue
        r = ner.iloc[j]
        en = clean(r.get('name_en')) or clean(r.get('name'))
        pl = clean(r.get('name_pl')) or en
        if not en:
            continue
        score[(pl, en)] = score.get((pl, en), 0) + ov
    best = sorted(score.items(), key=lambda kv: -kv[1])
    d['name'] = None
    for (pl, en), ov in best:
        if ov < max(0.04, 0.3 * stem_len) or pl in used:
            continue
        d['name'] = pl; names_en[pl] = en; used.add(pl)
        break
log(f'named rivers: {len(used)}')

# ─── nearest town to each mouth ──────────────────────────────────────────────
gn = pd.read_csv(RAW / 'geonames_cities1000/cities1000.txt', sep='\t', header=None, usecols=[1, 4, 5, 8, 14], quoting=3,
                 names=['name', 'lat', 'lon', 'cc', 'pop'], dtype={'name': str, 'cc': str}, keep_default_na=False)
gn = gn[(gn.lon >= READ[0] - 2) & (gn.lon <= READ[2] + 2) & (gn.lat >= READ[1] - 2) & (gn.lat <= READ[3] + 2)].reset_index(drop=True)
glat, glon = np.radians(gn.lat.values), np.radians(gn.lon.values)
for d in groups:
    if d['kind'] != 'basin':
        continue
    lon, lat = map(math.radians, d['mouth'])
    h = np.sin((glat - lat) / 2) ** 2 + np.cos(lat) * np.cos(glat) * np.sin((glon - lon) / 2) ** 2
    k = int(np.argmin(h))
    d['place'], d['pcc'], d['pkm'] = gn.name[k], gn.cc[k], round(float(2 * 6371 * np.arcsin(np.sqrt(h[k]))), 1)

# ─── countries ───────────────────────────────────────────────────────────────
ctry = gpd.read_file(NE('ne_10m_admin_0_countries'), bbox=READ)[['NAME_PL', 'NAME_EN', 'geometry']]
ctry_tree = shapely.STRtree(ctry.geometry.values)
names_ctry = {}

def countries(poly, min_pct=0.3):
    total = poly.area
    shares = {}
    for j in ctry_tree.query(poly):
        a = shapely.intersection(poly, ctry.geometry.values[j]).area
        if a > 0:
            pl, en = ctry.NAME_PL.values[j], ctry.NAME_EN.values[j]
            names_ctry[pl] = en
            shares[pl] = shares.get(pl, 0) + a
    s = sum(shares.values()) or total
    out = sorted(((k, round(100 * v / s, 1)) for k, v in shares.items()), key=lambda kv: -kv[1])
    return [[k, v] for k, v in out if v >= min_pct]

for d in groups:
    d['ctry'] = countries(d['poly'])
log('countries done')

# ─── population (GHSL) ───────────────────────────────────────────────────────
has_pop = GHSL.exists()
if has_pop:
    import rasterio, rasterio.features, rasterio.windows
    with rasterio.open(GHSL) as src:
        bx = shapely.union_all([d['poly'] for d in groups]).bounds
        win = rasterio.windows.from_bounds(*bx, transform=src.transform).round_offsets().round_lengths()
        pop = src.read(1, window=win).astype(np.float64)
        pop[pop < 0] = 0
        tr = src.window_transform(win)
        ids = rasterio.features.rasterize(((d['poly'], k + 1) for k, d in enumerate(groups)), out_shape=pop.shape, transform=tr, fill=0, dtype='int32')
        sums = np.bincount(ids.ravel(), weights=pop.ravel(), minlength=len(groups) + 1)
    for k, d in enumerate(groups):
        d['pop'] = float(sums[k + 1])
    log(f'population: {sum(d["pop"] for d in groups) / 1e6:.1f} million')

# ─── bbox and quantisation ───────────────────────────────────────────────────
x0, y0, x1, y1 = shapely.union_all([d['poly'] for d in groups]).bounds
m = 0.3
BBOX = [math.floor((x0 - m) * 10) / 10, math.ceil((x1 + m) * 10) / 10, math.floor((y0 - m) * 10) / 10, math.ceil((y1 + m) * 10) / 10]
LON0, LON1, LAT0, LAT1 = BBOX
qx = lambda v: np.clip(np.round((np.asarray(v) - LON0) / (LON1 - LON0) * 65535), 0, 65535).astype('<u2')
qy = lambda v: np.clip(np.round((np.asarray(v) - LAT0) / (LAT1 - LAT0) * 65535), 0, 65535).astype('<u2')
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
log(f'bbox {BBOX}')

def rings_of(geom):
    """Polygons → list of polygons → list of rings (open, exterior CCW / holes CW)."""
    geom = shapely.orient_polygons(geom)
    out = []
    for p in getattr(geom, 'geoms', [geom]):
        if p.geom_type != 'Polygon' or p.is_empty:
            continue
        out.append([np.asarray(r.coords)[:-1] for r in [p.exterior, *p.interiors] if len(r.coords) >= 4])
    return out

def pack(polys, gq=False):
    """[[ring lengths] per polygon], b64 uint16 xy (bbox or global quantisation)."""
    lens, parts = [], []
    for p in polys:
        lens.append([len(r) for r in p])
        for r in p:
            if gq:
                q = np.c_[np.round((r[:, 0] + 180) / 360 * 65535), np.round((r[:, 1] + 90) / 180 * 65535)].astype('<u2')
            else:
                q = np.c_[qx(r[:, 0]), qy(r[:, 1])]
            parts.append(q.ravel())
    return [lens, b64(np.concatenate(parts) if parts else np.zeros(0, '<u2'))]

def flatten(geom):
    """One entry per polygon part: [rings]."""
    return [p for p in rings_of(geom)]

# ─── rivers ──────────────────────────────────────────────────────────────────
def chaikin(pts, passes=2):
    for _ in range(passes):
        if len(pts) < 3:
            return pts
        a, b = pts[:-1], pts[1:]
        mid = np.empty((2 * len(a), 2)); mid[0::2], mid[1::2] = 0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b
        pts = np.vstack([pts[:1], mid[1:-1], pts[-1:]])
    return pts

def dp(pts, tol=80.0):
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(float(pts[:, 1].mean())))
    xy = np.c_[pts[:, 0] * 111_320 * k, pts[:, 1] * 111_320]
    keep = np.zeros(len(pts), bool); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = xy[a], xy[b]
        seg = q - p; L = float(seg @ seg); r = xy[a + 1:b] - p
        if L == 0:
            dd = np.hypot(r[:, 0], r[:, 1])
        else:
            t = np.clip((r @ seg) / L, 0, 1); dd = np.hypot(r[:, 0] - t * seg[0], r[:, 1] - t * seg[1])
        j = int(np.argmax(dd))
        if dd[j] > tol:
            keep[a + 1 + j] = True; stack += [(a, a + 1 + j), (a + 1 + j, b)]
    return pts[keep]

gid = {d['key']: k for k, d in enumerate(groups)}
cls_of = np.clip(7 - riv.ORD_FLOW.values.astype(int), 0, 4)
rivers = []
for c in range(5):
    cnt, xy, g, up = [], [], [], []
    for i in np.flatnonzero(kept & (cls_of == c)):
        p = dp(chaikin(coords[i]))
        q = np.c_[qx(p[:, 0]), qy(p[:, 1])].astype(np.int64)
        q = q[np.r_[True, np.any(np.diff(q, axis=0) != 0, axis=1)]]
        if len(q) < 2:
            q = np.vstack([q, q])
        cnt.append(len(q)); xy.append(q.astype('<u2').ravel()); g.append(gid[reach_group[i]]); up.append(min(round(up_of[i]), 4e9))
    rivers.append(dict(n=len(cnt), cnt=b64(np.array(cnt, '<u2')), xy=b64(np.concatenate(xy) if xy else np.zeros(0, '<u2')),
                       g=b64(np.array(g, '<u2')), up=b64(np.array(up, '<u4'))))
    log(f'class {c}: {len(cnt)} reaches')

# ─── groups, sub-basins, totals ──────────────────────────────────────────────
r1 = lambda v: round(float(v), 1)
out_groups = []
for d in groups:
    if d['kind'] == 'coast':
        o = dict(name=None, kind='coast', sub=d['sub'], area=r1(d['parea']), dis=0, nreach=0, rkm=0, nout=0, parea=r1(d['parea']), ctry=d['ctry'])
    else:
        o = dict(name=d['name'], kind='basin', sub=d['sub'], place=d['place'], pcc=d['pcc'], pkm=d['pkm'], area=r1(d['area']),
                 dis=round(d['dis'], 1), nreach=d['nreach'], rkm=r1(d['rkm']), len=r1(d['len']),
                 mouth=[round(d['mouth'][0], 3), round(d['mouth'][1], 3)], parea=r1(d['parea']), ctry=d['ctry'])
        if d['name'] or d['area'] >= 1500:
            lp = polylabel(max(getattr(d['poly'], 'geoms', [d['poly']]), key=lambda p: p.area), tolerance=0.02)
            o['lbl'] = [round(lp.x, 3), round(lp.y, 3)]
        if d.get('clipped'):
            o['clipped'] = True
    if has_pop:
        o['pop'] = round(d['pop'])
    out_groups.append(o)

def agg(sel_groups, polys_for_ctry, nout):
    basins = [d for d in sel_groups if d['kind'] == 'basin']
    tot = dict(parea=sum(d['parea'] for d in sel_groups), dis=round(sum(d['dis'] for d in basins), 1), nout=nout,
               nreach=sum(d['nreach'] for d in basins), rkm=round(sum(d['rkm'] for d in basins), 1))
    if has_pop:
        tot['pop'] = round(sum(d['pop'] for d in sel_groups))
    tot['ctry'] = countries(polys_for_ctry, 0.1)
    return tot

subs = []
outlines = []
for k, s in enumerate(C['subs']):
    sg = [d for d in groups if d['sub'] == k]
    u = shapely.union_all([d['poly'] for d in sg]) if sg else Polygon()
    outlines.append(u)
    top6 = [[d['name'], r1(d['area'])] for d in sg if d['kind'] == 'basin' and d['name']][:6]
    a = agg(sg, u, sum(1 for m in mouths.values() if m[2] == k)) if sg else dict(parea=0, dis=0, nout=0, nreach=0, rkm=0, ctry=[])
    subs.append(dict(name=s['pl'], en=s['en'], lbl=list(s['lbl']), **{k2: v for k2, v in a.items() if k2 != 'ctry'}, top=top6, ctry=a['ctry']))
whole = shapely.union_all(outlines)
outlines.append(whole)
total = agg(groups, whole, len(mouths))
log(f'total: {total["parea"] / 1e6:.2f} million km², {total["nout"]} river mouths, {total["dis"]:.0f} m³/s')

# ─── base map layers ─────────────────────────────────────────────────────────
BOX = box(LON0 - 7, max(-85, LAT0 - 18), LON1 + 7, min(85, LAT1 + 18))  # ⊇ the cut-out box of build-data.mjs
dbox = box(LON0, LAT0, LON1, LAT1)
land = shapely.intersection(land_u, dbox)
if C['water'] == 'inland':
    land = shapely.difference(land, water)  # the Caspian is water, not a lake
lk = pd.concat([gpd.read_file(NE(n), bbox=tuple(dbox.bounds)) for n in ('ne_10m_lakes', 'ne_10m_lakes_europe')], ignore_index=True)
lakes_g = [shapely.intersection(shapely.make_valid(g), dbox) for g in lk.geometry.values if g is not None]
lakes_g = [g for g in lakes_g if not g.is_empty and area_km2(g) >= 12]
if C['water'] == 'inland':
    lakes_g = [g for g in lakes_g if shapely.intersection(g, water).area < 0.5 * g.area]
bl = gpd.read_file(NE('ne_10m_admin_0_boundary_lines_land'), bbox=tuple(dbox.bounds))
border_lines = []
for g in bl.geometry.values:
    g = shapely.intersection(g, dbox)
    for part in getattr(g, 'geoms', [g]):
        if part.geom_type == 'LineString' and len(part.coords) >= 2:
            border_lines.append(np.asarray(part.coords))
w50 = gpd.read_file(NE('ne_50m_land'), bbox=tuple(BOX.bounds))
world = shapely.intersection(shapely.union_all(w50.geometry.values), BOX)
if C['water'] == 'inland':
    world = shapely.difference(world, water)

src = dict(
    sea=SEA,
    bbox=BBOX,
    rivers=rivers,
    groups=out_groups,
    subs=subs,
    total=total,
    basinRings=[[len(r) for r in p] for d in groups for p in [sum(flatten(d['poly']), [])]],
    basinXY=None,
    outlines=pack([sum(flatten(o), []) for o in outlines]),
    land=pack(flatten(land)),
    lakes=pack([sum(flatten(g), []) for g in lakes_g]),
    borders=[[len(l) for l in border_lines], b64(np.concatenate([np.c_[qx(l[:, 0]), qy(l[:, 1])].ravel() for l in border_lines]) if border_lines else np.zeros(0, '<u2'))],
    world=pack(flatten(world), gq=True),
    names=dict(rivers=names_en, countries=names_ctry),
    method=dict(clip_lat=CLIP, population='GHSL GHS-POP R2023A, epoch 2025 (JRC)' if has_pop else None),
)
bp = pack([sum(flatten(d['poly']), []) for d in groups])
src['basinRings'], src['basinXY'] = bp[0], bp[1]
path = ROOT / f'data/{SEA}.source.json'
path.write_text(json.dumps(src, ensure_ascii=False), encoding='utf-8')
log(f'wrote {path.name}: {path.stat().st_size / 1e6:.1f} MB')
for d in groups[:25]:
    if d['kind'] == 'basin':
        print(f"  {d['name'] or '—':28s} {names_en.get(d['name'], ''):24s} {d['area']:>10.0f} km²  {d['dis']:>8.0f} m³/s  sub {d['sub']}  {d['place']} ({d['pcc']})")
