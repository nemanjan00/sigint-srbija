// "What you are likely to hear" on a frequency, with a typical occupied
// bandwidth: from the emitter's own mode when a source says it, else from the
// band plan applications (English names, see ../english) at that frequency.

const MHZ = 1e6;

const inRange = (hz, low, high) => {
	return hz >= low * MHZ && hz < high * MHZ;
};

// Ordered: first matching rule per application wins. `when` limits a rule to a frequency.
const APPLICATION_RULES = [
	{ match: /^Amateur-satellite/, hear: "Amateur satellites: FM voice transponders, telemetry and packet", bandwidthHz: 12500, technology: "amateur satellite" },
	{ match: /^Amateur/, hear: "Amateur radio: FM and DMR voice through repeaters, SSB and CW, APRS packet, beacons", bandwidthHz: 12500, technology: "amateur" },
	{ match: /^PMR446/, hear: "PMR446 walkie-talkies: analog FM, dPMR446 / DMR", bandwidthHz: 12500, technology: "PMR446" },
	{ match: /^(PPDR|BBDR)/, hear: "Public-safety radio (TETRA): encrypted digital voice and data — bursty buzzing", bandwidthHz: 25000, technology: "TETRA" },
	{ match: /^Citizens band/, hear: "CB radio: AM / FM / SSB voice", bandwidthHz: 10000, technology: "CB" },
	{ match: /^(PMR|Functional systems|Land systems|Civil land systems|Land and maritime systems|Mobile systems|Civil and military mobile systems)/, when: (hz) => hz < 1000 * MHZ, hear: "Two-way land mobile radio: analog narrow FM voice, or digital DMR / dPMR / NXDN / TETRA (often encrypted)", bandwidthHz: 12500, technology: "land mobile" },
	{ match: /^On-site paging/, hear: "On-site paging (hospitals, hotels, factories): short data bursts, some voice", bandwidthHz: 12500, technology: "paging" },
	{ match: /^Railway|^GSM-R|^FRMCS/, hear: "Railway radio: analog FM voice (train dispatch), GSM-R", bandwidthHz: 12500, technology: "railway" },
	{ match: /^Radio broadcasting/, when: (hz) => inRange(hz, 87.5, 108), hear: "FM broadcast radio: wideband FM stereo with RDS", bandwidthHz: 200000, technology: "FM broadcast" },
	{ match: /^Radio broadcasting/, when: (hz) => hz < 30 * MHZ, hear: "AM broadcast radio (long, medium or short wave)", bandwidthHz: 9000, technology: "AM broadcast" },
	{ match: /^T-DAB/, hear: "DAB+ digital radio: one 1.5 MHz block carries a multiplex of stations", bandwidthHz: 1536000, technology: "DAB+" },
	{ match: /^(Television|DVB-T2)/, hear: "Digital terrestrial TV (DVB-T2): an 8 MHz flat block, a multiplex of channels", bandwidthHz: 8000000, technology: "DVB-T2" },
	{ match: /^(Air traffic|Aeronautical systems)/, when: (hz) => inRange(hz, 117.975, 137), hear: "Airband: AM voice between pilots and air traffic control, ACARS data", bandwidthHz: 8330, technology: "airband AM" },
	{ match: /^(Air traffic|Aeronautical systems)/, when: (hz) => hz < 30 * MHZ, hear: "HF aeronautical: USB voice, HFDL data", bandwidthHz: 3000, technology: "HF USB" },
	{ match: /^(Air traffic|Aeronautical systems)/, when: (hz) => inRange(hz, 225, 400), hear: "Military airband: AM voice", bandwidthHz: 25000, technology: "airband AM" },
	{ match: /^(Maritime traffic|Ship stations|DSC|Search and rescue)/, when: (hz) => inRange(hz, 156, 174), hear: "Marine VHF: FM voice on the rivers (Danube, Sava), DSC calls", bandwidthHz: 25000, technology: "marine VHF" },
	{ match: /^AIS/, hear: "AIS: ship position bursts (GMSK 9600 bd), decodable", bandwidthHz: 25000, technology: "AIS" },
	{ match: /^NAVTEX/, hear: "NAVTEX: maritime safety text broadcasts", bandwidthHz: 500, technology: "NAVTEX" },
	{ match: /^GSM\b/, hear: "GSM base stations: continuous TDMA data carriers, no clear voice", bandwidthHz: 200000, technology: "GSM" },
	{ match: /^(MFCN|IMT|GSM 1800)/, hear: "Mobile network (LTE / 5G) base stations: wide continuous digital carriers, nothing to listen to", bandwidthHz: null, technology: "mobile network" },
	{ match: /^(Radio microphones|PMSE|Wireless audio)/, hear: "Wireless microphones and in-ear monitors (wide FM or digital audio), at events and studios", bandwidthHz: 200000, technology: "PMSE" },
	{ match: /^Radiosondes|^Meteorological aids/, hear: "Weather-balloon radiosondes: telemetry bursts you can decode (e.g. radiosonde_auto_rx)", bandwidthHz: 10000, technology: "radiosonde" },
	{ match: /^Weather satellites/, when: (hz) => inRange(hz, 137, 138), hear: "Weather satellite downlinks (Meteor-M LRPT images)", bandwidthHz: 150000, technology: "weather satellite" },
	{ match: /^(Fixed links|Fixed systems|Medium and high capacity fixed links|FWA|BFWA|Feeder links|Tactical radio relay|TV programme links|Radio programme links|Wideband data)/, hear: "Fixed point-to-point links: digital data between two antennas, nothing to listen to", bandwidthHz: null, technology: "fixed link" },
	{ match: /^(Radars|Civil radars|Low-power radars|Airborne radars|Weather radar|Marine radar|Wind profiler|Radiolocation|Synthetic aperture|GBSAR|SRR)/, hear: "Radar pulses", bandwidthHz: null, technology: "radar" },
	{ match: /^(VOR|ILS|MLS|GBAS|Aeronautical radiobeacons|Aeronautical navigation|Maritime radiobeacons|Radionavigation systems|Radio altimeters|Airborne Doppler)/, hear: "Navigation aids: steady carriers with a Morse identifier (VOR / ILS / NDB)", bandwidthHz: null, technology: "navigation" },
	{ match: /^(Non-specific short-range|ISM|RFID|Alarms|Meter reading|Model control|Inductive|Radio LANs|DECT|WIA|ITS|TTT|Tracking)/, hear: "Short-range devices: remotes, sensors, alarms, meters, Wi-Fi — short digital bursts", bandwidthHz: null, technology: "SRD" },
	{ match: /^(Radio astronomy|Passive sensors)/, hear: "Receive-only: kept quiet for radio astronomy and passive sensing", bandwidthHz: null, technology: "passive" },
	{ match: /^Standard frequency/, hear: "Time signal station", bandwidthHz: null, technology: "time signal" },
	{ match: /satellite|^(FSS|MSS|ESIM|GSO|NGSO|ESV|AES|VSAT|SNG|HEST|SIT|CGC|GPS|GLONASS|Galileo|GNSS|Satellite)/i, hear: "Satellite links: weak signals, most need a dish or a special antenna", bandwidthHz: null, technology: "satellite" }
];

