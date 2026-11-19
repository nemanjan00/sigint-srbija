// Site name -> coordinates, for sources that publish only place names.
// Stored in data/gazetteer.json (tracked in git) so entries can be reviewed
// and corrected by hand; set "reviewed": true after checking an entry, and
// update() will never overwrite it.
const fs = require("fs");
const path = require("path");
const storage = require("../storage");
const nominatim = require("../services/nominatim");

const GAZETTEER_FILE = path.join(storage.DATA_DIR, "gazetteer.json");
// OSM files Kosovo under "xk"
const COUNTRY_CODES = "rs,xk";
const SITE_ACCURACY_M = 1000;
const CITY_ACCURACY_M = 5000;

// Lookup keys for an emitter, most specific first. Site names alone are often
// generic ("Dom kulture", "Opšta bolnica"), so they are always paired with the city.
const lookupsFor = (emitter) => {
	const lookups = [];

	if (emitter.location && emitter.city && emitter.location !== emitter.city) {
		lookups.push({ key: emitter.location + ", " + emitter.city, accuracyM: SITE_ACCURACY_M });
	}

	if (emitter.city || emitter.location) {
		lookups.push({ key: emitter.city || emitter.location, accuracyM: CITY_ACCURACY_M });
	}

	return lookups;
};

const keysFor = (emitter) => {
	return lookupsFor(emitter).map((lookup) => {
		return lookup.key;
	});
};

/**
 * Best gazetteer position for an emitter
 * @param {Object} places - Loaded gazetteer
 * @param {Object} emitter
 * @returns {{lat: number, lon: number, accuracyM: number}|null}
 */
const find = (places, emitter) => {
	const lookup = lookupsFor(emitter).find((candidate) => {
		return places[candidate.key];
	});

	if (!lookup) {
		return null;
	}

	return { lat: places[lookup.key].lat, lon: places[lookup.key].lon, accuracyM: lookup.accuracyM };
};

// { key: { lat, lon, query, display_name, osm, reviewed } | null (not found) }
const load = () => {
	if (!fs.existsSync(GAZETTEER_FILE)) {
		return {};
	}

	return JSON.parse(fs.readFileSync(GAZETTEER_FILE, "utf8"));
};

const save = (places) => {
	const sorted = Object.keys(places).sort().reduce((result, name) => {
		result[name] = places[name];
		return result;
	}, {});

	fs.writeFileSync(GAZETTEER_FILE, JSON.stringify(sorted, null, "\t") + "\n");
};

const geocode = (name) => {
	return nominatim.search(name, COUNTRY_CODES).then((result) => {
		if (!result) {
			return null;
		}

		return {
			lat: Number(result.lat),
			lon: Number(result.lon),
			query: name,
			display_name: result.display_name,
			osm: result.osm_type + "/" + result.osm_id,
			reviewed: false
		};
	});
};

/**
 * Geocode keys (see keysFor) not yet in the gazetteer (names already present,
 * including not-found nulls, are kept unless retryMissing is set)
 * @param {string[]} names
 * @param {Object} [options]
 * @param {boolean} [options.retryMissing] - Look up names stored as null again
 * @returns {Promise<{added: number, notFound: number}>}
 */
const update = (names, options) => {
	const places = load();
	const settings = options || {};
	const todo = Array.from(new Set(names)).filter((name) => {
		return !(name in places) || (places[name] === null && settings.retryMissing);
	});
	const counts = { added: 0, notFound: 0 };

	return todo.reduce((chain, name) => {
		return chain.then(() => {
			return geocode(name);
		}).then((place) => {
			places[name] = place;
			counts[place ? "added" : "notFound"]++;
			console.log((place ? "  found " : "  missing ") + name + (place ? " -> " + place.display_name : ""));
			save(places);
		});
	}, Promise.resolve()).then(() => {
		return counts;
	});
};

module.exports = {
	GAZETTEER_FILE: GAZETTEER_FILE,
	keysFor: keysFor,
	find: find,
	load: load,
	update: update
};
