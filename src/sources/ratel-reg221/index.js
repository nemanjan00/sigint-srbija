// RATEL register reg221 ("Регистар евидентираних радио-станица у јавној
// мобилној електронској комуникационој мрежи"): every radio station of the
// mobile networks (Telekom Srbija, Yettel, A1), one row per band + technology
// per site. Grouped here into one emitter per operator per site, kind "cell":
//   mode        technologies, e.g. "2G/4G/5G"
//   name        site name as registered (e.g. "BG-HOTEL PUTNIK UMTS")
//   operator    network operator
//   tx_hz..     downlink of the lowest band (the coverage layer); all bands in raw.bands
//   location    address, city = place from the address' postcode row
//   raw.observed  cells seen at the site in contributed observations (src/cell-observations)
const ratelRegistry = require("../../services/ratel-registry");
const ratel = require("../../utils/ratel");
const sector = require("../../reg203/sector");
const toWgs84 = require("../../reg203/database").toWgs84;
const cellObservations = require("../../cell-observations");

const REGISTER = "reg221";
// Downlink (base station transmit) ranges of the bands named in the register, MHz
const DOWNLINK_MHZ = {
	700: [758, 788],
	800: [791, 821],
	900: [925, 960],
	1800: [1805, 1880],
	2100: [2110, 2170],
	2600: [2620, 2690],
	3500: [3400, 3800]
};
const TECHNOLOGY_ORDER = ["2G", "3G", "4G", "5G"];
const COORDINATE_DECIMALS = 5;

const keyOf = (row) => {
	const lat = Number(row["Географска ширина"]).toFixed(COORDINATE_DECIMALS);
	const lon = Number(row["Географска дужина"]).toFixed(COORDINATE_DECIMALS);
	return row["Носилац права (оператор)"] + "/" + lat + "," + lon;
};

const unique = (values) => {
	return values.filter((value, index) => {
		return value && values.indexOf(value) === index;
	});
};

// All rows of one operator at one site -> emitter
const toEmitter = (key, rows) => {
	const first = rows[0];
	const bands = unique(rows.map((row) => {
		return row["Радиофреквенцијски опсег"];
	})).sort((a, b) => {
		return Number(a) - Number(b);
	});
	const technologies = unique(rows.map((row) => {
		return row["Примењена технологија"];
	})).sort((a, b) => {
		return TECHNOLOGY_ORDER.indexOf(a) - TECHNOLOGY_ORDER.indexOf(b);
	});
	const downlink = DOWNLINK_MHZ[bands[0]] || null;
	const operator = first["Носилац права (оператор)"];
	const position = toWgs84({ lat_deg: Number(first["Географска ширина"]) || null, lon_deg: Number(first["Географска дужина"]) || null, koord_sistem: "WGS 84" });

	return {
		source_key: key,
		kind: "cell",
		mode: technologies.join("/"),
		name: first["Назив места"] || null,
		operator: operator,
		tx_hz: downlink ? downlink[0] * 1e6 : null,
		tx_high_hz: downlink ? downlink[1] * 1e6 : null,
		location: first["Адреса"] || null,
		lat: position.lat,
		lon: position.lon,
		coord_source: position.lat === null ? null : (position.correction ? "source:corrected:" + position.correction : "source"),
		active: 1,
		sector: "telecom",
		owner: sector.classify(operator).owner,
		raw: {
			ids: rows.map((row) => {
				return row["Евиденциони број"];
			}),
			bands: bands,
			technologies: technologies,
			stations: rows.map((row) => {
				return { band: row["Радиофреквенцијски опсег"], technology: row["Примењена технологија"] };
			}),
			postcode: first["Поштански број"] || undefined
		}
	};
};

const ratelReg221 = {
	id: "ratel-reg221",
	description: "RATEL register of mobile network radio stations (reg221), one emitter per operator site",
	url: "https://registar.ratel.rs/cyr/reg221",

	fetch: () => {
		return ratelRegistry.getCsvExport(REGISTER, {}).then((buffer) => {
			const groups = ratel.parseExport(buffer).reduce((result, row) => {
				const key = keyOf(row);
				result[key] = result[key] || [];
				result[key].push(row);
				return result;
			}, {});

			return cellObservations.enrich(Object.keys(groups).map((key) => {
				return toEmitter(key, groups[key]);
			}));
		});
	}
};

module.exports = ratelReg221;
