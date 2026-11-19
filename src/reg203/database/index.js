// reg203 detail tables, kept in the global database (src/storage)
const crypto = require("crypto");
const storage = require("../../storage");
const besselToWgs84 = require("../../utils/datum").besselToWgs84;
const boundary = require("../../utils/boundary");
const sector = require("../sector");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reg203_meta (key TEXT PRIMARY KEY, value TEXT);

-- One row per frequency assignment (a licence usually has several).
CREATE TABLE IF NOT EXISTS reg203_assignments (
	id                    INTEGER PRIMARY KEY,
	redni_broj            INTEGER NOT NULL,   -- register ordinal (Редни број)
	broj_dozvole          TEXT    NOT NULL,   -- licence number (Број дозволе)
	nosilac               TEXT    NOT NULL,   -- holder + address as exported (Носилац права)
	nosilac_naziv         TEXT,               -- holder name (split / from HTML)
	nosilac_adresa        TEXT,               -- holder address (split / from HTML)
	tx_freq_raw           TEXT,               -- Предајна фреквенција as exported
	tx_freq_low_hz        INTEGER,
	tx_freq_high_hz       INTEGER,            -- = low unless a range was given
	rx_freq_raw           TEXT,               -- Пријемна фреквенција as exported
	rx_freq_low_hz        INTEGER,
	rx_freq_high_hz       INTEGER,
	vazi_od               TEXT,               -- valid from, ISO date
	rok_trajanja          TEXT,               -- valid until, ISO date
	znak_identifikacije   TEXT,               -- call sign / identification
	vrsta_raw             TEXT,               -- e.g. "FX/CP"
	vrsta_stanice         TEXT,               -- station type code -> reg203_station_types
	vrsta_sluzbe          TEXT,               -- service type code -> reg203_service_types
	lokacija              TEXT,
	lon_raw               TEXT,               -- Географска дужина, DDMMSS
	lat_raw               TEXT,               -- Географска ширина, DDMMSS
	lon_deg               REAL,               -- decimal degrees (datum: koord_sistem!)
	lat_deg               REAL,
	koord_sistem          TEXT,               -- 'WGS 84' or 'Bessel' (old Yugoslav datum)
	status                TEXT,               -- '' (valid) or 'Престала да важи'
	vazeca                INTEGER NOT NULL,   -- 1 if status is empty
	status_datum          TEXT,               -- date the licence ceased, ISO
	razlog                TEXT,               -- reason it ceased
	-- filled by enrichment (HTML only):
	tehnicki_pregled      TEXT,               -- technical inspection date, ISO
	datum_pocetka         TEXT,               -- date usage started, ISO
	vrsta_opis            TEXT,               -- full station/service description
	enriched              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_reg203_redni    ON reg203_assignments(redni_broj);
CREATE INDEX IF NOT EXISTS ix_reg203_dozvola  ON reg203_assignments(broj_dozvole);
CREATE INDEX IF NOT EXISTS ix_reg203_nosilac  ON reg203_assignments(nosilac);
CREATE INDEX IF NOT EXISTS ix_reg203_tx       ON reg203_assignments(tx_freq_low_hz, tx_freq_high_hz);
CREATE INDEX IF NOT EXISTS ix_reg203_rx       ON reg203_assignments(rx_freq_low_hz, rx_freq_high_hz);
CREATE INDEX IF NOT EXISTS ix_reg203_vrsta    ON reg203_assignments(vrsta_stanice, vrsta_sluzbe);
CREATE INDEX IF NOT EXISTS ix_reg203_vazeca   ON reg203_assignments(vazeca);
CREATE INDEX IF NOT EXISTS ix_reg203_geo      ON reg203_assignments(lat_deg, lon_deg);
CREATE INDEX IF NOT EXISTS ix_reg203_znak     ON reg203_assignments(znak_identifikacije);

CREATE TABLE IF NOT EXISTS reg203_station_types (code TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS reg203_service_types (code TEXT PRIMARY KEY, name TEXT);

-- Full-text search over the free-text columns.
CREATE VIRTUAL TABLE IF NOT EXISTS reg203_fts USING fts5(
	broj_dozvole, nosilac, znak_identifikacije, lokacija,
	content='reg203_assignments', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS reg203_assignments_ai AFTER INSERT ON reg203_assignments BEGIN
	INSERT INTO reg203_fts(rowid, broj_dozvole, nosilac, znak_identifikacije, lokacija)
	VALUES (new.id, new.broj_dozvole, new.nosilac, new.znak_identifikacije, new.lokacija);
END;
CREATE TRIGGER IF NOT EXISTS reg203_assignments_ad AFTER DELETE ON reg203_assignments BEGIN
	INSERT INTO reg203_fts(reg203_fts, rowid, broj_dozvole, nosilac, znak_identifikacije, lokacija)
	VALUES ('delete', old.id, old.broj_dozvole, old.nosilac, old.znak_identifikacije, old.lokacija);
END;

-- Convenience views
CREATE VIEW IF NOT EXISTS reg203_licenses AS
	SELECT broj_dozvole, redni_broj,
	       MIN(nosilac)         AS nosilac,
	       MAX(nosilac_naziv)   AS nosilac_naziv,
	       MIN(vazi_od)         AS vazi_od,
	       MAX(rok_trajanja)    AS rok_trajanja,
	       MAX(vazeca)          AS vazeca,
	       COUNT(*)             AS n_assignments,
	       MIN(tx_freq_low_hz)  AS tx_min_hz,
	       MAX(tx_freq_high_hz) AS tx_max_hz
	FROM reg203_assignments GROUP BY broj_dozvole, redni_broj;

CREATE VIEW IF NOT EXISTS reg203_active AS
	SELECT * FROM reg203_assignments WHERE vazeca = 1;
`;

const ASSIGNMENT_COLUMNS = [
	"redni_broj", "broj_dozvole", "nosilac", "nosilac_naziv", "nosilac_adresa",
	"tx_freq_raw", "tx_freq_low_hz", "tx_freq_high_hz", "rx_freq_raw", "rx_freq_low_hz", "rx_freq_high_hz",
	"vazi_od", "rok_trajanja", "znak_identifikacije", "vrsta_raw", "vrsta_stanice", "vrsta_sluzbe", "lokacija",
	"lon_raw", "lat_raw", "lon_deg", "lat_deg", "koord_sistem", "status", "vazeca", "status_datum", "razlog"
];

const INSERT_SQL = "INSERT INTO reg203_assignments (" + ASSIGNMENT_COLUMNS.join(", ") + ") VALUES (" + ASSIGNMENT_COLUMNS.map(() => {
	return "?";
}).join(", ") + ")";

const ENRICH_SQL = `UPDATE reg203_assignments SET
	nosilac_naziv = COALESCE(:nosilac_naziv, nosilac_naziv),
	nosilac_adresa = COALESCE(:nosilac_adresa, nosilac_adresa),
	tehnicki_pregled = :tehnicki_pregled, datum_pocetka = :datum_pocetka, vrsta_opis = :vrsta_opis, enriched = 1
WHERE redni_broj = :redni_broj AND broj_dozvole = :broj_dozvole
	-- the CSV export rounds to 4 decimals of MHz, the HTML shows 5: allow 100 Hz slack
	AND ABS(IFNULL(tx_freq_low_hz, -1) - IFNULL(:tx_freq_low_hz, -1)) <= 100
	AND ABS(IFNULL(rx_freq_low_hz, -1) - IFNULL(:rx_freq_low_hz, -1)) <= 100
	AND IFNULL(lokacija, '') = IFNULL(:lokacija, '') AND IFNULL(vazi_od, '') = IFNULL(:vazi_od, '')
	AND IFNULL(rok_trajanja, '') = IFNULL(:rok_trajanja, '')`;

const ENRICH_PARAMS = [
	"nosilac_naziv", "nosilac_adresa", "tehnicki_pregled", "datum_pocetka", "vrsta_opis",
	"redni_broj", "broj_dozvole", "tx_freq_low_hz", "rx_freq_low_hz", "lokacija", "vazi_od", "rok_trajanja"
];

// Typo fixes tried for positions far outside Serbia (seen in the register:
// 23° typed for 22°, 10° for 20°, latitude and longitude swapped)
const CORRECTIONS = [
	{ name: "swapped", apply: (p) => ({ lat: p.lon, lon: p.lat }) },
	{ name: "lon-1", apply: (p) => ({ lat: p.lat, lon: p.lon - 1 }) },
	{ name: "lon+1", apply: (p) => ({ lat: p.lat, lon: p.lon + 1 }) },
	{ name: "lon+10", apply: (p) => ({ lat: p.lat, lon: p.lon + 10 }) },
	{ name: "lon-10", apply: (p) => ({ lat: p.lat, lon: p.lon - 10 }) },
	{ name: "lat-1", apply: (p) => ({ lat: p.lat - 1, lon: p.lon }) },
	{ name: "lat+1", apply: (p) => ({ lat: p.lat + 1, lon: p.lon }) }
];

/**
 * Published position, or a corrected one when it is clearly outside Serbia
 * and exactly one simple typo fix lands inside. Otherwise no position.
 * @returns {{lat: number|null, lon: number|null, correction: string|null}}
 */
const checkPosition = (position) => {
	if (boundary.isNear(position.lat, position.lon)) {
		return { lat: position.lat, lon: position.lon, correction: null };
	}

	const fixes = CORRECTIONS.map((correction) => {
		return Object.assign({ correction: correction.name }, correction.apply(position));
	}).filter((candidate) => {
		return boundary.isInside(candidate.lat, candidate.lon);
	});

	if (fixes.length === 1) {
		return fixes[0];
	}

	return { lat: null, lon: null, correction: "outside-serbia" };
};

// Coordinates in the register are on the datum named in koord_sistem
const toWgs84 = (row) => {
	if (row.lat_deg === null || row.lon_deg === null) {
		return { lat: null, lon: null, correction: null };
	}

	const checked = checkPosition({ lat: row.lat_deg, lon: row.lon_deg });

	if (checked.lat === null || row.koord_sistem !== "Bessel") {
		return checked;
	}

	return Object.assign(besselToWgs84(checked.lat, checked.lon), { correction: checked.correction });
};

const KEY_HASH_LENGTH = 8;

// Stable across re-fetches (row ids are not): licence number + hash of the
// assignment's content. Exact duplicates get "#2"... from storage.
const stableKey = (row) => {
	const content = [row.tx_freq_raw, row.rx_freq_raw, row.lokacija, row.lon_raw, row.lat_raw, row.znak_identifikacije].join("|");
	const hash = crypto.createHash("sha1").update(content).digest("hex").slice(0, KEY_HASH_LENGTH);

	return row.broj_dozvole + "~" + hash;
};

const toEmitter = (row) => {
	const position = toWgs84(row);
	const holder = sector.classify(row.nosilac_naziv || row.nosilac);

	return {
		source_key: stableKey(row),
		kind: "licence",
		callsign: row.znak_identifikacije,
		operator: row.nosilac_naziv || row.nosilac,
		tx_hz: row.tx_freq_low_hz,
		tx_high_hz: row.tx_freq_high_hz,
		rx_hz: row.rx_freq_low_hz,
		rx_high_hz: row.rx_freq_high_hz,
		location: row.lokacija,
		lat: position.lat,
		lon: position.lon,
		coord_source: position.correction && position.lat !== null ? "source:corrected:" + position.correction : null,
		active: row.vazeca,
		sector: holder.sector,
		owner: holder.owner,
		raw: {
			table: "reg203_assignments",
			id: row.id,
			broj_dozvole: row.broj_dozvole,
			vrsta: row.vrsta_raw,
			koord_sistem: row.koord_sistem,
			published_position: position.correction ? { lat: row.lat_deg, lon: row.lon_deg, lat_raw: row.lat_raw, lon_raw: row.lon_raw } : undefined,
			position_note: position.correction || undefined
		}
	};
};

// Create reg203 tables in the global database if needed
const open = () => {
	const db = storage.getDatabase();
	db.exec(SCHEMA);

	const insertAssignment = db.prepare(INSERT_SQL);
	const enrichAssignment = db.prepare(ENRICH_SQL);
	const setMetaValue = db.prepare("INSERT OR REPLACE INTO reg203_meta VALUES (?, ?)");

	const database = {
		begin: () => {
			db.exec("BEGIN");
		},

		commit: () => {
			db.exec("COMMIT");
		},

		setMeta: (meta) => {
			Object.keys(meta).forEach((key) => {
				setMetaValue.run(key, String(meta[key]));
			});
		},

		/**
		 * Replace all assignments and code tables
		 * @param {Object[]} assignments - Records from parser.toAssignment
		 * @param {{stationTypes: Object, serviceTypes: Object}} lookups - code -> name
		 */
		replaceAssignments: (assignments, lookups) => {
			database.begin();
			db.exec("DELETE FROM reg203_assignments");
			db.exec("INSERT INTO reg203_fts(reg203_fts) VALUES('rebuild')");
			assignments.forEach((assignment) => {
				insertAssignment.run.apply(insertAssignment, ASSIGNMENT_COLUMNS.map((column) => {
					return assignment[column];
				}));
			});
			[["reg203_station_types", lookups.stationTypes], ["reg203_service_types", lookups.serviceTypes]].forEach((table) => {
				const insert = db.prepare("INSERT OR REPLACE INTO " + table[0] + " VALUES (?, ?)");
				Object.keys(table[1]).forEach((code) => {
					insert.run(code, table[1][code]);
				});
			});
			db.exec("INSERT INTO reg203_fts(reg203_fts) VALUES('rebuild')");
			database.commit();
		},

		// Apply fields parsed from an HTML row; returns true when a row matched
		enrich: (row) => {
			const params = ENRICH_PARAMS.reduce((result, key) => {
				result[key] = row[key];
				return result;
			}, {});

			return enrichAssignment.run(params).changes > 0;
		},

		getStats: () => {
			return {
				licences: db.prepare("SELECT COUNT(DISTINCT broj_dozvole) AS n FROM reg203_assignments").get().n,
				active: db.prepare("SELECT COUNT(*) AS n FROM reg203_assignments WHERE vazeca = 1").get().n
			};
		},

		// All assignments as global emitters (coordinates converted to WGS 84)
		getEmitters: () => {
			return db.prepare("SELECT * FROM reg203_assignments ORDER BY id").all().map(toEmitter);
		}
	};

	return database;
};

module.exports = {
	open: open
};
