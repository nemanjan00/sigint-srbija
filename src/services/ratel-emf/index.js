const got = require("got-verbose");
const withRetry = require("../../utils/retry").withRetry;

// RATEL EMF monitoring (https://emf.ratel.rs): broadband (100 kHz - 7 GHz)
// electric field level. No API: data is embedded in the map pages' scripts.
//  - fixed stations: map markers on /cyr/rezultati-merenja/ (marker<ID> position
//    + infowindow<ID> "name<br>address<br>city<br>status"); a station's chart
//    page has 6-minute values for a date range (~1 MB even for one day)
//  - drive campaigns: /drive-campaign/results/<city>-<campaign>/cyr lists every
//    measured point as { id, lat, lng, dateTime, field, ... }
const STATIONS_PAGE = "cyr/rezultati-merenja/";
const CAMPAIGNS_PAGE = "drive-campaign/results/-/cyr";
// chart series shown: field level only (the page's params bit mask)
const SERIES_PARAMS = "1000001";

const textOf = (html) => {
	return html.replace(/<[^>]+>/g, "|").split("|").map((part) => {
		return part.trim();
	}).filter(Boolean);
};

// "21.11.2026." for a Date (Europe/Belgrade calendar day)
const ratelDate = (date) => {
	const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", day: "2-digit", month: "2-digit", year: "numeric" }).format(date).split("/");
	return parts.join(".") + ".";
};

// "21.11.2026. 21:42" (Belgrade time) -> ISO string
const isoFromLabel = (label) => {
	const match = /^(\d{2})\.(\d{2})\.(\d{4})\.? (\d{2}):(\d{2})(?::(\d{2}))?/.exec(label || "");

	if (!match) {
		return null;
	}

	const local = match[3] + "-" + match[2] + "-" + match[1] + "T" + match[4] + ":" + match[5] + ":" + (match[6] || "00");
	// offset of Belgrade at that moment
	const guess = new Date(local + "Z");
	const belgrade = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Belgrade" }));
	const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));

	return new Date(guess.getTime() - (belgrade - utc)).toISOString();
};

const seriesAfter = (html, label) => {
	const at = html.indexOf("label: \"" + label + "\"");
	const data = at < 0 ? -1 : html.indexOf("data : [", at);

	if (data < 0 || data - at > 1000) {
		return null;
	}

	return html.slice(data + 8, html.indexOf("]", data)).split(",").map(Number);
};

const ratelEmf = {
	_client: got.extend({
		prefixUrl: "https://emf.ratel.rs"
	}),

	// [{ id, lat, lon, name, address, city, active }]
	getStations: withRetry(() => {
		return ratelEmf._client.get(STATIONS_PAGE).then((response) => {
			const html = response.body;
			const markers = Array.from(html.matchAll(/var marker(\d+) = new google\.maps\.Marker\(\{\s*position: new google\.maps\.LatLng\(([\d.-]+), ([\d.-]+)\)/g));

			return markers.map((marker) => {
				const info = new RegExp("var infowindow" + marker[1] + " = new google\\.maps\\.InfoWindow\\(\\{\\s*content:\"(.*?)\"\\s*\\}\\)", "s").exec(html);
				const parts = info ? textOf(info[1].split("</b>").slice(1).join("</b>").replace(/\\"/g, "\"")) : [];

				return {
					id: Number(marker[1]),
					lat: Number(marker[2]),
					lon: Number(marker[3]),
					name: parts[0] || null,
					address: parts[1] || null,
					city: parts[2] || null,
					status: parts[3] || null,
					active: /активно/i.test(parts[3] || "")
				};
			});
		});
	}),

	// [{ id: "2-2", city, name }]
	getCampaigns: withRetry(() => {
		return ratelEmf._client.get(CAMPAIGNS_PAGE).then((response) => {
			return Array.from(response.body.matchAll(/<li class="location-menu-item" rel="\d+"><a>([^<(]+)\(\d+\)<\/a>\s*<ul>(.*?)<\/ul>/gs)).flatMap((city) => {
				return Array.from(city[2].matchAll(/rel="(\d+-\d+)"><a[^>]*>([^<]+)</g)).map((campaign) => {
					return { id: campaign[1], city: city[1].trim(), name: campaign[2].trim() };
				});
			});
		});
	}),

	// [{ id, lat, lon, time (ISO), field_vm }]
	getCampaignPoints: withRetry((campaignId) => {
		return ratelEmf._client.get("drive-campaign/results/" + campaignId + "/cyr").then((response) => {
			return Array.from(response.body.matchAll(/\{\s*id: (\d+),\s*lat: ([\d.-]+),\s*lng: ([\d.-]+),\s*dateTime:'([^']*)',\s*field:'([\d.]+)'/g)).map((point) => {
				return { id: Number(point[1]), lat: Number(point[2]), lon: Number(point[3]), time: isoFromLabel(point[4]), field_vm: Number(point[5]) };
			});
		});
	}),

	/**
	 * 6-minute values of a fixed station between two days (inclusive)
	 * @param {{ id: number, lat: number, lon: number }} station
	 * @param {Date} from
	 * @param {Date} until
	 * @returns {Promise<Array<{ time: string, field_vm: number, exposure: number|null }>>} exposure = upper estimate as a fraction of the limit
	 */
	getStationSeries: withRetry((station, from, until) => {
		const path = "results/details/cyr/" + station.id + "/from:" + ratelDate(from) + "/until:" + ratelDate(until) +
			"/params:" + SERIES_PARAMS + "/gps:" + station.lat.toFixed(8) + "," + station.lon.toFixed(8);

		return ratelEmf._client.get(path).then((response) => {
			const html = response.body;
			const labels = /labels : \[(.*?)\]/s.exec(html);
			const fields = seriesAfter(html, "Ниво поља") || [];
			const exposure = seriesAfter(html, "Горња граница") || [];
			const times = labels ? labels[1].split(",").map((label) => {
				return isoFromLabel(label.replace(/"/g, "").trim());
			}) : [];

			return times.map((time, index) => {
				return { time: time, field_vm: fields[index], exposure: Number.isFinite(exposure[index]) ? exposure[index] : null };
			}).filter((point) => {
				return point.time && Number.isFinite(point.field_vm);
			});
		});
	})
};

module.exports = ratelEmf;
