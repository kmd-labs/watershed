# Watershed — Sea Drainage Basins

Interactive 3D globe of a sea's drainage basin — the Baltic, the North Sea, the Mediterranean, the Black Sea or the Caspian: every river catchment that drains to it, the sea sub-basins they feed and the countries they cross. Built on the KMD design system (`src/design-system` submodule); follow [AGENTS.md](AGENTS.md).

```bash
git clone --recurse-submodules https://github.com/kmd-labs/watershed.git
npm install
npm start          # http://localhost:4200
```

## Seas

Every visit starts at the **entry** (`src/app/entry`): first a **look** — *White & Classy* (the design system's light theme) or *Midnight City Neons* (its Midnight dark theme, tuned in `src/styles.scss`; the default) — each shown with an example (`src/assets/entry/`); then the **sea**, on a map of Europe with the five drainage basins (`src/assets/data/seas-map.json`, built by `python -I scripts/build-seas-map.py`). No sea data is downloaded before the choice. **Change sea…** in the view menu or the drainage-basin panel's title opens the entry at the map (and back to the look). Links carry the sea (`?sea=north`) and open it directly; the look is kept in `localStorage` (`watershed.theme`), the last sea is marked on the map (`watershed.sea`). Each sea's data — `<sea>.json`, `<sea>.streams.json` and `<sea>.relief.webp` in `src/assets/data/` — is fetched only when that sea is chosen; `index.html` sets the look before the first paint and preloads only a linked sea's data. The entry's code is a lazy chunk.

| Sea | Basin shown | River mouths | Sub-basins |
| --- | --- | --- | --- |
| Baltic | 1.75 million km² | 1,573 | Bothnian Bay … Danish Straits & Kattegat |
| North Sea | 0.68 million km² (without the English Channel and the Kattegat) | 1,611 | Skagerrak, northern, German Bight & Wadden Sea, southern, western |
| Mediterranean | 1.94 million km² (the Nile north of 22°N only) | 4,206 | Adriatic, Tyrrhenian, Aegean & Marmara, Levantine, western basin, Ionian & central |
| Black Sea | 2.38 million km² (with the Sea of Azov) | 850 | Sea of Azov, north-western shelf, eastern, western, southern |
| Caspian | 2.51 million km² (land that reaches it by river) | 816 | North, Middle, South Caspian |

Texts that name the sea are per-sea overlays on the Baltic dictionary (`src/app/core/i18n/seas.*.ts`), including each sea's sourced poster figures.

## What's on the map

- **Where the rivers end** (start view): the rivers sea by sea, revealed from the coast upstream; the tour starts playing 3 s after the map appears.
- **Top 20 river basins**: a guided tour of the 20 largest river basins, largest first, on the catchments map; its legend names all twenty colours. Closing the tour leaves you on the catchments map, whose Top 20 button starts it again. **Where the rivers end** works the same way, sea by sea, and closes onto the sea sub-basins.
- **River catchments**: every HydroBASINS catchment draining to the Baltic in one sand tone, coastal strips without a sizeable river slightly lighter, the drainage divide outlined. Clicking a catchment highlights it and turns its river network blue.
- **Sea sub-basins** (view switcher, top right): catchments tinted by the part of the sea they drain to (Bothnian Bay … Danish Straits & Kattegat), with the area of each in the legend.
- **Layers**: rivers (HydroRIVERS, line width by river class), country borders (dashed, off by default), labels.
- **Rivers / Countries panel**: rivers ranked by catchment area or discharge (searchable, filterable by sub-basin); each country's area and share of the drainage basin.
- **Catchment card**: area and rank, mean discharge, main-river and network length, mouth, nearest town, countries in the basin.

- **Links & sharing**: every view lives in the URL (`?view=mosaic&ground=dark`, `?view=catchments&basin=1`, `?step=3` for "Where the rivers end" (the start view), `?view=top&step=5`, `?view=poster&palette=black-neon&by=sea&basin=1`, `?view=raindrop&drop=22.6,50.2`, `&lang=pl`; older `?top=…` and `?basin=…` links still work); the address bar follows the map, and the share button (as in kmd-labs/el-nino) offers a QR code, the link to the current view and the app link.
- **Poster maker** (its own view; the Poster button opens it set up for the current view and river): a live preview and every choice — five colour schemes (white with black rivers, white with pastels, black with white, vivid or neon rivers), rivers coloured by basin or by sea, the whole drainage basin or one river's basin, title, subtitle and tagline, figures with numbered sources, sea names, A4 / A3 / A2 — and a PNG download at 300 dpi (150 dpi on phones and tablets) tagged with its resolution. The base map is drawn as vectors, so it stays sharp at any scale; the rivers are rendered by WebGL in tiles and blended on top (with a soft glow for neon). Figures on the whole-basin poster cite HydroRIVERS, HELCOM PLC-7 and State of the Baltic Sea, and Björck et al. 2008.
- **Map buttons**: zoom in, zoom out and back to the whole basin, under the view switcher.

Colours are theme tokens defined in [`src/styles.scss`](src/styles.scss) from the design-system palette and read by the globe through `ThemeService`.

## Data & method

| Layer | Source |
| --- | --- |
| River network, catchments, discharge | HydroRIVERS v1.0 / HydroBASINS v1c (Lehner & Grill 2013, WWF / HydroSHEDS), WaterGAP mean flow 1971–2000 |
| Land, lakes, borders | Natural Earth |
| River names (new seas) | Wikidata, Natural Earth |
| Population (new seas) | GHSL GHS-POP R2023A, 2025 (European Commission, JRC) |
| Towns at river mouths (new seas) | GeoNames |

`src/assets/data/<sea>.json` and `<sea>.streams.json` are built by `node scripts/build-data.mjs <sea>` from `data/<sea>.source.json` (the Baltic's also from `data/rivers.hr.json`).

The new seas' sources come from `python -I scripts/build-sea.py north|black|caspian|med` (raw inputs: `sh data/raw/download.sh` — HydroBASINS level 12, HydroRIVERS, Natural Earth, GeoNames — plus the GHSL GHS-POP 2025 grid; all git-ignored). Every HydroRIVERS outlet whose mouth lies on the sea's water within a rough polygon of the sea belongs to it; its catchment is made of the HydroBASINS units whose largest reach is in that river system, simplified as one coverage. Names: Wikidata rivers whose mouth (P403) is the sea or part of it, matched by mouth coordinates and drainage area (snapshot in `data/wikidata/`), else Natural Earth river lines along the lower main stem. Nearest towns from GeoNames, country shares from Natural Earth, populations from GHSL. Relief: `python -I scripts/build-relief.py <sea>` (ETOPO1 via ERDDAP for the sea's cut-out box).

River geometry: `python scripts/build-rivers.py` matches every reach of the source export to the original HydroRIVERS v1.0 (download the Europe shapefile into `data/hydrorivers/`, see the script header) by its end points, smooths the 15″ grid staircase (two Chaikin passes) and simplifies at 80 m. The export had cut reaches down to ~3 vertices each — straight chords km long. Checked against OpenStreetMap, streams draining under 100 km² are often off the real channel in flat land, so the build leaves out streams under 50 km² upstream, unnamed river systems under 100 km² and rivers on islands under 500 km² (constants at the top of `build-data.mjs`).

Other clean-ups, also at build time:

- HydroRIVERS routes flow through lakes as straight connector reaches (hundreds of parallel lines across Ladoga and Onega). River segments whose midpoint lies on a Natural Earth lake are skipped, so rivers stop at the shore.
- HydroBASINS leaves holes inside the biggest lakes (Ladoga, Peipus) that showed up as stray jagged outlines; hole rings lying ≥ 80 % on a lake are dropped.
