// Usage: yarn fetch [source-id ...]  (no ids = all sources)
// Fetches sources into the global database, then resolves coordinates.
const sources = require("../src/sources");
const storage = require("../src/storage");
const geo = require("../src/geo");

const requested = process.argv.slice(2);
const sourcesMap = sources.getSourcesMap();

const unknown = requested.filter((id) => {
	return !sourcesMap[id];
});

if (unknown.length > 0) {
	console.error("Unknown source(s): " + unknown.join(", "));
	console.error("Available: " + Object.keys(sourcesMap).join(", "));
	process.exit(1);
}

let selected = sources.getSources();

if (requested.length > 0) {
	selected = requested.map((id) => {
		return sourcesMap[id];
	});
}

const fetchSource = (source) => {
	return source.fetch().then((emitters) => {
		const count = storage.replaceEmitters(source, emitters);
		console.log(source.id + ": saved " + count + " emitters");
		return true;
	}).catch((error) => {
		console.error(source.id + ": failed");
		console.error(error);
		return false;
	});
};

selected.reduce((chain, source) => {
	return chain.then((results) => {
		return fetchSource(source).then((ok) => {
			return results.concat([ok]);
		});
	});
}, Promise.resolve([])).then((results) => {
	console.log("coordinates resolved:", geo.resolve());
	storage.close();

	if (results.includes(false)) {
		process.exit(1);
	}
});
