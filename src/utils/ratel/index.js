// Parsers for value formats used on RATEL registers (registar.ratel.rs)
const decodeHTML = require("entities").decodeHTML;

const FREQ_UNITS = {
	hz: 1,
	khz: 1e3,
	mhz: 1e6,
	ghz: 1e9
};

const normWs = (text) => {
	return decodeHTML(text).replace(/\s+/g, " ").trim();
};

/**
 * "7866.3000 MHz" -> { low: 7866300000, high: 7866300000 }
 * "410.0000 MHz - 423.1250 MHz" -> { low: 410000000, high: 423125000 }
 * @param {string|null} text
 * @returns {{low: number|null, high: number|null}}
 */
const parseFreq = (text) => {
	const empty = { low: null, high: null };

	if (!text) {
		return empty;
	}

	const matches = Array.from(text.replace(/\u00a0/g, " ").matchAll(/([\d.,]+)\s*([kKmMgG]?Hz)/g));
	const values = matches.map((match) => {
		const number = Number(match[1].replace(",", "."));
		return Math.round(number * FREQ_UNITS[match[2].toLowerCase()]);
	});

	if (values.length === 0 || values.some(Number.isNaN)) {
		return empty;
	}

	return {
		low: Math.min.apply(null, values),
		high: Math.max.apply(null, values)
	};
};

// dd.mm.yyyy -> yyyy-mm-dd, null when missing or not a real date
const parseDate = (text) => {
	if (!text) {
		return null;
	}

	const match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);

	if (!match) {
		return null;
	}

	const day = Number(match[1]);
	const month = Number(match[2]);
	const year = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));

	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
		return null;
	}

	return date.toISOString().slice(0, 10);
};

// "195859" (DDMMSS, degrees may have more digits) -> 19.983056; null if invalid
const parseDms = (text) => {
	if (!text || !/^\d+$/.test(text.trim())) {
		return null;
	}

	const digits = text.trim().padStart(6, "0");
	const seconds = Number(digits.slice(-2));
	const minutes = Number(digits.slice(-4, -2));
	const degrees = Number(digits.slice(0, -4));

	if (minutes >= 60 || seconds >= 60) {
		return null;
	}

	return Math.round((degrees + minutes / 60 + seconds / 3600) * 1e6) / 1e6;
};

// The export glues holder name and address with two spaces in ~22% of rows;
// otherwise they cannot be split reliably (enrichment fills them in).
const splitHolder = (text) => {
	const index = text.indexOf("  ");

	if (index === -1) {
		return { name: null, address: null };
	}

	return {
		name: text.slice(0, index).trim() || null,
		address: text.slice(index + 2).replace(/\s{2,}/g, " ").trim() || null
	};
};

module.exports = {
	normWs: normWs,
	parseFreq: parseFreq,
	parseDate: parseDate,
	parseDms: parseDms,
	splitHolder: splitHolder
};
