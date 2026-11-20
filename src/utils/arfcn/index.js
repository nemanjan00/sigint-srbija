// Channel numbers of mobile networks -> 3GPP band + downlink centre frequency:
// GSM ARFCN (3GPP TS 45.005), UMTS UARFCN (TS 25.101), LTE EARFCN (TS 36.101),
// NR-ARFCN (TS 38.104). Only the bands used in Serbia. The channel number alone
// identifies the band (downlink channel ranges don't overlap).

// technology -> [{ band, register, first, last, mhz(channel) }]; register = band
// name in the RATEL registers (MHz)
const BANDS = {
	GSM: [
		{ band: 900, register: "900", first: 0, last: 124, mhz: (n) => 935 + 0.2 * n },
		{ band: 900, register: "900", first: 975, last: 1023, mhz: (n) => 935 + 0.2 * (n - 1024) },
		{ band: 1800, register: "1800", first: 512, last: 885, mhz: (n) => 1805.2 + 0.2 * (n - 512) }
	],
	UMTS: [
		{ band: 1, register: "2100", first: 10562, last: 10838, mhz: (n) => n / 5 },
		{ band: 8, register: "900", first: 2937, last: 3088, mhz: (n) => 340 + n / 5 }
	],
	LTE: [
		{ band: 1, register: "2100", first: 0, last: 599, mhz: (n) => 2110 + 0.1 * n },
		{ band: 3, register: "1800", first: 1200, last: 1949, mhz: (n) => 1805 + 0.1 * (n - 1200) },
		{ band: 7, register: "2600", first: 2750, last: 3449, mhz: (n) => 2620 + 0.1 * (n - 2750) },
		{ band: 8, register: "900", first: 3450, last: 3799, mhz: (n) => 925 + 0.1 * (n - 3450) },
		{ band: 20, register: "800", first: 6150, last: 6449, mhz: (n) => 791 + 0.1 * (n - 6150) },
		{ band: 28, register: "700", first: 9210, last: 9659, mhz: (n) => 758 + 0.1 * (n - 9210) }
	],
	NR: [
		{ band: 28, register: "700", first: 151600, last: 160600, mhz: (n) => 0.005 * n },
		{ band: 78, register: "3500", first: 620000, last: 653333, mhz: (n) => 3000 + 0.015 * (n - 600000) }
	]
};

const round = (mhz) => {
	return Math.round(mhz * 1000) / 1000;
};

/**
 * Band and downlink centre frequency of a channel, or null if it isn't in a known band
 * @param {string} technology GSM | UMTS | LTE | NR
 * @param {number} channel ARFCN / UARFCN / EARFCN / NR-ARFCN
 * @returns {{band: number, register: string, mhz: number}|null}
 */
const channelInfo = (technology, channel) => {
	const found = (BANDS[technology] || []).find((entry) => {
		return channel >= entry.first && channel <= entry.last;
	});

	return found ? { band: found.band, register: found.register, mhz: round(found.mhz(channel)) } : null;
};

module.exports = {
	channelInfo: channelInfo
};