// Station types in reg203 (vrsta_stanice): what it means for listening, and
// which technologies (APPLICATION_RULES) such a station most likely uses
const LAND_MOBILE = ["land mobile", "TETRA", "paging", "railway", "PMR446"];
const STATION_TYPES = {
	FB: { hear: "Base station: talks to its mobiles — the strongest signal of its network", prefer: LAND_MOBILE },
	FX: { hear: "Fixed station: a link to one other station (often a repeater link or telemetry)", prefer: ["fixed link"] },
	ML: { hear: "Mobile stations (vehicles, handhelds) transmit here — heard only nearby, when in use", prefer: LAND_MOBILE },
	MO: { hear: "Mobile stations transmit here — heard only nearby, when in use", prefer: LAND_MOBILE },
	PR: { hear: "Handheld radios", prefer: LAND_MOBILE },
	FA: { hear: "Aeronautical ground station (airport, air traffic control)", prefer: ["airband AM", "HF USB"] },
	FC: { hear: "Coast station (river traffic)", prefer: ["marine VHF", "AIS"] },
	AL: { hear: "Aeronautical navigation beacon", prefer: ["navigation"] },
	NL: { hear: "Maritime navigation beacon", prefer: ["navigation"] },
	SM: { hear: "Meteorological aids station", prefer: ["radiosonde"] }
};
// Band plan hints shown for a licence (the full list of uses is shown anyway)
const MAX_PLAN_HINTS = 2;

