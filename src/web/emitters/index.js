// Read side of the database for the map UI
const storage = require("../../storage");
const sector = require("../../reg203/sector");
const spectrum = require("../spectrum");
const ratelRegistry = require("../../services/ratel-registry");
const access = require("../../access");
const live = require("../../live");

// Columns sent to the browser for every point, in this order
const MAP_COLUMNS = ["id", "lat", "lon", "source", "kind", "mode", "tx_hz", "tx_high_hz", "active", "callsign", "operator", "location", "station_type", "service_type", "sector", "owner", "coord_accuracy_m", "duplicate_of", "name"];

let cache = null;

// Links drawn between stations (raw.links of a source, keys within the same
// source) as [fromId, toId, color], each pair once. Ends are the main listing
// of each station, so lines meet the pins the map shows.
const loadLinks = (db) => {
	const rows = db.prepare(`SELECT e.id, e.source, coalesce(e.duplicate_of, e.id) AS main, l.value->>'key' AS key, l.value->>'color' AS color
		FROM emitters e, json_each(e.raw, '$.links') l WHERE e.raw->'links' IS NOT NULL`).all();
	const findMain = db.prepare("SELECT coalesce(duplicate_of, id) AS main FROM emitters WHERE source = ? AND source_key = ?");
	const seen = new Set();

	return rows.reduce((links, row) => {
		const other = findMain.get(row.source, row.key);

		if (!other || other.main === row.main) {
			return links;
		}

		const pair = Math.min(row.main, other.main) + "-" + Math.max(row.main, other.main);

		if (seen.has(pair)) {
			return links;
		}

		seen.add(pair);
		return links.concat([[row.main, other.main, row.color || null]]);
	}, []);
};

// Stations linked to an emitter: [{ id, source_key, callsign, name, location, color }]
const linkedStations = (db, emitter, raw) => {
	const find = db.prepare("SELECT id, source_key, callsign, name, location FROM emitters WHERE source = ? AND source_key = ?");

	return ((raw && raw.links) || []).map((link) => {
		const row = find.get(emitter.source, link.key);
		return row ? Object.assign({}, row, { color: link.color || null }) : null;
	}).filter(Boolean);
};

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
			sector, owner, coord_accuracy_m, duplicate_of,
			-- names only where pins are labelled by them (mesh nodes, gateways): keeps the payload small
			CASE WHEN kind IN ('mesh', 'lorawan') THEN name END AS name
		FROM emitters WHERE lat IS NOT NULL`).all().map((row) => {
		return MAP_COLUMNS.map((column) => {
			return row[column];
		});
	});

	const data = {
		columns: MAP_COLUMNS,
		rows: rows,
		lookups: loadLookups(db),
		links: loadLinks(db),
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
	const canonical = emitter.duplicate_of || emitter.id;

	// every listing of the same station (canonical first), except this one
	result.listings = db.prepare(`SELECT id, source, source_key, callsign, name, tx_hz, rx_hz, location, lat, lon, coord_source, duplicate_of, raw
		FROM emitters WHERE (id = ? OR duplicate_of = ?) AND id != ? ORDER BY duplicate_of IS NOT NULL, id`).all(canonical, canonical, emitter.id).map((listing) => {
		return Object.assign({}, listing, { raw: undefined, access: access.fromRaw(listing.source, listing.raw) });
	});
	// tone / colour code: this listing's own, missing fields from the others
	result.access = access.merge([access.fromRaw(emitter.source, result.raw)].concat(result.listings.map((listing) => {
		return listing.access;
	})));

	if (emitter.source === "ratel-reg203" && result.raw && result.raw.id) {
		result.detail = db.prepare(`SELECT a.*, st.name AS vrsta_stanice_naziv, sv.name AS vrsta_sluzbe_naziv
			FROM reg203_assignments a
			LEFT JOIN reg203_station_types st ON st.code = a.vrsta_stanice
			LEFT JOIN reg203_service_types sv ON sv.code = a.vrsta_sluzbe
			WHERE a.id = ?`).get(result.raw.id);
		// other assignments of the same licence
		result.licence = db.prepare(`SELECT id, tx_freq_raw, rx_freq_raw, lokacija, vazeca FROM reg203_assignments
			WHERE broj_dozvole = ? ORDER BY id LIMIT 200`).all(result.raw.broj_dozvole);
		// the register's own entry: a search by licence number lists its assignments
		result.record_url = ratelRegistry.getSearchUrl("reg203", { filter: result.raw.broj_dozvole });
	}

	result.links = linkedStations(db, emitter, result.raw);
	// BrandMeister activity of the station (DMR repeaters), memory only
	result.live = live.get(canonical);
	result.spectrum = spectrum.getSpectrum(result);

	return result;
};

const getEmitterByKey = (source, key) => {
	const row = storage.getDatabase().prepare("SELECT id FROM emitters WHERE source = ? AND source_key = ?").get(source, key);

	if (!row) {
		return null;
	}

	return getEmitter(row.id);
};

const ping = () => {
	return storage.getDatabase().prepare("SELECT count(*) AS n FROM sources").get().n;
};

module.exports = {
	ping: ping,
	getMapData: getMapData,
	getEmitter: getEmitter,
	getEmitterByKey: getEmitterByKey
};
