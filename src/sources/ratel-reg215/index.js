// RATEL register reg215 ("Евиденција радио-станица у радиофреквенцијским
// опсезима који се користе по режиму општег овлашћења"): licence-exempt radio
// stations that still have to be registered, kind "link":
//   type 1000  RLAN stations at 2.4 / 5 / 60 GHz (Wi-Fi access points, links);
//              tx_hz..tx_high_hz = the registered band, raw.bandwidth_mhz = channel width
//   type 2000  E-band (71-86 GHz) point-to-point links; one emitter per end,
//              tx_hz = that end's transmit frequency, raw.partner = the other end
//   type 3000  CB radio stations (27 MHz): no coordinates, separate source ratel-reg215-cb
// operator = the applicant as published (mobile operators by their short name),
// location = the published site name / address. raw.published is the register
// row unchanged (applicant, address, contact, SSID, MAC, ...); the other raw
// fields are the parsed technical values.
const crypto = require("crypto");
const ratelRegistry = require("../../services/ratel-registry");
const ratel = require("../../utils/ratel");
const toWgs84 = require("../../reg203/database").toWgs84;

const REGISTER = "reg215";
const TYPES = { rlan: "1000", eband: "2000" };
// Applicant ids of the mobile operators (same ids as in reg221)
const OPERATORS = {
	"PS.20220023-0": "A1",
	"PS.17162543-0": "Telekom Srbija",
	"PS.20147229-0": "Yettel"
};
const KEY_HASH_LENGTH = 12;

const hash = (parts) => {
	return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, KEY_HASH_LENGTH);
};

const number = (text) => {
	const value = Number(String(text || "").replace(",", "."));
	return text !== "" && Number.isFinite(value) ? value : null;
};

// Published "DMS E  DMS N" position, checked against Serbia (swapped / typo'd
// values corrected like reg203). Returns { lat, lon, correction }.
const place = (text) => {
	const parsed = ratel.parseDmsPair(text);

	if (!parsed) {
		return { lat: null, lon: null, correction: null };
	}

	return toWgs84({ lat_deg: parsed.lat, lon_deg: parsed.lon, koord_sistem: "WGS 84" });
};

const coordSource = (position) => {
	if (position.lat === null) {
		return null;
	}

	return position.correction ? "source:corrected:" + position.correction : "source";
};

const partnerOf = (position) => {
	return position.lat === null ? undefined : { lat: position.lat, lon: position.lon };
};

const oneLine = (text) => {
	return text ? text.replace(/\s+/g, " ").trim() : null;
};

// "2400-2483,5 MHz" / "59.4-71 GHz" -> { low, high } in Hz
const parseBand = (text) => {
	const match = String(text || "").match(/([\d.,]+)\s*-\s*([\d.,]+)\s*(MHz|GHz)/);

	if (!match) {
		return { low: null, high: null };
	}

	const unit = match[3] === "GHz" ? 1e9 : 1e6;
	return { low: Math.round(number(match[1]) * unit), high: Math.round(number(match[2]) * unit) };
};

const rlanEmitter = (row) => {
	const band = parseBand(row["Фреквенцијски опсег радио станице"]);
	const position = place(row["Координате локације (WGS 84)"]);
	const partner = place(row["Координате друге локације"]);
	const operator = OPERATORS[row["ИД"]] || null;
	const configuration = (row["Конфигурација мреже"] || "").replace(/\s+/g, "");

	return {
		source_key: "rlan/" + hash([row["ИД"], row["Фреквенцијски опсег радио станице"], row["Координате локације (WGS 84)"], row["Азимут максималног зрачења"], row["MAC adresa"], row["SSID радио станице"]]),
		kind: "link",
		mode: "RLAN " + (configuration || "?"),
		name: "RLAN " + (configuration || "") + " " + (row["Фреквенцијски опсег радио станице"] || "").replace(",", "."),
		operator: operator || oneLine(row["Назив подносиоца пријаве"]),
		location: oneLine(row["Назив/адреса локације"]),
		tx_hz: band.low,
		tx_high_hz: band.high,
		lat: position.lat,
		lon: position.lon,
		coord_source: coordSource(position),
		active: 1,
		sector: operator ? "telecom" : null,
		owner: operator ? "private" : null,
		raw: {
			type: "RLAN",
			band: row["Фреквенцијски опсег радио станице"],
			configuration: row["Конфигурација мреже"] || undefined,
			power_dbm: number(row["Снага предајника (dBm)"]),
			bandwidth_mhz: number(row["Ширина опсега заузетог емисијом (MHz)"]),
			atpc: row["ATPC"] || undefined,
			dfs: row["DFS"] || undefined,
			equipment: row["Произвођач, тип радио уређаја"] || undefined,
			antenna: row["Тип антене"] || undefined,
			antenna_gain: number(row["Добитак антене"]),
			azimuth: number(row["Азимут максималног зрачења"]),
			partner: partnerOf(partner),
			registered: ratel.parseDate(row["Датум пријаве"]) || undefined,
			published: row
		}
	};
};

