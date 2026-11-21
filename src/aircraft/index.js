// Live aircraft over Serbia from adsb.lol, shared by every visitor: the
// server fetches at most once per REFRESH_MS, and only when someone asks
// (a request while the copy is older starts one fetch and gets the current
// copy meanwhile). Nothing is stored.
const adsbLol = require("../services/adsb-lol");

// covers Serbia with a margin (nautical miles)
const AREA = { lat: 44.1, lon: 20.9, radiusNm: 190 };
const REFRESH_MS = 10 * 1000;
// positions older than this are left out
const MAX_POSITION_AGE_S = 60;
const COLUMNS = ["hex", "flight", "registration", "type", "lat", "lon", "altitude_ft", "track", "speed_kt", "squawk", "category", "on_ground"];

let snapshot = { time: null, columns: COLUMNS, rows: [] };
let pending = null;

const toRow = (aircraft) => {
	const onGround = aircraft.alt_baro === "ground";

	return [
		aircraft.hex,
		(aircraft.flight || "").trim() || null,
		aircraft.r || null,
		aircraft.t || null,
		aircraft.lat,
		aircraft.lon,
		onGround ? 0 : (Number.isFinite(aircraft.alt_baro) ? aircraft.alt_baro : aircraft.alt_geom || null),
		Number.isFinite(aircraft.track) ? Math.round(aircraft.track) : (Number.isFinite(aircraft.true_heading) ? Math.round(aircraft.true_heading) : null),
		Number.isFinite(aircraft.gs) ? Math.round(aircraft.gs) : null,
		aircraft.squawk || null,
		aircraft.category || null,
		onGround
	];
};

const refresh = () => {
	pending = adsbLol.getAircraftNear(AREA).then((aircraft) => {
		snapshot = {
			time: new Date().toISOString(),
			columns: COLUMNS,
			rows: aircraft.filter((entry) => {
				return Number.isFinite(entry.lat) && Number.isFinite(entry.lon) && !(entry.seen_pos > MAX_POSITION_AGE_S);
			}).map(toRow)
		};
	}).catch((error) => {
		console.error("adsb.lol: " + error.message);
	}).then(() => {
		pending = null;
	});

	return pending;
};

// The shared copy; starts a refresh when it is older than REFRESH_MS. The first call waits for data.
const getSnapshot = () => {
	const stale = !snapshot.time || Date.now() - Date.parse(snapshot.time) >= REFRESH_MS;

	if (stale && !pending) {
		refresh();
	}

	if (!snapshot.time && pending) {
		return pending.then(() => {
			return snapshot;
		});
	}

	return Promise.resolve(snapshot);
};

module.exports = {
	getSnapshot: getSnapshot
};
