// What Serbian DMR repeaters are doing, from the BrandMeister last-heard feed.
// Memory only (nothing is stored): per station the call in progress, the last
// call and the talkgroups heard recently. Only repeaters we list (by DMR ID)
// are followed, so hotspots (personal stations) are never tracked. Stations
// are keyed by the main listing's emitter id.
//
// Found by watching the feed (2026-11): master 2302 only publishes
// Session-Stop (no Start/Update), so calls are seen when they end, not while
// they run; and the feed replays the last ~20 minutes of sessions on connect.
// Times therefore come from the session (Start/Stop), never from arrival.
const storage = require("../storage");
const lastheard = require("../services/brandmeister-lastheard");

// BrandMeister Serbia
const MASTER = 2302;
// a call without Session-Stop is over after this long
const STALE_CALL_MS = 3 * 60 * 1000;
const RECENT_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT_TALKGROUPS = 12;
const SWEEP_MS = 30 * 1000;
const RELOAD_STATIONS_MS = 60 * 1000;

const stations = new Map();
const subscribers = new Set();
let repeaters = { version: null, checked: 0, byDmrId: new Map() };
let feed = null;

// DMR ID -> main listing id, reloaded after a fetch
const stationIdOf = (dmrId) => {
	if (Date.now() - repeaters.checked > RELOAD_STATIONS_MS) {
		const db = storage.getDatabase();
		const version = JSON.stringify(db.prepare("SELECT id, fetched_at FROM sources ORDER BY id").all());

		if (version !== repeaters.version) {
			const byDmrId = new Map(db.prepare(`SELECT dmr_id, coalesce(duplicate_of, id) AS main FROM emitters
				WHERE dmr_id IS NOT NULL AND kind = 'repeater'`).all().map((row) => {
				return [String(row.dmr_id), row.main];
			}));

			repeaters = { version: version, checked: 0, byDmrId: byDmrId };
		}

		repeaters.checked = Date.now();
	}

	return repeaters.byDmrId.get(String(dmrId));
};

const callTime = (call) => {
	return call.stop || call.start;
};

const toCall = (session) => {
	const group = (session.CallTypes || []).includes("Group");

	return {
		callsign: session.SourceCall || null,
		name: session.SourceName || null,
		talkgroup: group ? session.DestinationID : null,
		private: !group,
		// private calls: the station called
		to: group ? null : (session.DestinationCall || session.DestinationID || null),
		slot: session.Slot || null,
		start: session.Start * 1000,
		stop: session.Stop ? session.Stop * 1000 : null
	};
};

const publish = (id) => {
	const station = stations.get(id) || null;

	subscribers.forEach((subscriber) => {
		subscriber(id, station);
	});
};

const recentTalkgroups = (talkgroups, call, now) => {
	const updated = Object.assign({}, talkgroups);

	if (call.talkgroup && callTime(call) > (updated[call.talkgroup] || 0)) {
		updated[call.talkgroup] = callTime(call);
	}

	return Object.keys(updated).filter((talkgroup) => {
		return now - updated[talkgroup] < RECENT_MS;
	}).sort((a, b) => {
		return updated[b] - updated[a];
	}).slice(0, MAX_RECENT_TALKGROUPS).reduce((kept, talkgroup) => {
		kept[talkgroup] = updated[talkgroup];
		return kept;
	}, {});
};

// The call in progress after a session event; a replayed Stop of an older call keeps the current one
const runningCall = (current, call, ended) => {
	if (!ended) {
		return call;
	}

	if (current && current.start > call.start) {
		return current;
	}

	return null;
};

const handleSession = (session) => {
	if (session.Master !== MASTER || !session.ContextID) {
		return;
	}

	const id = stationIdOf(session.ContextID);

	if (id === undefined) {
		return;
	}

	const call = toCall(session);
	const now = Date.now();

	if (now - callTime(call) > RECENT_MS) {
		return;
	}

	const previous = stations.get(id) || { dmr_id: session.ContextID, call: null, last: null, talkgroups: {} };
	const ended = session.Event === "Session-Stop";
	// replayed or out-of-order sessions don't replace a newer one
	const newer = !previous.last || callTime(call) >= callTime(previous.last);

	stations.set(id, Object.freeze({
		dmr_id: previous.dmr_id,
		call: runningCall(previous.call, call, ended),
		last: ended && newer ? call : previous.last,
		talkgroups: recentTalkgroups(previous.talkgroups, call, now)
	}));
	publish(id);
};

// Calls whose Session-Stop never came
const sweep = () => {
	const now = Date.now();

	stations.forEach((station, id) => {
		if (station.call && now - station.call.start > STALE_CALL_MS) {
			stations.set(id, Object.freeze(Object.assign({}, station, { call: null, last: Object.assign({}, station.call, { stop: now }) })));
			publish(id);
		}
	});
};

const start = () => {
	if (feed) {
		return;
	}

	feed = lastheard.follow(handleSession);
	setInterval(sweep, SWEEP_MS).unref();
};

// Every followed station: { [emitterId]: state }
const snapshot = () => {
	return Array.from(stations.entries()).reduce((result, entry) => {
		result[entry[0]] = entry[1];
		return result;
	}, {});
};

const get = (id) => {
	return stations.get(id) || null;
};

/**
 * Call `subscriber(id, state)` on every change; returns unsubscribe.
 * @param {function(number, object|null)} subscriber
 */
const subscribe = (subscriber) => {
	subscribers.add(subscriber);

	return () => {
		subscribers.delete(subscriber);
	};
};

module.exports = {
	start: start,
	snapshot: snapshot,
	get: get,
	subscribe: subscribe
};
