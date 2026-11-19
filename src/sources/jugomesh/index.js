// Meshtastic mesh nodes from jugomesh.com (Malla map of the Yugoslav LoRa mesh),
// kind "mesh". Only infrastructure roles are imported: CLIENT / CLIENT_MUTE /
// CLIENT_BASE nodes are people's own radios, often at home (personal locations).
//   name      node long name; raw has hex id, short name, hardware, role, channel, altitude
//   tx_hz     869.525 MHz: in the EU_868 region a 250 kHz preset (MediumFast,
//             LongFast) has a single frequency slot, whatever the channel name
const jugomesh = require("../../services/jugomesh");

const MAX_AGE_HOURS = 720;
const INFRASTRUCTURE_ROLES = ["ROUTER", "ROUTER_LATE", "REPEATER", "ROUTER_CLIENT"];
const EU_868_HZ = 869525000;

const toEmitter = (node) => {
	return {
		source_key: node.hex_id,
		kind: "mesh",
		mode: "Meshtastic",
		name: node.long_name || node.display_name || node.short_name || node.hex_id,
		tx_hz: EU_868_HZ,
		rx_hz: EU_868_HZ,
		lat: node.latitude,
		lon: node.longitude,
		coord_source: "source",
		active: node.is_stale ? 0 : 1,
		sector: "amateur",
		owner: "amateur",
		raw: {
			hex_id: node.hex_id,
			node_id: node.node_id,
			short_name: node.short_name,
			role: node.role,
			hw_model: node.hw_model,
			primary_channel: node.primary_channel,
			altitude: node.altitude,
			last_seen: node.last_seen_network ? new Date(node.last_seen_network * 1000).toISOString() : undefined,
			last_position: node.last_position_update ? new Date(node.last_position_update * 1000).toISOString() : undefined
		}
	};
};

const jugomeshSource = {
	id: "jugomesh",
	description: "Meshtastic infrastructure nodes (routers, repeaters) of the Yugoslav LoRa mesh, from jugomesh.com",
	url: "https://jugomesh.com/map",

	fetch: () => {
		return jugomesh.getLocations(MAX_AGE_HOURS).then((data) => {
			return data.locations.filter((node) => {
				return INFRASTRUCTURE_ROLES.includes(node.role) && Number.isFinite(node.latitude) && Number.isFinite(node.longitude);
			}).map(toEmitter);
		});
	}
};

module.exports = jugomeshSource;