// One E-band link -> an emitter for each end (A transmits on A's frequency)
const ebandEmitters = (row) => {
	const operator = OPERATORS[row["ИД"]] || null;
	const ends = ["А", "Б"];
	const positions = ends.map((end) => {
		return place(row["Координате локације " + end + " (WGS84)"]);
	});
	const linkKey = hash([row["ИД"], row["Координате локације А (WGS84)"], row["Координате локације Б (WGS84)"], row["Предајна фреквенција на локацији А (MHz)"], row["Предајна фреквенција на локацији Б (MHz)"]]);
	const bandwidth = number(row["Ширина опсега заузетог емисијом (MHz)"]);

	return ends.map((end, index) => {
		const mhz = number(row["Предајна фреквенција на локацији " + end + " (MHz)"]);
		const partnerEnd = ends[1 - index];
		const centre = mhz === null ? null : mhz * 1e6;
		const half = bandwidth ? bandwidth * 1e6 / 2 : 0;

		return {
			source_key: "eband/" + linkKey + "/" + (index === 0 ? "a" : "b"),
			kind: "link",
			mode: "E-band P-P",
			name: "E-band link " + (index === 0 ? "A" : "B") + (mhz === null ? "" : " · " + mhz / 1e3 + " GHz"),
			operator: operator || oneLine(row["Назив подносиоца пријаве"]),
			location: oneLine(row["Назив/адреса локације " + end]),
			tx_hz: centre === null ? null : Math.round(centre - half),
			tx_high_hz: centre === null ? null : Math.round(centre + half),
			rx_hz: number(row["Предајна фреквенција на локацији " + partnerEnd + " (MHz)"]) === null ? null : Math.round(number(row["Предајна фреквенција на локацији " + partnerEnd + " (MHz)"]) * 1e6),
			lat: positions[index].lat,
			lon: positions[index].lon,
			coord_source: coordSource(positions[index]),
			active: 1,
			sector: operator ? "telecom" : null,
			owner: operator ? "private" : null,
			raw: {
				type: "E-band link",
				end: index === 0 ? "A" : "B",
				frequency_mhz: mhz,
				bandwidth_mhz: bandwidth,
				capacity_mbit: number(row["Капацитет (Mbit/s)"]),
				// published without a unit: some rows are metres, others km
				length: number(row["Дужина РР везе"]),
				power_dbm: number(row["Излазна снага предајника на локацији " + end + " (dBm)"]),
				eirp_dbm: number(row["e.i.r.p на локацији " + end + " (dBm)"]),
				antenna_gain_dbi: number(row["Добитак антене на локацији " + end + " (dBi)"]),
				antenna: row["Произвођач, тип антене, пречник антене на локацији " + end] || undefined,
				antenna_height_m: number(row["Висина антене изнад терена на локацији " + end]),
				polarization: row["Поларизација на локацији " + end] || undefined,
				azimuth: number(row["Азимут на локацији " + end]),
				equipment: row["Произвођач, тип радио уређаја"] || undefined,
				partner: partnerOf(positions[1 - index]),
				registered: ratel.parseDate(row["Датум пријаве"]) || undefined,
				published: row
			}
		};
	});
};

const ratelReg215 = {
	id: "ratel-reg215",
	description: "RATEL register of licence-exempt stations (reg215): RLAN / Wi-Fi stations and E-band links",
	url: "https://registar.ratel.rs/cyr/reg215",

	fetch: () => {
		return ratelRegistry.getCsvExport(REGISTER, { vrsta: TYPES.rlan })
			.then((buffer) => {
				const rlan = ratel.parseExport(buffer).map(rlanEmitter);

				return ratelRegistry.getCsvExport(REGISTER, { vrsta: TYPES.eband }).then((ebandBuffer) => {
					const eband = ratel.parseExport(ebandBuffer).reduce((result, row) => {
						return result.concat(ebandEmitters(row));
					}, []);

					return rlan.concat(eband);
				});
			});
	}
};

module.exports = ratelReg215;
