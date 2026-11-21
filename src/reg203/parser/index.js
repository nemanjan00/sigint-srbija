// Parsers for register reg203 (CSV export and HTML search pages)
const fs = require("fs");
const parseCsvStream = require("csv-parse").parse;
const ratelUtils = require("../../utils/ratel");

const normWs = ratelUtils.normWs;
const parseFreq = ratelUtils.parseFreq;
const parseDate = ratelUtils.parseDate;
const parseDms = ratelUtils.parseDms;
const splitHolder = ratelUtils.splitHolder;

// Exact header of the export, in order
const CSV_COLUMNS = [
	"Редни број", "Број дозволе", "Носилац права", "Предајна фреквенција",
	"Пријемна фреквенција", "Важи од", "Рок трајања", "Знак идентификације",
	"Врста станице/службе", "Локација", "Географска дужина", "Географска ширина",
	"Координантни систем", "Статус", "Датум", "Разлог"
];

const CSV_OPTIONS = {
	delimiter: "\t",
	quote: "\"",
	relax_quotes: true,
	relax_column_count: true,
	skip_empty_lines: true
};
const UTF16LE_BOM = [0xff, 0xfe];

const ROW_REGEX = /<tr class="(?: |disabled)?">([\s\S]*?)<\/tr>\s*<tr class="hidden additional-data[^"]*">([\s\S]*?)<\/tr>/g;
const TD_REGEX = /<td[^>]*>([\s\S]*?)<\/td>/g;

const isUtf16Export = (buffer) => {
	return buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff));
};

/**
 * Parse the raw export file row by row (constant memory)
 * @param {string} csvFile - UTF-16LE export with BOM
 * @param {function(string[])} onRow - Called with every well-formed row (without header)
 * @returns {Promise<{rows: number, skipped: number}>}
 */
const parseExportFile = (csvFile, onRow) => {
	const head = Buffer.alloc(2);
	const fd = fs.openSync(csvFile, "r");
	fs.readSync(fd, head, 0, 2, 0);
	fs.closeSync(fd);

	if (head[0] !== UTF16LE_BOM[0] || head[1] !== UTF16LE_BOM[1]) {
		return Promise.reject(new Error("Unexpected export encoding, no UTF-16LE BOM: " + JSON.stringify(head.toString("latin1"))));
	}

	return new Promise((resolve, reject) => {
		const counts = { rows: 0, skipped: 0 };
		const csv = parseCsvStream(Object.assign({ encoding: "utf16le", bom: true }, CSV_OPTIONS));
		let header = null;

		csv.on("data", (row) => {
			if (header === null) {
				header = row.join("\t").replace(/^\ufeff/, "");

				if (header !== CSV_COLUMNS.join("\t")) {
					csv.destroy(new Error("Unexpected CSV header: " + JSON.stringify(row)));
				}

				return;
			}

			if (row.length !== CSV_COLUMNS.length) {
				counts.skipped++;
				return;
			}

			counts.rows++;
			onRow(row);
		});
		csv.on("error", reject);
		csv.on("end", () => {
			resolve(counts);
		});

		fs.createReadStream(csvFile).on("error", reject).pipe(csv);
	});
};

// One export row -> assignment record (keys match database columns)
const toAssignment = (row) => {
	const values = row.map((value) => {
		return value.trim();
	});
	const holder = splitHolder(values[2]);
	const tx = parseFreq(values[3]);
	const rx = parseFreq(values[4]);
	const kind = values[8] ? values[8].split("/") : [];
	const status = values[13];

	return {
		redni_broj: Number(values[0]),
		broj_dozvole: values[1],
		nosilac: normWs(values[2]),
		nosilac_naziv: holder.name,
		nosilac_adresa: holder.address,
		tx_freq_raw: values[3] || null,
		tx_freq_low_hz: tx.low,
		tx_freq_high_hz: tx.high,
		rx_freq_raw: values[4] || null,
		rx_freq_low_hz: rx.low,
		rx_freq_high_hz: rx.high,
		vazi_od: parseDate(values[5]),
		rok_trajanja: parseDate(values[6]),
		znak_identifikacije: values[7] || null,
		vrsta_raw: values[8] || null,
		vrsta_stanice: kind[0] || null,
		vrsta_sluzbe: kind.slice(1).join("/") || null,
		lokacija: values[9] || null,
		lon_raw: values[10] || null,
		lat_raw: values[11] || null,
		lon_deg: parseDms(values[10]),
		lat_deg: parseDms(values[11]),
		koord_sistem: values[12] || null,
		status: status,
		vazeca: status ? 0 : 1,
		status_datum: parseDate(values[14]),
		razlog: values[15] || null
	};
};

