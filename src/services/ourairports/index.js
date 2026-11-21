const got = require("got-verbose");
const parse = require("csv-parse/sync").parse;
const withRetry = require("../../utils/retry").withRetry;

// OurAirports open data (public domain, community maintained): airports,
// their radio frequencies and radio navigation aids, worldwide CSVs (~1-13 MB)
const ourairports = {
	_client: got.extend({
		prefixUrl: "https://davidmegginson.github.io/ourairports-data"
	}),

	_getCsv: withRetry((file) => {
		return ourairports._client.get(file).then((response) => {
			return parse(response.body, { columns: true, skip_empty_lines: true, bom: true });
		});
	}),

	// id, ident, type (VOR, VOR-DME, NDB, TACAN, ...), name, frequency_khz, latitude_deg, longitude_deg, dme_channel, associated_airport, ...
	getNavaids: () => {
		return ourairports._getCsv("navaids.csv");
	},

	// id, ident, type, name, latitude_deg, longitude_deg, municipality, ...
	getAirports: () => {
		return ourairports._getCsv("airports.csv");
	},

	// airport_ident, type (TWR, APP, GND, ATIS, ...), description, frequency_mhz
	getAirportFrequencies: () => {
		return ourairports._getCsv("airport-frequencies.csv");
	}
};

module.exports = ourairports;
