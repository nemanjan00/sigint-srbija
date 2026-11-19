// Fill in coordinates for emitters whose source did not publish any, using
// other sources. Runs after every fetch; derived coordinates are recomputed
// from scratch each time (coord_source not starting with 'source').
//
// Order of preference:
//  1. same DMR ID in a source with coordinates
//  2. same callsign (and same TX frequency when both are known)
//  3. same TX frequency and the same place name (map entries without callsign)
//  4. gazetteer (data/gazetteer.json) by "site, city", then city
//  5. Maidenhead locator (grid square centre)
const storage = require("../storage");
const gazetteer = require("../gazetteer");
const maidenhead = require("../utils/maidenhead");

// Sources trusted as coordinate donors, best first
const DONORS = ["yu1srs-map", "brandmeister"];
const FREQ_TOLERANCE_HZ = 2000;

const normalize = (text) => {
	return (text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
};

const sameFrequency = (a, b) => {
	return a !== null && b !== null && Math.abs(a - b) <= FREQ_TOLERANCE_HZ;
};

const frequencyCompatible = (a, b) => {
	return a === null || b === null || sameFrequency(a, b);
};

const fromDonor = (donor, method) => {
	return {
		lat: donor.lat,
		lon: donor.lon,
		coord_source: donor.source + ":" + method,
		coord_accuracy_m: donor.coord_accuracy_m
	};
};

const byPriority = (a, b) => {
	return DONORS.indexOf(a.source) - DONORS.indexOf(b.source);
};

const matchers = [
	(emitter, donors) => {
		const donor = emitter.dmr_id && donors.filter((candidate) => {
			return candidate.dmr_id === emitter.dmr_id;
		})[0];
		return donor ? fromDonor(donor, "dmr_id") : null;
	},
	(emitter, donors) => {
		const donor = emitter.callsign && donors.filter((candidate) => {
			return candidate.callsign === emitter.callsign && frequencyCompatible(candidate.tx_hz, emitter.tx_hz);
		})[0];
		return donor ? fromDonor(donor, "callsign") : null;
	},
	(emitter, donors) => {
		const places = [emitter.location, emitter.city].map(normalize).filter(Boolean);
		const donor = donors.filter((candidate) => {
			const text = normalize(candidate.name + " " + (candidate.location || ""));
			return sameFrequency(candidate.tx_hz, emitter.tx_hz) && places.some((place) => {
				return text.includes(place);
			});
		})[0];
		return donor ? fromDonor(donor, "frequency+place") : null;
	},
	(emitter, _donors, places) => {
		const place = gazetteer.find(places, emitter);

		if (!place) {
			return null;
		}

		return { lat: place.lat, lon: place.lon, coord_source: "gazetteer", coord_accuracy_m: place.accuracyM };
	},
	(emitter) => {
		const square = maidenhead.toLatLon(emitter.locator);

		if (!square) {
			return null;
		}

		return { lat: square.lat, lon: square.lon, coord_source: "maidenhead", coord_accuracy_m: square.accuracyM };
	}
];

const resolve = () => {
	const db = storage.getDatabase();
	const places = gazetteer.load();

	return storage.transaction(() => {
		db.exec("UPDATE emitters SET lat = NULL, lon = NULL, coord_source = NULL, coord_accuracy_m = NULL WHERE coord_source IS NOT NULL AND coord_source NOT LIKE 'source%'");

		const donors = storage.getEmitters("coord_source = 'source' AND source IN (" + DONORS.map(() => {
			return "?";
		}).join(", ") + ")", DONORS).sort(byPriority);
		// licences without coordinates are mobile stations; nothing to resolve there
		const missing = storage.getEmitters("lat IS NULL AND (kind IS NULL OR kind != 'licence')");
		const update = db.prepare("UPDATE emitters SET lat = ?, lon = ?, coord_source = ?, coord_accuracy_m = ? WHERE id = ?");

		const counts = missing.reduce((result, emitter) => {
			const position = matchers.reduce((found, matcher) => {
				return found || matcher(emitter, donors, places);
			}, null);

			if (position) {
				update.run(position.lat, position.lon, position.coord_source, position.coord_accuracy_m, emitter.id);
				result[position.coord_source] = (result[position.coord_source] || 0) + 1;
			} else {
				result.unresolved++;
			}

			return result;
		}, { unresolved: 0 });

		return counts;
	});
};

module.exports = {
	resolve: resolve
};