const cellsOf = (html) => {
	return Array.from(html.matchAll(TD_REGEX)).map((match) => {
		return match[1];
	});
};

// "Key: value<br/>Key: value" -> { Key: value }
const parseAdditionalData = (html) => {
	const text = normWs(html.replace(/<br\s*\/?>/g, " | "));

	return text.split(" | ").reduce((fields, part) => {
		const index = part.indexOf(":");

		if (index !== -1) {
			fields[part.slice(0, index).trim()] = part.slice(index + 1).trim();
		}

		return fields;
	}, {});
};

// Rows of an HTML search page, with the fields the CSV export lacks
const parseSearchPage = (html) => {
	return Array.from(html.matchAll(ROW_REGEX)).map((match) => {
		const cells = cellsOf(match[1]).map((cell) => {
			return normWs(cell.replace(/<[^>]+>/g, " "));
		});

		if (cells.length < 9) {
			return null;
		}

		const extraCells = cellsOf(match[2]);
		const fields = parseAdditionalData(extraCells[extraCells.length - 1] || "");

		return {
			redni_broj: Number(cells[0]),
			broj_dozvole: cells[1],
			nosilac_naziv: cells[2] || null,
			tx_freq_low_hz: parseFreq(cells[3]).low,
			rx_freq_low_hz: parseFreq(cells[4]).low,
			vazi_od: parseDate(cells[5]),
			rok_trajanja: parseDate(cells[6]),
			vrsta_raw: cells[7] || null,
			lokacija: cells[8] || null,
			nosilac_adresa: fields["Адреса"] || null,
			tehnicki_pregled: parseDate(fields["Технички преглед"]),
			datum_pocetka: parseDate(fields["Датум почетка коришћења"]),
			vrsta_opis: fields["Врста станице/службе"] || null
		};
	}).filter((row) => {
		return row !== null;
	});
};

// Pages are 1-based (page=0 is an alias of page 1); the highest linked page is the last
const parseLastPage = (html) => {
	const pages = Array.from(html.matchAll(/page=(\d+)/g)).map((match) => {
		return Number(match[1]);
	});

	return Math.max.apply(null, pages.concat([1]));
};

const parseSelectOptions = (html, name) => {
	const select = html.match(new RegExp("<select[^>]+name=\"" + name + "\"[^>]*>([\\s\\S]*?)</select>"));

	if (!select) {
		return {};
	}

	return Array.from(select[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)).reduce((options, match) => {
		const code = match[1];

		if (code) {
			const text = normWs(match[2].replace(/<[^>]+>/g, ""));
			options[code] = text.startsWith(code + ",") ? text.slice(code.length + 1).trim() : text;
		}

		return options;
	}, {});
};

// Code tables and "updated" date from the search form page
const parseFormPage = (html) => {
	const updated = html.match(/registar-updated-date">\s*([\d.]+)/);

	return {
		stationTypes: parseSelectOptions(html, "vrstaStanice"),
		serviceTypes: parseSelectOptions(html, "vrstaSluzbe"),
		updated: parseDate(updated ? updated[1] : null)
	};
};

module.exports = {
	CSV_COLUMNS: CSV_COLUMNS,
	isUtf16Export: isUtf16Export,
	parseExportFile: parseExportFile,
	toAssignment: toAssignment,
	parseSearchPage: parseSearchPage,
	parseLastPage: parseLastPage,
	parseFormPage: parseFormPage
};
