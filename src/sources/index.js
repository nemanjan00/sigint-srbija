// Registry of all signal sources. Each source exposes:
//  id          - unique slug, emitters.source in storage
//  description - what the source contains
//  url         - where data comes from
//  fetch()     - Promise resolving to array of emitters (see src/storage)
//
// Order matters only for logging; coordinates are resolved after all fetches.
const SOURCES = [
	require("./yu1srs-repeaters"),
	require("./yu1srs-map"),
	require("./brandmeister"),
	require("./ratel-reg203"),
	require("./ratel-reg204"),
	require("./ratel-reg221"),
	require("./ratel-reg215"),
	require("./ratel-reg215-cb"),
	require("./jugomesh"),
	require("./ttn"),
	require("./ourairports"),
	require("./ratel-emf")
];

const getSources = () => {
	return SOURCES;
};

const getSourcesMap = () => {
	return getSources().reduce((map, source) => {
		map[source.id] = source;
		return map;
	}, {});
};

module.exports = {
	getSources: getSources,
	getSourcesMap: getSourcesMap
};
