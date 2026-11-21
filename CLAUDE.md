# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# sigint-srbija

Collects public signal sources in Serbia (repeaters, beacons, licences, ...) into one SQLite database and shows them on a map. README.md has the user-facing overview.

- Always use the /implement-js skill when writing JS here (CommonJS on the server, ES modules only in `src/web/client/`).

## Commands

- `yarn fetch [source-id ...]` — fetch sources into `data/sigint.sqlite`; duplicates and coordinates (`src/geo`, ~0.1 s) are resolved after **every** source, so a crash mid-run never leaves unlinked duplicates. ~25 s for all; reg203 downloads ~150 MB.
- `yarn reg203-enrich [--limit-pages N]` — HTML-only licence fields from ~8k RATEL pages (~15 min). Use `--limit-pages 3` to test.
- `yarn gazetteer [--retry-missing]` — geocode unresolved site names (Nominatim, 1 req/s).
- `yarn bandplan [pdf]` — parse the band plan PDF into `data/bandplan.json` (tracked; needs poppler `pdftotext`). Default PDF path is the `lib/` mirror (`yarn ratel-docs regulativa-elektronske-komunikacije`).
- `yarn ratel-docs [--tree] [slug ...]` — RATEL document mirror into `lib/`.
- `yarn build` / `yarn build-watch` — build the page (`bin/build.js`): esbuild bundles `src/web/client/app.js` (+ qrp-shadcdn, maplibre-gl from node_modules) and the Tailwind CLI builds `client/index.css` into `src/web/dist/` (gitignored, served by express). Run it before `yarn web`; the Docker image builds it.
- `PORT=3300 yarn web` (forever) / `yarn watch` (nodemon) — map server.
- `yarn lint` — ESLint (eslint 8, `.eslintrc.json`; `src/web/client` linted as browser ES modules, `src/web/dist` ignored). `npx eslint --fix <file>` fixes indentation.
- No test suite. Verify data changes with sqlite3 queries against `data/sigint.sqlite`, UI changes in headless Chromium (see Web UI).
- `SIGINT_DB=/path/to.sqlite` points every command at another database (e.g. a scratch rebuild).
- The DB is fully rebuildable with `yarn fetch && yarn reg203-enrich` (current data only — sources are live, past states are not reproducible).

## Deployment

- `.github/workflows/image.yml` (same shape as ~/meat-proxy) builds `ghcr.io/nemanjan00/sigint-srbija` (`latest` + short sha, amd64/arm64) on every push to main/master; `ci.yml` lints.
- Runs on `root@dmr.nemanja.top` (Docker Swarm, Traefik on the external `flocksocial` network, like the other stacks there). Stack file: `deploy/docker-stack.yml`, copied to `/root/sigint-srbija/docker-stack.yml` (next to the server-only `sigint.env` with secrets), deployed with `docker stack deploy --with-registry-auth -c docker-stack.yml sigint-srbija`; host https://sigint.nemanja.top. The GHCR package is public, so the server pulls without login.
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
- The server (4 GB, shared with other stacks, ~700 MB free) OOM-killed the nightly fetch when the reg203 export grew to 238k rows (2026-11-21). reg203 is therefore streamed end to end: `parser.parseExportFile` (csv-parse stream) → `replaceAssignments(fill)` → `getEmitters()` returns an iterator → `storage.replaceEmitters` accepts any iterable. Peak ~150 MB instead of ~1 GB. Don't reintroduce whole-file / `.all()` arrays for reg203.

## Web UI (map)

Default port 3000 is taken on the dev machine; use `PORT=3300`.

