// APRS-IS: the internet backbone of APRS (what aprs.fi shows). Read-only
// login (passcode -1) with a server-side range filter; one packet per line.
// aprsc refuses the placeholder login N0CALL, so the client logs in as SIGINTRS.
const net = require("net");

const HOST = "rotate.aprs2.net";
const PORT = 14580;
const LOGIN = "SIGINTRS";
const SOFTWARE = "sigint-srbija 1.0";
const RECONNECT_MIN_MS = 10 * 1000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
// the server sends a "#" keepalive every ~20 s; silence this long = dead link
const IDLE_MS = 2 * 60 * 1000;

const aprsIs = {
	/**
	 * Follow the packets of an area until close(); reconnects with backoff.
	 * @param {string} filter APRS-IS filter, e.g. "r/44.1/20.9/320" (range, km)
	 * @param {function(string)} onPacket called with each raw packet line
	 * @returns {{ close: function() }}
	 */
	follow: (filter, onPacket) => {
		let socket = null;
		let closed = false;
		let delay = RECONNECT_MIN_MS;
		let timer = null;

		const connect = () => {
			let buffer = "";

			socket = net.connect(PORT, HOST);
			socket.setEncoding("latin1");
			socket.setTimeout(IDLE_MS);
			socket.on("connect", () => {
				socket.write("user " + LOGIN + " pass -1 vers " + SOFTWARE + " filter " + filter + "\r\n");
			});
			socket.on("data", (chunk) => {
				const lines = (buffer + chunk).split(/\r?\n/);
				buffer = lines.pop();
				lines.filter((line) => {
					return line && !line.startsWith("#");
				}).forEach((line) => {
					delay = RECONNECT_MIN_MS;
					onPacket(line);
				});
			});
			socket.on("timeout", () => {
				socket.destroy();
			});
			socket.on("error", (error) => {
				console.error("APRS-IS: " + error.message);
			});
			socket.on("close", () => {
				if (closed) {
					return;
				}

				console.error("APRS-IS: disconnected, retrying in " + Math.round(delay / 1000) + " s");
				timer = setTimeout(connect, delay);
				delay = Math.min(delay * 2, RECONNECT_MAX_MS);
			});
		};

		connect();

		return {
			close: () => {
				closed = true;
				clearTimeout(timer);

				if (socket) {
					socket.destroy();
				}
			}
		};
	}
};

module.exports = aprsIs;
