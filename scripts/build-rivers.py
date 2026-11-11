#!/usr/bin/env python3
"""
Rebuilds the river geometry of data/baltic.source.json from the original HydroRIVERS v1.0
(Lehner & Grill 2013), which the source export had simplified to ~3 vertices per reach — straight
chords several km long that cut every bend and drift off the real channels.

    curl -o data/hydrorivers/HydroRIVERS_v10_eu_shp.zip https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_eu_shp.zip
    (unzip into data/hydrorivers/)
    python scripts/build-rivers.py [tolerance_m]

Every reach of the source export is matched to its HydroRIVERS reach by its quantised end points,
so basin, size class and downstream topology (end of a reach = start of the next) are kept
exactly. Its vertices are replaced by the full HydroRIVERS line. That line is a staircase on the
15″ (~450 m) flow-direction grid, so it is first smoothed (two Chaikin corner-cutting passes,
end points fixed) and then simplified with Douglas–Peucker at `tolerance_m` (default 80 m). Upstream area (UPLAND_SKM) is stored per reach so the web
build can leave out the smallest streams.

Writes data/rivers.hr.json (same layout as the source `rivers`, plus `up`: upstream km² per reach).
Needs numpy only.
"""
import base64, json, math, struct, sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SHP = ROOT / 'data/hydrorivers/HydroRIVERS_v10_eu_shp/HydroRIVERS_v10_eu'
TOL_M = float(sys.argv[1]) if len(sys.argv) > 1 else 80.0
SMOOTH_PASSES = 2

src = json.loads((ROOT / 'data/baltic.source.json').read_text(encoding='utf-8'))
LON0, LON1, LAT0, LAT1 = src['bbox']
u16 = lambda s: np.frombuffer(base64.b64decode(s), dtype='<u2')
qx = lambda lon: np.clip(np.round((np.asarray(lon) - LON0) / (LON1 - LON0) * 65535), 0, 65535).astype(np.int64)
qy = lambda lat: np.clip(np.round((np.asarray(lat) - LAT0) / (LAT1 - LAT0) * 65535), 0, 65535).astype(np.int64)

# ── DBF: upstream area per record ───────────────────────────────────────────
raw = (SHP.with_suffix('.dbf')).read_bytes()
nrec = struct.unpack('<I', raw[4:8])[0]
hlen = struct.unpack('<H', raw[8:10])[0]
rlen = struct.unpack('<H', raw[10:12])[0]
rec = np.frombuffer(raw, dtype=f'S{rlen}', count=nrec, offset=hlen)
# field offsets (deletion flag first): HYRIV_ID 9, NEXT_DOWN 9, MAIN_RIV 9, LENGTH 7, DIST_DN 7,
# DIST_UP 7, CATCH 7, UPLAND 10, ...
def col(start, width):
    return np.array([float(r[start:start + width]) for r in rec])
upland = col(1 + 9 + 9 + 9 + 7 + 7 + 7 + 7, 10)
print(f'dbf: {nrec} reaches')

# ── SHP: polylines inside the bbox ──────────────────────────────────────────
shx = np.frombuffer((SHP.with_suffix('.shx')).read_bytes()[100:], dtype='>i4').reshape(-1, 2)
shp = (SHP.with_suffix('.shp')).read_bytes()
lines = {}
for i, (off, _) in enumerate(shx):
    o = off * 2 + 8
    xmin, ymin, xmax, ymax = struct.unpack_from('<4d', shp, o + 4)
    if xmax < LON0 or xmin > LON1 or ymax < LAT0 or ymin > LAT1:
        continue
    nparts, npts = struct.unpack_from('<2i', shp, o + 36)
    pts = np.frombuffer(shp, dtype='<f8', count=npts * 2, offset=o + 44 + 4 * nparts).reshape(-1, 2)
    lines[i] = pts
print(f'shp: {len(lines)} reaches in the bbox')

# index by quantised (start, end)
key = lambda a, b, c, d: (int(a) << 48) | (int(b) << 32) | (int(c) << 16) | int(d)
by_ends = {}
for i, p in lines.items():
    sx, sy, ex, ey = qx(p[0, 0]), qy(p[0, 1]), qx(p[-1, 0]), qy(p[-1, 1])
    by_ends.setdefault(key(sx, sy, ex, ey), []).append(i)

def chaikin(pts, passes):
    """Corner cutting (1/4, 3/4) with fixed end points: the grid staircase becomes a smooth curve."""
    for _ in range(passes):
        if len(pts) < 3:
            return pts
        a, b = pts[:-1], pts[1:]
        q = 0.75 * a + 0.25 * b
        r = 0.25 * a + 0.75 * b
        mid = np.empty((2 * len(a), 2))
        mid[0::2], mid[1::2] = q, r
        pts = np.vstack([pts[:1], mid[1:-1], pts[-1:]])
    return pts

def dp(pts, tol):
    """Douglas–Peucker on lon/lat with a metric tolerance (local equirectangular)."""
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
        seg = q - p; L = float(seg @ seg)
        r = xy[a + 1:b] - p
        if L == 0:
            d = np.hypot(r[:, 0], r[:, 1])
        else:
            t = np.clip((r @ seg) / L, 0, 1)
            d = np.hypot(r[:, 0] - t * seg[0], r[:, 1] - t * seg[1])
        m = int(np.argmax(d))
        if d[m] > tol:
            keep[a + 1 + m] = True
            stack += [(a, a + 1 + m), (a + 1 + m, b)]
    return pts[keep]

out_rivers = []
stats = dict(matched=0, unmatched=0, v_old=0, v_new=0)
for ci, rc in enumerate(src['rivers']):
    cnt = u16(rc['cnt']); xy = u16(rc['xy']).reshape(-1, 2).astype(np.int64)
    new_cnt, new_xy, ups = [], [], []
    o = 0
    for n in map(int, cnt):
        q = xy[o:o + n]; o += n
        stats['v_old'] += n
        cand = by_ends.get(key(q[0, 0], q[0, 1], q[-1, 0], q[-1, 1]), [])
        if cand:
            i = cand.pop(0)
            p = dp(chaikin(lines[i], SMOOTH_PASSES), TOL_M)
            nq = np.c_[qx(p[:, 0]), qy(p[:, 1])]
            nq[0], nq[-1] = q[0], q[-1]  # exact end points: topology unchanged
            # drop consecutive duplicates created by quantisation
            keep = np.r_[True, np.any(np.diff(nq, axis=0) != 0, axis=1)]
            nq = nq[keep]
            if len(nq) < 2:
                nq = q[[0, -1]]
            ups.append(upland[i])
            stats['matched'] += 1
        else:
            nq = q
            ups.append(0.0)
            stats['unmatched'] += 1
        new_cnt.append(len(nq)); new_xy.append(nq)
        stats['v_new'] += len(nq)
    allxy = np.concatenate(new_xy).astype('<u2').ravel()
    out_rivers.append({
        'n': rc['n'],
        'cnt': base64.b64encode(np.array(new_cnt, '<u2').tobytes()).decode(),
        'xy': base64.b64encode(allxy.tobytes()).decode(),
        'g': rc['g'],
        'up': base64.b64encode(np.array(np.minimum(np.round(ups), 4e9), '<u4').tobytes()).decode(),
    })
    print(f'class {ci}: {len(cnt)} reaches')

(ROOT / 'data/rivers.hr.json').write_text(json.dumps({'tolerance_m': TOL_M, 'smooth_passes': SMOOTH_PASSES, 'rivers': out_rivers}), encoding='utf-8')
print(json.dumps(stats), f'vertices x{stats["v_new"] / stats["v_old"]:.2f}')
