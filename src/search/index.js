// In-memory search over all emitters (incl. ones without a position), shared
// by the MCP server. Text matching folds Cyrillic -> Latin and drops
// diacritics, which SQLite LIKE cannot do. Reloaded when a fetch changes
// `sources.fetched_at`.
//
// Memory: the index keeps only what filters need (plus the folded text) and is
// read from an SQLite iterator; returned rows are read in full by id. With
// ~260k emitters full row objects cost ~500 MB, too much for the server. The
// index is dropped after IDLE_MS without searches (MCP use is occasional).
const storage = require("../storage");
const fold = require("../utils/text").fold;
const access = require("../access");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const EARTH_RADIUS_KM = 6371;
const IDLE_MS = 15 * 60 * 1000;

// filter fields of the index
const INDEX_COLUMNS = `id, source, kind, sector, owner, active, duplicate_of, lat, lon, tx_hz, tx_high_hz, rx_hz, rx_high_hz,
	callsign, dmr_id, name, operator, location, city,
	CASE WHEN source = 'ratel-reg203' THEN raw->>'vrsta' END AS vrsta`;
// full rows of a result page
const ROW_COLUMNS = `id, source, source_key, kind, mode, callsign, dmr_id, name, operator, tx_hz, tx_high_hz, rx_hz, rx_high_hz,
	city, location, locator, lat, lon, coord_source, coord_accuracy_m, active, sector, owner, duplicate_of,
	CASE WHEN source = 'ratel-reg203' THEN raw->>'vrsta' END AS vrsta`;

let cache = null;
let idleTimer = null;

const forgetLater = () => {
	clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		cache = null;
	}, IDLE_MS);
	idleTimer.unref();
};

const load = () => {
	const db = storage.getDatabase();
	const version = JSON.stringify(db.prepare("SELECT id, fetched_at FROM sources ORDER BY id").all());

	forgetLater();

	if (cache && cache.version === version) {
		return cache.rows;
	}

	cache = null;

	const rows = db.prepare("SELECT " + INDEX_COLUMNS + " FROM emitters").iterate().map((row) => {
		const vrsta = (row.vrsta || "").split("/");

		return {
			id: row.id,
			source: row.source,
			kind: row.kind,
			sector: row.sector,
			owner: row.owner,
			active: row.active,
			duplicate_of: row.duplicate_of,
			lat: row.lat,
			lon: row.lon,
			tx_hz: row.tx_hz,
			tx_high_hz: row.tx_high_hz,
			rx_hz: row.rx_hz,
			rx_high_hz: row.rx_high_hz,
			station_type: vrsta[0] || null,
			service_type: vrsta.slice(1).join("/") || null,
			haystack: fold([row.callsign, row.dmr_id, row.name, row.operator, row.location, row.city].filter(Boolean).join(" "))
		};
	}).toArray();

	cache = { version: version, rows: rows };
	return rows;
};

// Tone / colour code of a station: its own listing's, missing fields from its other listings
const accessOf = (db, row) => {
	if (!access.SOURCES.includes(row.source)) {
		return null;
	}

	const station = row.duplicate_of || row.id;
	const listings = db.prepare(`SELECT id, source, raw FROM emitters WHERE (id = ? OR duplicate_of = ?)
		ORDER BY id = ? DESC, duplicate_of IS NOT NULL, id`).all(station, station, row.id);

	return access.merge(listings.map((listing) => {
		return access.fromRaw(listing.source, listing.raw);
	}));
};

// Full rows for a page of index entries, in the same order (distance_km kept)
const hydrate = (entries) => {
	const db = storage.getDatabase();
	const select = db.prepare("SELECT " + ROW_COLUMNS + " FROM emitters WHERE id = ?");

	return entries.map((entry) => {
		const row = select.get(entry.id);
		const vrsta = (row.vrsta || "").split("/");

		return Object.assign(row, {
			vrsta: undefined,
			station_type: vrsta[0] || null,
			service_type: vrsta.slice(1).join("/") || null,
			access: accessOf(db, row)
		}, entry.distance_km === undefined ? {} : { distance_km: entry.distance_km });
	});
};

const toRadians = (degrees) => {
	return degrees * Math.PI / 180;
};

const distanceKm = (lat1, lon1, lat2, lon2) => {
	const dLat = toRadians(lat2 - lat1);
	const dLon = toRadians(lon2 - lon1);
	const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

	return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
};

const overlaps = (low, high, min, max) => {
	if (low === null) {
		return false;
	}

	return (high === null ? low : high) >= min && low <= max;
};

