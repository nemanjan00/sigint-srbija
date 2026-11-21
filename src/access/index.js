// How to open a repeater: CTCSS (PL) tone for FM, colour code and timeslot
// talkgroups for DMR. Read from the source records (`raw`) of the amateur
// sources; values that aren't plausible (e.g. "nema rep") are left out.
//  - yu1srs-repeaters: cc = CTCSS tone (FM) or colour code (DMR), ts1/ts2 = talkgroups (DMR)
//  - yu1srs-map: PL = CTCSS tone ("123", "67.0", "RX-123, TX-88.5"), TS1/TS2 = "TG220"
//  - brandmeister: colorcode

const CTCSS_MIN_HZ = 60;
const CTCSS_MAX_HZ = 260;
const MAX_COLOR_CODE = 15;
const FIELDS = ["ctcss_hz", "ctcss_out_hz", "color_code", "ts1_tg", "ts2_tg"];

const toNumber = (text) => {
	const match = String(text === null || text === undefined ? "" : text).match(/\d+(?:[.,]\d+)?/);
	return match ? Number(match[0].replace(",", ".")) : null;
};

const toTone = (text) => {
	const hz = toNumber(text);
	return hz !== null && hz >= CTCSS_MIN_HZ && hz <= CTCSS_MAX_HZ ? hz : null;
};

const toColorCode = (text) => {
	const code = toNumber(text);
	return code !== null && Number.isInteger(code) && code <= MAX_COLOR_CODE ? code : null;
};

const toTalkgroup = (text) => {
	const match = String(text === null || text === undefined ? "" : text).match(/^\s*(?:TG\s*)?(\d+)\s*$/i);
	return match ? Number(match[1]) : null;
};

// "RX-123, TX-88.5" = 123 Hz to open the repeater, 88.5 Hz on its output
const parseTones = (text) => {
	const rx = String(text || "").match(/RX\D*(\d+(?:[.,]\d+)?)/i);
	const tx = String(text || "").match(/TX\D*(\d+(?:[.,]\d+)?)/i);

	if (rx || tx) {
		return { ctcss_hz: rx ? toTone(rx[1]) : null, ctcss_out_hz: tx ? toTone(tx[1]) : null };
	}

	return { ctcss_hz: toTone(text), ctcss_out_hz: null };
};

const PARSERS = {
	"yu1srs-repeaters": (raw) => {
		if (raw.type === "DMR") {
			return { color_code: toColorCode(raw.cc), ts1_tg: toTalkgroup(raw.ts1), ts2_tg: toTalkgroup(raw.ts2) };
		}

		return ["VHF", "UHF", "RUM"].includes(raw.type) ? parseTones(raw.cc) : {};
	},
	"yu1srs-map": (raw) => {
		return Object.assign(parseTones(raw.PL), { ts1_tg: toTalkgroup(raw.TS1), ts2_tg: toTalkgroup(raw.TS2) });
	},
	"brandmeister": (raw) => {
		return { color_code: toColorCode(raw.colorcode) };
	}
};

const withoutEmpty = (access) => {
	const result = FIELDS.reduce((found, field) => {
		if (access[field] !== null && access[field] !== undefined) {
			found[field] = access[field];
		}

		return found;
	}, {});

	return Object.keys(result).length > 0 ? result : null;
};

/**
 * Access settings published by one listing, or null.
 * @param {string} source emitter source id
 * @param {object|string} raw source record (object or JSON text)
 */
const fromRaw = (source, raw) => {
	const parser = PARSERS[source];
	const record = typeof raw === "string" ? JSON.parse(raw) : raw;

	if (!parser || !record) {
		return null;
	}

	return withoutEmpty(parser(record));
};

/**
 * One station's settings from its listings' settings, best first: each field
 * comes from the first listing that has it.
 * @param {Array<object|null>} accesses fromRaw() results in rank order
 */
const merge = (accesses) => {
	return withoutEmpty(accesses.filter(Boolean).reduceRight((merged, access) => {
		return Object.assign(merged, access);
	}, {}));
};

module.exports = {
	SOURCES: Object.keys(PARSERS),
	fromRaw: fromRaw,
	merge: merge
};
