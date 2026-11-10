# Watershed — Baltic Sea Drainage Basin

Interactive 3D globe of the Baltic Sea drainage basin: every river catchment that drains to the Baltic, the sea sub-basins they feed and the countries they cross. Built on the KMD design system (`src/design-system` submodule); follow [AGENTS.md](AGENTS.md).

```bash
git clone --recurse-submodules https://github.com/kmd-labs/watershed.git
npm install
npm start          # http://localhost:4200
```

## What's on the map

- **River catchments** (default view): every HydroBASINS catchment draining to the Baltic in one sand tone, coastal strips without a sizeable river slightly lighter, the drainage divide outlined. Clicking a catchment highlights it and turns its river network blue.
- **Sea sub-basins** (view switcher, top right): catchments tinted by the part of the sea they drain to (Bothnian Bay … Danish Straits & Kattegat), with the area of each in the legend.
- **Layers**: rivers (HydroRIVERS, line width by river class), country borders (dashed, off by default), labels.
- **Rivers / Countries panel**: rivers ranked by catchment area or discharge (searchable, filterable by sub-basin); each country's area and share of the drainage basin.
- **Catchment card**: area and rank, mean discharge, main-river and network length, mouth, nearest town, countries in the basin.

Colours are theme tokens defined in [`src/styles.scss`](src/styles.scss) from the design-system palette and read by the globe through `ThemeService`.

## Data & method

| Layer | Source |
| --- | --- |
| River network, catchments, discharge | HydroRIVERS v1.0 / HydroBASINS v1c (Lehner & Grill 2013, WWF / HydroSHEDS), WaterGAP mean flow 1971–2000 |
| Land, lakes, borders | Natural Earth |

`src/assets/data/baltic.json` holds the packed geometry. Two clean-ups happen at load time (`BalticDataService`, `GlobeComponent`):

- HydroRIVERS routes flow through lakes as straight connector reaches (hundreds of parallel lines across Ladoga and Onega). River segments whose midpoint lies on a Natural Earth lake are skipped, so rivers stop at the shore.
- HydroBASINS leaves holes inside the biggest lakes (Ladoga, Peipus) that showed up as stray jagged outlines; hole rings lying ≥ 80 % on a lake are dropped.
