// Map UI + JSON API over the global database
const path = require("path");
const express = require("express");
const compression = require("compression");
const emitters = require("./emitters");

const PUBLIC_DIR = path.join(__dirname, "public");

const app = express();

app.use(compression());
app.use(express.static(PUBLIC_DIR));

// Every emitter with coordinates, compact (see emitters.getMapData)
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

// Client-side routes (/e/<source>/<key>) are rendered by the same page
app.get(/^\/e\//, (_req, res) => {
	res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

module.exports = app;
