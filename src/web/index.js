// Map UI + JSON API over the global database
const path = require("path");
const express = require("express");
const compression = require("compression");
const emitters = require("./emitters");
const mcp = require("../mcp");
const bandplan = require("../bandplan");
const live = require("../live");
const emf = require("../emf");
const aprs = require("../aprs");
const aircraft = require("../aircraft");

// Built page (yarn build: src/web/client -> src/web/dist)
const PUBLIC_DIR = path.join(__dirname, "dist");
// keeps proxies from closing an idle event stream
const LIVE_HEARTBEAT_MS = 25 * 1000;

const app = express();

// behind Traefik: trust X-Forwarded-* for req.protocol / host (MCP result links)
app.set("trust proxy", true);

// On-air state of DMR repeaters as server-sent events: one "snapshot" with
// every station, then one "station" per change ({ id, state }). Registered
// before compression, which would buffer the stream.
app.get("/api/live", (req, res) => {
	res.set({ "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" });
	res.flushHeaders();

	const send = (event, payload) => {
		res.write("event: " + event + "\ndata: " + JSON.stringify(payload) + "\n\n");
	};
	const unsubscribe = live.subscribe((id, state) => {
		send("station", { id: id, state: state });
	});
	const heartbeat = setInterval(() => {
		res.write(": ping\n\n");
	}, LIVE_HEARTBEAT_MS);

	send("snapshot", live.snapshot());

	req.on("close", () => {
		unsubscribe();
		clearInterval(heartbeat);
	});
});

app.use(compression());

// Container healthcheck: the database opens and answers
app.get("/healthz", (_req, res) => {
	emitters.ping();
	res.json({ ok: true });
});
app.use(express.static(PUBLIC_DIR));

app.post("/mcp", express.json({ limit: "1mb" }), mcp.handle);
app.get("/mcp", mcp.methodNotAllowed);
app.delete("/mcp", mcp.methodNotAllowed);

// Every emitter with coordinates, compact (see emitters.getMapData)
app.get("/api/bandplan", (_req, res) => {
	res.set("cache-control", "public, max-age=3600");
	res.json(bandplan.getPlan());
});

app.get("/api/map", (_req, res) => {
	res.set("cache-control", "no-cache");
	res.json(emitters.getMapData());
});

// Stable lookup for shared links: /api/emitter?source=brandmeister&key=220001
app.get("/api/emitter", (req, res) => {
	const emitter = emitters.getEmitterByKey(String(req.query.source || ""), String(req.query.key || ""));

	if (!emitter) {
		res.status(404).json({ error: "not found" });
		return;
	}

	res.json(emitter);
});

app.get("/api/emitters/:id", (req, res) => {
	const emitter = emitters.getEmitter(Number(req.params.id));

	if (!emitter) {
		res.status(404).json({ error: "not found" });
		return;
	}

	res.json(emitter);
});

// Live layers, the same copy for everyone: APRS stations heard (APRS-IS, memory)
// and aircraft (adsb.lol, fetched at most every 10 s while someone is looking)
app.get("/api/aprs", (_req, res) => {
	res.set("cache-control", "no-cache");
	res.json(aprs.getSnapshot());
});

app.get("/api/aircraft", (_req, res) => {
	res.set("cache-control", "no-cache");
	aircraft.getSnapshot().then((snapshot) => {
		res.json(snapshot);
	});
});

// RATEL EMF drive-campaign points for the heatmap (loaded when the layer is turned on)
app.get("/api/emf/campaigns", (_req, res) => {
	res.set("cache-control", "no-cache");
	res.json(emf.getCampaignPoints());
});

// A fixed EMF station's values of the last two days (fetched from RATEL, cached 10 min)
app.get("/api/emf/stations/:key/series", (req, res) => {
	const station = emitters.getEmitterByKey("ratel-emf", req.params.key);

	if (!station || !station.raw) {
		res.status(404).json({ error: "not found" });
		return;
	}

	emf.getStationSeries(station.raw).then((series) => {
		res.json({ series: series });
	}).catch((error) => {
		res.status(502).json({ error: "RATEL EMF: " + error.message });
	});
});

// Client-side routes (/e/<source>/<key>) are rendered by the same page
app.get(/^\/e\//, (_req, res) => {
	res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

module.exports = app;
