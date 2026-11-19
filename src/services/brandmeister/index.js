const got = require("got-verbose");
const withRetry = require("../../utils/retry").withRetry;

const brandmeister = {
	_client: got.extend({
		prefixUrl: "https://api.brandmeister.network/v2"
	}),

	// Devices (repeaters and hotspots) last connected to a master server
	getDevicesByMaster: withRetry((master) => {
		return brandmeister._client.get("device/byMaster/" + master).then((response) => {
			return JSON.parse(response.body);
		});
	}),

	getDevice: withRetry((id) => {
		return brandmeister._client.get("device/" + id).then((response) => {
			return JSON.parse(response.body);
		});
	})
};

module.exports = brandmeister;
