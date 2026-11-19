// Maidenhead locator (JN95WD, KN03, ...) -> centre of the grid square
const KM_PER_DEGREE = 111.32;

/**
 * @param {string} locator - 2 to 8 characters
 * @returns {{lat: number, lon: number, accuracyM: number}|null} accuracyM = centre-to-corner distance
 */
const toLatLon = (locator) => {
	const text = (locator || "").trim().toUpperCase();

	if (!/^[A-R]{2}(?:[0-9]{2}(?:[A-X]{2}(?:[0-9]{2})?)?)?$/.test(text)) {
		return null;
	}

	const steps = [
		{ lon: 20, lat: 10, base: 65 },
		{ lon: 2, lat: 1, base: 48 },
		{ lon: 5 / 60, lat: 2.5 / 60, base: 65 },
		{ lon: 0.5 / 60, lat: 0.25 / 60, base: 48 }
	].slice(0, text.length / 2);

	const corner = steps.reduce((position, step, index) => {
		return {
			lon: position.lon + (text.charCodeAt(index * 2) - step.base) * step.lon,
			lat: position.lat + (text.charCodeAt(index * 2 + 1) - step.base) * step.lat
		};
	}, { lon: -180, lat: -90 });

	const last = steps[steps.length - 1];
	const lat = corner.lat + last.lat / 2;
	const lon = corner.lon + last.lon / 2;
	const heightKm = last.lat * KM_PER_DEGREE;
	const widthKm = last.lon * KM_PER_DEGREE * Math.cos(lat * Math.PI / 180);

	return {
		lat: Math.round(lat * 1e6) / 1e6,
		lon: Math.round(lon * 1e6) / 1e6,
		accuracyM: Math.round(Math.sqrt(heightKm * heightKm + widthKm * widthKm) / 2 * 1000)
	};
};

module.exports = {
	toLatLon: toLatLon
};
