// RATEL register reg215, type 3000: registered CB (27 MHz) radio stations,
// kind "cb". The register has no coordinates, only the station's address
// (place + street); it is geocoded via OSM Nominatim (src/geocoder, cached in
// the database), falling back to the place when the street isn't found.
//
// operator = the applicant, location = the published address; raw.published is
// the register row unchanged.
//
//   tx_hz..tx_high_hz = the CB band (40 channels, 26.965-27.405 MHz)
//   mode              = emissions of the registered radios (FM / AM / SSB)
//   raw.radios        = [{ model, power_w, emission, antenna, antenna_gain_dbd }]
const crypto = require("crypto");
const ratelRegistry = require("../../services/ratel-registry");
const ratel = require("../../utils/ratel");
const geocoder = require("../../geocoder");

const REGISTER = "reg215";
const TYPE = "3000";
const CB_LOW_HZ = 26965000;
const CB_HIGH_HZ = 27405000;
const MAX_RADIOS = 7;
const KEY_HASH_LENGTH = 12;
// Rough radius of the position by how it was found
const ACCURACY_M = { address: 50, street: 300, place: 3000 };
const STREET_TYPES = ["road", "street"];
const EMISSIONS = { "FM/PM": "FM", "AM DSB": "AM", "AM SSB": "SSB" };

const hash = (parts) => {
	return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, KEY_HASH_LENGTH);
};

const number = (text) => {
	const value = Number(String(text || "").replace(",", "."));
	return text !== "" && Number.isFinite(value) ? value : null;
};

const clean = (text) => {
	return String(text || "").replace(/\s+/g, " ").trim();
};

// "23000 Zrenjanin" / "Beograd 11000" / "NERESNICA, 12242" -> place name without postcode
const placeName = (text) => {
	return clean(String(text || "").replace(/\d{5}/g, "").replace(/^[\s,]+|[\s,]+$/g, ""));
};

const radiosOf = (row) => {
	return Array.from({ length: MAX_RADIOS }, (_unused, index) => {
		return index === 0 ? "" : " " + (index + 1);
	}).map((suffix) => {
		return {
			model: clean(row["Произвођач и тип радио станице" + suffix]) || undefined,
			power_w: number(row["Снага предајника (W)" + suffix]) || undefined,
			emission: clean(row["Врста емисије" + suffix]) || undefined,
			antenna: clean([row["Произвођач антене" + suffix], row["Тип антене" + suffix]].map(clean).join(" ")) || undefined,
			antenna_gain_dbd: number(row["Добитак антене (dBd)" + suffix]) === null ? undefined : number(row["Добитак антене (dBd)" + suffix])
		};
	}).filter((radio) => {
		return radio.model || radio.power_w || radio.emission;
	});
};

const modeOf = (radios) => {
	const modes = radios.map((radio) => {
		return EMISSIONS[radio.emission];
	}).filter(Boolean);

	return modes.filter((mode, index) => {
		return modes.indexOf(mode) === index;
	}).join(" / ") || null;
};

const accuracyOf = (found) => {
	if (found.index === 1) {
		return ACCURACY_M.place;
	}

	return STREET_TYPES.includes(found.type) ? ACCURACY_M.street : ACCURACY_M.address;
};

// One registration -> emitter (positions are looked up one by one: Nominatim allows 1 req/s)
const toEmitter = (row) => {
	const place = placeName(row["Место и поштански број локације радио станице"]);
	const street = clean(row["Улица и број локације радио станице"]);
	const postcode = (String(row["Место и поштански број локације радио станице"] || "").match(/\d{5}/) || [])[0];
	const radios = radiosOf(row);
	const queries = [
		street && place ? street + ", " + [postcode, place].filter(Boolean).join(" ") : null,
		place || null
	];

	return geocoder.geocodeFirst(queries).then((found) => {
		return {
			source_key: hash([row["Датум пријаве"], place, street, radios.map((radio) => {
				return radio.model;
			}).join(",")]),
			kind: "cb",
			mode: modeOf(radios),
			name: "CB station",
			tx_hz: CB_LOW_HZ,
			tx_high_hz: CB_HIGH_HZ,
			operator: clean(row["Назив подносиоца пријаве"]) || null,
			city: place || null,
			location: [street, clean(row["Место и поштански број локације радио станице"])].filter(Boolean).join(", ") || null,
			lat: found ? found.lat : null,
			lon: found ? found.lon : null,
			coord_source: found ? (found.index === 0 ? "source:geocoded:address" : "source:geocoded:place") : null,
			coord_accuracy_m: found ? accuracyOf(found) : null,
			active: 1,
			owner: "private",
			raw: {
				register: "reg215 CB (27 MHz)",
				place: place || undefined,
				registered: ratel.parseDate(row["Датум пријаве"]) || undefined,
				radios: radios,
				published: row
			}
		};
	});
};

const ratelReg215Cb = {
	id: "ratel-reg215-cb",
	description: "RATEL register reg215, CB radio stations (27 MHz): positions geocoded from the registered address",
	url: "https://registar.ratel.rs/cyr/reg215",

	fetch: () => {
		return ratelRegistry.getCsvExport(REGISTER, { vrsta: TYPE }).then((buffer) => {
			return ratel.parseExport(buffer).reduce((previous, row) => {
				return previous.then((emitters) => {
					return toEmitter(row).then((emitter) => {
						return emitters.concat([emitter]);
					});
				});
			}, Promise.resolve([]));
		});
	}
};

module.exports = ratelReg215Cb;
