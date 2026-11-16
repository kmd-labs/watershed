#!/usr/bin/env python3
"""
Builds src/assets/data/<sea>.relief.webp — a subtle hillshade for the globe cut-out of one sea.

Source: NOAA ETOPO1 (1 arc-minute, public domain), fetched from ERDDAP for the cut-out box, i.e.
the `worldBox` that scripts/build-data.mjs wrote into src/assets/data/<sea>.json (cached in
data/raw/etopo/<sea>.nc; the Baltic's is data/etopo.nc):

    node scripts/build-data.mjs <sea>
    python -I scripts/build-relief.py <sea>

Needs numpy, scipy and Pillow. Output is a greyscale image on the lon/lat grid, north up, where
128 means "flat": the globe blends it with `soft-light`, so the sea and plains stay untouched and
only slopes lighten (facing the light, north-west) or darken.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.io import netcdf_file

VERTICAL_EXAGGERATION = 5.0
GAIN = 300.0  # shade units → grey levels around 128
LIGHTS = [(315, 0.5), (270, 0.25), (0, 0.25)]  # azimuth (deg, clockwise from north), weight
SUN_ALT = np.radians(45)

import json, urllib.request
ROOT = Path(__file__).resolve().parent.parent
SEA = sys.argv[1] if len(sys.argv) > 1 else 'baltic'
W0, W1, S0, S1 = json.loads((ROOT / f'src/assets/data/{SEA}.json').read_text(encoding='utf-8'))['worldBox']
src = ROOT / ('data/etopo.nc' if SEA == 'baltic' else f'data/raw/etopo/{SEA}.nc')
if not src.exists():
    src.parent.mkdir(parents=True, exist_ok=True)
    url = (f'https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.nc?altitude%5B({S0}):1:({S1})%5D%5B({W0}):1:({W1})%5D')
    req = urllib.request.Request(url, headers={'User-Agent': 'watershed-data-build/1.0'})
    with urllib.request.urlopen(req, timeout=300) as r:
        src.write_bytes(r.read())
out = ROOT / f'src/assets/data/{SEA}.relief.webp'
OUT_WIDTH = 2048  # upscaled ~3x on the globe anyway; smooth shading survives resampling

nc = netcdf_file(str(src), 'r', mmap=False)
z = nc.variables['altitude'].data.astype(np.float64)[::-1]  # rows north → south
lat = nc.variables['latitude'].data[::-1]
cell = float(abs(lat[1] - lat[0]))

dy = cell * 111_320.0
dx = (cell * 111_320.0 * np.cos(np.radians(lat)))[:, None]
ze = np.where(z > 0, z, 0.0) * VERTICAL_EXAGGERATION
gy, gx = np.gradient(ze)
dzdx = gx / dx
dzdy = -gy / dy  # image rows grow southward; +dzdy = rising to the north
slope = np.arctan(np.hypot(dzdx, dzdy))
aspect = np.arctan2(-dzdx, -dzdy)  # downslope direction, clockwise from north

shade = np.zeros_like(z)
for az, w in LIGHTS:
    a = np.radians(az)
    shade += w * (np.cos(slope) * np.sin(SUN_ALT) + np.sin(slope) * np.cos(SUN_ALT) * np.cos(a - aspect))
flat = np.sin(SUN_ALT)
grey = np.clip(128 + (shade - flat) * GAIN, 0, 255)
grey[z <= 0] = 128

img = Image.fromarray(grey.astype(np.uint8), 'L')
img = img.resize((OUT_WIDTH, round(img.height * OUT_WIDTH / img.width)), Image.LANCZOS)
img.save(out, quality=78, method=6)
print(f'{out.name}: {img.width}x{img.height}, {out.stat().st_size / 1024:.0f} KB')
