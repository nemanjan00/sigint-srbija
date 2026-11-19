# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# sigint-srbija

Collects public signal sources in Serbia (repeaters, beacons, licences, ...) into one SQLite database and shows them on a map. README.md has the user-facing overview.

- Always use the /implement-js skill when writing JS here (CommonJS on the server, ES modules only in `src/web/public/`).

## Commands

- `yarn fetch [source-id ...]` — fetch sources into `data/sigint.sqlite`, then merge duplicates and resolve coordinates (`src/geo`). ~25 s for all; reg203 downloads ~100 MB.
- `yarn reg203-enrich [--limit-pages N]` — HTML-only licence fields from ~8k RATEL pages (~15 min). Use `--limit-pages 3` to test.
- `yarn gazetteer [--retry-missing]` — geocode unresolved site names (Nominatim, 1 req/s).
- `yarn bandplan [pdf]` — parse the band plan PDF into `data/bandplan.json` (tracked; needs poppler `pdftotext`). Default PDF path is the `lib/` mirror (`yarn ratel-docs regulativa-elektronske-komunikacije`).
- `yarn ratel-docs [--tree] [slug ...]` — RATEL document mirror into `lib/`.
- `PORT=3300 yarn web` (forever) / `yarn watch` (nodemon) — map server.
- `yarn lint` — ESLint (eslint 8, `.eslintrc.json`; `src/web/public` linted as browser ES modules). `npx eslint --fix <file>` fixes indentation.
- No test suite. Verify data changes with sqlite3 queries against `data/sigint.sqlite`, UI changes in headless Chromium (see Web UI).
- `SIGINT_DB=/path/to.sqlite` points every command at another database (e.g. a scratch rebuild).
- The DB is fully rebuildable with `yarn fetch && yarn reg203-enrich` (current data only — sources are live, past states are not reproducible).

## Deployment

- `.github/workflows/image.yml` (same shape as ~/meat-proxy) builds `ghcr.io/nemanjan00/sigint-srbija` (`latest` + short sha, amd64/arm64) on every push to main/master; `ci.yml` lints.
- Runs on `root@dmr.nemanja.top` (Docker Swarm, Traefik on the external `flocksocial` network, like the other stacks there). Stack file: `deploy/docker-stack.yml`, copied to `/root/sigint-srbija/docker-stack.yml`, deployed with `docker stack deploy --with-registry-auth -c docker-stack.yml sigint-srbija`; host https://sigint.nemanja.top. The GHCR package is public, so the server pulls without login.
- The database is not in the image. It is copied to the server and mounted: `/data/sigint/sigint.sqlite` → container `SIGINT_DB=/data/sigint/sigint.sqlite` (directory mount, SQLite needs to write WAL files next to it). One replica (SQLite).
- Data updates itself: the `updater` service (`bin/cron.js`, node-cron, `UPDATE_SCHEDULE` default `0 4 * * *` Europe/Belgrade) runs `bin/fetch.js` then `bin/reg203-enrich.js` as child processes against the mounted DB; the web service's cache follows `sources.fetched_at`. Raw reg203 CSVs are kept next to the DB (`<db dir>/reg203/`, newest `REG203_KEEP_CSV`=7). A reg203 rebuild carries enrichment over to unchanged assignments, so names don't regress until enrichment reruns. Logs: `docker service logs sigint-srbija_updater`.
- Replace the data by hand: `sqlite3 data/sigint.sqlite ".backup /tmp/s.sqlite"`, copy it over the server file, then `docker service update --force sigint-srbija_web`.
- Update the app: push to main (`git push origin master:main` — local branch is master), wait for the Image workflow, then `docker service update --image ghcr.io/nemanjan00/sigint-srbija:<short sha> --with-registry-auth` for `sigint-srbija_web` and `sigint-srbija_updater`. The sha tag has **no prefix** (`3e6a1d4`, not `sha-3e6a1d4`); a wrong tag takes the site down.

## Gotchas found the hard way

