# SIGINT Srbija

Public radio signal sources in Serbia, collected into one database and shown
on one map: amateur repeaters, APRS digipeaters and beacons, DMR repeaters, and
every radio licence in RATEL's public register (~161k frequency assignments).

## What's in it

| source | what | positions |
|---|---|---|
| [SRS repeater table](https://yu1srs.org.rs/repetitori-u-srbiji-tabelarno/) | DMR / VHF / UHF / RUM repeaters, APRS digipeaters, beacons | none, resolved from the other sources |
| [SRS repeater map](https://yu1srs.org.rs/repetitori-u-srbiji/) | same network + repeaters in neighbouring countries | exact |
| [BrandMeister](https://brandmeister.network/) | DMR repeaters with Serbian IDs (`220xxx`) | exact |
| [RATEL reg203](https://registar.ratel.rs/cyr/reg203) | every radio-frequency licence: holder, TX/RX, site, station/service type, validity | fixed stations; mobile stations have none |
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
PORT=3300 yarn web      # map on http://localhost:3300
```

| command | does |
|---|---|
| `yarn fetch [source ...]` | fetch all (or the named) sources, then merge duplicates and resolve positions. Sources: `yu1srs-repeaters`, `yu1srs-map`, `brandmeister`, `ratel-reg203` |
| `yarn reg203-enrich` | add holder name/address, inspection and start-of-use dates, full station description to licences |
| `yarn gazetteer` | geocode site names that still have no position (OpenStreetMap Nominatim, 1 req/s) into `data/gazetteer.json` — review the result, wrong matches happen |
| `yarn ratel-docs [slug ...]` | mirror RATEL documents into `lib/` (`--tree` to only list pages) |
| `yarn web` / `yarn watch` | map server (forever / nodemon) |
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
- Works on phones: filters and details become bottom sheets.

API used by the page:

| endpoint | returns |
|---|---|
| `GET /api/map` | every emitter with a position, as compact rows |
| `GET /api/emitters/:id` | one emitter, its other listings, and for licences the full register row and the licence's other assignments |
| `GET /api/emitter?source=&key=` | the same, by stable key |

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
set `"reviewed": true` on checked entries) and `data/boundary.geojson`
(simplified OSM outline of Serbia incl. Kosovo, used to catch bad positions).

## Layout

```
bin/                entry points (fetch, reg203-enrich, gazetteer, ratel-docs)
src/sources/        one module per source -> emitters
src/storage/        the SQLite database
src/geo/            duplicate merging + position resolution
src/reg203/         RATEL register: parser, detail tables, sector guessing
src/ratel-docs/     RATEL document mirror
src/services/       HTTP clients (RATEL, BrandMeister, Nominatim)
src/web/            map server, API and the page (MapLibre + qrp-shadcdn, no build step)
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
