// RATEL broadcasting register reg204 ("База података о коришћењу
// радио-дифузног спектра"): FM radio (BC) and TV (BT) transmitters.
// One emitter per assignment, kind "broadcast":
//   mode      "FM" radio / "TV"
//   callsign  identification (radio: e.g. XRADIOKOLUBARA96.9; TV: multiplex, e.g. KP1)
//   name      channel (FM channel number / TV channel)
//   operator  holder name; active = no status (expired ones are kept, active 0)
// Coordinates are DDMMSS on the datum in "Координантни систем" (WGS 84 or Bessel).
const crypto = require("crypto");
const ratelRegistry = require("../../services/ratel-registry");
const ratel = require("../../utils/ratel");
const toWgs84 = require("../../reg203/database").toWgs84;
const sector = require("../../reg203/sector");

const REGISTER = "reg204";
const MODES = { BC: "FM", BT: "TV" };
const KEY_HASH_LENGTH = 8;

// Licence number + hash of the assignment's content (row numbers are not stable)
const stableKey = (row) => {
	const content = [row["Фреквенција"], row["Локација"], row["Географска дужина"], row["Географска ширина"], row["Знак идентификације"]].join("|");
	return row["Број дозволе"] + "~" + crypto.createHash("sha1").update(content).digest("hex").slice(0, KEY_HASH_LENGTH);
};

const toEmitter = (row) => {
	const frequency = ratel.parseFreq(row["Фреквенција"]);
	const holderText = row["Носилац права"];
	const holder = ratel.splitHolder(holderText);
	const operator = holder.name || holderText;
	const position = toWgs84({
		lat_deg: ratel.parseDms(row["Географска ширина"]),
		lon_deg: ratel.parseDms(row["Географска дужина"]),
		koord_sistem: row["Координантни систем"]
	});
	const stationType = (row["Врста станице/службе"] || "").split("/")[0];
	const owner = sector.classify(operator);

	return {
		source_key: stableKey(row),
		kind: "broadcast",
		mode: MODES[stationType] || null,
		callsign: row["Знак идентификације"] || null,
		name: row["Канал"] ? "Channel " + row["Канал"] : null,
		operator: operator,
		tx_hz: frequency.low,
		tx_high_hz: frequency.high,
		location: row["Локација"] || null,
		lat: position.lat,
		lon: position.lon,
		coord_source: position.lat === null ? null : (position.correction ? "source:corrected:" + position.correction : "source"),
		active: row["Статус"] ? 0 : 1,
		sector: "telecom",
		owner: owner.owner,
		raw: Object.assign({}, row, { holder_address: holder.address || undefined, position_note: position.correction || undefined })
	};
};

const ratelReg204 = {
	id: "ratel-reg204",
	description: "RATEL broadcasting register (reg204): FM radio and TV transmitters",
	url: "https://registar.ratel.rs/cyr/reg204",

	fetch: () => {
		return ratelRegistry.getCsvExport(REGISTER, {}).then((buffer) => {
			return ratel.parseExport(buffer).map(toEmitter);
		});
	}
};

module.exports = ratelReg204;
