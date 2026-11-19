const MAX_MHZ = 300000;

// "438.50000" (MHz) -> 438500000 Hz; null when missing or implausible (source typos)
const mhzToHz = (text) => {
	if (text === null || text === undefined || text === "") {
		return null;
	}

	const mhz = Number(String(text).replace(",", ".").trim());

	if (!Number.isFinite(mhz) || mhz <= 0 || mhz > MAX_MHZ) {
		return null;
	}

	return Math.round(mhz * 1e6);
};

module.exports = {
	mhzToHz: mhzToHz
};
