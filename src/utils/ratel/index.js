// Parsers for value formats used on RATEL registers (registar.ratel.rs)
const decodeHTML = require("entities").decodeHTML;
const parseCsv = require("csv-parse/sync").parse;

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

const decodeUtf16 = (buffer) => {
	if (buffer[0] === 0xfe && buffer[1] === 0xff) {
		return Buffer.from(buffer).swap16().toString("utf16le").slice(1);
	}

	if (buffer[0] === 0xff && buffer[1] === 0xfe) {
		return buffer.toString("utf16le").slice(1);
	}

	throw new Error("Unexpected export encoding, no UTF-16 BOM: " + JSON.stringify(buffer.slice(0, 40).toString("latin1")));
};

/**
 * A register's CSV export (UTF-16 with BOM, tab-separated, quoted) as objects
 * keyed by the header row. Repeated header names get " 2", " 3", ... appended.
 * @param {Buffer} buffer
 * @returns {Object[]}
 */
const parseExport = (buffer) => {
	const rows = parseCsv(decodeUtf16(buffer), {
		delimiter: "\t",
		quote: "\"",
		relax_quotes: true,
		relax_column_count: true,
		skip_empty_lines: true
	});
	const seen = {};
	const header = (rows[0] || []).map((name) => {
		seen[name] = (seen[name] || 0) + 1;
		return seen[name] === 1 ? name : name + " " + seen[name];
	});

	return rows.slice(1).map((row) => {
		return header.reduce((object, name, index) => {
			object[name] = row[index] === undefined ? "" : row[index].trim();
			return object;
		}, {});
	});
};

// "20°27´56´´E  44°48´50´´N" -> { lat: 44.813889, lon: 20.465556 }; null if not that format
const parseDmsPair = (text) => {
	const parts = Array.from(String(text || "").matchAll(/(\d+)°\s*(\d+)[´'’]\s*([\d.,]+)\s*(?:´´|"|''|”)?\s*([NSEW])/g));

	if (parts.length !== 2) {
		return null;
	}

	return parts.reduce((result, part) => {
		const value = Number(part[1]) + Number(part[2]) / 60 + Number(part[3].replace(",", ".")) / 3600;
		const signed = part[4] === "S" || part[4] === "W" ? -value : value;
		result[part[4] === "N" || part[4] === "S" ? "lat" : "lon"] = Math.round(signed * 1e6) / 1e6;
		return result;
	}, {});
};

module.exports = {
	parseExport: parseExport,
	parseDmsPair: parseDmsPair,
	normWs: normWs,
	parseFreq: parseFreq,
	parseDate: parseDate,
	parseDms: parseDms,
	splitHolder: splitHolder
};
