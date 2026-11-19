const got = require("got-verbose");
const wrapper = require("queue-promised").wrapper;
const withRetry = require("../../utils/retry").withRetry;

// Usage policy: max 1 request/second, identifying User-Agent
// https://operations.osmfoundation.org/policies/nominatim/
const USER_AGENT = "sigint-srbija/1.0 (public signal source catalogue)";
const REQUEST_INTERVAL = 1100;

const sleep = (ms) => {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
};

const nominatim = {
	_client: got.extend({
		prefixUrl: "https://nominatim.openstreetmap.org",
		headers: {
			"user-agent": USER_AGENT
		}
	}),

	/**
	 * First search result, or null
	 * @param {string} query - Free-form place name
	 * @param {string} countryCodes - e.g. "rs"
	 */
	search: wrapper(withRetry((query, countryCodes) => {
		return nominatim._client.get("search", {
			searchParams: {
				q: query,
				countrycodes: countryCodes,
				format: "jsonv2",
				limit: 1
			}
		}).then((response) => {
			return sleep(REQUEST_INTERVAL).then(() => {
				return JSON.parse(response.body)[0] || null;
			});
		});
	}), 1)
};

module.exports = nominatim;
