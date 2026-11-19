const cheerio = require("cheerio");

const EMPTY_VALUES = ["", "/", "-"];

const normalizeCell = (text) => {
	const trimmed = text.replace(/\s+/g, " ").trim();

	if (EMPTY_VALUES.includes(trimmed)) {
		return null;
	}

	return trimmed;
};

/**
 * Parse HTML table into array of objects
 * @param {string} html - Page HTML
 * @param {string} selector - CSS selector of table
 * @param {string[]} fields - Object keys, in column order (extra columns are dropped)
 * @returns {Object[]}
 */
const parseTable = (html, selector, fields) => {
	const $ = cheerio.load(html);
	const table = $(selector);

	if (table.length === 0) {
		throw new Error("Table not found: " + selector);
	}

	return table.find("tbody tr").toArray().map((row) => {
		const cells = $(row).find("td").toArray().map((cell) => {
			return normalizeCell($(cell).text());
		});

		return fields.reduce((result, field, index) => {
			result[field] = cells[index] === undefined ? null : cells[index];
			return result;
		}, {});
	});
};

module.exports = {
	parseTable: parseTable,
	normalizeCell: normalizeCell
};
