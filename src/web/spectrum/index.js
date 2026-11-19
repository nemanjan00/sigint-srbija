// Spectrum part of an emitter's details: band plan entry at its frequency and
// listening hints. The interactive explorer in the page draws the signals
// from the map data and the whole plan from GET /api/bandplan.
const bandplan = require("../../bandplan");

/**
 * @param {object} emitter emitters row (raw parsed, `detail` for reg203)
 * @returns {object|null} { band, plan, hints, bandwidth, technology }
 */
const getSpectrum = (emitter) => {
	if (!emitter.tx_hz) {
		return null;
	}

	return bandplan.describe(emitter);
};

module.exports = {
	getSpectrum: getSpectrum
};
