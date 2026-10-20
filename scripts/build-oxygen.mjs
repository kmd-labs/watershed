#!/usr/bin/env node
/**
 * Fetches the autumn near-bottom dissolved oxygen series for the Baltic Sea from EMODnet Chemistry
 * (SMHI DIVAnd 6-year seasonal analysis v2025, "deepest values", 0.1° grid) and writes
 * src/assets/data/oxygen.json.
 *
 * Each year Y is the autumn (Sep–Nov) mean of the 6-year window centred on Y. Years before 1961
 * are skipped: the observation coverage there is too sparse for a reliable basin-wide field.
 *
 * Usage: node scripts/build-oxygen.mjs [fromYear] [toYear]   (default 1961 2020)
 */
import { writeFileSync } from 'node:fs';

const DATASET = 'https://erddap.emodnet.eu/erddap/griddap/oceanbrowser_opendap_84a4_82d9_d87c';
const VAR = 'Water_body_dissolved_oxygen_concentration_deepest';
const FROM = +(process.argv[2] ?? 1961);
const TO = +(process.argv[3] ?? 2020);
const LAT0 = 53.0, LAT1 = 65.9, LON0 = 9.4, LON1 = 30.9, D = 0.1;
const nlat = Math.round((LAT1 - LAT0) / D) + 1;
const nlon = Math.round((LON1 - LON0) / D) + 1;
/** Values are stored as uint8 = µmol/l ÷ 2 (0–508 µmol/l); 255 = no data. */
const SCALE = 2, NO_DATA = 255;

const years = [];
for (let y = FROM; y <= TO; y++) years.push(y);

const frames = new Map(); // year -> Float32Array(nlat*nlon)
for (const y of years) frames.set(y, new Float32Array(nlat * nlon).fill(NaN));

// Quarterly time axis: stride 4 keeps one autumn per year.
const url = `${DATASET}.csv?${VAR}%5B(${FROM}-10-16T00:00:00Z):4:(${TO}-10-16T00:00:00Z)%5D%5B(${LAT0}):(${LAT1})%5D%5B(${LON0}):(${LON1})%5D`;
console.log(`Fetching ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`ERDDAP HTTP ${res.status}`);
const text = await res.text();
let start = text.indexOf('\n', text.indexOf('\n') + 1) + 1; // skip 2 header lines
while (start > 0 && start < text.length) {
  const end = text.indexOf('\n', start);
  const line = text.slice(start, end < 0 ? undefined : end);
  start = end < 0 ? -1 : end + 1;
  const [time, lat, lon, v] = line.split(',');
  if (!v || v === 'NaN') continue;
  const f = frames.get(+time.slice(0, 4));
  if (!f) continue;
  f[Math.round((+lat - LAT0) / D) * nlon + Math.round((+lon - LON0) / D)] = +v;
}

// Keep only cells that hold data in at least one year.
const cells = [];
for (let k = 0; k < nlat * nlon; k++) if (years.some(y => !Number.isNaN(frames.get(y)[k]))) cells.push(k);

const packed = new Uint8Array(years.length * cells.length);
years.forEach((y, yi) => {
  const f = frames.get(y);
  cells.forEach((k, ci) => {
    const v = f[k];
    packed[yi * cells.length + ci] = Number.isNaN(v) ? NO_DATA : Math.min(254, Math.round(Math.max(0, v) / SCALE));
  });
});

const out = {
  source: 'EMODnet Chemistry / SMHI, DIVAnd 6-year seasonal analysis v2025 (doi:10.13120/7ec4c23e-84eb-4e9c-97b4-b2a1c02137db)',
  season: 'autumn',
  unit: 'umol/l',
  lat0: LAT0,
  lon0: LON0,
  d: D,
  nlat,
  nlon,
  years,
  scale: SCALE,
  noData: NO_DATA,
  cells: Buffer.from(new Uint16Array(cells).buffer).toString('base64'),
  values: Buffer.from(packed.buffer).toString('base64')
};
writeFileSync(new URL('../src/assets/data/oxygen.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote ${years.length} years × ${cells.length} sea cells.`);
