// BrandMeister Hoseline: live audio of one talkgroup, straight from
// BrandMeister to the browser (the public token their own Hoseline page uses).
// Messages are MessagePack arrays [type, ...args]; audio is 8 kHz µ-law,
// 960 bytes every 120 ms.
import { encode, decode } from "@msgpack/msgpack";

const URL = "wss://hose.brandmeister.network/spotter/?token=test:test";
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

		const socket = new WebSocket(URL, ["spotter"]);
		socket.binaryType = "arraybuffer";
		socket.onopen = () => {
			socket.send(encode([TYPES.GROUP_JOIN, [talkgroup]]));
			update({ status: "listening" });
		};
		socket.onmessage = (event) => {
			const message = decode(new Uint8Array(event.data));
			const handler = handlers[message[0]];

			if (handler) {
				handler(message);
			}
		};
		socket.onclose = () => {
			if (ws === socket) {
				ws = null;
				update({ status: "error", caller: null, level: null });
			}
		};
		ws = socket;
	};

	return { play: play, stop: stop };
};
