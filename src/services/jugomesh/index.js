const got = require("got-verbose");
const withRetry = require("../../utils/retry").withRetry;

// Malla (Meshtastic MQTT analyser) instance of the Yugoslav mesh community
const jugomesh = {
	_client: got.extend({
		prefixUrl: "https://jugomesh.com/api"
	}),

	/**
	 * Nodes with a position heard within maxAgeHours, plus traceroute links
	 * @param {number} maxAgeHours
	 * @returns {Promise<{locations: Object[], traceroute_links: Object[]}>}
	 */
	getLocations: withRetry((maxAgeHours) => {
		return jugomesh._client.get("locations", { searchParams: { max_age_hours: maxAgeHours } }).then((response) => {
			return JSON.parse(response.body);
		});
	})
};

module.exports = jugomesh;
