// In-memory search over all emitters (incl. ones without a position), shared
// by the MCP server. Text matching folds Cyrillic -> Latin and drops
// diacritics, which SQLite LIKE cannot do. Reloaded when a fetch changes
// `sources.fetched_at`.
const storage = require("../storage");
const fold = require("../utils/text").fold;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const EARTH_RADIUS_KM = 6371;

const COLUMNS = `id, source, source_key, kind, mode, callsign, dmr_id, name, operator, tx_hz, tx_high_hz, rx_hz, rx_high_hz,
	city, location, locator, lat, lon, coord_source, coord_accuracy_m, active, sector, owner, duplicate_of,
	CASE WHEN source = 'ratel-reg203' THEN raw->>'vrsta' END AS vrsta`;

let cache = null;

const load = () => {
	const db = storage.getDatabase();
	const version = JSON.stringify(db.prepare("SELECT id, fetched_at FROM sources ORDER BY id").all());

	if (cache && cache.version === version) {
		return cache.rows;
	}

	const rows = db.prepare("SELECT " + COLUMNS + " FROM emitters").all().map((row) => {
		const vrsta = (row.vrsta || "").split("/");

		return Object.freeze(Object.assign(row, {
			station_type: vrsta[0] || null,
			service_type: vrsta.slice(1).join("/") || null,
			haystack: fold([row.callsign, row.dmr_id, row.name, row.operator, row.location, row.city].filter(Boolean).join(" "))
		}));
	});

	cache = { version: version, rows: rows };
	return rows;
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
 * @param {string[]} [options.kinds] - repeater | digipeater | beacon | licence
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

	if (!near) {
		return { total: matched.length, rows: matched.slice(offset, offset + limit) };
	}

	const nearby = matched.map((row) => {
		return Object.assign({}, row, { distance_km: distanceKm(near.lat, near.lon, row.lat, row.lon) });
	}).filter((row) => {
		return row.distance_km <= near.radiusKm;
	}).sort((a, b) => {
		return a.distance_km - b.distance_km;
	});

	return { total: nearby.length, rows: nearby.slice(offset, offset + limit) };
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
