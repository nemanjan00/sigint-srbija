# SIGINT Srbija

Public radio signal sources in Serbia, collected into one database and shown
on one map: amateur repeaters, APRS digipeaters and beacons, DMR repeaters,
every radio licence in RATEL's public register (~161k frequency assignments),
FM and TV transmitters, mobile network base stations, registered Wi-Fi links and CB radio stations.

## What's in it

| source | what | positions |
|---|---|---|
| [SRS repeater table](https://yu1srs.org.rs/repetitori-u-srbiji-tabelarno/) | DMR / VHF / UHF / RUM repeaters, APRS digipeaters, beacons | none, resolved from the other sources |
| [SRS repeater map](https://yu1srs.org.rs/repetitori-u-srbiji/) | same network + repeaters in neighbouring countries | exact |
| [BrandMeister](https://brandmeister.network/) | DMR repeaters with Serbian IDs (`220xxx`) | exact |
| [RATEL reg203](https://registar.ratel.rs/cyr/reg203) | every radio-frequency licence: holder, TX/RX, site, station/service type, validity | fixed stations; mobile stations have none |
| [RATEL reg204](https://registar.ratel.rs/cyr/reg204) | broadcasting: FM radio and TV transmitters (frequency, channel, station ID, holder, site, validity) | exact |
| [RATEL reg221](https://registar.ratel.rs/cyr/reg221) | mobile network radio stations of Telekom Srbija, Yettel and A1 (band, 2G–5G), one pin per operator site; sites are enriched with observed cells (cell ids, downlink channels) from contributed measurements kept outside the repository (`data/donation.json`, never committed) | exact |
| [RATEL reg215](https://registar.ratel.rs/cyr/reg215) | registered licence-exempt stations: 2.4 / 5 / 60 GHz RLAN (Wi-Fi) stations and E-band links, with the applicant | exact |
| [RATEL reg215 CB](https://registar.ratel.rs/cyr/reg215) | registered CB (27 MHz) radio stations: address, radio, power, emission | geocoded from the registered address (OpenStreetMap), else the place |
| [Jugomesh](https://jugomesh.com/map) | Meshtastic LoRa mesh routers and repeaters (869.525 MHz); personal client nodes are left out | exact |
| [RATEL documents](https://www.ratel.rs/sr/rf-spektar) | spectrum plans and regulations (PDF/DOC), mirrored to `lib/` | — |

The same station listed by several sources is merged into one pin; its details
show every listing and flag frequency disagreements between them.

### Good to know about the data

- **No police or military.** They are not in RATEL's public register.
- **No modulation.** The register has no emission-class field.
- **Sector** (fire & rescue, ambulance & health, energy, telecom, private
  security, …) and **public / private** are guessed from the licence holder's
  name. The register has neither.
- **Register typos are corrected, not hidden.** About 30 licences have
  positions outside Serbia (23° typed for 22°, 10° for 20°, lat/lon swapped).
  When exactly one simple fix lands inside Serbia it is used and marked
  "corrected"; the published position is kept.
- Coordinates on the old Yugoslav datum (Bessel) are converted to WGS 84.
- Positions guessed from a city name or a Maidenhead locator carry an accuracy
  radius and can be hidden with "Precise positions only".

## Quick start

Needs Node.js 22.13+ (built-in `node:sqlite`) and yarn.

```sh
yarn install
yarn fetch              # all sources -> data/sigint.sqlite (~25 s, downloads ~100 MB)
yarn reg203-enrich      # optional: extra licence fields from ~8k RATEL pages (~15 min)
yarn build              # bundle the map page (esbuild + Tailwind) into src/web/dist
PORT=3300 yarn web      # map on http://localhost:3300
```

| command | does |
|---|---|
| `yarn fetch [source ...]` | fetch all (or the named) sources, then merge duplicates and resolve positions. Sources: `yu1srs-repeaters`, `yu1srs-map`, `brandmeister`, `ratel-reg203`, `ratel-reg204`, `ratel-reg221`, `ratel-reg215`, `ratel-reg215-cb`, `jugomesh` |
| `yarn reg203-enrich` | add holder name/address, inspection and start-of-use dates, full station description to licences |
| `yarn gazetteer` | geocode site names that still have no position (OpenStreetMap Nominatim, 1 req/s) into `data/gazetteer.json` — review the result, wrong matches happen |
| `yarn bandplan [pdf]` | parse RATEL's band plan table (PDF, needs `pdftotext`) into `data/bandplan.json` |
| `yarn ratel-docs [slug ...]` | mirror RATEL documents into `lib/` (`--tree` to only list pages) |
| `yarn build` / `yarn build-watch` | bundle the map page (`src/web/client` → `src/web/dist`: esbuild, Tailwind CLI) |
| `yarn web` / `yarn watch` | map server + MCP (forever / nodemon) |
| `yarn cron` | scheduled update: `fetch` + `reg203-enrich` every night at 04:00 Europe/Belgrade (`UPDATE_SCHEDULE`, `UPDATE_TIMEZONE`, `UPDATE_ON_START=1`) |
| `yarn lint` | ESLint |

## The map

- Filters: text search (Cyrillic and Latin both match), kind, source, band
  presets or a custom MHz range, and for licences holder (public / private),
  sector, station type and service type.
- Click a pin for details; a cluster of a few stations or any cluster when
  zoomed in lists what's inside.
- Every view is a link. Items have stable URLs that survive data refreshes,
  filters and map position live in the query string:

  ```
  /e/brandmeister/220001
  /e/ratel-reg203/026/000249/001~f84c1827
  /?sector=health,emergency&owner=public&map=12.00/44.80/20.46
  ```

  Back / Forward step through what you opened; **Share** copies the link.
- Every emitter shows what you are likely to hear on its frequency (DMR, FM
  repeater, APRS, airband, land mobile, …) with a typical bandwidth and the
  national band plan entry for that frequency (services, applications, who it is
  reserved for — police, military, emergency services — and how it is
  licensed).
- **Spectrum explorer**: the whole national band plan from 3 kHz to 3 THz with
  every known signal on it — scroll / pinch to zoom, drag to pan, hover for
  details, click a signal to open it on the map. It opens on the clicked
  emitter's band, full screen with **Spectrum** / **Expand**, and the view is part
  of the link (`?spectrum=144,146`).
- **RF panorama**: every transmitter site around a point as a 360° horizon
  (bearing left to right, nearer sites higher) and a radar, within 5–80 km.
  Open it from an emitter (**Panorama from here**), by right-clicking the map,
  or with **Around me** (your location). On a phone, **AR camera** draws the sites
  over the camera view, steered by the compass and following GPS.
- Works on phones: filters and details become bottom sheets.

API used by the page:

| endpoint | returns |
|---|---|
| `GET /api/map` | every emitter with a position, as compact rows |
| `GET /api/emitters/:id` | one emitter, its other listings, and for licences the full register row and the licence's other assignments |
| `GET /api/emitter?source=&key=` | the same, by stable key |
| `POST /mcp` | MCP server (see above) |

## MCP

AI assistants can search the database over [MCP](https://modelcontextprotocol.io):
public, read-only, no key, at `https://sigint.nemanja.top/mcp`.

```sh
claude mcp add --transport http sigint-srbija https://sigint.nemanja.top/mcp   # Claude Code
codex mcp add sigint-srbija --url https://sigint.nemanja.top/mcp               # Codex CLI
```

Tools: `search_emitters` (text, frequency range, area, filters),
`find_frequency` (what's on 145.600?), `get_emitter`, `band_plan` (what a
frequency is allocated to and what you'd hear), `database_info`.
Other clients, tool details and example questions: [docs/mcp.md](docs/mcp.md).

## Database

Everything lives in `data/sigint.sqlite` (not in git, ~300 MB; rebuild with
`yarn fetch`).

- `emitters` — one row per transmitter / frequency assignment from any source:
  kind, mode, callsign, DMR ID, operator, TX/RX in Hz, site, lat/lon (WGS 84),
  where the position came from and how accurate it is, sector, owner, and the
  source record as JSON. `(source, source_key)` is stable across refreshes.
- `sources` — what was fetched and when.
- `reg203_*` — the full RATEL register with full-text search; see
  [docs/ratel.md](docs/ratel.md) for its schema and example queries.

```sql
-- licensed transmitters in the 70 cm band, with holder and site
SELECT operator, tx_hz / 1e6 AS mhz, location, lat, lon
  FROM emitters
 WHERE kind = 'licence' AND active = 1 AND tx_hz BETWEEN 430e6 AND 440e6;
```

Tracked data files: `data/gazetteer.json` (site name → position, hand-correctable;
set `"reviewed": true` on checked entries), `data/boundary.geojson`
(simplified OSM outline of Serbia incl. Kosovo, used to catch bad positions) and
`data/bandplan.json` (RATEL's band plan, Plan namene RF opsega Table 1, parsed
by `yarn bandplan`).

## Layout

```
bin/                entry points (fetch, reg203-enrich, gazetteer, ratel-docs)
src/sources/        one module per source -> emitters
src/storage/        the SQLite database
src/geo/            duplicate merging + position resolution
src/bandplan/       national band plan: PDF parser, English names, listening hints
src/reg203/         RATEL register: parser, detail tables, sector guessing
src/ratel-docs/     RATEL document mirror
src/services/       HTTP clients (RATEL, BrandMeister, Nominatim)
src/web/            map server and API; client/ = the page (MapLibre + qrp-shadcdn), built into dist/
src/utils/          parsers and helpers (frequency, datum, Maidenhead, boundary, …)
```

Adding a source: create `src/sources/<id>/index.js` exporting
`{ id, description, url, fetch() }` where `fetch()` resolves to emitter
objects, register it in `src/sources/index.js`, run `yarn fetch <id>`.

## Credits

Data: [SRS — Savez radio-amatera Srbije](https://yu1srs.org.rs/),
[BrandMeister](https://brandmeister.network/),
[RATEL](https://www.ratel.rs/), © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors. Basemap © [CARTO](https://carto.com/attributions).
