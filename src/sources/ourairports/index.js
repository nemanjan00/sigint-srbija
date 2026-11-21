// Aviation radio from OurAirports (kind "aviation"), inside data/boundary.geojson:
//  - navaids: VOR / VOR-DME / TACAN (108-118 MHz), NDB (190-1750 kHz).
//      callsign = Morse ident, mode = type, tx = navaid frequency;
//      DME channel and its reply frequency (the ground transponder) in raw
//  - airport radio: tower, approach, ground, ATIS, ... per airport, at the airport position.
//      callsign = airport ident, mode = frequency type, tx = frequency
// Community data: frequencies are not checked against AIP Serbia.
const ourairports = require("../../services/ourairports");
const boundary = require("../../utils/boundary");

const KHZ = 1000;
const MHZ = 1000000;

const inside = (row) => {
	return boundary.isInside(Number(row.latitude_deg), Number(row.longitude_deg));
};

// DME ground reply frequency of a channel ("070X"): X replies 63 MHz below the
// interrogation (1025 + n - 1) up to channel 63 and 63 MHz above from 64; Y the other way round
const dmeReplyMhz = (channel) => {
	const match = /^0*(\d+)([XY])$/.exec(channel || "");

	if (!match) {
		return null;
	}

	const number = Number(match[1]);
	const interrogation = 1024 + number;
	const below = (number <= 63) === (match[2] === "X");

	return below ? interrogation - 63 : interrogation + 63;
};

const navaidEmitter = (navaid) => {
	const hz = Number(navaid.frequency_khz) * KHZ;

	return {
		source_key: "navaid/" + navaid.id,
		kind: "aviation",
		mode: navaid.type,
		callsign: navaid.ident || null,
		name: navaid.name + " " + navaid.type,
		operator: navaid.associated_airport || null,
		tx_hz: hz || null,
		lat: Number(navaid.latitude_deg),
		lon: Number(navaid.longitude_deg),
		coord_source: "source",
		raw: {
			type: navaid.type,
			ident: navaid.ident,
			name: navaid.name,
			frequency_khz: Number(navaid.frequency_khz) || null,
			dme_channel: navaid.dme_channel || undefined,
			dme_reply_mhz: dmeReplyMhz(navaid.dme_channel) || undefined,
			elevation_ft: Number(navaid.elevation_ft) || undefined,
			power: navaid.power || undefined,
			usage: navaid.usageType || undefined,
			airport: navaid.associated_airport || undefined
		}
	};
};

const frequencyEmitter = (airport, frequency) => {
	return {
		source_key: "airport/" + airport.ident + "/" + frequency.type + "/" + frequency.frequency_mhz,
		kind: "aviation",
		mode: frequency.type,
		callsign: airport.ident,
		name: airport.name + " " + (frequency.description || frequency.type).trim(),
		location: airport.municipality || null,
		tx_hz: Math.round(Number(frequency.frequency_mhz) * MHZ) || null,
		lat: Number(airport.latitude_deg),
		lon: Number(airport.longitude_deg),
		coord_source: "source",
		raw: {
			airport: airport.ident,
			airport_name: airport.name,
			airport_type: airport.type,
			type: frequency.type,
			description: frequency.description || undefined,
			frequency_mhz: Number(frequency.frequency_mhz)
		}
	};
};

const ourairportsSource = {
	id: "ourairports",
	description: "Aviation radio: navigation aids (VOR, DME, NDB) and airport frequencies, from OurAirports",
	url: "https://ourairports.com/countries/RS/",

	fetch: () => {
		return Promise.all([ourairports.getNavaids(), ourairports.getAirports(), ourairports.getAirportFrequencies()]).then((results) => {
			const navaids = results[0].filter(inside).map(navaidEmitter);
			const airports = new Map(results[1].filter(inside).map((airport) => {
				return [airport.ident, airport];
			}));
			const frequencies = results[2].filter((frequency) => {
				return airports.has(frequency.airport_ident) && Number(frequency.frequency_mhz) > 0;
			}).map((frequency) => {
				return frequencyEmitter(airports.get(frequency.airport_ident), frequency);
			});

			return navaids.concat(frequencies);
		});
	}
};

module.exports = ourairportsSource;
