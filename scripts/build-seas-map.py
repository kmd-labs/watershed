#!/usr/bin/env python3
"""
Builds src/assets/data/seas-map.json — the entry map of Europe (src/app/entry): the five seas'
drainage basins, the land around them, the large lakes and the main rivers of each basin.

    python -I scripts/build-seas-map.py

Inputs: data/<sea>.source.json (scripts/build-sea.py; the Baltic's from the original pipeline) and
Natural Earth 1:50m land, 1:10m lakes and 1:10m rivers & lake centrelines (data/raw/download.sh).

  · basins: the whole drainage basin of each sea (its last outline), simplified (0.04°), parts
    under 0.15 deg² dropped; with its area (km²), river mouths and population for the map's notes.
  · land: Natural Earth land within 45° W – 105° E, 0 – 84° N, simplified (0.05°).
  · lakes: Natural Earth lakes of scale rank ≤ 2.
  · rivers: Natural Earth rivers of scale rank ≤ 7, assigned to the basin that holds their
    midpoint; `w` = 8 − scale rank (line weight).
Coordinates are rounded to 0.01° (≈ 1 km; the map is at most a few thousand pixels wide).
"""
import base64
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import Polygon, box

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data/raw'
OUT = ROOT / 'src/assets/data/seas-map.json'
SEAS = ['baltic', 'north', 'med', 'black', 'caspian']
BOX = box(-45, 0, 105, 84)
# The Baltic's people (GHSL is summed by scripts/build-sea.py for the other seas only).
BALTIC_POP = 82_300_000


def r2(v):
    return round(float(v), 2)


def unpack(lens, b64, bbox):
    """Outline polygons from a source file's packed uint16 coordinates."""
    xy = np.frombuffer(base64.b64decode(b64), '<u2').astype(float).reshape(-1, 2)
    L0, L1, A0, A1 = bbox
    xy[:, 0] = L0 + (L1 - L0) * xy[:, 0] / 65535
    xy[:, 1] = A0 + (A1 - A0) * xy[:, 1] / 65535
    polys, o = [], 0
    for rl in lens:
        rings = []
        for n in rl:
            rings.append(xy[o:o + n])
            o += n
        polys.append(rings)
    return polys


def rings_out(geom, tol, min_area):
    geom = shapely.simplify(geom, tol, preserve_topology=True)
    res = []
    for p in getattr(geom, 'geoms', [geom]):
        if p.geom_type != 'Polygon' or p.area < min_area:
            continue
        res.append([[r2(x), r2(y)] for x, y in list(p.exterior.coords)[:-1]])
    return res


def main():
    basins, shapes = {}, {}
    for sea in SEAS:
        B = json.loads((ROOT / f'data/{sea}.source.json').read_text(encoding='utf-8'))
        whole = unpack(B['outlines'][0], B['outlines'][1], B['bbox'])[len(B['subs'])]
        polys = [Polygon(r).buffer(0) for r in whole if len(r) >= 4]
        g = shapely.union_all([p for p in polys if not p.is_empty])
        basins[sea] = dict(rings=rings_out(g, 0.04, 0.15), area=round(B['total']['parea']),
                           mouths=B['total']['nout'], pop=B['total'].get('pop') or (BALTIC_POP if sea == 'baltic' else None))
        shapes[sea] = shapely.simplify(g, 0.02)

    land = gpd.read_file(RAW / 'ne_50m_land/ne_50m_land.shp', bbox=BOX.bounds)
    land_rings = rings_out(shapely.intersection(shapely.union_all(land.geometry.values), BOX), 0.05, 0.05)

    lk = gpd.read_file(RAW / 'ne_10m_lakes/ne_10m_lakes.shp', bbox=BOX.bounds)
    lakes = []
    for g, rank in zip(lk.geometry.values, lk.scalerank.values):
        if g is not None and rank <= 2:
            lakes += rings_out(shapely.make_valid(g), 0.04, 0.3)

    rv = gpd.read_file(RAW / 'ne_10m_rivers_lake_centerlines/ne_10m_rivers_lake_centerlines.shp', bbox=BOX.bounds)
    rivers = {s: [] for s in SEAS}
    for g, rank in zip(rv.geometry.values, rv.scalerank.values):
        if g is None or rank > 7:
            continue
        for part in getattr(g, 'geoms', [g]):
            part = shapely.simplify(part, 0.03)
            mid = part.interpolate(0.5, normalized=True)
            for s in SEAS:
                if shapes[s].contains(mid):
                    rivers[s].append(dict(w=max(1, 8 - int(rank)), p=[[r2(x), r2(y)] for x, y in part.coords]))
                    break

    OUT.write_text(json.dumps(dict(basins=basins, land=land_rings, lakes=lakes, rivers=rivers), separators=(',', ':')), encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.0f} KB',
          {s: (len(basins[s]['rings']), len(rivers[s])) for s in SEAS}, 'land rings', len(land_rings), 'lakes', len(lakes))


if __name__ == '__main__':
    main()
