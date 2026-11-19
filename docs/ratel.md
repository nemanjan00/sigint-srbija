# RATEL sources

RATEL (Регулаторно тело за електронске комуникације и поштанске услуге) is the
Serbian electronic-communications regulator. Ported from the Python scripts in
`~/ratel` (2026-11-19).

## Register reg203: `yarn fetch ratel-reg203`

Source: <https://registar.ratel.rs/cyr/reg203> ("База података о коришћењу
радио-фреквенцијског спектра", licences for radio stations incl. aircraft and
ships).

```sh
yarn fetch ratel-reg203                 # download CSV export, rebuild reg203_* tables + emitters
yarn reg203-enrich                      # add the HTML-only fields (~8k pages, slow)
yarn reg203-enrich --limit-pages 3      # quick test
```

Everything lives in the global database `data/sigint.sqlite`: detail tables
are prefixed `reg203_`, and every assignment is also an `emitters` row
(`source = 'ratel-reg203'`, coordinates converted to WGS 84).

Notes on the source:

- The CSV export (`format=csv`) returns the **entire** register in one file,
  about 100 MB and 162k rows. It is **UTF-16LE with a BOM, tab-separated,
  every field double-quoted**. The raw file is kept unchanged in `data/reg203/`.
- The licence-type selector on the site (radio stations / aircraft / ships) is
  ignored by the server; all three return the same result set.
- The XML export returns HTTP 500. The RSS feeds only carry recent changes.
- The HTML result pages contain fields the CSV lacks: holder name and address
  as separate values, technical-inspection date, start-of-use date and the
  full station/service description. `--enrich` fetches them.
- The server's TLS chain is missing the intermediate certificate. The client
  downloads it from Sectigo (URL in `src/services/ratel-registry`) and adds it
  to the CA list, so certificates are still fully verified.

### Schema (SQLite)

| table / view | contents |
|---|---|
| `reg203_assignments` | one row per frequency assignment: licence number, holder, TX/RX frequency (raw string and integer Hz, low/high for ranges), validity dates (ISO), call sign, station/service codes, location, coordinates (raw DDMMSS and decimal degrees), coordinate datum, status and cessation reason, plus enrichment columns |
| `reg203_station_types`, `reg203_service_types` | code tables from the search form (e.g. `FX` = fixed station, `CP` = open to public correspondence) |
| `reg203_fts` | FTS5 index over licence number, holder, call sign, location |
| `reg203_licenses` | one row per licence with assignment count and frequency span |
| `reg203_active` | assignments whose licence is currently valid |
| `reg203_meta` | fetch time, register "updated" date, row count, source file |

Caveats: `lon_deg`/`lat_deg` in `reg203_assignments` are in the datum given by
`koord_sistem` (`WGS 84` or `Bessel`, the old Yugoslav datum); `emitters.lat/lon`
are converted to WGS 84. About 180 rows have impossible
DDMMSS values in the source (seconds of 60 or more); their decimal columns are
NULL and the raw string is kept. `vazeca = 1` means the status column is empty
("valid"); it does not check `rok_trajanja` against today.

```sql
-- who transmits in 430-440 MHz right now
SELECT nosilac_naziv, tx_freq_raw, lokacija FROM reg203_active
 WHERE tx_freq_low_hz BETWEEN 430e6 AND 440e6;

-- full-text search
SELECT a.broj_dozvole, a.nosilac, a.lokacija FROM reg203_assignments a
  JOIN reg203_fts f ON f.rowid = a.id
 WHERE reg203_fts MATCH 'Ниш AND Телеком';
```

## Documents: `yarn ratel-docs`

Mirrors documents from www.ratel.rs into `lib/`, one directory per page
(`https://www.ratel.rs/sr/<slug>`), nested as in the site menu.

```sh
yarn ratel-docs                         # regulativa-elektronske-komunikacije + rf-spektar
yarn ratel-docs --tree rf-spektar       # print the page tree only
yarn ratel-docs --out lib <slug> ...
```

Re-running is incremental: existing files are skipped. Filenames come from the
upload URL; links with hashed or garbled URLs are named after the link text.

Known dead links (HTTP 404, as of 2026-11-19): the Word form templates
`Obrazac-ZPD*.docx` under `rf-spektar/radio-komunikacije/` and
`rf-spektar/uputstva-i-obrasci-1/`, and the page `lista-angazovanih-lica`.
