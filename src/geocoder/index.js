// Address -> position via OSM Nominatim, cached in the database (table
// geocode_cache) so nightly fetches only look up addresses they haven't seen.
// The cache stays in the database, never in tracked files: queries can be
// private persons' addresses (CB register).
const storage = require("../storage");
const nominatim = require("../services/nominatim");

const COUNTRY_CODES = "rs";
// Misses are retried after this many days (OSM data improves)
const MISS_RETRY_DAYS = 30;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS geocode_cache (
	query       TEXT PRIMARY KEY,
	lat         REAL,              -- NULL = not found
	lon         REAL,
	type        TEXT,              -- Nominatim addresstype (house, road, village, ...)
	fetched_at  TEXT NOT NULL
);
`;

let ready = false;

const getDatabase = () => {
	const db = storage.getDatabase();

	if (!ready) {
		db.exec(SCHEMA);
		ready = true;
	}

	return db;
};

const isFresh = (row) => {
	if (row.lat !== null) {
		return true;
	}

	return Date.now() - Date.parse(row.fetched_at) < MISS_RETRY_DAYS * 24 * 3600 * 1000;
};

/**
 * Position of a free-form query, or null
 * @param {string} query
 * @returns {Promise<{lat: number, lon: number, type: string}|null>}
 */
const geocode = (query) => {
	const db = getDatabase();
	const cached = db.prepare("SELECT lat, lon, type, fetched_at FROM geocode_cache WHERE query = ?").get(query);

	if (cached && isFresh(cached)) {
		return Promise.resolve(cached.lat === null ? null : { lat: cached.lat, lon: cached.lon, type: cached.type });
	}

	return nominatim.search(query, COUNTRY_CODES).then((result) => {
		const found = result ? { lat: Number(result.lat), lon: Number(result.lon), type: result.addresstype || result.type || null } : null;

		db.prepare("INSERT OR REPLACE INTO geocode_cache (query, lat, lon, type, fetched_at) VALUES (?, ?, ?, ?, ?)")
			.run(query, found ? found.lat : null, found ? found.lon : null, found ? found.type : null, new Date().toISOString());

		return found;
	});
};

/**
 * First query that resolves, tried in order
 * @param {string[]} queries
 * @returns {Promise<{lat, lon, type, query, index}|null>} index = which query matched
 */
const geocodeFirst = (queries) => {
	return queries.reduce((previous, query, index) => {
		return previous.then((found) => {
			if (found || !query) {
				return found;
			}

			return geocode(query).then((result) => {
				return result ? Object.assign({ query: query, index: index }, result) : null;
			});
		});
	}, Promise.resolve(null));
};

module.exports = {
	geocode: geocode,
	geocodeFirst: geocodeFirst
};
