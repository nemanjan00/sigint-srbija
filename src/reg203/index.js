// Register reg203 ("База података о коришћењу радио-фреквенцијског спектра"):
// every radio-frequency licence in Serbia, incl. aircraft and ships.
//
// How the site works (findings, September 2026):
//  * The search form paginates 20 rows per page (page=1..N, 1-based; page=0
//    is an alias of page 1). The `source`
//    selector (radio stations / aircraft / ships) is ignored server-side.
//  * format=csv returns the WHOLE register (~100 MB, ~162k rows) as UTF-16LE
//    with BOM, tab-separated, every field quoted, dates dd.mm.yyyy, coordinates
//    DDMMSS, frequencies "123.4560 MHz" or "410.0000 MHz - 423.1250 MHz".
//  * HTML rows carry fields the CSV lacks (holder name/address separately,
//    inspection date, start-of-use date, full station/service description);
//    enrich() walks all ~8k pages to add them.
//  * action=xml returns HTTP 500; RSS only lists recent changes.
const fs = require("fs");
const path = require("path");
const wrapper = require("queue-promised").wrapper;
const ratelRegistry = require("../services/ratel-registry");
const parser = require("./parser");

const REGISTER = "reg203";
const SOURCE_URL = "https://registar.ratel.rs/cyr/" + REGISTER;
const COMMIT_EVERY_PAGES = 200;

const now = () => {
	return new Date().toISOString().slice(0, 19) + "Z";
};

// Download the CSV export, kept byte-for-byte
const download = (csvFile) => {
	const start = Date.now();
	console.log("downloading CSV export -> " + csvFile);

	return ratelRegistry.getCsvExport(REGISTER).then((buffer) => {
		if (!parser.isUtf16Export(buffer)) {
			throw new Error("Unexpected export encoding, no UTF-16 BOM: " + JSON.stringify(buffer.slice(0, 40).toString("latin1")));
		}

		fs.mkdirSync(path.dirname(csvFile), { recursive: true });
		fs.writeFileSync(csvFile, buffer);
		console.log("  " + (buffer.length / 1e6).toFixed(1) + " MB in " + Math.round((Date.now() - start) / 1000) + "s");
		return csvFile;
	});
};

/**
 * Build database from a downloaded CSV export
 * @param {Object} database - Opened reg203 database
 * @param {string} csvFile - Path to the raw export
 */
const build = (database, csvFile) => {
	const parsed = parser.parseExport(fs.readFileSync(csvFile));

	if (parsed.skipped > 0) {
		console.error("  WARNING: " + parsed.skipped + " malformed rows skipped");
	}

	console.log("fetching code tables from the search form");

	return ratelRegistry.getFormPage(REGISTER).then((html) => {
		const form = parser.parseFormPage(html);

		console.log("indexing " + parsed.rows.length + " rows into SQLite");
		database.replaceAssignments(parsed.rows.map(parser.toAssignment), form);
		database.setMeta({
			source_url: SOURCE_URL,
			csv_file: path.resolve(csvFile),
			csv_encoding: "UTF-16LE with BOM, tab-separated, quoted fields",
			fetched_at: now(),
			register_updated: form.updated || "",
			row_count: parsed.rows.length,
			coordinate_note: "lon_deg/lat_deg are converted from DDMMSS; datum is koord_sistem ('Bessel' = old Yugoslav/Hermannskogel datum, not WGS 84)."
		});

		return {
			rows: parsed.rows.length,
			updated: form.updated
		};
	});
};

/**
 * Add HTML-only fields to existing rows by walking all search pages
 * @param {Object} database - Opened reg203 database
 * @param {Object} options
 * @param {number} options.workers - Parallel page fetches
 * @param {number} [options.limitPages] - Only the first N pages (testing)
 */
const enrich = (database, options) => {
	const start = Date.now();
	const counts = { matched: 0, unmatched: 0, done: 0, failed: 0 };
	const getPage = wrapper((page) => {
		return ratelRegistry.getSearchPage(REGISTER, { page: String(page) });
	}, options.workers);

	const apply = (html) => {
		parser.parseSearchPage(html).forEach((row) => {
			if (database.enrich(row)) {
				counts.matched++;
			} else {
				counts.unmatched++;
			}
		});
	};

	return getPage(1).then((first) => {
		const total = Math.min(parser.parseLastPage(first), options.limitPages || Infinity);
		const pages = Array.from({ length: total - 1 }, (_, index) => {
			return index + 2;
		});

		console.log("enriching from HTML: " + total + " pages, " + options.workers + " workers");
		database.begin();
		apply(first);
		counts.done = 1;

		return Promise.all(pages.map((page) => {
			return getPage(page).then((html) => {
				apply(html);
				counts.done++;

				if (counts.done % COMMIT_EVERY_PAGES === 0 || counts.done === total) {
					database.commit();
					database.begin();
					const elapsed = (Date.now() - start) / 1000;
					console.log("  " + counts.done + "/" + total + " pages, matched " + counts.matched + ", unmatched " + counts.unmatched +
						", " + Math.round(elapsed) + "s elapsed, eta " + Math.round(elapsed / counts.done * (total - counts.done)) + "s");
				}
			}).catch((error) => {
				// keep going; report at the end
				counts.failed++;
				console.error("  page " + page + ": " + error.message);
			});
		}));
	}).then(() => {
		database.commit();
		database.setMeta({
			enriched_at: now(),
			enrich_unmatched_rows: counts.unmatched
		});
		console.log("enrichment done: matched " + counts.matched + ", unmatched " + counts.unmatched + ", failed pages " + counts.failed);
		return counts;
	});
};

module.exports = {
	download: download,
	build: build,
	enrich: enrich
};
