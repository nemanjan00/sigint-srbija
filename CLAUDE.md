# sigint-srbija

Collects public signal sources in Serbia (repeaters, beacons, licences, ...) into one place.

- Always use the /implement-js skill when writing JS here.
- `yarn fetch` fetches all sources into the global DB and resolves coordinates; `yarn fetch <id> ...` only the given ones.

## Web UI (map)

`yarn web` (forever) / `yarn watch` (nodemon) → http://localhost:3000 (`PORT` env to change; 3000 is taken on this machine, use e.g. `PORT=3300`).

- `src/index.js` → `src/web` (express): `GET /api/map` = all emitters with coordinates as compact arrays (cached until `sources.fetched_at` changes), `GET /api/emitters/:id` = full row + reg203 detail and the licence's other assignments.
- `src/web/public/` — static page, no build: MapLibre GL **5.x** UMD (6.x is ESM-only), CARTO dark-matter basemap (label fonts must be ones it serves, e.g. "Montserrat SemiBold"), UI from **qrp-shadcdn** (the user's shadcn port on qrp, CDN `+esm` bundle; Tailwind browser build + its `tailwind-theme.js`). Import qrp core (`state`, `el`, `when`, …) from the same bundle URL — never a second qrp copy.
- All filtering is client-side over ~74k points; search folds Cyrillic → Latin and strips diacritics. Clusters: amber = licences, cyan = all-amateur, cyan glow = contains amateur; clicking a small cluster or any cluster at zoom ≥ 12 lists its emitters.
- Shareable URLs (History API): `/e/<source>/<source_key>` = open emitter (server serves index.html for `/e/*`, client resolves via `GET /api/emitter?source=&key=`); query string = non-default filters (`q, kind, src, band, min, max, type, svc, sector, owner, active, precise`) + map view `map=zoom/lat/lon`. **No `#` fragments** (user wants plain HTML5 URLs). Opening an emitter pushes history; filters/moves replaceState. **Links depend on `source_key` being stable across re-fetches** — never use row ids (reg203 key = licence number + `~` + sha1 of the assignment's content).
- qrp-shadcdn is pinned in `index.html` + `app.js` (currently 0.4.0 → qrp 0.14.0); bump both together. Use qrp's `onChange(source, cb)` instead of `effect` + `untracked`.
- Responsive: below 768 px the filter panel and details are bottom sheets under a top bar (search + Filters button); bigger tap radius on touch devices. Check both a desktop and a phone viewport (390×844, touch) when changing layout.
- `window.sigintMap` exposes the map for debugging; verify UI changes in a real browser (headless Chromium + puppeteer-core works with `--use-angle=swiftshader`).

## Storage (global)

One SQLite database, `data/sigint.sqlite` (gitignored), `src/storage`:

- `emitters` — every source's records in one schema: kind, mode, callsign, dmr_id, operator, tx/rx Hz, city, location, locator, lat/lon (WGS 84), coord_source, coord_accuracy_m, active, raw (source record as JSON). Unique on (source, source_key); a fetch replaces all rows of that source.
- `sources` — id, url, fetched_at, emitter_count.
- Detail tables of big sources live in the same DB with a prefix (`reg203_*`).

## Coordinates (`src/geo`, runs after every fetch)

Rows with `coord_source = 'source'` got coordinates from their own source. Rows without coordinates are filled from other sources and recomputed each run, in this order: same DMR ID → same callsign (+ compatible TX) → same TX + place name → gazetteer → Maidenhead locator. Donor sources: `yu1srs-map`, then `brandmeister`. `coord_source` records how (e.g. `yu1srs-map:callsign`).

- Gazetteer: `data/gazetteer.json` (tracked). `yarn gazetteer` geocodes still-unresolved "site, city" and city names via OSM Nominatim (1 req/s). Entries are often wrong for generic names. Review them, fix by hand, and set `"reviewed": true`. A `null` entry means not found; retry with `--retry-missing`.
- Licences (reg203) without coordinates are mobile stations and are not resolved.
- reg203 positions clearly outside Serbia (not within 0.3° of `data/boundary.geojson`, a simplified OSM Serbia + Kosovo outline) are register typos. If exactly one simple fix (lat/lon swap, ±1°, ±10°) lands inside, it is used with `coord_source = 'source:corrected:<fix>'` and the published position kept in `raw.published_position`; otherwise no position. `geo` treats any `source%` coord_source as source-given.
- reg203 Bessel coordinates are converted to WGS 84 (`src/utils/datum`, EPSG:3906 shift) in emitters; `reg203_assignments` keeps the original datum.

## Licence holder sector

`emitters.sector` / `emitters.owner` (public | private | amateur). For reg203 they are guessed from the holder name by ordered regex rules in `src/reg203/sector` (folded to lowercase Latin via `src/utils/text`). Police and military are not in the public register; there is no modulation / emission class field anywhere in reg203. Check the distribution after editing rules (top holders per sector).

## Layout

- `src/sources/<id>/index.js` — `{ id, description, url, fetch() }`, `fetch()` resolves to emitters (objects with the `emitters` column names; `source_key` required, `raw` any JSON). Registered in `src/sources/index.js`.
- `src/web` — map UI + API (see above).
- `src/services/` — HTTP clients (`ratel-registry`, `ratel-website`, `brandmeister`, `nominatim`).
- `src/reg203` (+ `parser`, `database`) — RATEL licence register; `yarn reg203-enrich` adds HTML-only fields (slow, ~8k pages).
- `src/ratel-docs` + `bin/ratel-docs.js` — RATEL document mirror → `lib/` (gitignored). Not emitters.
- `src/utils/` — `table` (HTML table parser), `frequency` (MHz → Hz), `maidenhead`, `datum`, `ratel` (RATEL value parsers), `retry` (don't use got's own retry, it can crash got 11).
- Details on RATEL in `docs/ratel.md`.

## Adding a source

1. Create `src/sources/<id>/index.js` (see `brandmeister` for a small one).
2. Register it in `src/sources/index.js`.
3. If it publishes good coordinates other sources could reuse, consider adding it to `DONORS` in `src/geo`.
4. `yarn fetch <id>` and `yarn lint`.

## Conventions

- Keep published values in `raw`; normalized columns are null when a value is implausible (e.g. typo `43090000` MHz). Don't silently fix source typos.
- Document per-type column meaning in a comment in the source module.
- Don't collect personal locations (e.g. BrandMeister 7-digit hotspot IDs are excluded).

## Sources

- `yu1srs-repeaters` — https://yu1srs.org.rs/repetitori-u-srbiji-tabelarno/ — SRS table (DMR/VHF/UHF/RUM repeaters, APRS, beacons). No coordinates; resolved via geo.
- `yu1srs-map` — Google My Maps KML behind https://yu1srs.org.rs/repetitori-u-srbiji/ — same network with coordinates, plus repeaters in neighbouring countries.
- `brandmeister` — BrandMeister API, master 2302, DMR IDs 220xxx (repeaters only). Some positions are city centres (YU0DZA, YU0DKS ~8-10 km off the map).
- `ratel-reg203` — https://registar.ratel.rs/cyr/reg203 — every RF licence (~161k assignments); raw CSV kept in `data/reg203/`.
