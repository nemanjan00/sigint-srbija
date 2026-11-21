// RATEL EMF monitoring stations (https://emf.ratel.rs), kind "emf": fixed
// broadband (100 kHz - 7 GHz) electric field sensors. They measure, they don't
// transmit: no frequency. Live values are fetched on demand (src/emf).
//   name      station name as published ("БГ - ОШ ..."), location = address, city = town
//   active    "Мерење је активно"
//   raw       sensor id (emf.ratel.rs id), position, status
// The fetch also replaces the drive-campaign points (src/emf) when RATEL's campaign list changed.
// Production reaches emf.ratel.rs through SIGINT_EMF_PROXY (see src/services/ratel-emf).
const ratelEmf = require("../../services/ratel-emf");
const emf = require("../../emf");

const toEmitter = (station) => {
	return {
		source_key: String(station.id),
		kind: "emf",
		mode: "Broadband",
		name: station.name,
		operator: "RATEL",
		location: station.address,
		city: station.city,
		lat: station.lat,
		lon: station.lon,
		coord_source: "source",
		active: station.active ? 1 : 0,
		sector: "public",
		owner: "public",
		raw: {
			id: station.id,
			lat: station.lat,
			lon: station.lon,
			name: station.name,
			address: station.address,
			city: station.city,
			status: station.status,
			band: "100 kHz - 7 GHz"
		}
	};
};

// one campaign page at a time (~2 MB each)
const fetchCampaigns = (campaigns) => {
	return campaigns.reduce((chain, campaign) => {
		return chain.then((done) => {
			return ratelEmf.getCampaignPoints(campaign.id).then((points) => {
				return done.concat([{ campaign: campaign, points: points }]);
			});
		});
	}, Promise.resolve([]));
};

const ratelEmfSource = {
	id: "ratel-emf",
	description: "RATEL EMF monitoring: fixed electric field sensors (plus drive-campaign measurements for the heatmap)",
	url: "https://emf.ratel.rs/cyr/rezultati-merenja/",

	fetch: () => {
		return ratelEmf.getCampaigns().then((campaigns) => {
			const ids = campaigns.map((campaign) => {
				return campaign.id;
			}).sort();

			// campaigns are finished measurements: only reload them when RATEL adds or removes one
			if (JSON.stringify(ids) === JSON.stringify(emf.getCampaignIds())) {
				console.log("ratel-emf: " + campaigns.length + " campaigns unchanged");
				return null;
			}

			return fetchCampaigns(campaigns).then((loaded) => {
				console.log("ratel-emf: " + loaded.length + " campaigns, " + emf.replaceCampaigns(loaded) + " measured points");
			});
		}).then(() => {
			return ratelEmf.getStations();
		}).then((stations) => {
			return stations.map(toEmitter);
		});
	}
};

module.exports = ratelEmfSource;
