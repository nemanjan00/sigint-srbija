// Is a point in Serbia (incl. Kosovo)? Uses data/boundary.geojson, a ~500 m
// simplified OSM outline (tracked in git).
const fs = require("fs");
const path = require("path");

const BOUNDARY_FILE = path.join(__dirname, "..", "..", "..", "data", "boundary.geojson");
// Positions this far outside the outline are "clearly wrong", closer ones may
// be real (border rivers, simplification)
const NEAR_MARGIN_DEG = 0.3;

let polygons = null;

const load = () => {
	if (polygons) {
		return polygons;
	}

	const collection = JSON.parse(fs.readFileSync(BOUNDARY_FILE, "utf8"));

	polygons = collection.features.reduce((result, feature) => {
		const geometry = feature.geometry;

		if (geometry.type === "Polygon") {
			return result.concat([geometry.coordinates]);
		}

		return result.concat(geometry.coordinates);
	}, []);

	return polygons;
};

// Ray casting on one ring of [lon, lat] points
const inRing = (ring, lat, lon) => {
	return ring.reduce((inside, point, index) => {
		const previous = ring[(index || ring.length) - 1];
		const crosses = (point[1] > lat) !== (previous[1] > lat) &&
			lon < (previous[0] - point[0]) * (lat - point[1]) / (previous[1] - point[1]) + point[0];
		return crosses ? !inside : inside;
	}, false);
};

const isInside = (lat, lon) => {
	return load().some((polygon) => {
		return inRing(polygon[0], lat, lon) && !polygon.slice(1).some((hole) => {
			return inRing(hole, lat, lon);
		});
	});
};

const bounds = () => {
	return load().reduce((box, polygon) => {
		return polygon[0].reduce((current, point) => {
			return {
				minLat: Math.min(current.minLat, point[1]),
				maxLat: Math.max(current.maxLat, point[1]),
				minLon: Math.min(current.minLon, point[0]),
				maxLon: Math.max(current.maxLon, point[0])
			};
		}, box);
	}, { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity });
};

// Inside, or within NEAR_MARGIN_DEG of the bounding box
const isNear = (lat, lon) => {
	const box = bounds();
	return lat >= box.minLat - NEAR_MARGIN_DEG && lat <= box.maxLat + NEAR_MARGIN_DEG &&
		lon >= box.minLon - NEAR_MARGIN_DEG && lon <= box.maxLon + NEAR_MARGIN_DEG;
};

module.exports = {
	isInside: isInside,
	isNear: isNear
};
