// Read side of the database for the map UI
const storage = require("../../storage");
const sector = require("../../reg203/sector");

// Columns sent to the browser for every point, in this order
const MAP_COLUMNS = ["id", "lat", "lon", "source", "kind", "mode", "tx_hz", "tx_high_hz", "active", "callsign", "operator", "location", "station_type", "service_type", "sector", "owner", "coord_accuracy_m"];

let cache = null;

const loadLookups = (db) => {
	const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'reg203_station_types'").get();

	if (!tableExists) {
		return { stationTypes: {}, serviceTypes: {}, sectors: sector.getSectors() };
	}

	const toMap = (rows) => {
		return rows.reduce((map, row) => {
			map[row.code] = row.name;
			return map;
		}, {});
	};

	return {
		stationTypes: toMap(db.prepare("SELECT code, name FROM reg203_station_types").all()),
		serviceTypes: toMap(db.prepare("SELECT code, name FROM reg203_service_types").all()),
		sectors: sector.getSectors()
	};
};

/**
 * All emitters with coordinates as { columns, rows, lookups, sources }.
 * Rows are arrays (much smaller than objects for ~75k points). Cached until
 * the sources table changes (i.e. after a fetch).
 */
const getMapData = () => {
	const db = storage.getDatabase();
	const version = JSON.stringify(db.prepare("SELECT id, fetched_at FROM sources ORDER BY id").all());

	if (cache && cache.version === version) {
		return cache.data;
	}

	const rows = db.prepare(`SELECT id, lat, lon, source, kind, mode, tx_hz, tx_high_hz, active, callsign, operator, location,
			CASE WHEN source = 'ratel-reg203' THEN substr(raw->>'vrsta', 1, instr(raw->>'vrsta' || '/', '/') - 1) END AS station_type,
			CASE WHEN source = 'ratel-reg203' AND instr(raw->>'vrsta', '/') > 0 THEN substr(raw->>'vrsta', instr(raw->>'vrsta', '/') + 1) END AS service_type,
			sector, owner, coord_accuracy_m
		FROM emitters WHERE lat IS NOT NULL`).all().map((row) => {
		return MAP_COLUMNS.map((column) => {
			return row[column];
		});
	});

	const data = {
		columns: MAP_COLUMNS,
		rows: rows,
		lookups: loadLookups(db),
		sources: db.prepare("SELECT * FROM sources ORDER BY id").all()
	};

	cache = { version: version, data: data };
	return data;
};

// Full emitter, plus the reg203 detail row for licences
const getEmitter = (id) => {
	const db = storage.getDatabase();
	const emitter = db.prepare("SELECT * FROM emitters WHERE id = ?").get(id);

	if (!emitter) {
		return null;
	}

	const result = Object.assign({}, emitter, { raw: emitter.raw ? JSON.parse(emitter.raw) : null });

	if (emitter.source === "ratel-reg203" && result.raw && result.raw.id) {
		result.detail = db.prepare(`SELECT a.*, st.name AS vrsta_stanice_naziv, sv.name AS vrsta_sluzbe_naziv
			FROM reg203_assignments a
			LEFT JOIN reg203_station_types st ON st.code = a.vrsta_stanice
			LEFT JOIN reg203_service_types sv ON sv.code = a.vrsta_sluzbe
			WHERE a.id = ?`).get(result.raw.id);
		// other assignments of the same licence
		result.licence = db.prepare(`SELECT id, tx_freq_raw, rx_freq_raw, lokacija, vazeca FROM reg203_assignments
			WHERE broj_dozvole = ? ORDER BY id LIMIT 200`).all(result.raw.broj_dozvole);
	}

	return result;
};

const getEmitterByKey = (source, key) => {
	const row = storage.getDatabase().prepare("SELECT id FROM emitters WHERE source = ? AND source_key = ?").get(source, key);

	if (!row) {
		return null;
	}

	return getEmitter(row.id);
};

module.exports = {
	getMapData: getMapData,
	getEmitter: getEmitter,
	getEmitterByKey: getEmitterByKey
};
