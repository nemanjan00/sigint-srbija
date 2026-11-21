const got = require("got-verbose");

// adsb.lol: community ADS-B / MLAT aggregator with an open API (ODbL).
// No CORS, so browsers get the data through this server.
const adsbLol = {
	_client: got.extend({
		prefixUrl: "https://api.adsb.lol/v2",
		timeout: { request: 15000 }
	}),

	/**
	 * Aircraft seen within a radius
	 * @param {{ lat: number, lon: number, radiusNm: number }} area
	 * @returns {Promise<Object[]>} readsb aircraft records (hex, flight, r, t, lat, lon, alt_baro, track, gs, squawk, category, seen_pos, ...)
	 */
	getAircraftNear: (area) => {
		return adsbLol._client.get("lat/" + area.lat + "/lon/" + area.lon + "/dist/" + area.radiusNm).then((response) => {
			return JSON.parse(response.body).ac || [];
		});
	}
};

module.exports = adsbLol;
