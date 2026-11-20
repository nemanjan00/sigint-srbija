// Contributed observations of mobile network cells (data/donation.json, next to
// the database; NEVER commit it, it is private data we only get to use). Each
// observation is a cell seen by a phone: network (MNC), technology, cell / site
// id, estimated position and the downlink channels heard.
//
// They enrich the register's cell sites (ratel-reg221): an observation belongs
// to the nearest site of the same operator that has its technology registered,
// within MAX_DISTANCE_M, unless a second such site is about as near (ambiguous).
// Observed positions are estimates, so unmatched observations are dropped.
const fs = require("fs");
const path = require("path");
const storage = require("../storage");
const arfcn = require("../utils/arfcn");

const FILE = process.env.SIGINT_CELL_OBSERVATIONS || path.join(storage.DB_DIR, "donation.json");
const MAX_DISTANCE_M = 100;
// A second candidate within this factor and margin of the nearest makes the match ambiguous
const AMBIGUOUS_FACTOR = 2;
const AMBIGUOUS_MARGIN_M = 50;
// Serbian MNCs (the file's own network names are outdated / wrong)
const OPERATORS = { 1: "Yettel", 3: "Telekom Srbija", 5: "A1" };
const GENERATIONS = { GSM: "2G", UMTS: "3G", LTE: "4G", NR: "5G" };
const GRID_PER_DEGREE = 100;
const EARTH_RADIUS_M = 6371000;
const RADIANS = Math.PI / 180;

const distanceM = (a, b) => {
	const x = (b.lon - a.lon) * RADIANS * Math.cos((a.lat + b.lat) / 2 * RADIANS);
	const y = (b.lat - a.lat) * RADIANS;
	return EARTH_RADIUS_M * Math.hypot(x, y);
};

const cellOf = (point) => {
	return [Math.floor(point.lat * GRID_PER_DEGREE), Math.floor(point.lon * GRID_PER_DEGREE)];
};

// Sites in a coarse lat/lon grid (cells ~1 km, larger than MAX_DISTANCE_M)
const gridOf = (sites) => {
	return sites.reduce((grid, site) => {
		const key = cellOf(site).join(",");
		grid[key] = (grid[key] || []).concat([site]);
		return grid;
	}, {});
};

const neighbours = (grid, point) => {
	const centre = cellOf(point);
	return [-1, 0, 1].reduce((result, dLat) => {
		return [-1, 0, 1].reduce((inner, dLon) => {
			return inner.concat(grid[(centre[0] + dLat) + "," + (centre[1] + dLon)] || []);
		}, result);
	}, []);
};

const unique = (values) => {
	return values.filter((value, index) => {
		return values.indexOf(value) === index;
	});
};

const toObservation = (row) => {
	return {
		operator: OPERATORS[row.mnc] || null,
		technology: GENERATIONS[row.rat] || null,
		rat: row.rat,
		cell_id: String(row.site_id),
		lat: Number(row.lat),
		lon: Number(row.lon),
		carriers: unique(row.channels || []).map((channel) => {
			const info = arfcn.channelInfo(row.rat, channel);
			return info ? { channel: channel, band: info.band, register_band: info.register, mhz: info.mhz } : null;
		}).filter(Boolean)
	};
};

/**
 * All observations, [] when the file isn't there
 * @returns {object[]} { operator, technology, rat, cell_id, lat, lon, carriers }
 */
const load = () => {
	if (!fs.existsSync(FILE)) {
		console.warn("cell-observations: " + FILE + " not found, skipping");
		return [];
	}

	return JSON.parse(fs.readFileSync(FILE, "utf8")).map(toObservation).filter((observation) => {
		return observation.operator && observation.technology && Number.isFinite(observation.lat) && Number.isFinite(observation.lon);
	});
};

// Register site the observation belongs to, or null
const matchSite = (grid, observation) => {
	const candidates = neighbours(grid, observation).filter((site) => {
		return site.operator === observation.operator && site.raw.technologies.includes(observation.technology);
	}).map((site) => {
		return { site: site, distance: distanceM(site, observation) };
	}).filter((candidate) => {
		return candidate.distance <= MAX_DISTANCE_M;
	}).sort((a, b) => {
		return a.distance - b.distance;
	});

	if (candidates.length === 0) {
		return null;
	}

	const nearest = candidates[0];
	const second = candidates[1];

	if (second && second.distance < nearest.distance * AMBIGUOUS_FACTOR && second.distance - nearest.distance < AMBIGUOUS_MARGIN_M) {
		return null;
	}

	return nearest;
};

/**
 * Cell site emitters (ratel-reg221) with raw.observed = [{ technology, rat,
 * cell_id, distance_m, carriers: [{ channel, band, register_band, mhz }] }]
 * @param {object[]} sites emitters with lat, lon, operator, raw.technologies
 * @returns {object[]} new emitter objects
 */
const enrich = (sites) => {
	const observations = load();
	const grid = gridOf(sites.filter((site) => {
		return site.lat !== null && site.lon !== null;
	}));
	const bySite = observations.reduce((result, observation) => {
		const match = matchSite(grid, observation);

		if (match) {
			result.set(match.site, (result.get(match.site) || []).concat([{
				technology: observation.technology,
				rat: observation.rat,
				cell_id: observation.cell_id,
				distance_m: Math.round(match.distance),
				carriers: observation.carriers
			}]));
		}

		return result;
	}, new Map());

	if (observations.length > 0) {
		const matched = Array.from(bySite.values()).reduce((sum, list) => {
			return sum + list.length;
		}, 0);
		console.log("cell-observations: " + matched + " of " + observations.length + " observations matched " + bySite.size + " sites");
	}

	return sites.map((site) => {
		const observed = bySite.get(site);

		if (!observed) {
			return site;
		}

		return Object.assign({}, site, {
			raw: Object.assign({}, site.raw, {
				observed: observed.sort((a, b) => {
					return a.technology.localeCompare(b.technology) || a.cell_id.localeCompare(b.cell_id, "en", { numeric: true });
				})
			})
		});
	});
};

module.exports = {
	load: load,
	enrich: enrich
};
