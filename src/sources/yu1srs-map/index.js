// SRS repeater map (Google My Maps embedded on yu1srs.org.rs/repetitori-u-srbiji/),
// exported as KML. Same network as yu1srs-repeaters, but with coordinates, and
// it also lists repeaters in neighbouring countries.
//
// The map also draws the links between repeaters (RU network backbone, a few
// VHF/UHF links) as unnamed lines. Each line vertex is snapped to the station
// placemark at that point (same layer preferred: several stations share a
// site), and every station gets raw.links = [{ key, color }] (key = the other
// station's source_key, color = the line colour on the SRS map).
const got = require("got-verbose");
const cheerio = require("cheerio");
const mhzToHz = require("../../utils/frequency").mhzToHz;

const MAP_ID = "1xWomnRZ0W-5Z_n7p9w1yJK3YPo3YXx8";
const URL = "https://www.google.com/maps/d/kml?mid=" + MAP_ID + "&forcekml=1";
const PAGE_URL = "https://yu1srs.org.rs/repetitori-u-srbiji/";
// A line vertex further than this from every station isn't a link end
const MAX_SNAP_M = 200;
const METRES_PER_DEGREE = 111320;
const CALLSIGN = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(?:-\d{1,2})?$/;

// Map layer name -> kind/mode. Layers not listed keep kind = null.
const LAYERS = [
	{ match: /^VHF/, kind: "repeater", mode: "FM" },
	{ match: /^UHF/, kind: "repeater", mode: "FM" },
	{ match: /^RU Mreža/, kind: "repeater", mode: "FM" },
	{ match: /^Digitalni/, kind: "repeater", mode: "DMR" },
	{ match: /^APRS/, kind: "digipeater", mode: "APRS" },
	{ match: /^Radiofar/, kind: "beacon", mode: null },
	{ match: /okruženju/, kind: "repeater", mode: null }
];

const layerType = (name) => {
	return LAYERS.find((layer) => {
		return layer.match.test(name);
	}) || { kind: null, mode: null };
};

// Description is "Key: value<br>TX 145.600<br>..." with a few bare lines (callsign, "CC1")
const parseDescription = (html) => {
	const lines = cheerio.load("<div>" + html.replace(/<br\s*\/?>/gi, "\n") + "</div>")("div").text()
		.split("\n").map((line) => {
			return line.replace(/\s+/g, " ").trim();
		}).filter(Boolean);

	return lines.reduce((fields, line) => {
		const keyValue = line.match(/^([^:]+):\s*(.*)$/);
		const spaced = line.match(/^(TX|RX|PL|TS1|TS2|Shift)\s+(.+)$/);

		if (keyValue && !/^https?$/i.test(keyValue[1]) && !line.startsWith("Link")) {
			fields[keyValue[1].trim()] = keyValue[2].trim();
		} else if (spaced) {
			// some placemarks list TX twice (typo for RX); keep the first
			if (fields[spaced[1]] === undefined) {
				fields[spaced[1]] = spaced[2];
			}
		} else if (CALLSIGN.test(line)) {
			fields.callsign = line;
		}

		return fields;
	}, {});
};

const findCallsign = (name, fields) => {
	const candidates = [fields.Oznaka, fields.callsign, name.split(" ")[0]];

	return candidates.find((candidate) => {
		return candidate && CALLSIGN.test(candidate);
	}) || null;
};

const toEmitter = (layerName, placemark) => {
	const type = layerType(layerName);
	const fields = parseDescription(placemark.description);
	const coordinates = (placemark.coordinates || "").trim().split(",").map(Number);
	const hasPoint = coordinates.length >= 2 && coordinates.every(Number.isFinite);
	const dmrId = fields.ID || null;
	const tx = (fields.TX || fields.Freq || "").replace(/\s*mhz$/i, "");

	return {
		source_key: layerName + "/" + placemark.name,
		kind: type.kind,
		mode: type.mode || (dmrId ? "DMR" : null),
		callsign: findCallsign(placemark.name, fields),
		dmr_id: dmrId,
		name: placemark.name,
		tx_hz: mhzToHz(tx),
		rx_hz: mhzToHz(fields.RX),
		location: fields.Lokacija || null,
		locator: fields.Lokator || null,
		lat: hasPoint ? coordinates[1] : null,
		lon: hasPoint ? coordinates[0] : null,
		sector: "amateur",
		owner: "amateur",
		raw: Object.assign({ layer: layerName, name: placemark.name }, fields)
	};
};