const inList = (list, value) => {
	return !list || list.length === 0 || list.includes(value);
};

/**
 * @param {Object} options
 * @param {string} [options.query] - Words that must all appear (callsign, DMR ID, name, operator, site, city)
 * @param {string[]} [options.kinds] - repeater | digipeater | beacon | licence | broadcast | cell | link
 * @param {string[]} [options.sources]
 * @param {string[]} [options.sectors]
 * @param {string} [options.owner] - public | private | amateur
 * @param {string[]} [options.stationTypes] - reg203 codes, e.g. FX, FB, ML
 * @param {string[]} [options.serviceTypes] - reg203 codes, e.g. CO, OT, CP
 * @param {number} [options.minHz] - Frequency range; matches TX or RX (whole range when given as a range)
 * @param {number} [options.maxHz]
 * @param {boolean} [options.activeOnly=true] - Skip expired licences
 * @param {boolean} [options.includeDuplicates=false] - Also return other sources' listings of the same station
 * @param {boolean} [options.withPositionOnly=false]
 * @param {{lat: number, lon: number, radiusKm: number}} [options.near] - Only within radius, nearest first
 * @param {number} [options.nearHz] - Sort by distance of TX or RX from this frequency (ignored with `near`)
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @returns {{total: number, rows: Object[]}} rows carry distance_km when `near` is given
 */
const search = (options) => {
	const terms = fold(options.query || "").split(/\s+/).filter(Boolean);
	const hasRange = options.minHz !== undefined || options.maxHz !== undefined;
	const minHz = options.minHz === undefined ? 0 : options.minHz;
	const maxHz = options.maxHz === undefined ? Infinity : options.maxHz;
	const near = options.near;
	const limit = Math.min(options.limit || DEFAULT_LIMIT, MAX_LIMIT);
	const offset = options.offset || 0;

	const matched = load().filter((row) => {
		if (options.activeOnly !== false && row.active === 0) {
			return false;
		}

		if (!options.includeDuplicates && row.duplicate_of !== null) {
			return false;
		}

		if (!inList(options.kinds, row.kind) || !inList(options.sources, row.source) || !inList(options.sectors, row.sector)) {
			return false;
		}

		if (!inList(options.stationTypes, row.station_type) || !inList(options.serviceTypes, row.service_type)) {
			return false;
		}

		if (options.owner && row.owner !== options.owner) {
			return false;
		}

		if ((options.withPositionOnly || near) && row.lat === null) {
			return false;
		}

		if (hasRange && !overlaps(row.tx_hz, row.tx_high_hz, minHz, maxHz) && !overlaps(row.rx_hz, row.rx_high_hz, minHz, maxHz)) {
			return false;
		}

		return terms.every((term) => {
			return row.haystack.includes(term);
		});
	});

	if (!near && options.nearHz !== undefined) {
		const offFrequency = (row) => {
			return Math.min(row.tx_hz === null ? Infinity : Math.abs(row.tx_hz - options.nearHz), row.rx_hz === null ? Infinity : Math.abs(row.rx_hz - options.nearHz));
		};
		const sorted = matched.slice().sort((a, b) => {
			return offFrequency(a) - offFrequency(b);
		});

		return { total: sorted.length, rows: hydrate(sorted.slice(offset, offset + limit)) };
	}

	if (!near) {
		return { total: matched.length, rows: hydrate(matched.slice(offset, offset + limit)) };
	}

	const nearby = matched.map((row) => {
		return { id: row.id, distance_km: distanceKm(near.lat, near.lon, row.lat, row.lon) };
	}).filter((row) => {
		return row.distance_km <= near.radiusKm;
	}).sort((a, b) => {
		return a.distance_km - b.distance_km;
	});

	return { total: nearby.length, rows: hydrate(nearby.slice(offset, offset + limit)) };
};

const getStats = () => {
	const rows = load();
	const countBy = (key) => {
		return rows.reduce((counts, row) => {
			const value = row[key] === null ? "(none)" : row[key];
			counts[value] = (counts[value] || 0) + 1;
			return counts;
		}, {});
	};

	return {
		emitters: rows.length,
		with_position: rows.filter((row) => {
			return row.lat !== null;
		}).length,
		by_kind: countBy("kind"),
		by_source: countBy("source"),
		by_sector: countBy("sector")
	};
};

module.exports = {
	search: search,
	getStats: getStats,
	DEFAULT_LIMIT: DEFAULT_LIMIT,
	MAX_LIMIT: MAX_LIMIT
};
