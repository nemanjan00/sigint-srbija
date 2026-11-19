// Parsers for register reg203 (CSV export and HTML search pages)
const parseCsv = require("csv-parse/sync").parse;
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

const ROW_REGEX = /<tr class="(?: |disabled)?">([\s\S]*?)<\/tr>\s*<tr class="hidden additional-data[^"]*">([\s\S]*?)<\/tr>/g;
const TD_REGEX = /<td[^>]*>([\s\S]*?)<\/td>/g;

const isUtf16Export = (buffer) => {
	return buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff));
};

const decodeUtf16 = (buffer) => {
	if (buffer[0] === 0xfe) {
		return Buffer.from(buffer).swap16().toString("utf16le").slice(1);
	}

	return buffer.toString("utf16le").slice(1);
};

/**
 * Parse the raw export (UTF-16 with BOM, tab-separated, quoted)
 * @param {Buffer} buffer
 * @returns {{rows: string[][], skipped: number}} rows without header
 */
const parseExport = (buffer) => {
	if (!isUtf16Export(buffer)) {
		throw new Error("Unexpected export encoding, no UTF-16 BOM: " + JSON.stringify(buffer.slice(0, 40).toString("latin1")));
	}

	const rows = parseCsv(decodeUtf16(buffer), {
		delimiter: "\t",
		quote: "\"",
		relax_quotes: true,
		relax_column_count: true,
		skip_empty_lines: true
	});

	if (rows.length === 0 || rows[0].join("\t") !== CSV_COLUMNS.join("\t")) {
		throw new Error("Unexpected CSV header: " + JSON.stringify(rows[0]));
	}

	const body = rows.slice(1).filter((row) => {
		return row.length === CSV_COLUMNS.length;
	});

	return {
		rows: body,
		skipped: rows.length - 1 - body.length
	};
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
	parseExport: parseExport,
	toAssignment: toAssignment,
	parseSearchPage: parseSearchPage,
	parseLastPage: parseLastPage,
	parseFormPage: parseFormPage
};
