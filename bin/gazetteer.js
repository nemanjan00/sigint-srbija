// Geocode place names of emitters that still have no coordinates (via
// OpenStreetMap Nominatim, 1 request/s) into data/gazetteer.json, then
// re-resolve coordinates. Review the file afterwards: wrong matches happen.
const parseArgs = require("util").parseArgs;
const storage = require("../src/storage");
const gazetteer = require("../src/gazetteer");
const geo = require("../src/geo");

const args = parseArgs({
	options: {
		"retry-missing": { type: "boolean", default: false }
	}
}).values;

const unresolved = storage.getEmitters("lat IS NULL AND (kind IS NULL OR kind != 'licence')");
const names = unresolved.reduce((result, emitter) => {
	return result.concat(gazetteer.keysFor(emitter));
}, []);

gazetteer.update(names, { retryMissing: args["retry-missing"] })
	.then((counts) => {
		console.log("gazetteer:", counts);
		console.log("coordinates resolved:", geo.resolve());
		storage.close();
		// TODO: drop once queue-promised stops re-arming runWaiter on an empty queue (keeps the process alive)
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
