// The Things Network LoRaWAN gateways in Serbia (public gateway map, via the
// Packet Broker mapper), kind "lorawan". Gateway owners publish the location
// themselves. Only TTN v3 ("ttn"): v2 ("ttnv2") was shut down in 2021.
//   name      gateway ID as registered (often "eui-<EUI>")
//   tx/rx     EU868 plan (all Serbian gateways): uplinks 867.1-868.5 MHz,
//             downlinks on the uplink channel or RX2 869.525 MHz
//   active    online now (gateway connected to TTN)
// Gateways without a status update for MAX_AGE_DAYS are left out (dead).
const packetbroker = require("../../services/packetbroker");
const boundary = require("../../utils/boundary");

// a circle around Serbia, cut to the boundary below
const AREA = { latitude: 44.1, longitude: 20.9, distance: 320000 };
const TTN_NET_ID = "000013";
const TTN_TENANT = "ttn";
const MAX_AGE_DAYS = 365;
const UPLINK_LOW_HZ = 867100000;
const UPLINK_HIGH_HZ = 868500000;
const RX2_HZ = 869525000;

const toEmitter = (gateway) => {
	return {
		source_key: gateway.id,
		kind: "lorawan",
		mode: "LoRaWAN",
		name: gateway.id,
		tx_hz: UPLINK_LOW_HZ,
		tx_high_hz: RX2_HZ,
		rx_hz: UPLINK_LOW_HZ,
		rx_high_hz: UPLINK_HIGH_HZ,
		lat: gateway.location.latitude,
		lon: gateway.location.longitude,
		coord_source: "source",
		active: gateway.online ? 1 : 0,
		raw: {
			id: gateway.id,
			eui: gateway.eui,
			cluster: gateway.clusterID,
			antenna_placement: gateway.antennaPlacement,
			antenna_count: gateway.antennaCount,
			altitude: gateway.location.altitude,
			online: gateway.online,
			updated_at: gateway.updatedAt
		}
	};
};

const isCurrent = (gateway) => {
	return Date.now() - Date.parse(gateway.updatedAt) < MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
};

const ttnSource = {
	id: "ttn",
	description: "The Things Network LoRaWAN gateways (public gateway map, via Packet Broker)",
	url: "https://www.thethingsnetwork.org/map",

	fetch: () => {
		return packetbroker.getGatewaysNear(AREA).then((gateways) => {
			return gateways.filter((gateway) => {
				return gateway.netID === TTN_NET_ID && gateway.tenantID === TTN_TENANT && gateway.location &&
					boundary.isInside(gateway.location.latitude, gateway.location.longitude) && isCurrent(gateway);
			}).map(toEmitter);
		});
	}
};

module.exports = ttnSource;
