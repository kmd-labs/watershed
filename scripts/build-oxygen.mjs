#!/usr/bin/env node
/**
 * Fetches near-bottom dissolved oxygen for the Baltic Sea from EMODnet Chemistry
 * (SMHI DIVAnd 6-year seasonal analysis v2025, "deepest values", 0.1° grid) and writes
 * src/assets/data/oxygen.json.
 *
 * Usage: node scripts/build-oxygen.mjs [YYYY-MM]   (default 2020-10 = autumn 2017–2023 window)
 */
import { writeFileSync } from 'node:fs';

const DATASET = 'https://erddap.emodnet.eu/erddap/griddap/oceanbrowser_opendap_84a4_82d9_d87c';
const VAR = 'Water_body_dissolved_oxygen_concentration_deepest';
const when = process.argv[2] ?? '2020-10';
const LAT0 = 53.0, LAT1 = 65.9, LON0 = 9.4, LON1 = 30.9, D = 0.1;
const NO_DATA = -32768;

const url = `${DATASET}.csv?${VAR}%5B(${when}-16T00:00:00Z)%5D%5B(${LAT0}):(${LAT1})%5D%5B(${LON0}):(${LON1})%5D`;
console.log(`Fetching ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`ERDDAP HTTP ${res.status}`);
const lines = (await res.text()).trim().split('\n').slice(2);

const nlat = Math.round((LAT1 - LAT0) / D) + 1;
const nlon = Math.round((LON1 - LON0) / D) + 1;
const values = new Int16Array(nlat * nlon).fill(NO_DATA);
let cells = 0;
for (const line of lines) {
  const [, lat, lon, v] = line.split(',');
  if (v === 'NaN') continue;
  const i = Math.round((+lat - LAT0) / D), j = Math.round((+lon - LON0) / D);
  values[i * nlon + j] = Math.round(Math.max(0, +v));
  cells++;
}

const out = {
  source: 'EMODnet Chemistry / SMHI, DIVAnd 6-year seasonal analysis v2025 (doi:10.13120/7ec4c23e-84eb-4e9c-97b4-b2a1c02137db)',
  window: when,
  unit: 'umol/l',
  lat0: LAT0,
  lon0: LON0,
  d: D,
  nlat,
  nlon,
  noData: NO_DATA,
  values: Buffer.from(values.buffer).toString('base64')
};
writeFileSync(new URL('../src/assets/data/oxygen.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote ${cells} sea cells (${nlat}×${nlon} grid).`);
