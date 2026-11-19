// Cross-source pass, run after every fetch (everything here is recomputed):
//
// 1. Duplicates: the same station listed by several sources is linked to one
//    canonical listing (emitters.duplicate_of), preferring DONORS order, so the
//    map shows it once.
// 2. Coordinates for emitters whose source did not publish any
//    (coord_source not starting with 'source'), in order of preference:
//     a. same station in a source with coordinates (see sameStation)
//     b. gazetteer (data/gazetteer.json) by "site, city", then city
//     c. Maidenhead locator (grid square centre)
const storage = require("../storage");
const gazetteer = require("../gazetteer");
const maidenhead = require("../utils/maidenhead");

// Sources trusted as coordinate donors, best first
const DONORS = ["yu1srs-map", "brandmeister"];
const FREQ_TOLERANCE_HZ = 2000;
// Sources disagree on frequencies of the same station (beacon YU0ZVA 144.41250
// vs 144.44125, YU0ZUA 432.401 vs 432.2401), so a shared callsign + kind allows more slack
const CALLSIGN_FREQ_TOLERANCE_HZ = 250000;
// Register kinds (RATEL) are never merged or positioned from other sources
const REGISTER_KINDS = ["licence", "broadcast", "cell", "link", "cb"];
const NOT_REGISTER = "(kind IS NULL OR kind NOT IN (" + REGISTER_KINDS.map((kind) => {
	return "'" + kind + "'";
}).join(", ") + "))";

const normalize = (text) => {
	return (text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
};

const sameFrequency = (a, b) => {
	return a !== null && b !== null && Math.abs(a - b) <= FREQ_TOLERANCE_HZ;
};

const frequencyClose = (a, b) => {
	return a === null || b === null || Math.abs(a - b) <= CALLSIGN_FREQ_TOLERANCE_HZ;
};

const samePlace = (emitter, candidate) => {
	const places = [emitter.location, emitter.city].map(normalize).filter(Boolean);
	const text = normalize(candidate.name + " " + (candidate.location || ""));

	return places.some((place) => {
		return text.includes(place);
	});
};

// How `candidate` is the same physical station as `emitter`, or null
const sameStation = (emitter, candidate) => {
	if (emitter.dmr_id && candidate.dmr_id === emitter.dmr_id) {
		return "dmr_id";
	}

	if (emitter.callsign && candidate.callsign === emitter.callsign && candidate.kind === emitter.kind && frequencyClose(candidate.tx_hz, emitter.tx_hz)) {
		return "callsign";
	}

	if (sameFrequency(candidate.tx_hz, emitter.tx_hz) && samePlace(emitter, candidate)) {
		return "frequency+place";
	}

	return null;
};

// First candidate that is the same station, by rule priority (DMR ID beats callsign beats place)
const findSameStation = (emitter, candidates) => {
	return ["dmr_id", "callsign", "frequency+place"].reduce((found, method) => {
		if (found) {
			return found;
		}

		const candidate = candidates.find((other) => {
			return other.id !== emitter.id && sameStation(emitter, other) === method;
		});

		return candidate ? { candidate: candidate, method: method } : null;
	}, null);
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
		const match = findSameStation(emitter, donors);
		return match ? fromDonor(match.candidate, match.method) : null;
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

const rank = (source) => {
	const index = DONORS.indexOf(source);
	return index === -1 ? DONORS.length : index;
};

// Link every non-licence listing to the best-ranked listing of the same station
const linkDuplicates = (db) => {
	const listings = storage.getEmitters(NOT_REGISTER).sort((a, b) => {
		return rank(a.source) - rank(b.source);
	});
	const canonicalOf = {};
	const update = db.prepare("UPDATE emitters SET duplicate_of = ? WHERE id = ?");

	return listings.reduce((count, emitter) => {
		const better = listings.filter((other) => {
			return rank(other.source) < rank(emitter.source);
		});
		const match = findSameStation(emitter, better);

		if (!match) {
			return count;
		}

		const canonical = canonicalOf[match.candidate.id] || match.candidate.id;
		canonicalOf[emitter.id] = canonical;
		update.run(canonical, emitter.id);
		return count + 1;
	}, 0);
};

const resolve = () => {
	const db = storage.getDatabase();
	const places = gazetteer.load();

	return storage.transaction(() => {
		db.exec("UPDATE emitters SET lat = NULL, lon = NULL, coord_source = NULL, coord_accuracy_m = NULL WHERE coord_source IS NOT NULL AND coord_source NOT LIKE 'source%'");
		db.exec("UPDATE emitters SET duplicate_of = NULL WHERE duplicate_of IS NOT NULL");

		const duplicates = linkDuplicates(db);
		const donors = storage.getEmitters("coord_source = 'source' AND source IN (" + DONORS.map(() => {
			return "?";
		}).join(", ") + ")", DONORS).sort(byPriority);
		// register entries without coordinates are mobile stations or unpublished; nothing to resolve there
		const missing = storage.getEmitters("lat IS NULL AND " + NOT_REGISTER);
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

		return Object.assign({ duplicates: duplicates }, counts);
	});
};

module.exports = {
	NOT_REGISTER: NOT_REGISTER,
	resolve: resolve
};
