// SRS repeater map (Google My Maps embedded on yu1srs.org.rs/repetitori-u-srbiji/),
// exported as KML. Same network as yu1srs-repeaters, but with coordinates, and
// it also lists repeaters in neighbouring countries.
const got = require("got-verbose");
const cheerio = require("cheerio");
const mhzToHz = require("../../utils/frequency").mhzToHz;

const MAP_ID = "1xWomnRZ0W-5Z_n7p9w1yJK3YPo3YXx8";
const URL = "https://www.google.com/maps/d/kml?mid=" + MAP_ID + "&forcekml=1";
const PAGE_URL = "https://yu1srs.org.rs/repetitori-u-srbiji/";
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

const parseKml = (kml) => {
	const $ = cheerio.load(kml, { xmlMode: true });

	return $("Folder").toArray().reduce((emitters, folder) => {
		const layerName = $(folder).children("name").text().trim();

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

		return emitters.concat(placemarks.map((placemark) => {
			return toEmitter(layerName, placemark);
		}));
	}, []);
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
