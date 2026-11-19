// Spectrum view of an emitter for the detail panel: band plan entry, listening
// hints, how busy its band is (histogram of our emitters) and the signals next
// to it (zoomed window around its frequency).
const storage = require("../../storage");
const bandplan = require("../../bandplan");

const OVERVIEW_BINS = 120;
// Zoom window: this many bandwidths each side, at least MIN_HALF_WINDOW_HZ
const WINDOW_BANDWIDTHS = 10;
const MIN_HALF_WINDOW_HZ = 50000;
const DEFAULT_BANDWIDTH_HZ = 12500;
const MAX_NEIGHBOURS = 400;
// Rows that are on the air: not a duplicate listing, not an expired licence
const LIVE = "duplicate_of IS NULL AND (active IS NULL OR active = 1)";

// Emitter counts in OVERVIEW_BINS equal slices of the band
const overview = (db, band) => {
	const width = band.high_hz - band.low_hz;
	const bins = new Array(OVERVIEW_BINS).fill(0);

	db.prepare(`SELECT CAST((tx_hz - ?) * ? / ? AS INTEGER) AS bin, count(*) AS n FROM emitters
		WHERE tx_hz >= ? AND tx_hz < ? AND ${LIVE} GROUP BY bin`).all(band.low_hz, OVERVIEW_BINS, width, band.low_hz, band.high_hz).forEach((row) => {
		bins[Math.min(row.bin, OVERVIEW_BINS - 1)] = row.n;
	});

	return bins;
};

// Distinct frequencies around hz with how many emitters use each; `id` is one
// of them with a position (clickable on the map), null when all are mobile
const neighbours = (db, low, high) => {
	return db.prepare(`SELECT tx_hz, max(tx_high_hz) AS tx_high_hz, count(*) AS count,
			min(CASE WHEN lat IS NOT NULL THEN id END) AS id,
			max(CASE WHEN kind != 'licence' THEN 1 ELSE 0 END) AS amateur,
			coalesce(max(callsign), max(operator)) AS label
		FROM emitters WHERE tx_hz >= ? AND tx_hz <= ? AND ${LIVE}
		GROUP BY tx_hz ORDER BY tx_hz LIMIT ?`).all(low, high, MAX_NEIGHBOURS);
};

/**
 * @param {object} emitter emitters row (raw parsed, `detail` for reg203)
 * @returns {object|null} { band, plan, hints, bandwidth, technology, overview, window: { low_hz, high_hz, signals } }
 */
const getSpectrum = (emitter) => {
	if (!emitter.tx_hz) {
		return null;
	}

	const db = storage.getDatabase();
	const description = bandplan.describe(emitter);
	const bandwidth = description.bandwidth ? description.bandwidth.hz : DEFAULT_BANDWIDTH_HZ;
	const centre = emitter.tx_high_hz ? (emitter.tx_hz + emitter.tx_high_hz) / 2 : emitter.tx_hz;
	const half = Math.max(bandwidth * WINDOW_BANDWIDTHS, MIN_HALF_WINDOW_HZ);
	const low = Math.max(0, Math.round(centre - half));
	const high = Math.round(centre + half);

	return Object.assign(description, {
		overview: description.band ? overview(db, description.band) : null,
		window: { low_hz: low, high_hz: high, signals: neighbours(db, low, high) }
	});
};

module.exports = {
	getSpectrum: getSpectrum
};
