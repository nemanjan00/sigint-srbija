// Parser for RATEL's band plan table ("Табела 1. Намена радиофреквенцијских
// опсега", annex of the Uredba o utvrđivanju Plana namene RF opsega) from the
// output of `pdftotext -bbox`. Columns sit at the same x on every page (the
// -layout text output shifts them per page), so words are assigned to columns
// by position.
const decodeXML = require("entities").decodeXML;

// Left edge (pt) of each table column
const COLUMNS = [
	["range", 0],
	["services", 148],
	["application", 286],
	["condition", 408],
	["regulation", 540],
	["standard", 606],
	["licensing", 664],
	["transfer", 702]
];
// Words closer than this vertically are on the same line
const LINE_TOLERANCE = 2;
// The table header (first page) and the "unofficial consolidated text" stamp
const HEADER_BOTTOM_FIRST_PAGE = 135;
const STAMP_BOTTOM = 45;

const RANGE = /^([\d.]+)\s*(Hz|kHz|MHz|GHz)\s*-\s*([\d.]+)\s*(Hz|kHz|MHz|GHz)$/;
const FOOTNOTES = /^((5\.\d+|SRB\d+|ECA\d+)[A-Za-zА-Яа-я]*[,\s]*)+$/;
// Footnotes trailing a service name on the same line
const TRAILING_FOOTNOTES = /\s+((5\.\d+|SRB\d+|ECA\d+)[A-Za-zА-Яа-я]*[,\s]*)+$/;
// Radio services (column 2) start with one of these; other lines continue the previous one
const SERVICE_STARTS = [
	"није намењено", "фиксна", "мобилна", "копнена", "поморска", "ваздухопловна", "радио-навигација", "радионавигацијска",
	"радиолокацијска", "радиоастрономска", "радиодифузна", "истраживање", "операције у свемиру", "међусателитска",
	"метеоролошка", "служба", "сателитска служба", "аматерска"
];
const WORD = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g;

const UNITS = { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 };

const toHz = (value, unit) => {
	return Math.round(parseFloat(value) * UNITS[unit]);
};

const parseWords = (page) => {
	return Array.from(page.matchAll(WORD)).map((match) => {
		return { x: parseFloat(match[1]), y: parseFloat(match[2]), text: decodeXML(match[3]) };
	});
};

const columnOf = (x) => {
	return COLUMNS.reduce((found, column) => {
		return x >= column[1] ? column[0] : found;
	}, COLUMNS[0][0]);
};

// Words -> lines ({ y, range, services, ... } with the text of each column)
const toLines = (words) => {
	const sorted = words.slice().sort((a, b) => {
		return a.y - b.y || a.x - b.x;
	});
	const rows = sorted.reduce((result, word) => {
		const last = result[result.length - 1];

		if (last && Math.abs(last.y - word.y) < LINE_TOLERANCE) {
			last.words.push(word);
		} else {
			result.push({ y: word.y, words: [word] });
		}

		return result;
	}, []);

	return rows.map((row) => {
		return row.words.sort((a, b) => {
			return a.x - b.x;
		}).reduce((line, word) => {
			const column = columnOf(word.x);
			line[column] = line[column] ? line[column] + " " + word.text : word.text;
			return line;
		}, { y: row.y });
	});
};

const isServiceStart = (text) => {
	const lower = text.toLowerCase();

	return SERVICE_STARTS.some((start) => {
		return lower.startsWith(start);
	});
};

// "(свемир-" + "Земља)" -> "(свемир-Земља)"
const joinWrapped = (head, tail) => {
	return /-$/.test(head) ? head + tail : head + " " + tail;
};

// Primary services are written in capitals, secondary ones in sentence case
const isPrimary = (text) => {
	const word = text.split(" ")[0].replace(/[^\p{L}]/gu, "");
	return word.length > 1 && word === word.toUpperCase();
};

// A new use starts with a capital, unless the previous line ended mid-phrase
// ("Навигациони помоћни уређаји са" / "Доплеровим ефектом на ваздухоплову")
const continuesUse = (previous, text) => {
	return /^\p{Ll}/u.test(text) || /\s(са|за|и|на|у|од|и\/или)$/.test(previous);
};

// Latin look-alikes typed into the licensing column ("OO")
const normalizeLicensing = (text) => {
	return text.replace(/O/g, "О").replace(/\s+/g, " ").trim();
};

const newBand = (match) => {
	return {
		low_hz: toHz(match[1], match[2]),
		high_hz: toHz(match[3], match[4]),
		label: match[0],
		services: [],
		footnotes: [],
		uses: []
	};
};

