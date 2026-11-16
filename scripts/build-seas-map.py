#!/usr/bin/env python3
"""
Builds src/assets/data/seas-map.json — the entry map of Europe (src/app/entry): the five seas'
drainage basins, the land around them, the large lakes and the main rivers of each basin.

    python -I scripts/build-seas-map.py

Inputs: data/<sea>.source.json (scripts/build-sea.py; the Baltic's from the original pipeline) and
Natural Earth 1:50m land and 1:10m lakes (data/raw/download.sh).

  · basins: the whole drainage basin of each sea (its last outline), simplified (0.04°), parts
    under 0.15 deg² dropped; with its area (km²), river mouths and population for the map's notes.
  · land: Natural Earth land within 45° W – 105° E, 0 – 84° N, simplified (0.05°).
  · lakes: Natural Earth lakes of scale rank ≤ 2.
  · rivers: each sea's HydroRIVERS network from its source file, size classes 2–4 (mean flow
    ≥ 10 m³/s); reaches of a class are joined into continuous lines downstream, then simplified
    (Douglas–Peucker, 0.04° east–west scaled by cos(lat)). Stored per sea and class as flat
    integer arrays in 0.01° units: the first point, then differences ([x0, y0, dx1, dy1, …]).
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
RIVER_CLASSES = (2, 3, 4)
RIVER_TOL = 0.04


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


def dp(pts, tol):
    """Douglas–Peucker on an (n, 2) array; keeps the end points."""
    if len(pts) < 3:
        return pts
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        seg = q - p
        L = float(seg @ seg)
        r = pts[a + 1:b] - p
        if L == 0:
            dd = np.hypot(r[:, 0], r[:, 1])
        else:
            t = np.clip((r @ seg) / L, 0, 1)
            dd = np.hypot(r[:, 0] - t * seg[0], r[:, 1] - t * seg[1])
        j = int(np.argmax(dd))
        if dd[j] > tol:
            keep[a + 1 + j] = True
            stack += [(a, a + 1 + j), (a + 1 + j, b)]
    return pts[keep]


def river_lines(B):
    """A sea's rivers of RIVER_CLASSES as continuous, simplified lines: {class: [flat deltas]}."""
    L0, L1, A0, A1 = B['bbox']
    reaches = []
    for c in RIVER_CLASSES:
        R = B['rivers'][c]
        cnt = np.frombuffer(base64.b64decode(R['cnt']), '<u2')
        xy = np.frombuffer(base64.b64decode(R['xy']), '<u2').reshape(-1, 2)
        o = 0
        for n in cnt:
            reaches.append((c, xy[o:o + n]))
            o += n
    # Reaches are stored in flow direction: follow each one downstream through reaches of its class.
    starts = {}
    for i, (_, q) in enumerate(reaches):
        starts.setdefault(tuple(q[0]), []).append(i)
    used = np.zeros(len(reaches), bool)
    out = {str(c): [] for c in RIVER_CLASSES}
    for i in sorted(range(len(reaches)), key=lambda k: reaches[k][0]):
        if used[i]:
            continue
        c, q = reaches[i]
        used[i] = True
        parts, cur = [q], tuple(q[-1])
        while True:
            nxt = [j for j in starts.get(cur, []) if not used[j] and reaches[j][0] == c]
            if not nxt:
                break
            j = nxt[0]
            used[j] = True
            parts.append(reaches[j][1][1:])
            cur = tuple(reaches[j][1][-1])
        pts = np.concatenate(parts).astype(float)
        lon = L0 + (L1 - L0) * pts[:, 0] / 65535
        lat = A0 + (A1 - A0) * pts[:, 1] / 65535
        k = np.cos(np.radians(lat.mean()))
        p = dp(np.c_[lon * k, lat], RIVER_TOL)
        q = np.round(np.c_[p[:, 0] / k, p[:, 1]] * 100).astype(int)
        q = q[np.r_[True, np.any(np.diff(q, axis=0) != 0, axis=1)]]
        if len(q) < 2:
            continue
        d = np.vstack([q[:1], np.diff(q, axis=0)])
        out[str(c)].append(d.ravel().tolist())
    return out


def rings_out(geom, tol, min_area):
    geom = shapely.simplify(geom, tol, preserve_topology=True)
    res = []
    for p in getattr(geom, 'geoms', [geom]):
        if p.geom_type != 'Polygon' or p.area < min_area:
            continue
        res.append([[r2(x), r2(y)] for x, y in list(p.exterior.coords)[:-1]])
    return res


def main():
    basins, rivers = {}, {}
    for sea in SEAS:
        B = json.loads((ROOT / f'data/{sea}.source.json').read_text(encoding='utf-8'))
        whole = unpack(B['outlines'][0], B['outlines'][1], B['bbox'])[len(B['subs'])]
        polys = [Polygon(r).buffer(0) for r in whole if len(r) >= 4]
        g = shapely.union_all([p for p in polys if not p.is_empty])
        basins[sea] = dict(rings=rings_out(g, 0.04, 0.15), area=round(B['total']['parea']),
                           mouths=B['total']['nout'], pop=B['total'].get('pop') or (BALTIC_POP if sea == 'baltic' else None))
        rivers[sea] = river_lines(B)

    land = gpd.read_file(RAW / 'ne_50m_land/ne_50m_land.shp', bbox=BOX.bounds)
    land_rings = rings_out(shapely.intersection(shapely.union_all(land.geometry.values), BOX), 0.05, 0.05)

    lk = gpd.read_file(RAW / 'ne_10m_lakes/ne_10m_lakes.shp', bbox=BOX.bounds)
    lakes = []
    for g, rank in zip(lk.geometry.values, lk.scalerank.values):
        if g is not None and rank <= 2:
            lakes += rings_out(shapely.make_valid(g), 0.04, 0.3)

    OUT.write_text(json.dumps(dict(basins=basins, land=land_rings, lakes=lakes, rivers=rivers), separators=(',', ':')), encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.0f} KB',
          {s: (len(basins[s]['rings']), sum(len(v) for v in rivers[s].values())) for s in SEAS}, 'land rings', len(land_rings), 'lakes', len(lakes))


if __name__ == '__main__':
    main()