- `src/index.js` → `src/web` (express): `GET /api/map` = all emitters with coordinates as compact arrays (cached until `sources.fetched_at` changes), `GET /api/emitters/:id` = full row + reg203 detail, the licence's other assignments and `record_url` (register search by licence number = the record's source; RATEL has no per-record page).
- `src/web/client/` — page sources, bundled into `src/web/dist/` by `yarn build` (no CDN scripts: CDN imports are for prototypes only). MapLibre GL **5.x** (npm `maplibre-gl`), CARTO dark-matter basemap (label fonts must be ones it serves, e.g. "Montserrat SemiBold"), UI from **qrp-shadcdn** (the user's shadcn port on qrp, npm `@nemanjan00/qrp-shadcdn`, peer `@nemanjan00/qrp`). Import qrp core (`state`, `el`, `when`, `onDispose`, …) from `@nemanjan00/qrp-shadcdn` too, so there is one qrp copy. CSS: `client/index.css` (Tailwind v4 + tw-animate-css + qrp-shadcdn `theme.css` + maplibre CSS + `app.css`); Tailwind scans `client/` and the qrp-shadcdn components (`@source`). Class names must appear literally in those files.
- All filtering is client-side over ~74k points; search folds Cyrillic → Latin and strips diacritics. Clusters: amber = licences, cyan = all-amateur/community (`AMATEUR_KINDS`), cyan glow = contains amateur; clicking a small cluster or any cluster at zoom ≥ 12 lists its emitters.
- Shareable URLs (History API): `/e/<source>/<source_key>` = open emitter (server serves index.html for `/e/*`, client resolves via `GET /api/emitter?source=&key=`); query string = non-default filters (`q, kind, src, band, min, max, type, svc, sector, owner, active, precise`) + map view `map=zoom/lat/lon`. **No `#` fragments** (user wants plain HTML5 URLs). Opening an emitter pushes history; filters/moves replaceState. **Links depend on `source_key` being stable across re-fetches** — never use row ids (reg203 key = licence number + `~` + sha1 of the assignment's content).
- qrp-shadcdn 0.4.1 → qrp 0.15.0 (package.json; bump qrp with it, it's a peer dependency). Use qrp's `onChange(source, cb)` instead of `effect` + `untracked`.
- Responsive: below 768 px the filter panel and details are bottom sheets under a top bar (search + Filters button); bigger tap radius on touch devices. Check both a desktop and a phone viewport (390×844, touch) when changing layout.
- `window.sigintMap` exposes the map for debugging; verify UI changes in a real browser (headless Chromium + puppeteer-core works with `--use-angle=swiftshader`).

## RF panorama (`src/web/client/panorama.js`)

Sites (map rows within the radius, grouped by position, filters apply) around an observer: 360° horizon strip (canvas; x = bearing, y = nearness, drag = turn, wheel = field of view; phones start at 120°) + north-up radar (sqrt distance). Opened by "Panorama from here" (detail), map right-click, "Around me" (geolocation; then not put in the URL), URL `?pano=lat,lon,km`. AR: rear camera (`getUserMedia`) under the strip, heading from `deviceorientationabsolute` (alpha) or iOS `webkitCompassHeading`, tilt from beta, GPS via `watchPosition` when the observer is the user. AR is full screen (Fullscreen API requested in the tap, before permission prompts) with a floating toolbar and a filter sheet bound to the map's own filter state (kind, band, radius). iOS needs `DeviceOrientationEvent.requestPermission()` from a tap; without sensor access AR still runs and the view is dragged. Needs HTTPS. Test in headless Chromium with `--use-fake-device-for-media-stream`, `page.setGeolocation` and a dispatched `DeviceOrientationEvent`.

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
- Spectrum explorer `src/web/client/spectrum.js` (canvas, no deps): log-frequency axis 3 kHz–3 THz, lanes = band allocations (colour by first primary service, `CATEGORIES`), reserved sub-bands (user groups), wide blocks (TX range ≥ 2 MHz: cell bands, RLAN bands), signals (map rows grouped by centre + width, bandwidth estimated by `signalWidth`), ruler. Wheel/pinch zoom, drag pan, click band = fit, click signal = open + fly. One instance is moved into each detail panel; a second one is the full-screen overlay (header "Spectrum" button / "Expand"), view in the URL as `?spectrum=lowMHz,highMHz`. Signals = what the map shows (`data.visible`, filters apply); main listings without a frequency borrow one from a duplicate.

## Repeater access (`src/access`)

CTCSS (PL) tone and DMR colour code / timeslot talkgroups parsed from the amateur sources' `raw` (SRS table `cc`/`ts1`/`ts2` — `cc` is the tone for VHF/UHF/RUM and the colour code for DMR; SRS map `PL` incl. split tone "RX-123, TX-88.5" and `TS1`/`TS2` "TG220"; BrandMeister `colorcode`). Fields: `ctcss_hz` (tone to open the repeater), `ctcss_out_hz` (only when a different output tone is published), `color_code`, `ts1_tg`, `ts2_tg`; implausible values ("nema rep") are dropped. A station's `access` = its own listing's fields, missing ones from its other listings (`access.merge` in rank order). `GET /api/emitters/:id` → `access` + per-listing `listings[].access` (details flag differing tones); MCP search results and `get_emitter` carry `access` (`src/search` computes it on load).

## BrandMeister live (`src/live`, `src/web/client/hose.js`)

- On-air state: the web process follows the BrandMeister last-heard feed (`src/services/brandmeister-lastheard`, Socket.IO v4 spoken over `ws`, reconnects with backoff; `SIGINT_LIVE=0` turns it off). Only sessions on master 2302 whose ContextID is a listed repeater's DMR ID count (hotspots are never tracked). Memory only: per main listing the running call, the last call (callsign + name, talkgroup or the station called privately — public amateur data, shown as BrandMeister publishes it) and talkgroups heard in the last 24 h. `GET /api/live` = SSE (`snapshot`, then `station` {id, state}), registered **before** `compression()` (it buffers streams); `getEmitter().live`; MCP `get_emitter.live`.
- Feed facts (observed 2026-11): master 2302 only publishes `Session-Stop` (no Start/Update), so calls show when they end. The map pulses a ring (`onair-ring`) for 30 s after a call (`JUST_HEARD_MS`) or while a call runs. On connect the feed replays the last ~20 min of sessions, so times come from the session's Start/Stop, never arrival, and older sessions don't replace newer ones. Master 2302 also carries Czech (OK, 230xxx) traffic. Serbian traffic is sparse; test UI with a fake feed (replace `lastheard.follow` before `live.start()`).
- Listen: `hose.js` connects the browser straight to Hoseline (`wss://hose.brandmeister.network/spotter/?token=test:test`, the public token BrandMeister's own page uses; works from our origin), MessagePack `[type, ...args]` (1 join [tgs], 11 call start, 21 alias, 20 µ-law 8 kHz audio 960 B/120 ms, 22 level dB, 12/13 drop/end), played with Web Audio. One talkgroup at a time, floating player bar. If the direct connection fails or isn't open within 5 s (blocking extensions, filtered networks — seen in the user's Firefox), the page switches to the relay for the rest of the visit: `src/hose-relay` = WebSocket `/api/hose` on the web server (`upgrade` handler in `src/index.js`), passes the spotter protocol through unchanged, client messages ≤256 B, max 50 relayed listeners. Test the fallback in Chromium with `--host-resolver-rules=MAP hose.brandmeister.network 127.0.0.1`. Details offer the published TS1/TS2 talkgroups plus the ones heard; "Hoseline ↗" = `https://hose.brandmeister.network/?subscribe=<tg,...>`.

## Live layers: APRS and aircraft

- APRS (`src/aprs`, `src/services/aprs-is`): the web process keeps one APRS-IS connection (rotate.aprs2.net:14580, read-only login `SIGINTRS` pass -1 — aprsc refuses `N0CALL` — filter `r/44.1/20.9/320`), parses with `aprs-parser`. Memory only, 6 h: last position per station within ~0.3° of Serbia (category digi / igate / weather / object / station from symbol + comment) and per callsign when heard (own packets, digipeated = `CALL*` in the path, gated = call after qAR/qAO). `GET /api/aprs` (map layer "APRS live", `?aprs=1`, polled every 30 s); `getEmitter().aprs` → details "APRS live" for digipeaters/beacons/repeaters; MCP `get_emitter.aprs`. aprs.fi itself isn't used: its API needs a key and its terms don't allow republishing; it shows the same APRS-IS packets.
- Aircraft (`src/aircraft`, `src/services/adsb-lol`): adsb.lol `/v2/lat/44.1/lon/20.9/dist/190` (no CORS). One shared copy for everyone, refreshed at most every 10 s and only on demand (a request finding it stale starts one fetch). `GET /api/aircraft` (layer "Aircraft live", `?air=1`, polled every 10 s; plane icon rotated by track, label flight + FL). Nothing stored.
- Both layers are client-side `liveLayer()` instances: they poll only while switched on and the tab is visible. Toggles: the "Live" chips at the top of the filter panel (`LIVE_LAYERS`: Aircraft, APRS, EMF drive tests); "Show only live layers" empties `s.kinds` (URL `?kind=`) to hide every fixed station.
- `SIGINT_LIVE=0` stops BrandMeister and APRS-IS connections.

## Licence holder sector

`emitters.sector` / `emitters.owner` (public | private | amateur). For reg203 they are guessed from the holder name by ordered regex rules in `src/reg203/sector` (folded to lowercase Latin via `src/utils/text`). Police and military are not in the public register; there is no modulation / emission class field anywhere in reg203. Check the distribution after editing rules (top holders per sector).

## Layout

- `src/sources/<id>/index.js` — `{ id, description, url, fetch() }`, `fetch()` resolves to emitters (objects with the `emitters` column names; `source_key` required, `raw` any JSON). Registered in `src/sources/index.js`.
- `src/web` — map UI + API (see above).
- `src/services/` — HTTP clients (`ratel-registry`, `ratel-website`, `brandmeister`, `nominatim`) and the `brandmeister-lastheard` WebSocket feed.
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
- Don't collect personal locations from sources that aren't public registers (e.g. BrandMeister 7-digit hotspot IDs, Meshtastic client nodes are excluded). Public register rows (RATEL) are kept as published.

## Sources

- `yu1srs-repeaters` — https://yu1srs.org.rs/repetitori-u-srbiji-tabelarno/ — SRS table (DMR/VHF/UHF/RUM repeaters, APRS, beacons). No coordinates; resolved via geo.
- `yu1srs-map` — Google My Maps KML behind https://yu1srs.org.rs/repetitori-u-srbiji/ — same network with coordinates, plus repeaters in neighbouring countries. Its unnamed LineStrings (RU network backbone + a few VHF/UHF links) become `raw.links = [{ key, color }]` on both end stations (vertex snapped to the nearest station of the line's layer within 200 m, else nearest station). `GET /api/map` returns `links: [[fromId, toId, color]]` between main listings; the map draws them (layer `links-line`, shown when both ends pass the filters) and details list "Linked to".
- `brandmeister` — BrandMeister API, master 2302, DMR IDs 220xxx (repeaters only). Some positions are city centres (YU0DZA, YU0DKS ~8-10 km off the map).
- `ratel-reg203` — https://registar.ratel.rs/cyr/reg203 — every RF licence (~161k assignments); raw CSV kept in `data/reg203/`.
- `ratel-reg204` — broadcasting register (kind `broadcast`, mode FM / TV), full CSV export with status. As of 2026-11 every TV assignment is marked expired (most on 2025-12-25), so TV shows only with "valid only" off.
- `ratel-reg221` — mobile network stations (kind `cell`), 154k rows grouped to one emitter per operator + site (key `operator/lat,lon`); TX = downlink of the lowest band, all bands/technologies in `raw`.
- Contributed cell observations (`src/cell-observations`): `data/donation.json` next to the DB (`SIGINT_CELL_OBSERVATIONS` overrides; prod: `/data/sigint/donation.json`, copied by hand). **Never commit it** (gitignored + dockerignored); it is not a source, it only enriches `ratel-reg221` sites with `raw.observed` (cells: id, technology, downlink carriers via `src/utils/arfcn`, distance). Match = nearest site of the same operator with that technology registered, ≤100 m, not ambiguous (~39% of observations, ~7.7k sites). MNC 1 = Yettel, 3 = Telekom Srbija, 5 = A1 (the file's own `mnc_name` is wrong for 5). Its `bands` don't line up with `channels`; the band comes from the channel number. Missing file = no enrichment (warning only).
- `ratel-reg215` — licence-exempt registrations (kind `link`): export per `vrsta` (1000 RLAN, 2000 E-band links, one emitter per end; 3000 = CB, see `ratel-reg215-cb`). `operator` = applicant as published (mobile operators by short name), `location` = published site; `raw.published` = the register row unchanged (public data — the user wants it kept as published). ~270 rows have lat/lon swapped (corrected via `toWgs84`).
- `ratel-reg215-cb` — reg215 vrsta 3000: CB radio stations (kind `cb`, 27 MHz band, ~54 rows, all private persons). No coordinates in the register: the address (street + place) is geocoded by `src/geocoder` (Nominatim, cache table `geocode_cache` in the DB — never in tracked files, these are home addresses), falling back to the place; `coord_source` `source:geocoded:address|place` (must start with `source`, or `src/geo` clears it). `location` = published address, `raw.published` = the row unchanged (RATEL publishes CB rows without the applicant name).
- `jugomesh` — https://jugomesh.com (Malla, Meshtastic MQTT analyser) `GET /api/locations?max_age_hours=720`, kind `mesh`. Only ROUTER / ROUTER_LATE / REPEATER roles: CLIENT* nodes are personal radios (personal locations). TX = 869.525 MHz (EU_868 has one slot for 250 kHz presets). `traceroute_links` in the same response could draw mesh links later.
- `ttn` — The Things Network LoRaWAN gateways (kind `lorawan`), from the Packet Broker mapper (`src/services/packetbroker`, `GET /api/v2/gateways` with `distanceWithin[latitude|longitude|distance]`; unfiltered it is ~40 MB worldwide). Only TTN v3 (netID 000013, tenant `ttn`; `ttnv2` is the network shut down in 2021), inside `data/boundary.geojson`, status updated within 365 days (~34 gateways, ~22 online). `active` = online now. EU868 plan: RX 867.1–868.5, TX up to RX2 869.525 MHz. Helium was checked (2026-11) and left out: `entities.nft.helium.io/v2/hotspots?subnetwork=iot` lists ~1M hotspots (~10k in the Serbia box) with positions but no liveness (`is_active` is false for all).
- `ourairports` — aviation radio (kind `aviation`) from OurAirports CSVs (`src/services/ourairports`, worldwide, filtered by `data/boundary.geojson`): navaids (VOR/VOR-DME/TACAN/NDB; callsign = Morse ident, `raw.dme_reply_mhz` computed from the DME channel) and airport frequencies (TWR/APP/GND/ATIS…, at the airport position, callsign = airport ident). ~53 rows. Community data, not checked against AIP.
- `ratel-emf` — RATEL EMF monitoring (https://emf.ratel.rs; `src/services/ratel-emf` scrapes the pages' scripts, no API): 118 fixed broadband (100 kHz–7 GHz) field sensors as kind `emf` (they measure, no frequency). Live values: `GET /api/emf/stations/:key/series` fetches the station's chart page for the last 2 days on demand (~1 MB, 6-min values ~1 h behind), cached 10 min in `src/emf`. Scraping all stations periodically would be ~130 MB per round: don't. The fetch also replaces the 13 drive-test campaigns (~43k points, tables `emf_campaigns` / `emf_campaign_points`), served by `GET /api/emf/campaigns` and drawn as value-coloured dots (RATEL's scale `EMF_SCALE`) when "EMF drive tests" is on (`?emf=1`). Not a density heatmap on purpose: the car sampled every few seconds, so density would show the route, not the field. **emf.ratel.rs refuses connections from outside Serbia** (prod is in Germany; TCP to 80/443 times out). Prod reaches it through a proxy in Serbia: `SIGINT_EMF_PROXY` (URL with credentials) comes from `/root/sigint-srbija/sigint.env` on the server (chmod 600, `env_file` in the stack) — **never commit it** (`*.env` is git- and dockerignored). It is a paid residential proxy: keep traffic low (only emf.ratel.rs uses it; campaigns are refetched only when RATEL's campaign list changes; live series are cached 10 min, failures 5 min, one 10 s attempt). RATEL's own CSV export links 404; the open data on data.gov.rs (`emf.ratel.rs/getOpenData/<id>/csv`, 13-40 MB each, no Range support) lags weeks.
- Register kinds (`licence`, `broadcast`, `cell`, `link`, `cb`), `lorawan`, `aviation` and `emf` are excluded from duplicate merging and position resolution (`NOT_REGISTER` in `src/geo`); the RATEL exports share `ratel.parseExport` (UTF-16 TSV → objects) and `getCsvExport(register, params)`.
