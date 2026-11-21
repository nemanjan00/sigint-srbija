// Fallback path for Hoseline audio: browsers that can't reach BrandMeister
// directly (blocking extensions, filtered networks) connect to
// /api/hose on this server, which passes the spotter protocol through to
// BrandMeister unchanged. Only small client messages (talkgroup joins) are
// forwarded upstream; the number of relayed listeners is capped.
const WebSocket = require("ws");

const PATH = "/api/hose";
const UPSTREAM = "wss://hose.brandmeister.network/spotter/?token=test:test";
const PROTOCOL = "spotter";
const MAX_CLIENTS = 50;
// joins are a few bytes; anything bigger isn't a spotter command
const MAX_CLIENT_MESSAGE = 256;

const relay = (client) => {
	const upstream = new WebSocket(UPSTREAM, [PROTOCOL], { perMessageDeflate: false });
	const pending = [];

	const closeBoth = () => {
		[client, upstream].forEach((socket) => {
			if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
				socket.terminate();
			}
		});
	};

	upstream.on("open", () => {
		pending.splice(0).forEach((message) => {
			upstream.send(message);
		});
	});
	upstream.on("message", (message, binary) => {
		if (client.readyState === WebSocket.OPEN) {
			client.send(message, { binary: binary });
		}
	});
	// bigger messages are refused by maxPayload
	client.on("message", (message, binary) => {
		if (upstream.readyState === WebSocket.OPEN) {
			upstream.send(message, { binary: binary });
		} else {
			pending.push(message);
		}
	});
	upstream.on("error", (error) => {
		console.error("Hoseline relay: " + error.message);
	});
	client.on("error", () => {});
	upstream.on("close", closeBoth);
	client.on("close", closeBoth);
};

/**
 * Serve the relay on an HTTP server's upgrade requests to /api/hose.
 * @param {import("http").Server} server
 */
const attach = (server) => {
	const wss = new WebSocket.Server({
		noServer: true,
		perMessageDeflate: false,
		maxPayload: MAX_CLIENT_MESSAGE,
		handleProtocols: (protocols) => {
			return protocols.has(PROTOCOL) ? PROTOCOL : false;
		}
	});

	wss.on("connection", relay);

	server.on("upgrade", (req, socket, head) => {
		if (new URL(req.url, "http://localhost").pathname !== PATH || wss.clients.size >= MAX_CLIENTS) {
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (client) => {
			wss.emit("connection", client, req);
		});
	});
};

module.exports = {
	PATH: PATH,
	attach: attach
};
