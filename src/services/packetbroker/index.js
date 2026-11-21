const got = require("got-verbose");
const withRetry = require("../../utils/retry").withRetry;

// Packet Broker mapper: public LoRaWAN gateways of networks that share their
// gateway map (The Things Network, ...). Same data as the TTN gateway map.
const packetbroker = {
	_client: got.extend({
		prefixUrl: "https://mapper.packetbroker.net/api/v2"
	}),

	/**
	 * Gateways within `distance` metres of a point (the unfiltered list is ~40 MB worldwide)
	 * @param {{ latitude: number, longitude: number, distance: number }} area
	 * @returns {Promise<Object[]>} { netID, tenantID, id, eui, clusterID, updatedAt, location, antennaPlacement, antennaCount, online }
	 */
	getGatewaysNear: withRetry((area) => {
		return packetbroker._client.get("gateways", {
			searchParams: {
				"distanceWithin[latitude]": area.latitude,
				"distanceWithin[longitude]": area.longitude,
				"distanceWithin[distance]": area.distance
			}
		}).then((response) => {
			return JSON.parse(response.body);
		});
	})
};

module.exports = packetbroker;
