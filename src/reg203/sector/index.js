// Sector of a licence holder, guessed from its name (the register has no such
// field). Rules are matched in order on the folded name (lowercase Latin, no
// diacritics); first match wins. Police and military are not in the public
// register at all.
const fold = require("../../utils/text").fold;

const SECTORS = [
	{ id: "emergency", label: "Fire & rescue", owner: "public", match: /vatrogas|spasilac|gorska sluzba|crveni krst|civilna zastit|vanredn/ },
	{ id: "health", label: "Ambulance & health", owner: "public", match: /hitn|urgent|dom zdravlja|bolnic|klinick|zdravstven|medicin|apotek/ },
	{ id: "justice", label: "Prisons & justice", owner: "public", match: /kazneno|zatvor|sud |sudsk|tuzilast/ },
	{ id: "government", label: "Government & municipal", owner: "public", match: /ministarstv|republika srbija|uprava|^grad |grad [a-z]+ -|opstin|skupstin|agencij|direkcij|zavod za|pokrajin|carin/ },
	{ id: "aviation", label: "Aviation", owner: null, match: /aerodrom|airport|kontrola letenja|smatsa|air serbia|vazduhoplov|aeroklub|avio/ },
	{ id: "rail-road-water", label: "Rail, road & waterways", owner: null, match: /zeleznic|putevi srbije|vodne puteve|luka |pristanist|plovidb|autoput|koridor/ },
	{ id: "public-transport", label: "Public transport & taxi", owner: null, match: /gradsko saobracajno|gsp|autoprevoz|lasta|taksi|taxi|prevoz/ },
	{ id: "energy", label: "Energy (power, oil, gas)", owner: null, match: /elektro|eps|elektroprivred|elektromrez|nis a\.?d|naft|srbijagas|gas |toplan|energ|termoelektr|hidroelektr/ },
	{ id: "utilities", label: "Utilities (water, waste, parking)", owner: "public", match: /komunaln|jkp|vodovod|kanalizac|cistoc|parking|zelenil|pogreb|beograd-put|skijalist|ada ciganlij/ },
	{ id: "telecom", label: "Telecom & broadcast", owner: null, match: /telekom|cetin|a1 srbija|yettel|telenor|vip mobile|emisiona tehnika|radio-televizij|rts|televizij|radio |sbb|orion telekom|mts/ },
	{ id: "security", label: "Private security", owner: "private", match: /obezbedj|obezbedenj|security|\bsafe\b|securitas|g4s|zastitn|istrazn|sot sistemi|dobergard|detektiv/ },
	{ id: "industry", label: "Industry & mining", owner: "private", match: /rudnik|rudarsk|zijin|copper|hbis|zelezar|steel|petrohemij|cement|fabrik|industrij|hemij|mining|sojaprotein/ }
];

const OTHER = { id: "other", label: "Other / private", owner: "private" };

// Generic public-ownership hints for sectors without a fixed owner
const PUBLIC_HINTS = /javn[oa] preduzec|javno komunaln|jkp|akcionarsko drustvo za upravljanje javnom|ministarstv|republika srbija|^grad |opstin|elektroprivreda srbije|elektrodistribucija srbije|elektromreza srbije|srbijagas|telekom srbija|putevi srbije|aerodromi srbije|kontrola letenja|infrastruktura zeleznice|emisiona tehnika/;

/**
 * @param {string} holder - Licence holder name
 * @returns {{sector: string, owner: string}} owner: public | private
 */
const classify = (holder) => {
	const name = fold(holder);
	const sector = SECTORS.find((candidate) => {
		return candidate.match.test(name);
	}) || OTHER;
	const owner = sector.owner || (PUBLIC_HINTS.test(name) ? "public" : "private");

	return { sector: sector.id, owner: owner === "private" && PUBLIC_HINTS.test(name) ? "public" : owner };
};

const getSectors = () => {
	return SECTORS.concat([OTHER]).map((sector) => {
		return { id: sector.id, label: sector.label };
	});
};

module.exports = {
	classify: classify,
	getSectors: getSectors
};
