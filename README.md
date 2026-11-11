# Watershed — Baltic Sea Drainage Basin

Interactive 3D globe of the Baltic Sea drainage basin: every river catchment that drains to the Baltic, the sea sub-basins they feed and the countries they cross. Built on the KMD design system (`src/design-system` submodule); follow [AGENTS.md](AGENTS.md).

```bash
git clone --recurse-submodules https://github.com/kmd-labs/watershed.git
npm install
npm start          # http://localhost:4200
```

## What's on the map

- **Top 20 river basins** (start view): a guided tour of the 20 largest river basins, largest first, on the catchments map; its legend names all twenty colours. Closing the tour leaves you on the catchments map, whose Top 20 button starts it again. **Where the rivers end** works the same way, sea by sea, and closes onto the sea sub-basins.
- **River catchments**: every HydroBASINS catchment draining to the Baltic in one sand tone, coastal strips without a sizeable river slightly lighter, the drainage divide outlined. Clicking a catchment highlights it and turns its river network blue.
- **Sea sub-basins** (view switcher, top right): catchments tinted by the part of the sea they drain to (Bothnian Bay … Danish Straits & Kattegat), with the area of each in the legend.
- **Layers**: rivers (HydroRIVERS, line width by river class), country borders (dashed, off by default), labels.
- **Rivers / Countries panel**: rivers ranked by catchment area or discharge (searchable, filterable by sub-basin); each country's area and share of the drainage basin.
- **Catchment card**: area and rank, mean discharge, main-river and network length, mouth, nearest town, countries in the basin.

- **Links & sharing**: every view lives in the URL (`?view=mosaic&ground=dark`, `?view=catchments&basin=1`, `?view=story&step=3`, `?step=5` for the top-20 tour, `?view=raindrop&drop=22.6,50.2`, `&lang=pl`; older `?top=…` and `?basin=…` links still work); the address bar follows the map, and the share button (as in kmd-labs/el-nino) offers a QR code, the link to the current view and the app link.
- **A2 print poster**: the Poster button renders the current view as a 420 × 594 mm sheet at 300 dpi (150 dpi on phones), tagged with its resolution, on white paper with ink or coloured rivers (night background for the black-ground views). Each figure under the map carries a footnote number pointing to its source (HydroRIVERS, HELCOM PLC-7 and State of the Baltic Sea, Björck et al. 2008).
- **Map buttons**: zoom in, zoom out and back to the whole basin, under the view switcher.

Colours are theme tokens defined in [`src/styles.scss`](src/styles.scss) from the design-system palette and read by the globe through `ThemeService`.

## Data & method

| Layer | Source |
| --- | --- |
| River network, catchments, discharge | HydroRIVERS v1.0 / HydroBASINS v1c (Lehner & Grill 2013, WWF / HydroSHEDS), WaterGAP mean flow 1971–2000 |
| Land, lakes, borders | Natural Earth |

`src/assets/data/baltic.json` and `streams.json` are built by `node scripts/build-data.mjs` from `data/baltic.source.json` and `data/rivers.hr.json`.

River geometry: `python scripts/build-rivers.py` matches every reach of the source export to the original HydroRIVERS v1.0 (download the Europe shapefile into `data/hydrorivers/`, see the script header) by its end points, smooths the 15″ grid staircase (two Chaikin passes) and simplifies at 80 m. The export had cut reaches down to ~3 vertices each — straight chords km long. Checked against OpenStreetMap, streams draining under 100 km² are often off the real channel in flat land, so the build leaves out streams under 50 km² upstream, unnamed river systems under 100 km² and rivers on islands under 500 km² (constants at the top of `build-data.mjs`).

Other clean-ups, also at build time:

- HydroRIVERS routes flow through lakes as straight connector reaches (hundreds of parallel lines across Ladoga and Onega). River segments whose midpoint lies on a Natural Earth lake are skipped, so rivers stop at the shore.
- HydroBASINS leaves holes inside the biggest lakes (Ladoga, Peipus) that showed up as stray jagged outlines; hole rings lying ≥ 80 % on a lake are dropped.
