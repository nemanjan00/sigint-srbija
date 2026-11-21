// BrandMeister last-heard feed: every call session on the network, live.
// Socket.IO v4 over a plain WebSocket (Engine.IO packets: "0" open, "2"/"3"
// ping/pong, "40" connected, "42[event, data]" event). Each "mqtt" event
// carries one session as JSON in `payload` (Event = Session-Start /
// Session-Update / Session-Stop, ContextID = repeater or hotspot ID,
// Master, Slot, SourceCall, DestinationID, CallTypes, Start/Stop in unix s).
const WebSocket = require("ws");

const URL = "wss://api.brandmeister.network/lh/?version=2&EIO=4&transport=websocket";
const RECONNECT_MIN_MS = 5000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;

const brandmeisterLastheard = {
	_open: (onSession, onClose) => {
		const ws = new WebSocket(URL, { perMessageDeflate: false });

		ws.on("message", (message) => {
			const text = String(message);

			if (text === "2") {
				ws.send("3");
			} else if (text.startsWith("0")) {
				ws.send("40");
			} else if (text.startsWith("40")) {
				ws.send("42" + JSON.stringify(["join", "everything"]));
			} else if (text.startsWith("42")) {
				const event = JSON.parse(text.slice(2));

				if (event[0] === "mqtt" && event[1] && event[1].payload) {
					onSession(JSON.parse(event[1].payload));
				}
			}
		});

		ws.on("error", (error) => {
			console.error("BrandMeister last heard: " + error.message);
		});

		ws.on("close", onClose);

		return ws;
	},

	/**
	 * Follow the feed until close() is called; reconnects with backoff.
	 * @param {function(object)} onSession called with each session record
	 * @returns {{ close: function() }}
	 */
	follow: (onSession) => {
		let ws = null;
		let delay = RECONNECT_MIN_MS;
		let closed = false;
		let timer = null;

		const connect = () => {
			const opened = Date.now();

			ws = brandmeisterLastheard._open((session) => {
				delay = RECONNECT_MIN_MS;
				onSession(session);
			}, () => {
				if (closed) {
					return;
				}

				// a connection that lasted a while starts the backoff over
				delay = Date.now() - opened > RECONNECT_MAX_MS ? RECONNECT_MIN_MS : Math.min(delay * 2, RECONNECT_MAX_MS);
				console.error("BrandMeister last heard: disconnected, retrying in " + Math.round(delay / 1000) + " s");
				timer = setTimeout(connect, delay);
			});
		};

		connect();

		return {
			close: () => {
				closed = true;
				clearTimeout(timer);

				if (ws) {
					ws.close();
				}
			}
		};
	}
};

module.exports = brandmeisterLastheard;
