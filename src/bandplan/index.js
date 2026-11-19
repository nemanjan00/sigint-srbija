// RATEL band plan (Plan namene RF opsega, Tabela 1) as data: which services
// and applications a frequency is allocated to, in Serbian and English, and a
// guess of what is heard there. Data: data/bandplan.json (`yarn bandplan`).
const fs = require("fs");
const path = require("path");
const english = require("./english");
const hints = require("./hints");

const PLAN_FILE = path.join(__dirname, "../../data/bandplan.json");
// Uses on (nearly) every band that say nothing about a frequency
const BACKGROUND_USES = /^(Radiodetermination applications|UWB|Inductive applications|Active medical implants)/;

let plan = null;

const load = () => {
	if (!plan) {
		plan = fs.existsSync(PLAN_FILE) ? JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")) : { bands: [] };
	}

	return plan;
};

// Band containing `hz` (binary search over sorted, contiguous bands)
const findBand = (hz) => {
	const bands = load().bands;
	let low = 0;
	let high = bands.length - 1;

	while (hz !== null && hz !== undefined && low <= high) {
		const middle = (low + high) >> 1;
		const band = bands[middle];

		if (hz < band.low_hz) {
			high = middle - 1;
		} else if (hz >= band.high_hz) {
			low = middle + 1;
		} else {
			return band;
		}
	}

	return null;
};

const translateUse = (use, hz) => {
	const en = english.application(use.application);
	// a use limited to sub-ranges applies here only if hz is inside one of them
	const here = use.ranges.length === 0 || use.ranges.some((range) => {
		return hz >= range.low_hz && hz <= range.high_hz;
	});

	return Object.assign({}, use, {
		en: en,
		here: here,
		background: BACKGROUND_USES.test(en || ""),
		users: english.users(use.condition),
		licensing_en: english.licensing(use.licensing)
	});
};

/**
 * Band plan entry for a frequency, translated, uses that apply at `hz` first.
 * @returns {{ low_hz, high_hz, label, services, footnotes, uses } | null}
 */
const lookup = (hz) => {
	const band = findBand(hz);

	if (!band) {
		return null;
	}

	const uses = band.uses.map((use) => {
		return translateUse(use, hz);
	}).sort((a, b) => {
		return (b.here - a.here) || (a.background - b.background);
	});

	return {
		low_hz: band.low_hz,
		high_hz: band.high_hz,
		label: band.label,
		services: band.services.map((service) => {
			return Object.assign({}, service, { en: english.service(service.name) });
		}),
		footnotes: band.footnotes,
		uses: uses
	};
};

/**
 * Band plan + listening hints for an emitter.
 * @param {object} emitter emitters row with parsed raw (and `detail` for reg203)
 */
const describe = (emitter) => {
	const band = lookup(emitter.tx_hz);
	const guess = hints.describe(emitter, band ? band.uses : []);

	const meta = load();

	return Object.assign({ band: band, plan: { title: meta.title || null, url: meta.url || null, date: meta.date || null } }, guess);
};

module.exports = {
	findBand: findBand,
	lookup: lookup,
	describe: describe
};
