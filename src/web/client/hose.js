// BrandMeister Hoseline: live audio of one talkgroup, straight from
// BrandMeister to the browser (the public token their own Hoseline page uses).
// When that connection fails (blocking extensions, filtered networks) the
// same protocol goes through this server's relay (/api/hose) instead.
// Messages are MessagePack arrays [type, ...args]; audio is 8 kHz µ-law,
// 960 bytes every 120 ms.
import { encode, decode } from "@msgpack/msgpack";

const DIRECT_URL = "wss://hose.brandmeister.network/spotter/?token=test:test";
const RELAY_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/hose";
// a direct connection not open by then counts as failed
const DIRECT_TIMEOUT_MS = 5000;
const SAMPLE_RATE = 8000;
// audio queued ahead of playback, absorbs network jitter
const JITTER_S = 0.3;

const TYPES = {
	GROUP_JOIN: 1,
	CALL_START: 11,
	CALL_DROP: 12,
	CALL_END: 13,
	CALL_AUDIO: 20,
	CALL_ALIAS: 21,
	CALL_METER: 22
};

// G.711 µ-law byte -> sample in [-1, 1]
const MULAW = Float32Array.from({ length: 256 }, (_, byte) => {
	const code = ~byte & 0xff;
	const magnitude = ((((code & 0x0f) << 3) + 0x84) << ((code & 0x70) >> 4)) - 0x84;
	return ((code & 0x80) ? -magnitude : magnitude) / 32768;
});

export const hoselineUrl = (talkgroups) => {
	return "https://hose.brandmeister.network/?subscribe=" + talkgroups.join(",");
};

/**
 * One talkgroup at a time.
 * @param {function(Object)} onState - { talkgroup, status: "connecting" | "listening" | "error", caller, level } or null when stopped
 */
export const createHosePlayer = (onState) => {
	let ws = null;
	let audio = null;
	let nextTime = 0;
	let current = null;
	// after one failed direct connection, use the relay for the rest of the visit
	let useRelay = false;

	const update = (changes) => {
		current = changes === null ? null : Object.freeze(Object.assign({}, current, changes));
		onState(current);
	};

	const playFrame = (bytes) => {
		const buffer = audio.createBuffer(1, bytes.length, SAMPLE_RATE);
		const channel = buffer.getChannelData(0);

		bytes.forEach((byte, index) => {
			channel[index] = MULAW[byte];
		});

		const source = audio.createBufferSource();
		source.buffer = buffer;
		source.connect(audio.destination);
		nextTime = Math.max(nextTime, audio.currentTime + JITTER_S);
		source.start(nextTime);
		nextTime += buffer.duration;
	};

	const handlers = {
		[TYPES.CALL_START]: (message) => {
			update({ caller: null, callerId: message[2], level: null });
		},
		[TYPES.CALL_ALIAS]: (message) => {
			update({ caller: message[1] || null });
		},
		[TYPES.CALL_METER]: (message) => {
			update({ level: message[1] });
		},
		[TYPES.CALL_AUDIO]: (message) => {
			playFrame(message[1]);
		},
		[TYPES.CALL_END]: () => {
			update({ caller: null, callerId: null, level: null });
		},
		[TYPES.CALL_DROP]: () => {
			update({ caller: null, callerId: null, level: null });
		}
	};

	const stop = () => {
		if (ws) {
			ws.onclose = null;
			ws.close();
			ws = null;
		}

		if (current) {
			update(null);
		}
	};

	// Call from a click: browsers only start audio after a user gesture
	const play = (talkgroup) => {
		stop();
		audio = audio || new AudioContext();
		audio.resume();
		nextTime = 0;
		update({ talkgroup: talkgroup, status: "connecting", caller: null, callerId: null, level: null });
		connect(talkgroup, useRelay);
	};

	const connect = (talkgroup, viaRelay) => {
		const socket = new WebSocket(viaRelay ? RELAY_URL : DIRECT_URL, ["spotter"]);
		let opened = false;

		// direct connection blocked: try again through the relay
		const fallBack = () => {
			if (ws === socket && !opened && !viaRelay) {
				useRelay = true;
				socket.onclose = null;
				socket.close();
				connect(talkgroup, true);
				return true;
			}

			return false;
		};
		const timer = setTimeout(fallBack, DIRECT_TIMEOUT_MS);

		socket.binaryType = "arraybuffer";
		socket.onopen = () => {
			opened = true;
			clearTimeout(timer);
			socket.send(encode([TYPES.GROUP_JOIN, [talkgroup]]));
			update({ status: "listening", relayed: viaRelay });
		};
		socket.onmessage = (event) => {
			const message = decode(new Uint8Array(event.data));
			const handler = handlers[message[0]];

			if (handler) {
				handler(message);
			}
		};
		socket.onclose = () => {
			clearTimeout(timer);

			if (ws === socket && !fallBack()) {
				ws = null;
				update({ status: "error", caller: null, level: null });
			}
		};
		ws = socket;
	};

	return { play: play, stop: stop };
};
