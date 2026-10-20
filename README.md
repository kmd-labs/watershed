# Watershed — Baltic Nutrient Loads

Interactive 3D globe of the Baltic Sea drainage basin showing how much **nitrogen (N)** and **phosphorus (P)** each river delivers to the sea. Built on the KMD design system (`src/design-system` submodule); follow [AGENTS.md](AGENTS.md).

```bash
git clone --recurse-submodules https://github.com/kmd-labs/watershed.git
npm install
npm start          # http://localhost:4200
```

## What's on the map

- **Catchment colour**: area-specific load (kg/km² · yr), 7 classes from a single-hue design-system ramp (orange for N, green for P).
- **Phosphorus discharge**: circles at river mouths, area ∝ annual P load (t/yr).
- **Dead zones over time**: near-bottom oxygen (EMODnet Chemistry / SMHI DIVAnd v2025, autumn 6-year means 1961–2020), hypoxic < 2 ml/l and anoxic < 0.2 ml/l. Year slider with play button, area-over-time chart, and a "change since the 1960s" view (new / persistent / recovered hypoxia vs 1961–1970). Regenerate with `node scripts/build-oxygen.mjs`.
- **N / P switch**: one toggle drives catchment colours, discharge circles, rankings and country totals.
- **List / detail panels**: ranking by load, area-specific load, discharge or name; per-river loads, concentrations, hydrology and countries.
- **Countries tab**: riverine loads aggregated per country, each river split by the country's share of its basin area (a geographic approximation, not HELCOM source apportionment).

## Data & method

| Layer | Source |
| --- | --- |
| River network, catchments, discharge | HydroRIVERS v1.0 / HydroBASINS v1c (Lehner & Grill 2013, WWF / HydroSHEDS), WaterGAP mean flow 1971–2000 |
| Land, lakes, borders | Natural Earth |
| Loads of the 7 largest rivers | HELCOM PLC-7, 2017 (BSEP n°178, 2021) |
| Concentrations for all other rivers | HELCOM BSEFS 2025, Tables 1a/1b, 2013–2022 flow-weighted riverine averages per sub-basin, split by country in the Baltic Proper and Danish Straits |

`src/assets/data/baltic.json` holds the packed geometry. The nutrient model lives in [`src/app/core/data/nutrients.ts`](src/app/core/data/nutrients.ts): measured loads, the concentration tables and class breaks are plain constants, so they are easy to update when HELCOM publishes PLC-8.

Estimated loads are marked with `≈` in the UI. The model total (≈ 709 kt N, 25 kt P per year) is above the HELCOM 2013–2022 average (578 kt N, 22.7 kt P) mainly because 2017 was a wet year for the big southern rivers.