- `queue-promised` (0.0.31, the user's library) never lets the process exit once its queue drains (`runWaiter` re-arms forever). Bins that use `wrapper()` end with an explicit `process.exit(0)` (marked TODO).
- got 11's built-in `retry` can crash the process with an uncatchable p-cancelable error; use `src/utils/retry` instead.
- registar.ratel.rs omits its TLS intermediate; `src/services/ratel-registry` fetches it from Sectigo and adds it to the CA list. Never disable verification.
- reg203 search pages are 1-based (`page=0` aliases page 1); the highest linked page is the last.
- Express 5 passes listen errors to the `listen` callback instead of throwing.

## Web UI (map)

Default port 3000 is taken on the dev machine; use `PORT=3300`.

- `src/index.js` → `src/web` (express): `GET /api/map` = all emitters with coordinates as compact arrays (cached until `sources.fetched_at` changes), `GET /api/emitters/:id` = full row + reg203 detail and the licence's other assignments.
- `src/web/public/` — static page, no build: MapLibre GL **5.x** UMD (6.x is ESM-only), CARTO dark-matter basemap (label fonts must be ones it serves, e.g. "Montserrat SemiBold"), UI from **qrp-shadcdn** (the user's shadcn port on qrp, CDN `+esm` bundle; Tailwind browser build + its `tailwind-theme.js`). Import qrp core (`state`, `el`, `when`, …) from the same bundle URL — never a second qrp copy.
- All filtering is client-side over ~74k points; search folds Cyrillic → Latin and strips diacritics. Clusters: amber = licences, cyan = all-amateur, cyan glow = contains amateur; clicking a small cluster or any cluster at zoom ≥ 12 lists its emitters.
- Shareable URLs (History API): `/e/<source>/<source_key>` = open emitter (server serves index.html for `/e/*`, client resolves via `GET /api/emitter?source=&key=`); query string = non-default filters (`q, kind, src, band, min, max, type, svc, sector, owner, active, precise`) + map view `map=zoom/lat/lon`. **No `#` fragments** (user wants plain HTML5 URLs). Opening an emitter pushes history; filters/moves replaceState. **Links depend on `source_key` being stable across re-fetches** — never use row ids (reg203 key = licence number + `~` + sha1 of the assignment's content).
- qrp-shadcdn is pinned in `index.html` + `app.js` (currently 0.4.1 → qrp 0.15.0); bump both together. Use qrp's `onChange(source, cb)` instead of `effect` + `untracked`.
- Responsive: below 768 px the filter panel and details are bottom sheets under a top bar (search + Filters button); bigger tap radius on touch devices. Check both a desktop and a phone viewport (390×844, touch) when changing layout.
- `window.sigintMap` exposes the map for debugging; verify UI changes in a real browser (headless Chromium + puppeteer-core works with `--use-angle=swiftshader`).

## MCP (`src/mcp`, POST /mcp)

Public, read-only, stateless Streamable HTTP MCP server on the web app (official `@modelcontextprotocol/sdk`, zod schemas); one server + transport per request. Tools: `search_emitters`, `find_frequency`, `get_emitter`, `band_plan`, `database_info`; all results carry the map `url`. Search runs in memory over every emitter (`src/search`, cached per `sources.fetched_at`, folded text). User-facing docs with client setup commands: `docs/mcp.md`. Test with the SDK client (`StreamableHTTPClientTransport`), not by editing the user's MCP config.

## Storage (global)

One SQLite database, `data/sigint.sqlite` (gitignored), `src/storage`:

- `emitters` — every source's records in one schema: kind, mode, callsign, dmr_id, operator, tx/rx Hz, city, location, locator, lat/lon (WGS 84), coord_source, coord_accuracy_m, active, raw (source record as JSON). Unique on (source, source_key); a fetch replaces all rows of that source.
- `sources` — id, url, fetched_at, emitter_count.
- Detail tables of big sources live in the same DB with a prefix (`reg203_*`).

## Duplicates (`src/geo`, runs after every fetch)

The same station is often listed by several sources (SRS map, BrandMeister, SRS table). `emitters.duplicate_of` links each listing to the best-ranked listing of the same station (rank = `DONORS` order, then everything else). Same station = same DMR ID, or same callsign + kind with TX within 250 kHz (sources have frequency typos), or same TX within 2 kHz + place name. The map shows one pin per station (`?dups=1` shows all); details list the other listings and flag differing frequencies. Licences are never linked.

## Coordinates (`src/geo`, runs after every fetch)

Rows with `coord_source = 'source'` got coordinates from their own source. Rows without coordinates are filled from other sources and recomputed each run, in this order: same DMR ID → same callsign (+ compatible TX) → same TX + place name → gazetteer → Maidenhead locator. Donor sources: `yu1srs-map`, then `brandmeister`. `coord_source` records how (e.g. `yu1srs-map:callsign`).

- Gazetteer: `data/gazetteer.json` (tracked). `yarn gazetteer` geocodes still-unresolved "site, city" and city names via OSM Nominatim (1 req/s). Entries are often wrong for generic names. Review them, fix by hand, and set `"reviewed": true`. A `null` entry means not found; retry with `--retry-missing`.
- Licences (reg203) without coordinates are mobile stations and are not resolved.
- reg203 positions clearly outside Serbia (not within 0.3° of `data/boundary.geojson`, a simplified OSM Serbia + Kosovo outline) are register typos. If exactly one simple fix (lat/lon swap, ±1°, ±10°) lands inside, it is used with `coord_source = 'source:corrected:<fix>'` and the published position kept in `raw.published_position`; otherwise no position. `geo` treats any `source%` coord_source as source-given.
- reg203 Bessel coordinates are converted to WGS 84 (`src/utils/datum`, EPSG:3906 shift) in emitters; `reg203_assignments` keeps the original datum.

## Band plan (`src/bandplan`, `data/bandplan.json`)

RATEL "Plan namene RF opsega — Tabela 1" (PDF, Dec 2025), parsed from `pdftotext -bbox` word positions: columns sit at fixed x on every page (`COLUMNS` in the parser); the `-layout` text output shifts columns per page, don't parse that. 583 contiguous bands, each with services (capitals = primary), footnotes and uses (application, condition, regulation, standards, licensing ПЗ/ЈН/ПН/ОО, transfer). Sub-ranges in a condition restrict a use only if they overlap the band and don't span it (others are paired-band references / tuning ranges).

- `english` — ITU service names, a dictionary of every application (add new ones when the PDF changes: check `english.application()` returns non-null for all), user groups from the condition (police/MUP, military, emergency, BIA). Conditions stay in Serbian.
- `hints` — "likely to hear" + typical bandwidth: the source's own mode wins (DMR/FM/APRS/beacon); licences use band-plan applications at the frequency ordered by reg203 station type (`STATION_TYPES.prefer`). A licensed TX range is used as the exact bandwidth.
- `src/web/spectrum` adds `spectrum` (band entry, hints, bandwidth) to `GET /api/emitters/:id`; `GET /api/bandplan` serves the whole plan translated (`bandplan.getPlan()`, ~45 kB gzipped). MCP: `band_plan` tool, `get_emitter.spectrum`.
- Spectrum explorer `src/web/public/spectrum.js` (canvas, no deps): log-frequency axis 3 kHz–3 THz, lanes = band allocations (colour by first primary service, `CATEGORIES`), reserved sub-bands (user groups), wide blocks (TX range ≥ 2 MHz: cell bands, RLAN bands), signals (map rows grouped by centre + width, bandwidth estimated by `signalWidth`), ruler. Wheel/pinch zoom, drag pan, click band = fit, click signal = open + fly. One instance is moved into each detail panel; a second one is the full-screen overlay (header "Spectrum" button / "Expand"), view in the URL as `?spectrum=lowMHz,highMHz`. Signals = what the map shows (`data.visible`, filters apply); main listings without a frequency borrow one from a duplicate.

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
- `ratel-reg204` — broadcasting register (kind `broadcast`, mode FM / TV), full CSV export with status. As of 2026-11 every TV assignment is marked expired (most on 2025-12-25), so TV shows only with "valid only" off.
- `ratel-reg221` — mobile network stations (kind `cell`), 154k rows grouped to one emitter per operator + site (key `operator/lat,lon`); TX = downlink of the lowest band, all bands/technologies in `raw`.
- `ratel-reg215` — licence-exempt registrations (kind `link`): export per `vrsta` (1000 RLAN, 2000 E-band links, one emitter per end; 3000 has no coordinates, skipped). Applicants are often private persons: never store name, address, phone, e-mail, tax id, SSID, MAC; operator/site name only for the three mobile operators. ~270 rows have lat/lon swapped (corrected via `toWgs84`).
- Register kinds (`licence`, `broadcast`, `cell`, `link`) are excluded from duplicate merging and position resolution (`NOT_REGISTER` in `src/geo`); the RATEL exports share `ratel.parseExport` (UTF-16 TSV → objects) and `getCsvExport(register, params)`.