const distanceM = (a, b) => {
	const dLon = (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180);
	return Math.hypot(dLon, a.lat - b.lat) * METRES_PER_DEGREE;
};

// "lon,lat,alt lon,lat,alt ..." -> [{ lat, lon }]
const parseLineCoordinates = (text) => {
	return text.trim().split(/\s+/).map((point) => {
		const values = point.split(",").map(Number);
		return { lat: values[1], lon: values[0] };
	}).filter((point) => {
		return Number.isFinite(point.lat) && Number.isFinite(point.lon);
	});
};

// Station at a line vertex: the nearest one of the line's layer within
// MAX_SNAP_M, else the nearest station
const snap = (stations, layerName, point) => {
	const near = stations.map((station) => {
		return { station: station, distance: distanceM(station, point) };
	}).filter((candidate) => {
		return candidate.distance <= MAX_SNAP_M;
	}).sort((a, b) => {
		return a.distance - b.distance;
	});

	if (near.length === 0) {
		return null;
	}

	// stations of one site are a few metres apart: the line's own layer wins
	const sameLayer = near.find((candidate) => {
		return candidate.station.raw.layer === layerName;
	});

	return (sameLayer || near[0]).station;
};

const parseKml = (kml) => {
	const $ = cheerio.load(kml, { xmlMode: true });
	const lines = [];

	const emitters = $("Folder").toArray().reduce((result, folder) => {
		const layerName = $(folder).children("name").text().trim();

		$(folder).find("Placemark").toArray().forEach((placemark) => {
			const line = $(placemark).find("LineString > coordinates").text();
			const style = $(placemark).children("styleUrl").text().match(/^#line-([0-9A-F]{6})-/i);

			if (line) {
				lines.push({ layer: layerName, color: style ? "#" + style[1] : null, points: parseLineCoordinates(line) });
			}
		});

		const placemarks = $(folder).find("Placemark").toArray().map((placemark) => {
			return {
				name: $(placemark).children("name").text().trim(),
				description: $(placemark).children("description").text(),
				coordinates: $(placemark).find("Point > coordinates").text() || null
			};
		}).filter((placemark) => {
			// the map has empty placeholder placemarks (no name, no point)
			return placemark.name || placemark.coordinates;
		});

		return result.concat(placemarks.map((placemark) => {
			return toEmitter(layerName, placemark);
		}));
	}, []);

	return withLinks(emitters, lines);
};

// Adds raw.links to the stations at both ends of every line segment
const withLinks = (emitters, lines) => {
	const stations = emitters.filter((emitter) => {
		return emitter.lat !== null;
	});
	const links = new Map();
	const addLink = (from, to, color) => {
		const list = links.get(from) || [];

		if (from !== to && !list.some((link) => {
			return link.key === to.source_key;
		})) {
			links.set(from, list.concat([{ key: to.source_key, color: color }]));
		}
	};

	lines.forEach((line) => {
		const ends = line.points.map((point) => {
			return snap(stations, line.layer, point);
		});

		ends.slice(1).forEach((end, index) => {
			const start = ends[index];

			if (start && end) {
				addLink(start, end, line.color);
				addLink(end, start, line.color);
			}
		});
	});

	return emitters.map((emitter) => {
		const list = links.get(emitter);
		return list ? Object.assign({}, emitter, { raw: Object.assign({}, emitter.raw, { links: list }) }) : emitter;
	});
};

const yu1srsMap = {
	_client: got.extend({}),

	id: "yu1srs-map",
	description: "SRS repeater map (Google My Maps KML): repeaters, APRS, beacons in Serbia and neighbouring countries, with coordinates",
	url: PAGE_URL,

	fetch: () => {
		return yu1srsMap._client.get(URL).then((response) => {
			return parseKml(response.body);
		});
	}
};

module.exports = yu1srsMap;
