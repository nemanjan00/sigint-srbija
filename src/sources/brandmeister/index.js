// DMR repeaters in Serbia from the BrandMeister network API (with coordinates).
const brandmeister = require("../../services/brandmeister");
const mhzToHz = require("../../utils/frequency").mhzToHz;

// Serbian devices connect to master 2302
const MASTERS = [2302];
// Serbian DMR IDs start with MCC 220. 6 digits = repeater; 7+ digits are
// personal hotspots (often at someone's home), deliberately left out.
const REPEATER_ID = /^220\d{3}$/;

const toEmitter = (device) => {
	const hasPoint = Number.isFinite(device.lat) && Number.isFinite(device.lng) && (device.lat !== 0 || device.lng !== 0);

	return {
		source_key: String(device.id),
		kind: "repeater",
		mode: "DMR",
		callsign: device.callsign || null,
		dmr_id: String(device.id),
		name: device.priorityDescription || null,
		tx_hz: mhzToHz(device.tx),
		rx_hz: mhzToHz(device.rx),
		city: device.city || null,
		lat: hasPoint ? device.lat : null,
		lon: hasPoint ? device.lng : null,
		sector: "amateur",
		owner: "amateur",
		raw: device
	};
};

const brandmeisterSource = {
	id: "brandmeister",
	description: "BrandMeister DMR repeaters in Serbia (DMR ID 220xxx)",
	url: "https://brandmeister.network/",

	fetch: () => {
		return Promise.all(MASTERS.map(brandmeister.getDevicesByMaster)).then((lists) => {
			return lists.reduce((all, list) => {
				return all.concat(list);
			}, []).filter((device) => {
				return REPEATER_ID.test(String(device.id));
			}).map(toEmitter);
		});
	}
};

module.exports = brandmeisterSource;
