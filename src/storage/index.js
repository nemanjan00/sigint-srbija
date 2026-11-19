// Global storage: one SQLite database for all sources (data/sigint.sqlite).
//
// Every source writes normalized rows to `emitters`; sources with richer data
// (e.g. reg203) keep their own detail tables in the same database.
const fs = require("fs");
const path = require("path");
const DatabaseSync = require("node:sqlite").DatabaseSync;

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_FILE = process.env.SIGINT_DB || path.join(DATA_DIR, "sigint.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
	id             TEXT PRIMARY KEY,
	description    TEXT,
	url            TEXT,
	fetched_at     TEXT,
	emitter_count  INTEGER
);

-- One row per transmitter / frequency assignment, from any source.
CREATE TABLE IF NOT EXISTS emitters (
	id                INTEGER PRIMARY KEY,
	source            TEXT NOT NULL,      -- sources.id
	source_key        TEXT NOT NULL,      -- stable key within source
	kind              TEXT,               -- repeater | digipeater | beacon | licence
	mode              TEXT,               -- FM | DMR | APRS | ... (NULL if unknown)
	callsign          TEXT,
	dmr_id            TEXT,
	name              TEXT,
	operator          TEXT,
	tx_hz             INTEGER,            -- emitter's transmit frequency (low end of range)
	tx_high_hz        INTEGER,            -- = tx_hz unless a range was given
	rx_hz             INTEGER,
	rx_high_hz        INTEGER,
	city              TEXT,
	location          TEXT,               -- site name as published
	locator           TEXT,               -- Maidenhead locator, if published
	lat               REAL,               -- WGS 84
	lon               REAL,
	coord_source      TEXT,               -- 'source' = given by the source itself, otherwise how it was derived
	coord_accuracy_m  INTEGER,            -- rough radius, NULL if unknown
	active            INTEGER,            -- 1 / 0, NULL if unknown
	sector            TEXT,               -- who operates it: amateur, energy, health, ... (see src/reg203/sector)
	owner             TEXT,               -- amateur | public | private
	raw               TEXT,               -- source record as JSON
	UNIQUE (source, source_key)
);
CREATE INDEX IF NOT EXISTS ix_emitters_tx       ON emitters(tx_hz, tx_high_hz);
CREATE INDEX IF NOT EXISTS ix_emitters_callsign ON emitters(callsign);
CREATE INDEX IF NOT EXISTS ix_emitters_dmr_id   ON emitters(dmr_id);
CREATE INDEX IF NOT EXISTS ix_emitters_geo      ON emitters(lat, lon);
CREATE INDEX IF NOT EXISTS ix_emitters_kind     ON emitters(kind, mode);
`;

const EMITTER_COLUMNS = [
	"source", "source_key", "kind", "mode", "callsign", "dmr_id", "name", "operator",
	"tx_hz", "tx_high_hz", "rx_hz", "rx_high_hz", "city", "location", "locator",
	"lat", "lon", "coord_source", "coord_accuracy_m", "active", "sector", "owner", "raw"
];

// Columns added after the first release; created on open when missing
const ADDED_COLUMNS = { sector: "TEXT", owner: "TEXT" };

const migrate = (db) => {
	const existing = db.prepare("PRAGMA table_info(emitters)").all().map((column) => {
		return column.name;
	});

	Object.keys(ADDED_COLUMNS).filter((name) => {
		return !existing.includes(name);
	}).forEach((name) => {
		db.exec("ALTER TABLE emitters ADD COLUMN " + name + " " + ADDED_COLUMNS[name]);
	});
};

const INSERT_EMITTER_SQL = "INSERT INTO emitters (" + EMITTER_COLUMNS.join(", ") + ") VALUES (" + EMITTER_COLUMNS.map(() => {
	return "?";
}).join(", ") + ")";

let database = null;

const getDatabase = () => {
	if (database) {
		return database;
	}

	fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
	database = new DatabaseSync(DB_FILE);
	database.exec("PRAGMA journal_mode=WAL");
	database.exec("PRAGMA synchronous=OFF");
	database.exec(SCHEMA);
	migrate(database);

	return database;
};

const transaction = (fn) => {
	const db = getDatabase();
	db.exec("BEGIN");

	try {
		const result = fn(db);
		db.exec("COMMIT");
		return result;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
};

// Duplicate keys within one source get "#2", "#3", ... appended
const withUniqueKeys = (emitters) => {
	const seen = {};

	return emitters.map((emitter) => {
		const key = String(emitter.source_key);
		seen[key] = (seen[key] || 0) + 1;

		if (seen[key] === 1) {
			return emitter;
		}

		return Object.assign({}, emitter, { source_key: key + "#" + seen[key] });
	});
};

const toRow = (source, emitter) => {
	const hasCoordinates = emitter.lat !== null && emitter.lat !== undefined;
	const values = Object.assign({}, emitter, {
		source: source.id,
		tx_high_hz: emitter.tx_high_hz === undefined ? emitter.tx_hz : emitter.tx_high_hz,
		rx_high_hz: emitter.rx_high_hz === undefined ? emitter.rx_hz : emitter.rx_high_hz,
		coord_source: hasCoordinates ? (emitter.coord_source || "source") : null,
		raw: emitter.raw === undefined || emitter.raw === null ? null : JSON.stringify(emitter.raw)
	});

	return EMITTER_COLUMNS.map((column) => {
		const value = values[column];
		return value === undefined ? null : value;
	});
};

/**
 * Replace all emitters of a source
 * @param {Object} source - Source from registry (id, description, url)
 * @param {Object[]} emitters - Objects with EMITTER_COLUMNS keys (source is filled in)
 */
const replaceEmitters = (source, emitters) => {
	const unique = withUniqueKeys(emitters);

	transaction((db) => {
		const insert = db.prepare(INSERT_EMITTER_SQL);
		db.prepare("DELETE FROM emitters WHERE source = ?").run(source.id);
		unique.forEach((emitter) => {
			insert.run.apply(insert, toRow(source, emitter));
		});
		db.prepare("INSERT OR REPLACE INTO sources (id, description, url, fetched_at, emitter_count) VALUES (?, ?, ?, ?, ?)")
			.run(source.id, source.description, source.url, new Date().toISOString().slice(0, 19) + "Z", unique.length);
	});

	return unique.length;
};

const getEmitters = (where, params) => {
	const statement = getDatabase().prepare("SELECT * FROM emitters" + (where ? " WHERE " + where : ""));
	return statement.all.apply(statement, params || []);
};

const close = () => {
	if (database) {
		database.close();
		database = null;
	}
};

module.exports = {
	DATA_DIR: DATA_DIR,
	DB_FILE: DB_FILE,
	getDatabase: getDatabase,
	transaction: transaction,
	replaceEmitters: replaceEmitters,
	getEmitters: getEmitters,
	close: close
};