// Hints from the emitter's own data (amateur sources say the mode)
const fromEmitter = (emitter) => {
	const raw = emitter.raw || {};

	if (emitter.mode === "DMR") {
		const slots = [raw.ts1 ? "TS1 " + raw.ts1 : null, raw.ts2 ? "TS2 " + raw.ts2 : null].filter(Boolean).join(", ");
		return { hear: "DMR digital voice: two time slots" + (raw.cc ? ", colour code " + raw.cc : "") + (slots ? " (" + slots + ")" : "") + ". Needs a DMR radio or a decoder (DSD+, SDRTrunk)", bandwidthHz: 12500, technology: "DMR" };
	}

	if (emitter.mode === "APRS" || emitter.kind === "digipeater") {
		return { hear: "APRS packet: 1200 bd AFSK bursts — positions, weather, messages (decode with Direwolf)", bandwidthHz: 12500, technology: "APRS" };
	}

	if (emitter.kind === "beacon") {
		return { hear: "Beacon: repeating Morse (CW) callsign and carrier, for propagation checks", bandwidthHz: 500, technology: "CW beacon" };
	}

	if (emitter.mode === "FM" || emitter.kind === "repeater") {
		return { hear: "Analog FM voice repeater: it retransmits on TX what it hears on RX, usually with a Morse ID", bandwidthHz: 12500, technology: "NFM" };
	}

	return null;
};

const fromApplication = (english, hz) => {
	return APPLICATION_RULES.find((rule) => {
		return english && rule.match.test(english) && (!rule.when || rule.when(hz));
	}) || null;
};

// Preferred technologies of the station type first, then rule order
const rank = (prefer) => {
	return (rule) => {
		const preferred = prefer.indexOf(rule.technology);
		return [preferred === -1 ? prefer.length : preferred, APPLICATION_RULES.indexOf(rule)];
	};
};

const byRank = (rankOf) => {
	return (a, b) => {
		const x = rankOf(a);
		const y = rankOf(b);
		return x[0] - y[0] || x[1] - y[1];
	};
};

/**
 * Hints for an emitter, most specific first. A mode published by the source
 * wins; otherwise the band plan uses at the frequency, ordered by station type.
 * @param {object} emitter emitters row (raw parsed), optionally with `detail` (reg203 row)
 * @param {Array<{en: string, here: boolean}>} uses band plan uses at the frequency
 * @returns {{ hints: string[], bandwidth: { hz, how } | null, technology: string | null }}
 */
const describe = (emitter, uses) => {
	const own = fromEmitter(emitter);
	const stationType = (emitter.detail && STATION_TYPES[emitter.detail.vrsta_stanice]) || { hear: null, prefer: [] };
	const fromPlan = uses.filter((use) => {
		return use.here;
	}).map((use) => {
		return fromApplication(use.en, emitter.tx_hz);
	}).filter((rule, index, all) => {
		return rule && all.indexOf(rule) === index;
	}).sort(byRank(rank(stationType.prefer)));
	const best = own || fromPlan[0] || null;
	const planHints = own ? [] : fromPlan.slice(0, MAX_PLAN_HINTS).map((rule) => {
		return rule.hear;
	});
	const hints = [own ? own.hear : null, stationType.hear].concat(planHints).filter(Boolean);

	let bandwidth = null;

	if (emitter.tx_high_hz && emitter.tx_high_hz > emitter.tx_hz) {
		bandwidth = { hz: emitter.tx_high_hz - emitter.tx_hz, how: "licensed block" };
	} else if (best && best.bandwidthHz) {
		bandwidth = { hz: best.bandwidthHz, how: "typical for " + best.technology };
	}

	return { hints: hints, bandwidth: bandwidth, technology: best ? best.technology : null };
};

module.exports = {
	describe: describe,
	fromEmitter: fromEmitter
};