const addServiceText = (band, text) => {
	if (FOOTNOTES.test(text)) {
		band.footnotes = band.footnotes.concat(text.split(/[,\s]+/).filter(Boolean));
		return;
	}

	const trailing = text.match(TRAILING_FOOTNOTES);

	if (trailing) {
		addServiceText(band, text.slice(0, trailing.index));
		addServiceText(band, trailing[0].trim());
		return;
	}

	const last = band.services[band.services.length - 1];

	if (last && !isServiceStart(text)) {
		last.name = joinWrapped(last.name, text);
		return;
	}

	band.services.push({ name: text, primary: isPrimary(text) });
};

const currentUse = (band) => {
	if (!band.uses.length) {
		band.uses.push({ application: null, condition: [], regulation: [], standards: [], licensing: null, transfer: false });
	}

	return band.uses[band.uses.length - 1];
};

const addLine = (band, line) => {
	if (line.services) {
		addServiceText(band, line.services);
	}

	if (line.application) {
		const last = band.uses[band.uses.length - 1];

		if (last && last.application && continuesUse(last.application, line.application)) {
			last.application = joinWrapped(last.application, line.application);
		} else {
			band.uses.push({ application: line.application, condition: [], regulation: [], standards: [], licensing: null, transfer: false });
		}
	}

	if (line.condition || line.regulation || line.standard || line.licensing || line.transfer) {
		const use = currentUse(band);

		if (line.condition) {
			use.condition.push(line.condition);
		}

		if (line.regulation) {
			use.regulation.push(line.regulation);
		}

		if (line.standard) {
			use.standards.push(line.standard);
		}

		if (line.licensing) {
			use.licensing = use.licensing ? use.licensing + " " + line.licensing : line.licensing;
		}

		if (line.transfer) {
			use.transfer = /ДА/.test(line.transfer);
		}
	}
};

// Sub-ranges named in a use's condition ("146.025-146.975 MHz", "Унутар опсега 9-148.5 kHz")
const subRanges = (text) => {
	return Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(kHz|MHz|GHz)/g)).map((match) => {
		return { low_hz: toHz(match[1], match[3]), high_hz: toHz(match[2], match[3]) };
	});
};

// The same use is often listed under several services of a band
const finishBand = (band) => {
	const seen = {};
	const uses = band.uses.map((use) => {
		const condition = use.condition.join(" ").replace(/- (\d)/g, "-$1").trim();
		const overlapping = subRanges(condition).filter((range) => {
			// ranges outside the band are references (e.g. the paired duplex band)
			return range.low_hz < band.high_hz && range.high_hz > band.low_hz;
		});
		// a range spanning the whole band ("380-470 MHz" tuning range) does not restrict the use
		const wholeBand = overlapping.some((range) => {
			return range.low_hz <= band.low_hz && range.high_hz >= band.high_hz;
		});
		const ranges = wholeBand ? [] : overlapping;

		return {
			application: use.application,
			condition: condition || null,
			ranges: ranges,
			regulation: use.regulation,
			standards: use.standards,
			licensing: use.licensing ? normalizeLicensing(use.licensing) : null,
			transfer: use.transfer
		};
	}).filter((use) => {
		const key = use.application + "|" + use.condition;
		const duplicate = seen[key];
		seen[key] = true;
		return !duplicate && (use.application || use.condition);
	});

	const services = band.services.map((service) => {
		// "(R)" sometimes printed twice
		return Object.assign({}, service, { name: service.name.replace(/(\([^)]*\))(?: \1)+/g, "$1") });
	});

	return Object.assign({}, band, { services: services, uses: uses });
};

/**
 * Bands of the plan from `pdftotext -bbox` HTML.
 * @param {string} html
 * @returns {Array<{low_hz, high_hz, label, services: Array<{name, primary}>, footnotes, uses}>}
 */
const parse = (html) => {
	const pages = html.split("<page ").slice(1);
	const lines = pages.reduce((result, page, index) => {
		const top = index === 0 ? HEADER_BOTTOM_FIRST_PAGE : STAMP_BOTTOM;
		const words = parseWords(page).filter((word) => {
			return word.y > top;
		});
		return result.concat(toLines(words));
	}, []);

	const bands = lines.reduce((result, line) => {
		const match = line.range && line.range.match(RANGE);

		if (match) {
			result.push(newBand(match));
		}

		if (result.length) {
			addLine(result[result.length - 1], Object.assign({}, line, { range: null }));
		}

		return result;
	}, []);

	return bands.map(finishBand);
};

module.exports = {
	parse: parse
};
