// Live APRS around Serbia from APRS-IS, memory only (nothing is stored): the
// last position of every station heard in the last MAX_AGE, and per callsign
// when it was last heard and how (own packet, digipeating, gating to the
// internet). The map's APRS layer and digipeater details read this.
const APRSParser = require("aprs-parser").APRSParser;
const aprsIs = require("../services/aprs-is");
const boundary = require("../utils/boundary");

// range filter around Serbia (km); positions outside the boundary are dropped below
const FILTER = "r/44.1/20.9/320";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;
const MAX_COMMENT = 120;
// q-constructs naming the iGate that put a packet on the internet
const IGATE_Q = ["qAR", "qAO", "qAo"];

const parser = new APRSParser();
const stations = new Map();
const heard = new Map();
let feed = null;
let packets = 0;

const baseCall = (call) => {
	return String(call || "").replace(/\*$/, "").toUpperCase();
};

const markHeard = (callsign, how, time) => {
	const previous = heard.get(callsign) || { packets: 0, digipeated: 0, gated: 0 };

	heard.set(callsign, {
		last: time,
		packets: previous.packets + (how === "packet" ? 1 : 0),
		digipeated: previous.digipeated + (how === "digi" ? 1 : 0),
		gated: previous.gated + (how === "igate" ? 1 : 0),
		since: previous.since || time
	});
};

// Category for the map: digipeater / iGate / weather / object / station, from symbol and comment
const categoryOf = (data, symbol) => {
	if (data.constructor.name === "ObjectPosition") {
		return "object";
	}

	if (symbol === "/_" || /^.[_@]$/.test(symbol || "") || data.weather) {
		return "weather";
	}

	if (/^.#$/.test(symbol || "") || /digi/i.test(data.comment || "")) {
		return "digi";
	}

	if (/^.&$/.test(symbol || "") || /igate/i.test(data.comment || "")) {
		return "igate";
	}

	return "station";
};

const handlePacket = (line) => {
	const now = Date.now();
	let packet = null;

	packets += 1;

	try {
		packet = parser.parse(line);
	} catch (error) {
		return;
	}

	if (!packet || !packet.from) {
		return;
	}

	const from = baseCall(packet.from.toString());
	const via = (packet.via || []).map(String);

	markHeard(from, "packet", now);
	via.filter((call) => {
		return call.endsWith("*") && !/^(WIDE|TRACE|RELAY|TCPIP|TCPXX|NOGATE|RFONLY)/i.test(call);
	}).forEach((call) => {
		markHeard(baseCall(call), "digi", now);
	});

	const q = via.findIndex((call) => {
		return IGATE_Q.includes(call);
	});

	if (q >= 0 && via[q + 1]) {
		markHeard(baseCall(via[q + 1]), "igate", now);
	}

	const data = packet.data;

	if (!data || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude) || !boundary.isNear(data.latitude, data.longitude)) {
		return;
	}

	const name = data.name ? baseCall(data.name) : from;

	stations.set(name, Object.freeze({
		callsign: name,
		lat: data.latitude,
		lon: data.longitude,
		symbol: data.symbol || null,
		category: categoryOf(data, data.symbol),
		comment: (data.comment || "").trim().slice(0, MAX_COMMENT) || null,
		altitude_m: Number.isFinite(data.altitude) ? Math.round(data.altitude) : null,
		path: via.join(","),
		object_of: data.name ? from : null,
		time: now
	}));
};

const sweep = () => {
	const oldest = Date.now() - MAX_AGE_MS;

	stations.forEach((station, call) => {
		if (station.time < oldest) {
			stations.delete(call);
		}
	});
	heard.forEach((entry, call) => {
		if (entry.last < oldest) {
			heard.delete(call);
		}
	});
};

const start = () => {
	if (feed) {
		return;
	}

	feed = aprsIs.follow(FILTER, handlePacket);
	setInterval(sweep, SWEEP_MS).unref();
};

// Map layer: { since, packets, columns, rows }
const COLUMNS = ["callsign", "lat", "lon", "category", "symbol", "time", "comment", "altitude_m", "path", "object_of"];

const getSnapshot = () => {
	return {
		packets: packets,
		columns: COLUMNS,
		rows: Array.from(stations.values()).map((station) => {
			return COLUMNS.map((column) => {
				return station[column];
			});
		})
	};
};

/**
 * When a callsign was last heard on APRS (own packets, digipeating, gating), or null
 * @param {string} callsign with SSID, e.g. "YU0XRS" or "YT3NIV-4"
 */
const getHeard = (callsign) => {
	const entry = heard.get(baseCall(callsign));
	const station = stations.get(baseCall(callsign));

	if (!entry) {
		return null;
	}

	return Object.assign({ callsign: baseCall(callsign) }, entry, { comment: station ? station.comment : null });
};

module.exports = {
	start: start,
	getSnapshot: getSnapshot,
	getHeard: getHeard
};
