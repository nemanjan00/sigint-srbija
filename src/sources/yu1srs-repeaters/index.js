const got = require("got-verbose");
const parseTable = require("../../utils/table").parseTable;
const mhzToHz = require("../../utils/frequency").mhzToHz;

const URL = "https://yu1srs.org.rs/repetitori-u-srbiji-tabelarno/";
const TABLE_SELECTOR = "#tablepress-8";

// Column order of the table on the site. Meaning of some columns depends on type:
//  - DMR: id = repeater DMR ID, cc = color code, ts1/ts2 = talkgroups
//  - VHF/UHF/RUM: cc = CTCSS tone (Hz)
//  - APRS: id = digipeater path (e.g. "Wide 1-1")
//  - FAR (beacons): id = Maidenhead locator
const FIELDS = ["type", "city", "channel", "callsign", "location", "id", "tx", "rx", "shift", "cc", "ts1", "ts2"];

const KINDS = {
	DMR: { kind: "repeater", mode: "DMR" },
	VHF: { kind: "repeater", mode: "FM" },
	UHF: { kind: "repeater", mode: "FM" },
	RUM: { kind: "repeater", mode: "FM" },
	APRS: { kind: "digipeater", mode: "APRS" },
	FAR: { kind: "beacon", mode: null }
};

// "YU0" (network placeholder) is not a callsign
const cleanCallsign = (text) => {
	if (!text || !/\d[A-Z]/.test(text)) {
		return null;
	}

	return text.toUpperCase();
};

const toEmitter = (row) => {
	const type = KINDS[row.type] || { kind: null, mode: null };

	return {
		source_key: [row.type, row.callsign || row.city, row.tx].join("/"),
		kind: type.kind,
		mode: type.mode,
		callsign: cleanCallsign(row.callsign),
		dmr_id: row.type === "DMR" ? row.id : null,
		name: row.channel,
		tx_hz: mhzToHz(row.tx),
		rx_hz: mhzToHz(row.rx),
		city: row.city,
		location: row.location,
		locator: row.type === "FAR" ? row.id : null,
		sector: "amateur",
		owner: "amateur",
		raw: row
	};
};

const yu1srsRepeaters = {
	_client: got.extend({}),

	id: "yu1srs-repeaters",
	description: "SRS table of amateur repeaters, APRS digipeaters and beacons in Serbia",
	url: URL,

	fetch: () => {
		return yu1srsRepeaters._client.get(URL).then((response) => {
			return parseTable(response.body, TABLE_SELECTOR, FIELDS).map(toEmitter);
		});
	}
};

module.exports = yu1srsRepeaters;
