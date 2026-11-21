// RATEL EMF measurements beyond the station pins (see src/services/ratel-emf):
// drive-campaign points for the heatmap (table emf_campaign_points, replaced on
// every fetch) and a fixed station's recent values (fetched on demand, cached).
const storage = require("../storage");
const ratelEmf = require("../services/ratel-emf");

const SERIES_CACHE_MS = 10 * 60 * 1000;
// RATEL unreachable (it refuses the production server): don't make every visitor wait again
const FAILURE_CACHE_MS = 5 * 60 * 1000;
const SERIES_DAYS = 2;
const COORD_DECIMALS = 5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS emf_campaigns (
	id TEXT PRIMARY KEY,
	city TEXT,
	name TEXT,
	points INTEGER,
	first_time TEXT,
	last_time TEXT
);
CREATE TABLE IF NOT EXISTS emf_campaign_points (
	campaign TEXT NOT NULL,
	lat REAL NOT NULL,
	lon REAL NOT NULL,
	time TEXT,
	field_vm REAL NOT NULL
);
`;

const seriesCache = new Map();
let campaignCache = null;

const ensureSchema = (db) => {
	db.exec(SCHEMA);
};

/**
 * Replace all campaign points
 * @param {Array<{ campaign: object, points: object[] }>} campaigns
 */
const replaceCampaigns = (campaigns) => {
	return storage.transaction((db) => {
		ensureSchema(db);
		db.exec("DELETE FROM emf_campaigns; DELETE FROM emf_campaign_points;");

		const insertCampaign = db.prepare("INSERT INTO emf_campaigns (id, city, name, points, first_time, last_time) VALUES (?, ?, ?, ?, ?, ?)");
		const insertPoint = db.prepare("INSERT INTO emf_campaign_points (campaign, lat, lon, time, field_vm) VALUES (?, ?, ?, ?, ?)");

		campaigns.forEach((entry) => {
			const times = entry.points.map((point) => {
				return point.time;
			}).filter(Boolean).sort();

			insertCampaign.run(entry.campaign.id, entry.campaign.city, entry.campaign.name, entry.points.length, times[0] || null, times[times.length - 1] || null);
			entry.points.forEach((point) => {
				insertPoint.run(entry.campaign.id, point.lat, point.lon, point.time, point.field_vm);
			});
		});

		return campaigns.reduce((total, entry) => {
			return total + entry.points.length;
		}, 0);
	});
};

const round = (value) => {
	return Number(value.toFixed(COORD_DECIMALS));
};

/**
 * Every campaign point for the heatmap: { campaigns: [...], points: [[lat, lon, field_vm, campaignIndex]] }.
 * Cached until a fetch changes the sources table.
 */
const getCampaignPoints = () => {
	const db = storage.getDatabase();
	const version = JSON.stringify(db.prepare("SELECT id, fetched_at FROM sources ORDER BY id").all());

	if (campaignCache && campaignCache.version === version) {
		return campaignCache.data;
	}

	ensureSchema(db);

	const campaigns = db.prepare("SELECT * FROM emf_campaigns ORDER BY city, id").all();
	const index = new Map(campaigns.map((campaign, position) => {
		return [campaign.id, position];
	}));
	const points = db.prepare("SELECT campaign, lat, lon, field_vm FROM emf_campaign_points").all().map((point) => {
		return [round(point.lat), round(point.lon), point.field_vm, index.get(point.campaign)];
	});

	campaignCache = { version: version, data: { campaigns: campaigns, points: points } };
	return campaignCache.data;
};

/**
 * A fixed station's values of the last two days, cached for 10 minutes
 * @param {{ id: number, lat: number, lon: number }} station - raw of a ratel-emf emitter
 */
const getStationSeries = (station) => {
	const cached = seriesCache.get(station.id);

	if (cached && Date.now() - cached.at < (cached.failed ? FAILURE_CACHE_MS : SERIES_CACHE_MS)) {
		return cached.promise;
	}

	const until = new Date();
	const from = new Date(until.getTime() - (SERIES_DAYS - 1) * 24 * 60 * 60 * 1000);
	const entry = { at: Date.now(), failed: false, promise: null };

	entry.promise = ratelEmf.getStationSeries(station, from, until).catch((error) => {
		entry.failed = true;
		throw error;
	});
	seriesCache.set(station.id, entry);
	return entry.promise;
};

module.exports = {
	replaceCampaigns: replaceCampaigns,
	getCampaignPoints: getCampaignPoints,
	getStationSeries: getStationSeries
};
