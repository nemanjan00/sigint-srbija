// Geographic coordinates on the old Yugoslav datum (Bessel 1841 ellipsoid,
// "MGI 1901", EPSG:3906) -> WGS 84, using the EPSG:3906 3-parameter shift.
// Accuracy is a few metres; without it positions are ~500 m off.
const BESSEL = { a: 6377397.155, f: 1 / 299.1528128 };
const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
const MGI_1901_TO_WGS84 = { dx: 682, dy: -203, dz: 480 };
const ITERATIONS = 6;

const eccentricitySquared = (ellipsoid) => {
	return ellipsoid.f * (2 - ellipsoid.f);
};

const toCartesian = (lat, lon, ellipsoid) => {
	const phi = lat * Math.PI / 180;
	const lambda = lon * Math.PI / 180;
	const e2 = eccentricitySquared(ellipsoid);
	const n = ellipsoid.a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));

	return {
		x: n * Math.cos(phi) * Math.cos(lambda),
		y: n * Math.cos(phi) * Math.sin(lambda),
		z: n * (1 - e2) * Math.sin(phi)
	};
};

const toGeographic = (point, ellipsoid) => {
	const e2 = eccentricitySquared(ellipsoid);
	const p = Math.sqrt(point.x * point.x + point.y * point.y);
	const initial = Math.atan2(point.z, p * (1 - e2));

	const phi = Array.from({ length: ITERATIONS }).reduce((current) => {
		const n = ellipsoid.a / Math.sqrt(1 - e2 * Math.sin(current) * Math.sin(current));
		const h = p / Math.cos(current) - n;
		return Math.atan2(point.z, p * (1 - e2 * n / (n + h)));
	}, initial);

	return {
		lat: phi * 180 / Math.PI,
		lon: Math.atan2(point.y, point.x) * 180 / Math.PI
	};
};

const round = (value) => {
	return Math.round(value * 1e6) / 1e6;
};

const besselToWgs84 = (lat, lon) => {
	const point = toCartesian(lat, lon, BESSEL);
	const shifted = {
		x: point.x + MGI_1901_TO_WGS84.dx,
		y: point.y + MGI_1901_TO_WGS84.dy,
		z: point.z + MGI_1901_TO_WGS84.dz
	};
	const result = toGeographic(shifted, WGS84);

	return {
		lat: round(result.lat),
		lon: round(result.lon)
	};
};

module.exports = {
	besselToWgs84: besselToWgs84
};
