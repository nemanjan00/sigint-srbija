import {
	state, onChange, el, mount, when, untracked,
	Input, Button, Badge, Switch, Label, Separator,
	ToggleGroup, ToggleGroupItem,
	Combobox, ComboboxChips, ComboboxValue, ComboboxChip, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxList, ComboboxItem,
	Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription,
	SearchIcon, XIcon, ArrowLeftIcon, ChevronRightIcon
} from "@nemanjan00/qrp-shadcdn";
import maplibregl from "maplibre-gl";
import { createSpectrum, formatHz, CATEGORY_LEGEND } from "./spectrum.js";
import { createPanorama } from "./panorama.js";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const INITIAL_BOUNDS = [[18.8, 41.85], [23.0, 46.2]];
// keep the map's visual centre clear of the floating panels
const PANEL_PADDING = { left: 380, right: 20, top: 20, bottom: 20 };
// phones: filters and details are bottom sheets under a top bar
const MOBILE_QUERY = "(max-width: 767px)";
const MOBILE_SHEET_SHARE = 0.55;
const FILTER_DEBOUNCE = 120;
// fingers need a bigger hit area than a mouse
const CLICK_RADIUS = matchMedia("(pointer: coarse)").matches ? 14 : 6;
const APPROXIMATE_M = 1000;
const LIST_CLUSTER_ZOOM = 12;
const LIST_CLUSTER_SIZE = 6;
const MAX_LIST = 500;

const KINDS = {
	repeater: { label: "Repeaters", color: "#22d3ee" },
	digipeater: { label: "APRS", color: "#a78bfa" },
	beacon: { label: "Beacons", color: "#f472b6" },
	licence: { label: "Licences", color: "#f59e0b" },
	broadcast: { label: "Broadcast", color: "#f43f5e" },
	cell: { label: "Cell sites", color: "#34d399" },
	link: { label: "Wi-Fi & links", color: "#94a3b8" },
	mesh: { label: "Mesh (LoRa)", color: "#fb923c" },
	cb: { label: "CB radio", color: "#facc15" }
};
// Kinds of the amateur / community sources (SRS, BrandMeister, mesh); the rest are RATEL registers
const AMATEUR_KINDS = ["repeater", "digipeater", "beacon", "mesh"];

const SOURCES = {
	"yu1srs-repeaters": { label: "SRS table", color: "#22d3ee" },
	"yu1srs-map": { label: "SRS map", color: "#34d399" },
	"brandmeister": { label: "BrandMeister", color: "#60a5fa" },
	"ratel-reg203": { label: "RATEL licences", color: "#f59e0b" },
	"ratel-reg204": { label: "RATEL broadcast", color: "#f43f5e" },
	"ratel-reg221": { label: "RATEL cell sites", color: "#34d399" },
	"ratel-reg215": { label: "RATEL Wi-Fi & links", color: "#94a3b8" },
	"ratel-reg215-cb": { label: "RATEL CB radio", color: "#facc15" },
	"jugomesh": { label: "Jugomesh", color: "#fb923c" }
};

// Frequency presets (Hz). Emitters match when their TX range overlaps.
const BANDS = [
	{ id: "all", label: "All" },
	{ id: "hf", label: "HF", min: 0, max: 30e6 },
	{ id: "6m", label: "6 m", min: 50e6, max: 54e6 },
	{ id: "vhf", label: "VHF", min: 30e6, max: 300e6 },
	{ id: "2m", label: "2 m", min: 144e6, max: 146e6 },
	{ id: "uhf", label: "UHF", min: 300e6, max: 1e9 },
	{ id: "70cm", label: "70 cm", min: 430e6, max: 440e6 },
	{ id: "pmr", label: "PMR446", min: 446e6, max: 446.2e6 },
	{ id: "shf", label: "> 1 GHz", min: 1e9, max: Infinity }
];

// --- data -------------------------------------------------------------------

const CYRILLIC = {
	а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m",
	н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "c", у: "u", ф: "f", х: "h", ц: "c", ч: "c", џ: "dz", ш: "s"
};

// Lowercase, Serbian Cyrillic -> Latin, no diacritics: "Шабац" and "Sabac" both -> "sabac"
const fold = (text) => {
	return String(text || "").toLowerCase().replace(/[а-џ]/g, (char) => {
		return CYRILLIC[char] || char;
	}).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj");
};

const data = {
	rows: [],
	byId: new Map(),
	features: [],
	haystacks: [],
	lookups: { stationTypes: {}, serviceTypes: {} },
	sources: []
};

const loadData = () => {
	return fetch("/api/map").then((response) => {
		return response.json();
	}).then((payload) => {
		const index = payload.columns.reduce((result, column, position) => {
			result[column] = position;
			return result;
		}, {});

		data.rows = payload.rows.map((row) => {
			return Object.freeze(payload.columns.reduce((record, column) => {
				record[column] = row[index[column]];
				return record;
			}, {}));
		});
		data.rows.forEach((row) => {
			data.byId.set(row.id, row);
		});
		data.features = data.rows.map((row) => {
			return {
				type: "Feature",
				id: row.id,
				geometry: { type: "Point", coordinates: [row.lon, row.lat] },
				properties: { id: row.id, kind: row.kind, label: AMATEUR_KINDS.includes(row.kind) ? (row.callsign || (row.kind === "mesh" ? row.name : "") || "") : "" }
			};
		});
		data.haystacks = data.rows.map((row) => {
			return fold([row.callsign, row.operator, row.location].join(" "));
		});
		data.lookups = payload.lookups;
		data.sources = payload.sources;
	});
};

// --- state ------------------------------------------------------------------

const s = state({
	loading: true,
	mobile: matchMedia(MOBILE_QUERY).matches,
	filtersOpen: false,
	query: "",
	sources: Object.keys(SOURCES),
	kinds: Object.keys(KINDS),
	band: "all",
	minMhz: "",
	maxMhz: "",
	stationTypes: [],
	serviceTypes: [],
	sectors: [],
	owner: "any",
	activeOnly: true,
	preciseOnly: false,
	showDuplicates: false,
	shown: 0,
	total: 0,
	// clicked spot: ids of all emitters under the cursor
	selection: [],
	selectionKey: "",
	detailId: null,
	detail: null,
	explorerOpen: false,
	panoramaOpen: false,
	panoramaRadius: 10,
	panoramaAr: false,
	panoramaError: "",
	panoramaSites: 0,
	arFiltersOpen: false
});

const frequencyRange = () => {
	const band = BANDS.find((candidate) => {
		return candidate.id === s.band;
	});
	const min = s.minMhz === "" ? null : Number(s.minMhz) * 1e6;
	const max = s.maxMhz === "" ? null : Number(s.maxMhz) * 1e6;

	if (min !== null || max !== null) {
		return { min: Number.isFinite(min) && min !== null ? min : 0, max: Number.isFinite(max) && max !== null ? max : Infinity };
	}

	if (band && band.min !== undefined) {
		return { min: band.min, max: band.max };
	}

	return null;
};

/**
 * Snapshot of the filter, read from state (so an effect calling this tracks all of it)
 */
const readFilter = () => {
	return {
		query: fold(s.query.trim()),
		sources: new Set(Array.from(s.sources)),
		kinds: new Set(Array.from(s.kinds)),
		stationTypes: new Set(Array.from(s.stationTypes)),
		serviceTypes: new Set(Array.from(s.serviceTypes)),
		sectors: new Set(Array.from(s.sectors)),
		owner: s.owner,
		range: frequencyRange(),
		activeOnly: s.activeOnly,
		preciseOnly: s.preciseOnly,
		showDuplicates: s.showDuplicates
	};
};

const matchesLicence = (filter, row) => {
	if (filter.stationTypes.size > 0 && !filter.stationTypes.has(row.station_type)) {
		return false;
	}

	if (filter.serviceTypes.size > 0 && !filter.serviceTypes.has(row.service_type)) {
		return false;
	}

	if (filter.sectors.size > 0 && !filter.sectors.has(row.sector)) {
		return false;
	}

	return filter.owner === "any" || row.owner === filter.owner;
};

const matches = (filter, row, index) => {
	if (!filter.sources.has(row.source) || !filter.kinds.has(row.kind)) {
		return false;
	}

	if (filter.activeOnly && row.active === 0) {
		return false;
	}

	// one pin per station: other sources' listings of it are shown in its details
	if (!filter.showDuplicates && row.duplicate_of !== null) {
		return false;
	}

	if (filter.preciseOnly && row.coord_accuracy_m !== null && row.coord_accuracy_m > APPROXIMATE_M) {
		return false;
	}

	// holder / station filters narrow licences only; amateur stations are controlled by Kind
	if (row.kind === "licence" && !matchesLicence(filter, row)) {
		return false;
	}

	if (filter.range) {
		const low = row.tx_hz;
		const high = row.tx_high_hz === null ? row.tx_hz : row.tx_high_hz;

		if (low === null || high < filter.range.min || low > filter.range.max) {
			return false;
		}
	}

	return !filter.query || data.haystacks[index].includes(filter.query);
};

// --- formatting -------------------------------------------------------------

const formatMhz = (hz) => {
	if (hz === null || hz === undefined) {
		return "—";
	}

	const mhz = hz / 1e6;
	const text = mhz.toFixed(6).replace(/0+$/, "");
	const decimals = text.split(".")[1] || "";

	return decimals.length < 3 ? mhz.toFixed(3) : text;
};

const formatRange = (low, high) => {
	if (low === null || low === undefined) {
		return "—";
	}

	if (high !== null && high !== undefined && high !== low) {
		return formatMhz(low) + " – " + formatMhz(high);
	}

	return formatMhz(low);
};

const formatNumber = (value) => {
	return Number(value).toLocaleString("en-US");
};

const titleOf = (row) => {
	return row.callsign || row.name || row.operator || row.location || "Emitter #" + row.id;
};

// --- map --------------------------------------------------------------------

const kindColor = ["match", ["get", "kind"]].concat(Object.keys(KINDS).reduce((result, kind) => {
	return result.concat([kind, KINDS[kind].color]);
}, []), ["#94a3b8"]);

// Map padding that keeps the visual centre clear of the panels / sheets
const mapPadding = (sheetOpen) => {
	if (!matchMedia(MOBILE_QUERY).matches) {
		return PANEL_PADDING;
	}

	return { top: 72, left: 16, right: 16, bottom: sheetOpen ? Math.round(window.innerHeight * MOBILE_SHEET_SHARE) : 24 };
};

// ?map=<zoom>/<lat>/<lon> (openstreetmap.org's hash format, kept in the query)
const parseView = () => {
	const parts = (new URLSearchParams(location.search).get("map") || "").split("/").map(Number);

	if (parts.length !== 3 || !parts.every(Number.isFinite)) {
		return null;
	}

	return { zoom: parts[0], center: [parts[2], parts[1]] };
};

const initialView = parseView();

const map = new maplibregl.Map(Object.assign({
	container: "map",
	style: BASEMAP,
	attributionControl: { compact: true }
}, initialView || { bounds: INITIAL_BOUNDS, fitBoundsOptions: { padding: mapPadding(false) } }));

// for debugging from the console
window.sigintMap = map;

map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

const circlePolygon = (lat, lon, radiusM) => {
	const points = Array.from({ length: 65 }, (_, step) => {
		const angle = step / 64 * 2 * Math.PI;
		const dLat = radiusM / 111320 * Math.cos(angle);
		const dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180)) * Math.sin(angle);
		return [lon + dLon, lat + dLat];
	});

	return { type: "Feature", geometry: { type: "Polygon", coordinates: [points] }, properties: {} };
};

const addLayers = () => {
	map.addSource("emitters", {
		type: "geojson",
		data: { type: "FeatureCollection", features: [] },
		cluster: true,
		clusterRadius: 48,
		clusterMaxZoom: 13,
		clusterProperties: {
			amateur: ["+", ["case", ["in", ["get", "kind"], ["literal", AMATEUR_KINDS]], 1, 0]]
		}
	});
	map.addSource("selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
	map.addSource("accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

	map.addLayer({
		id: "accuracy-fill",
		type: "fill",
		source: "accuracy",
		paint: { "fill-color": "#22d3ee", "fill-opacity": 0.08 }
	});
	map.addLayer({
		id: "accuracy-line",
		type: "line",
		source: "accuracy",
		paint: { "line-color": "#22d3ee", "line-opacity": 0.5, "line-width": 1, "line-dasharray": [2, 2] }
	});

	// clusters: cyan when all amateur, amber otherwise; a cyan glow marks amateur stations inside
	const clusterColor = ["case", ["==", ["get", "amateur"], ["get", "point_count"]], KINDS.repeater.color, KINDS.licence.color];
	const glowColor = ["case", [">", ["get", "amateur"], 0], KINDS.repeater.color, KINDS.licence.color];
	const clusterRadius = ["step", ["get", "point_count"], 14, 25, 18, 250, 24, 2500, 32];

	map.addLayer({
		id: "cluster-glow",
		type: "circle",
		source: "emitters",
		filter: ["has", "point_count"],
		paint: {
			"circle-color": glowColor,
			"circle-radius": ["+", clusterRadius, 10],
			"circle-opacity": ["case", [">", ["get", "amateur"], 0], 0.3, 0.12],
			"circle-blur": 0.8
		}
	});
	map.addLayer({
		id: "clusters",
		type: "circle",
		source: "emitters",
		filter: ["has", "point_count"],
		paint: {
			"circle-color": "#0b1220",
			"circle-radius": clusterRadius,
			"circle-stroke-color": clusterColor,
			"circle-stroke-width": 1.5,
			"circle-stroke-opacity": 0.9
		}
	});
	map.addLayer({
		id: "cluster-count",
		type: "symbol",
		source: "emitters",
		filter: ["has", "point_count"],
		layout: {
			"text-field": ["get", "point_count_abbreviated"],
			"text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
			"text-size": 11
		},
		paint: { "text-color": "#e2e8f0" }
	});

	map.addLayer({
		id: "points-glow",
		type: "circle",
		source: "emitters",
		filter: ["!", ["has", "point_count"]],
		paint: {
			"circle-color": kindColor,
			"circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 7, 14, 14],
			"circle-opacity": ["case", ["in", ["get", "kind"], ["literal", AMATEUR_KINDS]], 0.3, 0.12],
			"circle-blur": 1
		}
	});
	map.addLayer({
		id: "points",
		type: "circle",
		source: "emitters",
		filter: ["!", ["has", "point_count"]],
		paint: {
			"circle-color": kindColor,
			"circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3.5, 14, 6.5],
			"circle-stroke-color": "#0b1220",
			"circle-stroke-width": 1.2
		}
	});
	map.addLayer({
		id: "point-labels",
		type: "symbol",
		source: "emitters",
		filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "label"], ""]],
		minzoom: 8,
		layout: {
			"text-field": ["get", "label"],
			"text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
			"text-size": 11,
			"text-offset": [0, 1.1],
			"text-anchor": "top",
			"text-optional": true
		},
		paint: { "text-color": kindColor, "text-halo-color": "#05080f", "text-halo-width": 1.4 }
	});

	map.addLayer({
		id: "selected-ring",
		type: "circle",
		source: "selected",
		paint: {
			"circle-radius": 13,
			"circle-color": "transparent",
			"circle-stroke-color": "#ffffff",
			"circle-stroke-width": 2,
			"circle-stroke-opacity": 0.9
		}
	});
};

const setSelectedMarker = (row) => {
	if (!map.getSource("selected")) {
		return;
	}

	const features = row ? [{ type: "Feature", geometry: { type: "Point", coordinates: [row.lon, row.lat] }, properties: {} }] : [];
	map.getSource("selected").setData({ type: "FeatureCollection", features: features });

	const accuracy = row && row.coord_accuracy_m ? [circlePolygon(row.lat, row.lon, row.coord_accuracy_m)] : [];
	map.getSource("accuracy").setData({ type: "FeatureCollection", features: accuracy });
};

let filterTimer = null;

// Main listings without a frequency (SRS map pins) borrow it from a duplicate listing
let frequencyOfDuplicates = null;

const withFrequency = (row) => {
	if (row.tx_hz) {
		return row;
	}

	if (!frequencyOfDuplicates) {
		frequencyOfDuplicates = new Map();
		data.rows.forEach((candidate) => {
			if (candidate.duplicate_of !== null && candidate.tx_hz && !frequencyOfDuplicates.has(candidate.duplicate_of)) {
				frequencyOfDuplicates.set(candidate.duplicate_of, { tx_hz: candidate.tx_hz, tx_high_hz: candidate.tx_high_hz });
			}
		});
	}

	const borrowed = frequencyOfDuplicates.get(row.id);
	return borrowed ? Object.assign({}, row, borrowed) : row;
};

const applyFilter = (filter) => {
	const features = data.features.filter((_, index) => {
		return matches(filter, data.rows[index], index);
	});

	if (map.getSource("emitters")) {
		map.getSource("emitters").setData({ type: "FeatureCollection", features: features });
	}

	data.visible = features.map((feature) => {
		return withFrequency(data.byId.get(feature.properties.id));
	});
	[panelExplorer, fullExplorer].filter(Boolean).forEach((explorer) => {
		explorer.setSignals(data.visible);
	});

	if (panorama) {
		panorama.setRows(data.visible);
	}
	s.shown = features.length;
};

const scheduleFilter = (filter) => {
	clearTimeout(filterTimer);
	filterTimer = setTimeout(() => {
		applyFilter(filter);
	}, FILTER_DEBOUNCE);
};

// --- URL state (shareable links) ---------------------------------------------
//
//   /e/<source>/<key>   open emitter; (source, source_key) is stable across re-fetches
//   ?q=&kind=&src=&band=&min=&max=&type=&svc=&sector=&owner=&active=0&precise=1   filters, only non-defaults
//   &map=<zoom>/<lat>/<lon>   map view
//
// Plain paths and query strings only (no #fragment), so links survive any
// server, crawler or chat app that drops fragments.
//
// Opening an emitter pushes a history entry (Back closes it / returns to the
// previous one); filters and map moves only replace the current entry.

const APP_TITLE = "SIGINT Srbija";
const ROUTE = /^\/e\/([^/]+)\/(.+)$/;

const DEFAULT_FILTER = {
	kinds: Object.keys(KINDS),
	sources: Object.keys(SOURCES),
	band: "all",
	activeOnly: true,
	preciseOnly: false
};

// slashes in keys stay readable: /e/ratel-reg203/026/000249/001~f84c1827
const emitterPath = (detail) => {
	return "/e/" + encodeURIComponent(detail.source) + "/" + detail.source_key.split("/").map(encodeURIComponent).join("/");
};

const parseRoute = () => {
	const match = location.pathname.match(ROUTE);

	if (!match) {
		return null;
	}

	return { source: decodeURIComponent(match[1]), key: match[2].split("/").map(decodeURIComponent).join("/") };
};

const sameSet = (a, b) => {
	return a.length === b.length && a.every((item) => {
		return b.includes(item);
	});
};

const filterParams = () => {
	const params = new URLSearchParams();
	const list = (name, values, defaults) => {
		if (!sameSet(values, defaults)) {
			params.set(name, values.join(","));
		}
	};

	if (s.query.trim()) {
		params.set("q", s.query.trim());
	}

	list("kind", Array.from(s.kinds), DEFAULT_FILTER.kinds);
	list("src", Array.from(s.sources), DEFAULT_FILTER.sources);

	if (s.band !== DEFAULT_FILTER.band) {
		params.set("band", s.band);
	}

	if (s.minMhz !== "") {
		params.set("min", s.minMhz);
	}

	if (s.maxMhz !== "") {
		params.set("max", s.maxMhz);
	}

	if (s.stationTypes.length > 0) {
		params.set("type", Array.from(s.stationTypes).join(","));
	}

	if (s.serviceTypes.length > 0) {
		params.set("svc", Array.from(s.serviceTypes).join(","));
	}

	if (s.sectors.length > 0) {
		params.set("sector", Array.from(s.sectors).join(","));
	}

	if (s.owner !== "any") {
		params.set("owner", s.owner);
	}

	if (s.activeOnly !== DEFAULT_FILTER.activeOnly) {
		params.set("active", s.activeOnly ? "1" : "0");
	}

	if (s.preciseOnly !== DEFAULT_FILTER.preciseOnly) {
		params.set("precise", s.preciseOnly ? "1" : "0");
	}

	if (s.showDuplicates) {
		params.set("dups", "1");
	}

	if (s.explorerOpen && explorerView) {
		params.set("spectrum", explorerView);
	}

	if (s.panoramaOpen && panoramaAt && !panoramaAt.mine) {
		params.set("pano", panoramaAt.lat.toFixed(5) + "," + panoramaAt.lon.toFixed(5) + "," + s.panoramaRadius);
	}

	return params;
};

const applyFilterQuery = (search) => {
	const params = new URLSearchParams(search);
	const list = (name, allowed, defaults) => {
		if (!params.has(name)) {
			return defaults;
		}

		return params.get(name).split(",").filter((value) => {
			return allowed.includes(value);
		});
	};

	s.query = params.get("q") || "";
	s.kinds = list("kind", Object.keys(KINDS), DEFAULT_FILTER.kinds);
	s.sources = list("src", Object.keys(SOURCES), DEFAULT_FILTER.sources);
	s.band = BANDS.some((band) => {
		return band.id === params.get("band");
	}) ? params.get("band") : DEFAULT_FILTER.band;
	s.minMhz = params.get("min") || "";
	s.maxMhz = params.get("max") || "";
	s.stationTypes = params.has("type") ? params.get("type").split(",").filter(Boolean) : [];
	s.serviceTypes = params.has("svc") ? params.get("svc").split(",").filter(Boolean) : [];
	s.sectors = params.has("sector") ? params.get("sector").split(",").filter(Boolean) : [];
	s.owner = ["public", "private"].includes(params.get("owner")) ? params.get("owner") : "any";
	s.activeOnly = params.has("active") ? params.get("active") === "1" : DEFAULT_FILTER.activeOnly;
	s.preciseOnly = params.has("precise") ? params.get("precise") === "1" : DEFAULT_FILTER.preciseOnly;
	s.showDuplicates = params.get("dups") === "1";
	explorerView = /^[\d.]+,[\d.]+$/.test(params.get("spectrum") || "") ? params.get("spectrum") : "";
	s.explorerOpen = explorerView !== "";

	const pano = (params.get("pano") || "").split(",").map(Number);
	if (pano.length === 3 && pano.every(Number.isFinite)) {
		panoramaAt = { lat: pano[0], lon: pano[1], label: null, mine: false };
		s.panoramaRadius = PANORAMA_RADII.includes(pano[2]) ? pano[2] : s.panoramaRadius;
		s.panoramaOpen = true;
	}
};

const viewParam = () => {
	const center = map.getCenter();
	return map.getZoom().toFixed(2) + "/" + center.lat.toFixed(5) + "/" + center.lng.toFixed(5);
};

// slashes in the map value stay readable: ?map=14.00/44.80167/20.47833
const urlFor = (path) => {
	const params = filterParams();
	params.set("map", viewParam());
	return path + "?" + params.toString().replace(/%2F/g, "/").replace(/%2C/g, ",");
};

const pushPath = (path) => {
	if (location.pathname !== path) {
		history.pushState(null, "", urlFor(path));
	}
};

const replaceUrl = () => {
	history.replaceState(history.state, "", urlFor(location.pathname));
};

const setTitle = (detail) => {
	document.title = detail ? titleOf(detail) + " · " + APP_TITLE : APP_TITLE;
};

// --- selection --------------------------------------------------------------

/**
 * Show a loaded emitter in the details panel
 * @param {Object} detail - From /api/emitters/:id or /api/emitter
 * @param {Object} options
 * @param {boolean} options.push - Add a history entry for it
 * @param {boolean} [options.fly] - Move the map to it
 */
const showDetail = (detail, options) => {
	s.filtersOpen = false;

	if (!s.selection.includes(detail.id)) {
		s.selection = [detail.id];
		s.selectionKey = String(detail.id);
	}

	s.detailId = detail.id;
	s.detail = Object.freeze(detail);
	setSelectedMarker(detail.lat !== null ? detail : null);
	setTitle(detail);

	if (options.fly && detail.lat !== null) {
		map.flyTo({ center: [detail.lon, detail.lat], zoom: Math.max(map.getZoom(), 14), padding: mapPadding(true), speed: 1.6 });
	}

	if (options.push) {
		pushPath(emitterPath(detail));
	}
};

const fetchJson = (url) => {
	return fetch(url).then((response) => {
		if (!response.ok) {
			throw new Error(url + ": " + response.status);
		}

		return response.json();
	});
};

// options.fly: move the map to it (opened from the spectrum, not from the map)
const loadDetail = (id, options) => {
	s.detailId = id;
	s.detail = null;
	setSelectedMarker(data.byId.get(id));

	return fetchJson("/api/emitters/" + id).then((detail) => {
		if (s.detailId === id) {
			showDetail(detail, Object.assign({ push: true }, options));
		}
	});
};

// Open the emitter named by the current URL (shared link, Back/Forward)
const openRoute = (options) => {
	const route = parseRoute();

	if (!route) {
		return Promise.resolve(null);
	}

	return fetchJson("/api/emitter?" + new URLSearchParams({ source: route.source, key: route.key })).then((detail) => {
		showDetail(detail, { push: false, fly: options.fly });
		return detail;
	}).catch(() => {
		history.replaceState(null, "", urlFor("/"));
		setTitle(null);
		return null;
	});
};

const clearSelection = () => {
	s.selection = [];
	s.selectionKey = "";
	s.detailId = null;
	s.detail = null;
	setSelectedMarker(null);
	setTitle(null);
};

const select = (ids) => {
	s.filtersOpen = false;

	if (ids.length === 1) {
		s.selection = ids;
		s.selectionKey = String(ids[0]);
		loadDetail(ids[0]);
		return;
	}

	s.selection = ids;
	s.selectionKey = ids.join(",");
	s.detailId = null;
	s.detail = null;
	setSelectedMarker(ids.length > 0 ? data.byId.get(ids[0]) : null);
	setTitle(null);
	pushPath("/");
};

const closeSelection = () => {
	clearSelection();
	pushPath("/");
};

const backToList = () => {
	s.detailId = null;
	s.detail = null;
	setTitle(null);
	pushPath("/");
};

// Share the current item: native share sheet on touch devices, clipboard elsewhere
const shareLink = (event) => {
	const button = event.currentTarget;
	const url = location.href;

	if (navigator.share && matchMedia("(pointer: coarse)").matches) {
		navigator.share({ title: document.title, url: url }).catch(() => {});
		return;
	}

	navigator.clipboard.writeText(url).then(() => {
		button.dataset.copied = "true";
		setTimeout(() => {
			delete button.dataset.copied;
		}, 1600);
	});
};

const wireMap = () => {
	map.on("contextmenu", (event) => {
		openPanorama({ lat: event.lngLat.lat, lon: event.lngLat.lng, label: null, mine: false });
	});

	const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: "380px" });

	// zoomed in, or a small cluster (often one site listed by several sources): list it instead of zooming
	map.on("click", "clusters", (event) => {
		const feature = event.features[0];
		const source = map.getSource("emitters");
		const count = feature.properties.point_count;

		if (map.getZoom() >= LIST_CLUSTER_ZOOM || count <= LIST_CLUSTER_SIZE) {
			Promise.resolve(source.getClusterLeaves(feature.properties.cluster_id, MAX_LIST, 0)).then((leaves) => {
				select(leaves.map((leaf) => {
					return leaf.properties.id;
				}));
			});
			return;
		}

		Promise.resolve(source.getClusterExpansionZoom(feature.properties.cluster_id)).then((zoom) => {
			map.easeTo({ center: feature.geometry.coordinates, zoom: zoom + 0.2 });
		});
	});

	map.on("click", (event) => {
		const box = [[event.point.x - CLICK_RADIUS, event.point.y - CLICK_RADIUS], [event.point.x + CLICK_RADIUS, event.point.y + CLICK_RADIUS]];
		const clusters = map.queryRenderedFeatures(box, { layers: ["clusters"] });

		if (clusters.length > 0) {
			return;
		}

		const ids = Array.from(new Set(map.queryRenderedFeatures(box, { layers: ["points"] }).map((feature) => {
			return feature.properties.id;
		})));

		if (ids.length > 0) {
			select(ids);
		}
	});

	["clusters", "points"].forEach((layer) => {
		map.on("mouseenter", layer, () => {
			map.getCanvas().style.cursor = "pointer";
		});
		map.on("mouseleave", layer, () => {
			map.getCanvas().style.cursor = "";
			popup.remove();
		});
	});

	map.on("mousemove", "points", (event) => {
		const row = data.byId.get(event.features[0].properties.id);

		if (!row) {
			return;
		}

		const content = el("div", { class: "flex max-w-[360px] items-center gap-2" },
			el("span", { class: "dot", style: "color:" + (KINDS[row.kind] || {}).color }),
			el("span", { class: "truncate font-semibold" }, titleOf(row)),
			row.tx_hz ? el("span", { class: "font-mono text-muted-foreground" }, formatMhz(row.tx_hz)) : null,
			event.features.length > 1 ? el("span", { class: "text-muted-foreground" }, "+" + (event.features.length - 1)) : null);

		popup.setLngLat([row.lon, row.lat]).setDOMContent(content).addTo(map);
	});
};

// --- UI: filter panel -------------------------------------------------------

const section = (title, ...children) => {
	return el("div", { class: "grid gap-2.5" },
		el("div", { class: "text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" }, title),
		...children);
};

const countBy = (key) => {
	return data.rows.reduce((counts, row) => {
		counts[row[key]] = (counts[row[key]] || 0) + 1;
		return counts;
	}, {});
};

const chipGroup = (options, binding, counts) => {
	return ToggleGroup({ type: "multiple", variant: "outline", size: "sm", spacing: 1.5, value: binding, class: "flex flex-wrap justify-start" },
		...Object.keys(options).map((key) => {
			return ToggleGroupItem({
				value: key,
				class: "h-8 gap-2 rounded-full px-3 text-xs data-[state=on]:bg-white/10 data-[state=on]:text-foreground data-[state=off]:opacity-50"
			},
			el("span", { class: "dot", style: "color:" + options[key].color }),
			options[key].label,
			el("span", { class: "font-mono text-[10px] text-muted-foreground" }, formatNumber(counts[key] || 0)));
		}));
};

/**
 * Multi-select of licence codes (station or service types)
 * @param {Object} types - code -> name
 * @param {string} column - Row column holding the code
 * @param {Array} binding - [state, key]
 * @param {string} placeholder
 */
const codePicker = (types, column, binding, placeholder) => {
	const counts = countBy(column);
	const codes = Object.keys(types).filter((code) => {
		return counts[code];
	}).sort((a, b) => {
		return counts[b] - counts[a];
	});
	const labelOf = (code) => {
		return code + " · " + types[code];
	};

	return Combobox({ multiple: true, autoHighlight: true, items: codes, value: binding, itemToStringLabel: labelOf },
		ComboboxChips({ class: "w-full min-h-9 bg-transparent" },
			ComboboxValue((values) => {
				return values.map((value) => {
					return ComboboxChip({ value: value, title: types[value] }, value);
				});
			}),
			ComboboxChipsInput({ placeholder: placeholder })),
		ComboboxContent(
			ComboboxEmpty("No station type found."),
			ComboboxList((code) => {
				return ComboboxItem({ value: code, label: labelOf(code) },
					el("span", { class: "font-mono text-xs text-primary w-7" }, code),
					el("span", { class: "flex-1 truncate" }, types[code]),
					el("span", { class: "font-mono text-[10px] text-muted-foreground" }, formatNumber(counts[code])));
			})));
};

const SECTOR_COLORS = {
	"emergency": "#f87171", "health": "#fb7185", "justice": "#c084fc", "government": "#818cf8",
	"aviation": "#38bdf8", "rail-road-water": "#2dd4bf", "public-transport": "#a3e635", "energy": "#facc15",
	"utilities": "#4ade80", "telecom": "#60a5fa", "security": "#f97316", "industry": "#a8a29e", "other": "#94a3b8"
};

// No chip selected = any sector
const sectorChips = () => {
	const counts = countBy("sector");

	return ToggleGroup({ type: "multiple", variant: "outline", size: "sm", spacing: 1.5, value: [s, "sectors"], class: "flex flex-wrap justify-start" },
		...data.lookups.sectors.map((sector) => {
			return ToggleGroupItem({
				value: sector.id,
				class: "h-8 gap-2 rounded-full px-3 text-xs data-[state=on]:bg-white/10 data-[state=on]:text-foreground"
			},
			el("span", { class: "dot", style: "color:" + (SECTOR_COLORS[sector.id] || "#94a3b8") }),
			sector.label,
			el("span", { class: "font-mono text-[10px] text-muted-foreground" }, formatNumber(counts[sector.id] || 0)));
		}));
};

const ownerToggle = () => {
	return ToggleGroup({ type: "single", variant: "outline", size: "sm", spacing: 0, value: [s, "owner"], class: "w-full" },
		...[["any", "Any"], ["public", "Public sector"], ["private", "Private"]].map((option) => {
			return ToggleGroupItem({ value: option[0], class: "h-8 flex-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground" }, option[1]);
		}));
};

// --- UI: MCP dialog -----------------------------------------------------------

const MCP_NAME = "sigint-srbija";
const MCP_DOCS = "https://github.com/nemanjan00/sigint-srbija/blob/main/docs/mcp.md";

// Setup per client; the endpoint is this site's own /mcp
const mcpClients = (url) => {
	return [
		{ label: "Claude Code", hint: "Add --scope user to have it in every project.", code: "claude mcp add --transport http " + MCP_NAME + " " + url },
		{ label: "Codex CLI", code: "codex mcp add " + MCP_NAME + " --url " + url },
		{ label: "VS Code", code: "code --add-mcp '" + JSON.stringify({ name: MCP_NAME, type: "http", url: url }) + "'" },
		{ label: "Cursor", hint: "~/.cursor/mcp.json", code: JSON.stringify({ mcpServers: { [MCP_NAME]: { url: url } } }, null, 2) },
		{ label: "Claude Desktop / claude.ai", hint: "Settings → Connectors → Add custom connector, with this URL.", code: url },
		{ label: "Local-only (stdio) clients", hint: "Bridged with mcp-remote.", code: JSON.stringify({ mcpServers: { [MCP_NAME]: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2) }
	];
};

const copyBlock = (code) => {
	return el("div", { class: "group/code relative min-w-0" },
		el("pre", { class: "whitespace-pre-wrap break-all rounded-lg border border-white/5 bg-black/40 py-2.5 pl-3 pr-16 text-[12px] leading-relaxed text-foreground" }, code),
		Button({
			variant: "ghost",
			size: "sm",
			class: "group/copy absolute right-1.5 top-1.5 h-7 px-2 text-[11px] text-muted-foreground data-[copied=true]:text-primary",
			onclick: (event) => {
				const button = event.currentTarget;
				navigator.clipboard.writeText(code).then(() => {
					button.dataset.copied = "true";
					setTimeout(() => {
						delete button.dataset.copied;
					}, 1600);
				});
			}
		},
		el("span", { class: "group-data-[copied=true]/copy:hidden" }, "Copy"),
		el("span", { class: "hidden group-data-[copied=true]/copy:inline" }, "Copied")));
};

const mcpDialog = () => {
	const url = location.origin + "/mcp";

	return Dialog(
		DialogTrigger(Button({ variant: "outline", size: "sm", class: "h-8 gap-1.5 rounded-full border-primary/30 px-3 text-xs text-primary hover:bg-primary/10", title: "Use this database from an AI assistant" },
			el("span", { class: "dot !size-1.5" }), "MCP")),
		// grid items default to min-width: auto, so long commands would widen the dialog
		DialogContent({ class: "thin-scroll max-h-[90dvh] overflow-y-auto sm:max-w-[560px] [&>*]:min-w-0" },
			DialogHeader(
				DialogTitle("Search this map from your AI assistant"),
				DialogDescription("A public, read-only MCP server. No key needed. Ask things like “what's on 145.600 MHz?” or “70 cm repeaters near Kragujevac”.")),
			el("div", { class: "grid gap-1.5" },
				el("div", { class: "text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" }, "Endpoint (Streamable HTTP)"),
				copyBlock(url)),
			...mcpClients(url).slice(0, 5).map((client) => {
				return el("div", { class: "grid gap-1.5" },
					el("div", { class: "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5" },
						el("span", { class: "text-sm font-medium" }, client.label),
						client.hint ? el("span", { class: "text-[11px] text-muted-foreground" }, client.hint) : null),
					copyBlock(client.code));
			}),
			el("details", { class: "group grid gap-1.5" },
				el("summary", { class: "flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground hover:text-foreground" },
					ChevronRightIcon({ class: "size-3.5 transition-transform group-open:rotate-90" }), "Clients that only run local servers"),
				el("div", { class: "mt-2" }, copyBlock(mcpClients(url)[5].code))),
			el("div", { class: "flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs text-muted-foreground" },
				el("span", {}, "Tools: search_emitters · find_frequency · get_emitter · database_info"),
				el("a", { href: MCP_DOCS, target: "_blank", rel: "noreferrer", class: "text-primary hover:underline" }, "Docs ↗"))));
};

const resetFilters = () => {
	s.query = "";
	s.sources = Object.keys(SOURCES);
	s.kinds = Object.keys(KINDS);
	s.band = "all";
	s.minMhz = "";
	s.maxMhz = "";
	s.stationTypes = [];
	s.serviceTypes = [];
	s.sectors = [];
	s.owner = "any";
	s.activeOnly = true;
	s.preciseOnly = false;
	s.showDuplicates = false;
};

const switchRow = (id, label, hint, binding) => {
	return el("div", { class: "flex items-center justify-between gap-3" },
		el("div", { class: "grid gap-0.5" },
			Label({ for: id, class: "text-sm" }, label),
			el("span", { class: "text-xs text-muted-foreground" }, hint)),
		Switch({ id: id, checked: binding }));
};

const searchBox = (id) => {
	return el("div", { class: "relative" },
		SearchIcon({ class: "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" }),
		Input({
			id: id,
			placeholder: "Callsign, operator, site…",
			bind: [s, "query"],
			class: "h-10 pl-9 pr-9 bg-black/20 text-base md:text-sm"
		}),
		when(() => s.query !== "", () => {
			return Button({
				variant: "ghost",
				size: "icon",
				class: "absolute right-1 top-1/2 size-8 -translate-y-1/2",
				onclick: () => {
					s.query = "";
				},
				"aria-label": "Clear search"
			}, XIcon({ class: "size-4" }));
		}));
};

const filterPanel = () => {
	const sourceCounts = countBy("source");
	const kindCounts = countBy("kind");

	return el("aside", {
		class: () => "panel thin-scroll absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl " +
			"md:inset-x-auto md:left-4 md:top-4 md:bottom-4 md:max-h-none md:w-[360px] md:rounded-2xl" + (s.filtersOpen ? "" : " max-md:hidden")
	},
	el("div", { class: "mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20 md:hidden" }),
	el("header", { class: "sticky top-0 z-10 grid gap-3 border-b border-white/5 bg-[color-mix(in_oklch,var(--card)_85%,transparent)] p-5 backdrop-blur-xl" },
		el("div", { class: "grid" },
			el("h1", { class: "glow-text text-lg font-bold tracking-tight" }, "SIGINT Srbija"),
			el("span", { class: "text-xs text-muted-foreground" }, "Public signal sources in Serbia")),
		el("div", { class: "flex flex-wrap items-center gap-1" },
			Button({ variant: "outline", size: "sm", class: "h-7 rounded-full px-3 text-xs", onclick: () => {
				openExplorer(s.detail ? selectionOf(s.detail) : null);
			} }, "Spectrum"),
			Button({ variant: "outline", size: "sm", class: "h-7 rounded-full px-3 text-xs", title: "RF panorama around your location (AR with the camera on phones)", onclick: openAroundMe }, "Around me"),
			mcpDialog(),
			Button({ variant: "ghost", size: "sm", class: "ml-auto text-xs text-muted-foreground", onclick: resetFilters }, "Reset")),
		el("div", { class: "flex items-baseline gap-1.5" },
			el("span", { class: "font-mono text-2xl font-semibold text-foreground" }, () => formatNumber(s.shown)),
			el("span", { class: "text-sm text-muted-foreground" }, () => "of " + formatNumber(s.total) + " on the map")),
		el("div", { class: "max-md:hidden" }, searchBox("search"))),
	el("div", { class: "grid gap-6 p-5" },
		section("Kind", chipGroup(KINDS, [s, "kinds"], kindCounts)),
		section("Source", chipGroup(SOURCES, [s, "sources"], sourceCounts)),
		section("Band",
			ToggleGroup({ type: "single", variant: "outline", size: "sm", spacing: 1.5, value: [s, "band"], class: "flex flex-wrap justify-start", onValueChange: () => {
				s.minMhz = "";
				s.maxMhz = "";
			} },
			...BANDS.map((band) => {
				return ToggleGroupItem({ value: band.id, class: "h-8 rounded-full px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground" }, band.label);
			})),
			el("div", { class: "flex items-center gap-2" },
				Input({ bind: [s, "minMhz"], type: "number", step: "any", placeholder: "min MHz", class: "h-9 font-mono text-xs bg-black/20" }),
				el("span", { class: "text-muted-foreground" }, "–"),
				Input({ bind: [s, "maxMhz"], type: "number", step: "any", placeholder: "max MHz", class: "h-9 font-mono text-xs bg-black/20" }))),
		el("div", { class: "grid gap-4 rounded-xl border border-white/5 bg-black/10 p-3.5" },
			el("div", { class: "flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" },
				el("span", { class: "dot !size-2", style: "color:" + KINDS.licence.color }), "Licences"),
			section("Holder", ownerToggle()),
			section("Sector", el("span", { class: "-mt-1 text-xs text-muted-foreground" }, "Guessed from the holder's name. Police and military are not in the public register."), sectorChips()),
			section("Station type", codePicker(data.lookups.stationTypes, "station_type", [s, "stationTypes"], "Any station type")),
			section("Service", codePicker(data.lookups.serviceTypes, "service_type", [s, "serviceTypes"], "Any service"))),
		Separator({ class: "bg-white/5" }),
		el("div", { class: "grid gap-4" },
			switchRow("active-only", "Valid licences only", "Hide expired RATEL licences and broadcast assignments", [s, "activeOnly"]),
			switchRow("precise-only", "Precise positions only", "Hide city-level / grid-square guesses", [s, "preciseOnly"]),
			switchRow("show-duplicates", "Show every listing", "One pin per source instead of one per station", [s, "showDuplicates"])),
		Separator({ class: "bg-white/5" }),
		section("Data",
			el("div", { class: "grid gap-1.5 text-xs" },
				...data.sources.map((source) => {
					const meta = SOURCES[source.id] || { label: source.id, color: "#94a3b8" };
					return el("a", { href: source.url, target: "_blank", rel: "noreferrer", class: "flex items-center gap-2 rounded-md px-1 py-0.5 text-muted-foreground hover:text-foreground" },
						el("span", { class: "dot", style: "color:" + meta.color }),
						el("span", { class: "flex-1" }, meta.label),
						el("span", { class: "font-mono text-[10px]" }, (source.fetched_at || "").slice(0, 10)));
				})))),
	el("div", { class: "sticky bottom-0 border-t border-white/5 bg-[color-mix(in_oklch,var(--card)_92%,transparent)] p-3 md:hidden" },
		Button({ class: "h-11 w-full text-sm", onclick: () => {
			s.filtersOpen = false;
		} }, () => "Show " + formatNumber(s.shown) + " on the map")));
};

// --- UI: details panel ------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

// lucide "link" (ISC)
const LinkIcon = () => {
	const svg = document.createElementNS(SVG_NS, "svg");
	[["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["class", "size-3.5"]].forEach((attribute) => {
		svg.setAttribute(attribute[0], attribute[1]);
	});
	["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"].forEach((d) => {
		const pathNode = document.createElementNS(SVG_NS, "path");
		pathNode.setAttribute("d", d);
		svg.appendChild(pathNode);
	});
	return svg;
};

const field = (label, value, options) => {
	if (value === null || value === undefined || value === "") {
		return null;
	}

	return el("div", { class: "grid grid-cols-[110px_1fr] gap-3 py-1.5 text-sm" },
		el("span", { class: "text-muted-foreground" }, label),
		el("span", { class: (options && options.mono ? "font-mono text-[13px] " : "") + "break-words" }, value));
};

const badge = (text, color) => {
	return Badge({ variant: "outline", class: "gap-1.5 rounded-full border-white/10 bg-white/5 font-normal" },
		color ? el("span", { class: "dot !size-1.5", style: "color:" + color }) : null, text);
};

const copyButton = (text) => {
	return Button({
		variant: "ghost",
		size: "sm",
		class: "h-6 px-2 text-[11px] text-muted-foreground",
		onclick: (event) => {
			navigator.clipboard.writeText(text);
			event.currentTarget.textContent = "Copied";
		}
	}, "Copy");
};

const CORRECTION_LABELS = {
	"swapped": "latitude and longitude were swapped",
	"lon-1": "longitude was 1° too far east",
	"lon+1": "longitude was 1° too far west",
	"lon+10": "longitude was 10° too far west",
	"lon-10": "longitude was 10° too far east",
	"lat-1": "latitude was 1° too far north",
	"lat+1": "latitude was 1° too far south"
};

const coordinateSourceLabel = (row) => {
	if (row.coord_source === "source") {
		return "published by source";
	}

	if (row.coord_source === "source:geocoded:address") {
		return "geocoded from the registered address (OpenStreetMap)";
	}

	if (row.coord_source === "source:geocoded:place") {
		return "geocoded from the registered place (OpenStreetMap), street not found";
	}

	if (row.coord_source && row.coord_source.startsWith("source:corrected:")) {
		const published = row.raw && row.raw.published_position;
		const fix = CORRECTION_LABELS[row.coord_source.split(":")[2]] || row.coord_source;
		return "corrected — published position was outside Serbia (" + fix + ")" + (published ? "; published " + published.lat.toFixed(6) + ", " + published.lon.toFixed(6) : "");
	}

	return row.coord_source;
};

const frequencyBlock = (detail) => {
	const tile = (label, low, high) => {
		return el("div", { class: "grid gap-0.5 rounded-xl border border-white/5 bg-black/25 px-3 py-2.5" },
			el("span", { class: "text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground" }, label),
			el("span", { class: "font-mono text-lg font-medium text-foreground" }, formatRange(low, high)),
			el("span", { class: "text-[10px] text-muted-foreground" }, low ? "MHz" : ""));
	};
	const shift = detail.tx_hz && detail.rx_hz && detail.tx_hz !== detail.rx_hz ? (detail.rx_hz - detail.tx_hz) / 1e6 : null;

	return el("div", { class: "grid gap-2" },
		el("div", { class: "grid grid-cols-2 gap-2" }, tile("TX", detail.tx_hz, detail.tx_high_hz), tile("RX", detail.rx_hz, detail.rx_high_hz)),
		shift !== null ? el("div", { class: "text-xs text-muted-foreground" }, "Shift ", el("span", { class: "font-mono text-foreground" }, (shift > 0 ? "+" : "") + shift.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + " MHz")) : null);
};

// --- spectrum: band plan, listening hints, interactive explorer ------------

const USER_COLORS = {
	"Police (MUP)": "#60a5fa",
	"Emergency services": "#f87171",
	"Military": "#a3e635",
	"Security agency (BIA)": "#c084fc",
	"Anyone": "#94a3b8"
};
// Show the emitter's whole band when it is at most this many signal widths wide
const MAX_BAND_SIGNALS = 1000;
const FOCUS_SPAN_SIGNALS = 400;

const useName = (use) => {
	return use.en || use.application || "Unspecified";
};

let bandplanRequest = null;

const loadBandplan = () => {
	if (!bandplanRequest) {
		bandplanRequest = fetchJson("/api/bandplan");
	}

	return bandplanRequest;
};

// Signals drawn in the explorers: what the map shows (filters apply)
const visibleRows = () => {
	return data.visible || data.rows;
};

// One explorer lives in the details panel and moves with it; created on first use
let panelExplorer = null;

const explorerFor = (plan) => {
	if (!panelExplorer) {
		panelExplorer = createSpectrum({ plan: plan, kinds: KINDS, onOpen: (id) => {
			loadDetail(id, { fly: true });
		} });
		panelExplorer.setSignals(visibleRows());
	}

	return panelExplorer;
};

// Emitter as a highlighted span on the explorer
const selectionOf = (detail) => {
	const width = detail.spectrum && detail.spectrum.bandwidth ? detail.spectrum.bandwidth.hz : 12500;
	const hasRange = detail.tx_high_hz && detail.tx_high_hz > detail.tx_hz;
	const centre = hasRange ? (detail.tx_hz + detail.tx_high_hz) / 2 : detail.tx_hz;
	const half = hasRange ? (detail.tx_high_hz - detail.tx_hz) / 2 : width / 2;

	return { low: centre - half, high: centre + half, centre: centre, width: hasRange ? half * 2 : width, rx: detail.rx_hz && detail.rx_hz !== detail.tx_hz ? detail.rx_hz : null };
};

// Start on the emitter's band, or around the emitter when the band is huge
const focusOn = (explorer, selection) => {
	const band = explorer.bandAt(selection.centre);

	if (band && band.high_hz - band.low_hz <= selection.width * MAX_BAND_SIGNALS) {
		explorer.showBand(band);
	} else {
		explorer.centre(selection.centre, selection.width * FOCUS_SPAN_SIGNALS);
	}
};

const explorerSlot = (detail) => {
	const slot = el("div", { class: "h-56 w-full" });

	loadBandplan().then((plan) => {
		const explorer = explorerFor(plan);
		const selection = selectionOf(detail);

		slot.appendChild(explorer.element);
		explorer.setSelected(selection);
		focusOn(explorer, selection);
	});

	return slot;
};

const useRow = (use) => {
	return el("div", { class: "grid gap-1 rounded-lg border border-white/5 bg-black/20 px-3 py-2" },
		el("div", { class: "flex flex-wrap items-center gap-1.5 text-sm" },
			el("span", { class: "font-medium" }, useName(use)),
			...use.users.map((user) => {
				return badge(user, USER_COLORS[user]);
			})),
		use.en && use.application && !fold(use.en).startsWith(fold(use.application)) ? el("span", { class: "text-[11px] text-muted-foreground" }, use.application) : null,
		use.condition ? el("span", { class: "text-xs text-muted-foreground" }, use.condition) : null,
		use.licensing_en.length ? el("span", { class: "text-[11px] text-muted-foreground" }, use.licensing_en.join(" / ")) : null);
};

const SubHeading = (text) => {
	return el("div", { class: "text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" }, text);
};

const spectrumBlock = (detail) => {
	const spectrum = detail.spectrum;

	if (!spectrum || !spectrum.band) {
		return null;
	}

	const band = spectrum.band;
	const here = band.uses.filter((use) => {
		return use.here && !use.background;
	});
	const elsewhere = band.uses.filter((use) => {
		return !use.here || use.background;
	});

	return el("div", { class: "grid gap-4" },
		spectrum.hints.length ? el("div", { class: "grid gap-1.5" },
			SubHeading("Likely to hear"),
			el("ul", { class: "grid gap-1 text-sm" },
				...spectrum.hints.map((hint, index) => {
					return el("li", { class: "flex gap-2 " + (index === 0 ? "text-foreground" : "text-muted-foreground") },
						el("span", { class: "mt-1.5 size-1.5 flex-none rounded-full bg-primary/70" }), hint);
				})),
			spectrum.bandwidth ? el("span", { class: "text-xs text-muted-foreground" }, "Bandwidth ",
				el("span", { class: "font-mono text-foreground" }, (spectrum.bandwidth.how === "licensed block" ? "" : "~") + formatHz(spectrum.bandwidth.hz)),
				" · " + spectrum.bandwidth.how) : null) : null,
		el("div", { class: "grid gap-2" },
			el("div", { class: "flex items-center justify-between gap-2" },
				SubHeading("Spectrum"),
				Button({ variant: "ghost", size: "sm", class: "h-6 px-2 text-[11px] text-muted-foreground", onclick: () => {
					openExplorer(selectionOf(detail));
				} }, "Expand ↗")),
			explorerSlot(detail),
			el("span", { class: "text-[11px] text-muted-foreground" }, "Scroll or pinch to zoom, drag to pan. Click a band to fit it, a signal to open it."),
			el("div", { class: "flex items-baseline justify-between gap-2 pt-1" }, SubHeading("Band"), el("span", { class: "font-mono text-xs text-muted-foreground" }, band.label)),
			el("div", { class: "flex flex-wrap gap-1.5" },
				...band.services.map((service) => {
					return Badge({
						variant: "outline",
						class: "rounded-full border-white/10 font-normal " + (service.primary ? "bg-white/10 text-foreground" : "bg-transparent text-muted-foreground"),
						title: service.name + (service.primary ? " (primary)" : " (secondary)")
					}, service.primary ? service.en.toUpperCase() : service.en.charAt(0).toUpperCase() + service.en.slice(1));
				}))),
		el("div", { class: "grid gap-1.5" },
			SubHeading("Band plan at this frequency"),
			...(here.length ? here.map(useRow) : [el("span", { class: "text-sm text-muted-foreground" }, "No specific use listed")]),
			elsewhere.length ? el("details", { class: "group grid gap-1.5" },
				el("summary", { class: "flex cursor-pointer list-none items-center gap-2 py-1 text-xs text-muted-foreground hover:text-foreground" },
					ChevronRightIcon({ class: "size-3.5 transition-transform group-open:rotate-90" }), "Other uses in this band (" + elsewhere.length + ")"),
				el("div", { class: "grid gap-1.5 pt-1" }, ...elsewhere.map(useRow))) : null,
			el("span", { class: "text-[11px] text-muted-foreground" },
				"Source: ",
				el("a", { class: "text-primary hover:underline", href: spectrum.plan.url, target: "_blank", rel: "noreferrer" }, "RATEL band plan, Table 1"),
				spectrum.plan.date ? " (" + spectrum.plan.date + ")" : "",
				band.footnotes.length ? " · notes " + band.footnotes.join(", ") : "")));
};

// RATEL registers other than reg203: cell site bands, link radio parameters
const cellBlock = (detail) => {
	const raw = detail.raw || {};

	if (detail.kind !== "cell" || !raw.stations) {
		return null;
	}

	const byBand = raw.stations.reduce((result, station) => {
		result[station.band] = (result[station.band] || []).concat([station.technology]);
		return result;
	}, {});

	return el("div", { class: "grid gap-1.5" },
		SubHeading("Registered radio stations (" + raw.stations.length + ")"),
		el("div", { class: "overflow-hidden rounded-lg border border-white/5" },
			el("table", { class: "w-full text-xs" },
				el("thead", { class: "bg-white/5 text-muted-foreground" },
					el("tr", {}, el("th", { class: "px-2 py-1.5 text-left font-medium" }, "Band"), el("th", { class: "px-2 py-1.5 text-left font-medium" }, "Technology"))),
				el("tbody", {},
					...Object.keys(byBand).sort((a, b) => {
						return Number(a) - Number(b);
					}).map((band) => {
						return el("tr", { class: "border-t border-white/5" },
							el("td", { class: "px-2 py-1 font-mono" }, band + " MHz"),
							el("td", { class: "px-2 py-1" }, byBand[band].join(", ")));
					})))),
		el("span", { class: "text-[11px] text-muted-foreground" }, "Register ids " + raw.ids.join(", ")));
};

const linkBlock = (detail) => {
	const raw = detail.raw || {};

	if (detail.kind !== "link") {
		return null;
	}

	const unit = (value, suffix) => {
		return value === null || value === undefined ? null : value + " " + suffix;
	};

	return el("div", { class: "grid gap-1" },
		SubHeading(raw.type === "E-band link" ? "E-band link (end " + raw.end + ")" : "RLAN station"),
		field("Band", raw.band || (raw.frequency_mhz ? raw.frequency_mhz + " MHz" : null), { mono: true }),
		field("Bandwidth", unit(raw.bandwidth_mhz, "MHz"), { mono: true }),
		field("Configuration", raw.configuration),
		field("Power", [unit(raw.power_dbm, "dBm"), raw.eirp_dbm !== undefined && raw.eirp_dbm !== null ? "EIRP " + raw.eirp_dbm + " dBm" : null].filter(Boolean).join(" · "), { mono: true }),
		field("Capacity", unit(raw.capacity_mbit, "Mbit/s"), { mono: true }),
		field("Azimuth", unit(raw.azimuth, "°"), { mono: true }),
		field("Equipment", raw.equipment),
		field("Antenna", [raw.antenna, unit(raw.antenna_gain_dbi === undefined ? raw.antenna_gain : raw.antenna_gain_dbi, "dBi"), raw.antenna_height_m ? raw.antenna_height_m + " m above ground" : null, raw.polarization ? "pol. " + raw.polarization : null].filter(Boolean).join(" · ")),
		field("Other end", raw.partner ? raw.partner.lat.toFixed(5) + ", " + raw.partner.lon.toFixed(5) : null, { mono: true }),
		field("Registered", raw.registered, { mono: true }),
		el("span", { class: "text-[11px] text-muted-foreground" }, "Applicant, address, SSID and MAC are in the register but not collected here."));
};

const licenceBlock = (detail) => {
	const row = detail.detail;

	if (!row) {
		return null;
	}

	return el("div", { class: "grid gap-1" },
		el("div", { class: "mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" }, "Licence"),
		el("div", { class: "grid grid-cols-[110px_1fr] items-center gap-3 py-1.5 text-sm" },
			el("span", { class: "text-muted-foreground" }, "Number"),
			el("div", { class: "flex flex-wrap items-center gap-2" },
				el("span", { class: "font-mono text-[13px]" }, row.broj_dozvole),
				// the register's own entry (holder, site, frequencies) — the source of this record
				detail.record_url ? el("a", { class: "text-[11px] text-primary hover:underline", target: "_blank", rel: "noreferrer", href: detail.record_url }, "View in RATEL register ↗") : null)),
		// enriched rows have name and address separately; otherwise show the register's combined text
		field("Holder", row.enriched ? row.nosilac_naziv : row.nosilac),
		field("Holder address", row.enriched ? row.nosilac_adresa : null),
		field("Station", row.vrsta_stanice ? row.vrsta_stanice + " · " + (row.vrsta_stanice_naziv || "") : null),
		field("Service", row.vrsta_sluzbe ? row.vrsta_sluzbe + " · " + (row.vrsta_sluzbe_naziv || "") : null),
		field("Description", row.vrsta_opis),
		field("Valid", [row.vazi_od, row.rok_trajanja].filter(Boolean).join(" → "), { mono: true }),
		field("Status", row.status ? row.status + (row.status_datum ? " (" + row.status_datum + ")" : "") + (row.razlog ? " · " + row.razlog : "") : "Valid"),
		field("Inspection", row.tehnicki_pregled, { mono: true }),
		field("In use since", row.datum_pocetka, { mono: true }),
		field("Datum", row.koord_sistem),
		detail.licence && detail.licence.length > 1 ? el("div", { class: "mt-3 grid gap-1" },
			el("div", { class: "text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" }, "All assignments on this licence (" + detail.licence.length + ")"),
			el("div", { class: "overflow-hidden rounded-lg border border-white/5" },
				el("table", { class: "w-full text-xs" },
					el("thead", { class: "bg-white/5 text-muted-foreground" },
						el("tr", {}, el("th", { class: "px-2 py-1.5 text-left font-medium" }, "TX"), el("th", { class: "px-2 py-1.5 text-left font-medium" }, "RX"), el("th", { class: "px-2 py-1.5 text-left font-medium" }, "Site"))),
					el("tbody", {},
						...detail.licence.map((assignment) => {
							const current = assignment.id === row.id;
							return el("tr", { class: "border-t border-white/5 " + (current ? "bg-primary/10 text-foreground" : "text-muted-foreground") + (assignment.vazeca ? "" : " line-through opacity-60") },
								el("td", { class: "px-2 py-1 font-mono" }, assignment.tx_freq_raw || "—"),
								el("td", { class: "px-2 py-1 font-mono" }, assignment.rx_freq_raw || "—"),
								el("td", { class: "px-2 py-1" }, assignment.lokacija || ""));
						}))))) : null);
};

const rawBlock = (raw) => {
	if (!raw) {
		return null;
	}

	return el("details", { class: "group rounded-xl border border-white/5 bg-black/20" },
		el("summary", { class: "flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground" },
			ChevronRightIcon({ class: "size-3.5 transition-transform group-open:rotate-90" }), "Source record"),
		el("pre", { class: "thin-scroll max-h-72 overflow-auto px-3 pb-3 text-[11px] leading-relaxed text-muted-foreground" }, JSON.stringify(raw, null, 2)));
};

// Other sources' listings of the same station; differing frequencies are highlighted
const listingsBlock = (detail) => {
	if (!detail.listings || detail.listings.length === 0) {
		return null;
	}

	const differs = (a, b) => {
		return a !== null && b !== null && a !== b;
	};

	return el("div", { class: "grid gap-1.5" },
		el("div", { class: "text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground" }, "Also listed by"),
		...detail.listings.map((listing) => {
			const source = SOURCES[listing.source] || { label: listing.source, color: "#94a3b8" };
			const txDiffers = differs(listing.tx_hz, detail.tx_hz);
			const rxDiffers = differs(listing.rx_hz, detail.rx_hz);

			return el("button", {
				class: "group grid w-full gap-1 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-left hover:border-white/15",
				onclick: () => {
					loadDetail(listing.id);
				}
			},
			el("div", { class: "flex items-center gap-2 text-sm" },
				el("span", { class: "dot !size-2", style: "color:" + source.color }),
				el("span", { class: "flex-1 font-medium" }, source.label),
				listing.duplicate_of === null ? el("span", { class: "text-[10px] uppercase tracking-wider text-muted-foreground" }, "main listing") : null,
				ChevronRightIcon({ class: "size-4 text-muted-foreground opacity-0 group-hover:opacity-100" })),
			el("div", { class: "flex flex-wrap gap-x-4 font-mono text-xs text-muted-foreground" },
				el("span", { class: txDiffers ? "text-amber-400" : "" }, "TX " + formatMhz(listing.tx_hz)),
				el("span", { class: rxDiffers ? "text-amber-400" : "" }, "RX " + formatMhz(listing.rx_hz)),
				listing.callsign && listing.callsign !== detail.callsign ? el("span", {}, listing.callsign) : null),
			txDiffers || rxDiffers ? el("span", { class: "text-[11px] text-amber-400/90" }, "Frequency differs from this listing — one of the sources has a typo") : null);
		}));
};

const sectorLabel = (id) => {
	const sector = data.lookups.sectors.find((candidate) => {
		return candidate.id === id;
	});

	return sector ? sector.label : id;
};

const detailView = (detail) => {
	const kind = KINDS[detail.kind] || { label: detail.kind, color: "#94a3b8" };
	const source = SOURCES[detail.source] || { label: detail.source, color: "#94a3b8" };
	const coordinates = detail.lat !== null ? detail.lat.toFixed(6) + ", " + detail.lon.toFixed(6) : null;

	return el("div", { class: "grid gap-5" },
		el("div", { class: "grid gap-2" },
			el("div", { class: "flex items-start gap-3" },
				el("span", { class: "dot mt-2 !size-3", style: "color:" + kind.color }),
				el("div", { class: "grid min-w-0 gap-0.5" },
					el("h2", { class: "line-clamp-3 text-xl font-semibold leading-tight tracking-tight break-words", title: titleOf(detail) }, titleOf(detail)),
					el("span", { class: "text-sm text-muted-foreground" }, [detail.city, detail.location].filter(Boolean).filter((value, index, all) => {
						return all.indexOf(value) === index;
					}).join(" · ") || " "))),
			el("div", { class: "flex flex-wrap gap-1.5" },
				badge(kind.label.replace(/s$/, ""), kind.color),
				detail.mode ? badge(detail.mode) : null,
				badge(source.label, source.color),
				detail.kind === "licence" && detail.sector ? badge(sectorLabel(detail.sector), SECTOR_COLORS[detail.sector]) : null,
				detail.kind === "licence" && detail.owner ? badge(detail.owner === "public" ? "Public sector" : "Private") : null,
				detail.active === 0 ? Badge({ variant: "destructive", class: "rounded-full" }, "Expired") : null)),
		frequencyBlock(detail),
		el("div", { class: "grid" },
			field(detail.kind === "licence" ? "Transmitter site" : "Site", detail.location),
			field(detail.kind === "broadcast" ? "Identification" : "Callsign", detail.callsign || (detail.kind === "licence" ? "not published in the register" : null), { mono: Boolean(detail.callsign) }),
			field("DMR ID", detail.dmr_id, { mono: true }),
			field("Name", detail.name && detail.name !== detail.callsign ? detail.name : null),
			field("Operator", detail.source !== "ratel-reg203" ? detail.operator : null),
			field("Locator", detail.locator, { mono: true }),
			coordinates ? el("div", { class: "grid grid-cols-[110px_1fr] items-center gap-3 py-1.5 text-sm" },
				el("span", { class: "text-muted-foreground" }, "Position"),
				el("div", { class: "flex flex-wrap items-center gap-1" },
					el("span", { class: "font-mono text-[13px]" }, coordinates),
					copyButton(coordinates),
					el("a", { class: "text-[11px] text-primary hover:underline", target: "_blank", rel: "noreferrer", href: "https://www.openstreetmap.org/?mlat=" + detail.lat + "&mlon=" + detail.lon + "#map=15/" + detail.lat + "/" + detail.lon }, "OSM ↗"),
					Button({ variant: "ghost", size: "sm", class: "h-6 px-2 text-[11px] text-primary", onclick: () => {
						openPanorama({ lat: detail.lat, lon: detail.lon, label: titleOf(detail), mine: false });
					} }, "Panorama from here"))) : null,
			field("Position from", coordinateSourceLabel(detail) + (detail.coord_accuracy_m ? " · ±" + formatNumber(detail.coord_accuracy_m) + " m" : ""))),
		listingsBlock(detail),
		spectrumBlock(detail),
		cellBlock(detail),
		linkBlock(detail),
		licenceBlock(detail),
		rawBlock(detail.raw));
};

const listView = () => {
	const rows = s.selection.map((id) => {
		return data.byId.get(id);
	}).filter(Boolean).sort((a, b) => {
		return (a.tx_hz || 0) - (b.tx_hz || 0);
	});

	return el("div", { class: "grid gap-3" },
		el("div", { class: "grid gap-0.5" },
			el("h2", { class: "text-lg font-semibold tracking-tight" }, rows.length + " emitters here"),
			el("span", { class: "text-sm text-muted-foreground" }, rows[0] ? rows[0].location || "" : "")),
		el("div", { class: "grid gap-1" },
			...rows.map((row) => {
				const kind = KINDS[row.kind] || { color: "#94a3b8" };
				return el("button", {
					class: "group flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left hover:border-white/10 hover:bg-white/5",
					onclick: () => {
						loadDetail(row.id);
					}
				},
				el("span", { class: "dot", style: "color:" + kind.color }),
				el("div", { class: "grid min-w-0 flex-1" },
					el("span", { class: "truncate text-sm font-medium" }, titleOf(row)),
					el("span", { class: "truncate text-xs text-muted-foreground" }, [row.station_type, row.active === 0 ? "expired" : null].filter(Boolean).join(" · ") || (SOURCES[row.source] || {}).label)),
				el("span", { class: "font-mono text-xs text-muted-foreground" }, formatMhz(row.tx_hz)),
				ChevronRightIcon({ class: "size-4 text-muted-foreground opacity-0 group-hover:opacity-100" }));
			})));
};

const detailPanel = () => {
	return when(() => s.selection.length > 0, () => {
		return el("aside", { class: "panel thin-scroll absolute inset-x-0 bottom-0 flex max-h-[70dvh] flex-col overflow-y-auto rounded-t-2xl md:inset-x-auto md:right-4 md:top-4 md:bottom-4 md:max-h-none md:w-[420px] md:rounded-2xl" },
			el("div", { class: "sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-[color-mix(in_oklch,var(--card)_85%,transparent)] px-3 py-2 backdrop-blur-xl" },
				when(() => s.selection.length > 1 && s.detailId !== null, () => {
					return Button({ variant: "ghost", size: "sm", class: "gap-1 text-muted-foreground", onclick: backToList }, ArrowLeftIcon({ class: "size-4" }), "All here");
				}, () => {
					return el("span", { class: "px-2 text-xs text-muted-foreground" }, "Details");
				}),
				el("div", { class: "flex items-center gap-1" },
					when(() => s.detail !== null, () => {
						return Button({
							variant: "ghost",
							size: "sm",
							class: "group/share gap-1.5 text-xs text-muted-foreground data-[copied=true]:text-primary",
							onclick: shareLink,
							title: "Copy a link to this item"
						},
						LinkIcon(),
						el("span", { class: "group-data-[copied=true]/share:hidden" }, "Share"),
						el("span", { class: "hidden group-data-[copied=true]/share:inline" }, "Link copied"));
					}),
					Button({ variant: "ghost", size: "icon", class: "size-8", onclick: closeSelection, "aria-label": "Close" }, XIcon({ class: "size-4" })))),
			el("div", { class: "p-4 md:p-5" },
				when(() => s.selectionKey + "|" + (s.detailId === null ? "list" : s.detailId + (s.detail ? ":ready" : ":loading")), () => {
					if (s.detailId === null) {
						return untracked(listView);
					}

					if (!s.detail) {
						return el("div", { class: "grid place-items-center py-24" }, el("div", { class: "spinner" }));
					}

					return untracked(() => {
						return detailView(s.detail);
					});
				})));
	});
};

// --- UI: mobile top bar -----------------------------------------------------

const activeFilterCount = () => {
	const changed = [
		s.query.trim() !== "",
		!sameSet(Array.from(s.kinds), DEFAULT_FILTER.kinds),
		!sameSet(Array.from(s.sources), DEFAULT_FILTER.sources),
		s.band !== DEFAULT_FILTER.band || s.minMhz !== "" || s.maxMhz !== "",
		s.stationTypes.length > 0,
		s.serviceTypes.length > 0,
		s.sectors.length > 0,
		s.owner !== "any",
		s.activeOnly !== DEFAULT_FILTER.activeOnly,
		s.preciseOnly !== DEFAULT_FILTER.preciseOnly,
		s.showDuplicates
	];

	return changed.filter(Boolean).length;
};

const mobileBar = () => {
	return el("div", { class: () => "absolute inset-x-3 top-3 grid gap-2 md:hidden" + (s.filtersOpen ? " hidden" : "") },
		el("div", { class: "panel flex items-center gap-2 rounded-2xl p-1.5" },
			el("div", { class: "min-w-0 flex-1" }, searchBox("search-mobile")),
			Button({ variant: "secondary", class: "h-10 gap-2 rounded-xl px-3", onclick: () => {
				s.filtersOpen = true;
			} },
			"Filters",
			when(() => activeFilterCount() > 0, () => {
				return el("span", { class: "grid size-5 place-items-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground" }, () => String(activeFilterCount()));
			})),
			Button({ variant: "secondary", class: "h-10 rounded-xl px-3", onclick: openAroundMe, "aria-label": "RF panorama around me" }, "Around")),
		el("div", { class: "panel justify-self-start rounded-full px-3 py-1 text-xs text-muted-foreground" },
			el("span", { class: "glow-text font-semibold" }, "SIGINT Srbija"), " · ",
			el("span", { class: "font-mono text-foreground" }, () => formatNumber(s.shown)), " shown"));
};

// --- UI: full-screen spectrum explorer -------------------------------------

const EXPLORER_PRESETS = [
	{ label: "All", low: 3e3, high: 3e12 },
	{ label: "LF/MF", low: 30e3, high: 3e6 },
	{ label: "HF", low: 3e6, high: 30e6 },
	{ label: "VHF", low: 30e6, high: 300e6 },
	{ label: "UHF", low: 300e6, high: 3e9 },
	{ label: "SHF", low: 3e9, high: 30e9 },
	{ label: "EHF", low: 30e9, high: 300e9 },
	{ label: "FM radio", low: 87.5e6, high: 108e6 },
	{ label: "Airband", low: 108e6, high: 137e6 },
	{ label: "2 m", low: 144e6, high: 146e6 },
	{ label: "70 cm", low: 430e6, high: 440e6 },
	{ label: "PMR446", low: 446e6, high: 446.2e6 },
	{ label: "TV", low: 470e6, high: 694e6 },
	{ label: "Cellular", low: 700e6, high: 3.8e9 }
];
const EXPLORER_URL_DELAY = 300;

// "low,high" in MHz of the open explorer (in the URL as ?spectrum=)
let explorerView = "";
let explorerStart = null;
let fullExplorer = null;
let explorerUrlTimer = 0;

const mhzText = (hz) => {
	return String(Number((hz / 1e6).toPrecision(9)));
};

// selection: emitter span to highlight and centre on, or null for the current / default view
const openExplorer = (selection) => {
	explorerStart = selection;
	s.explorerOpen = true;
};

const closeExplorer = () => {
	s.explorerOpen = false;
	explorerView = "";
	replaceUrl();
};

const legendDot = (color, label, square) => {
	return el("span", { class: "flex items-center gap-1.5 whitespace-nowrap" },
		el("span", { class: (square ? "size-2.5 rounded-sm" : "dot !size-2") + " flex-none", style: square ? "background:" + color : "color:" + color }), label);
};

const explorerOverlay = () => {
	return when(() => s.explorerOpen, () => {
		const slot = el("div", { class: "min-h-0 flex-1" });
		const readout = el("span", { class: "font-mono text-xs text-muted-foreground" }, "");
		const goTo = Input({
			placeholder: "Go to MHz…",
			inputmode: "decimal",
			class: "h-8 w-32 font-mono text-xs",
			onkeydown: (event) => {
				const mhz = Number(event.currentTarget.value.replace(",", "."));

				if (event.key === "Enter" && mhz > 0 && fullExplorer) {
					fullExplorer.centre(mhz * 1e6, Math.max(mhz * 1e6 * 0.002, 100e3));
				}
			}
		});
		loadBandplan().then((plan) => {
			if (!fullExplorer) {
				fullExplorer = createSpectrum({
					plan: plan,
					kinds: KINDS,
					onOpen: (id) => {
						closeExplorer();
						loadDetail(id, { fly: true });
					},
					onView: (view) => {
						explorerView = mhzText(view.low) + "," + mhzText(view.high);
						readout.textContent = formatHz(view.low, 7) + " – " + formatHz(view.high, 7);
						clearTimeout(explorerUrlTimer);
						explorerUrlTimer = setTimeout(replaceUrl, EXPLORER_URL_DELAY);
					}
				});
				fullExplorer.setSignals(visibleRows());
			}

			const fromUrl = explorerView.split(",").map(Number);
			slot.appendChild(fullExplorer.element);
			fullExplorer.setSelected(explorerStart);

			if (explorerStart) {
				focusOn(fullExplorer, explorerStart);
			} else if (fromUrl.length === 2 && fromUrl[1] > fromUrl[0]) {
				fullExplorer.setView(fromUrl[0] * 1e6, fromUrl[1] * 1e6);
			} else {
				fullExplorer.setView(3e3, 3e12);
			}
		});

		return el("div", { class: "panel fixed inset-0 z-40 flex flex-col gap-3 p-3 md:inset-6 md:rounded-2xl md:p-4" },
			el("div", { class: "flex flex-wrap items-center gap-2" },
				el("h2", { class: "mr-2 text-base font-semibold tracking-tight" }, el("span", { class: "glow-text" }, "Spectrum"), " explorer"),
				el("div", { class: "flex flex-wrap gap-1" },
					...EXPLORER_PRESETS.map((preset) => {
						return Button({ variant: "secondary", size: "sm", class: "h-7 rounded-full px-2.5 text-xs", onclick: () => {
							fullExplorer.setView(preset.low, preset.high);
						} }, preset.label);
					})),
				el("div", { class: "ml-auto flex items-center gap-1" },
					goTo,
					Button({ variant: "outline", size: "icon", class: "size-8", "aria-label": "Zoom out", onclick: () => {
						fullExplorer.zoom(2);
					} }, "−"),
					Button({ variant: "outline", size: "icon", class: "size-8", "aria-label": "Zoom in", onclick: () => {
						fullExplorer.zoom(0.5);
					} }, "+"),
					Button({ variant: "ghost", size: "icon", class: "size-8", onclick: closeExplorer, "aria-label": "Close" }, XIcon({ class: "size-4" })))),
			slot,
			el("div", { class: "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground" },
				readout,
				el("span", { class: "text-white/20" }, "|"),
				...CATEGORY_LEGEND.map((category) => {
					return legendDot(category.color, category.label, true);
				}),
				el("span", { class: "text-white/20" }, "|"),
				...Object.keys(USER_COLORS).filter((user) => {
					return user !== "Anyone";
				}).map((user) => {
					return legendDot(USER_COLORS[user], user, true);
				}),
				el("span", { class: "text-white/20" }, "|"),
				...Object.keys(KINDS).map((kind) => {
					return legendDot(KINDS[kind].color, KINDS[kind].label);
				}),
				el("span", { class: "basis-full md:basis-auto md:ml-auto" }, "Signals follow the map filters. Scroll / pinch to zoom, drag to pan, click a band to fit it, a signal to open it.")));
	});
};

// --- UI: RF panorama (360° around a point, AR with the camera) ---------------

const PANORAMA_RADII = [5, 10, 30, 80];
const NO_COMPASS = "No access to the compass: drag the view to line it up with the camera.";

// { lat, lon, label, mine } - mine: the user's own location (not put in the URL)
let panoramaAt = null;
let panorama = null;
let panoramaRoot = null;

const openPanorama = (observer) => {
	panoramaAt = observer;
	s.panoramaError = "";
	s.panoramaOpen = true;

	if (panorama) {
		panorama.setObserver(observer);
	}

	replaceUrl();
};

const closePanorama = () => {
	if (panorama) {
		panorama.stopAr();
	}

	exitFullscreen();
	s.arFiltersOpen = false;
	s.panoramaAr = false;
	s.panoramaOpen = false;
	replaceUrl();
};

const locate = () => {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) {
			reject(new Error("This browser has no location access"));
			return;
		}

		navigator.geolocation.getCurrentPosition((position) => {
			resolve({ lat: position.coords.latitude, lon: position.coords.longitude, label: "your location", mine: true });
		}, (error) => {
			reject(new Error("Location unavailable: " + error.message));
		}, { enableHighAccuracy: true, timeout: 15000 });
	});
};

const openAroundMe = () => {
	locate().then(openPanorama).catch((error) => {
		openPanorama(panoramaAt || { lat: map.getCenter().lat, lon: map.getCenter().lng, label: "map centre", mine: false });
		s.panoramaError = error.message;
	});
};

// Camera + compass; follows GPS when looking around the user's own location
const exitFullscreen = () => {
	if (document.fullscreenElement && document.exitFullscreen) {
		document.exitFullscreen().catch(() => {});
	}
};

const toggleAr = () => {
	if (panorama.arActive()) {
		panorama.stopAr();
		s.panoramaAr = false;
		s.arFiltersOpen = false;
		exitFullscreen();
		return;
	}

	s.panoramaError = "";

	// full screen must be requested inside the tap, before the permission prompts
	if (panoramaRoot && panoramaRoot.requestFullscreen) {
		panoramaRoot.requestFullscreen().catch(() => {});
	}

	panorama.startAr(Boolean(panoramaAt && panoramaAt.mine)).then(() => {
		s.panoramaAr = true;

		if (!panorama.hasCompass()) {
			s.panoramaError = NO_COMPASS;
		}
	}).catch((error) => {
		s.panoramaError = error.message;
		exitFullscreen();
	});
};

const openSite = (ids) => {
	const first = data.byId.get(ids[0]);
	closePanorama();
	select(ids);

	if (first) {
		map.flyTo({ center: [first.lon, first.lat], zoom: Math.max(map.getZoom(), 14), padding: mapPadding(true), speed: 1.6 });
	}
};

const panoramaSummary = () => {
	const where = panoramaAt ? (panoramaAt.label ? "from " + panoramaAt.label : panoramaAt.lat.toFixed(4) + ", " + panoramaAt.lon.toFixed(4)) : "";
	return where + " · " + formatNumber(s.panoramaSites) + " sites within " + s.panoramaRadius + " km";
};

const radiusButtons = () => {
	return PANORAMA_RADII.map((km) => {
		return Button({
			variant: "secondary",
			size: "sm",
			class: () => "h-7 rounded-full px-2.5 text-xs" + (s.panoramaRadius === km ? " bg-primary text-primary-foreground hover:bg-primary/90" : ""),
			onclick: () => {
				s.panoramaRadius = km;
				panorama.setRadius(km * 1000);
				replaceUrl();
			}
		}, km + " km");
	});
};

// Full-screen AR: floating toolbar on top, filter sheet (the map's own filters) at the bottom
const arControls = () => {
	const kindCounts = countBy("kind");

	return el("div", { class: "pointer-events-none absolute inset-0 flex flex-col justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]" },
		el("div", { class: "pointer-events-auto grid min-w-0 gap-2" },
			el("div", { class: "panel flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2" },
				el("span", { class: "min-w-0 flex-1 truncate text-xs text-muted-foreground" }, () => formatNumber(s.panoramaSites) + " sites · " + s.panoramaRadius + " km"),
				Button({ variant: "secondary", size: "sm", class: "h-8 shrink-0 rounded-full px-3 text-xs", onclick: () => {
					s.arFiltersOpen = !s.arFiltersOpen;
				} }, "Filters", when(() => activeFilterCount() > 0, () => {
					return el("span", { class: "ml-1.5 grid size-4 place-items-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground" }, () => String(activeFilterCount()));
				})),
				Button({ variant: "secondary", size: "icon", class: "size-8 shrink-0 rounded-full", onclick: toggleAr, "aria-label": "Stop camera" }, XIcon({ class: "size-4" }))),
			when(() => s.panoramaError !== "", () => {
				return el("div", { class: "rounded-lg border border-amber-400/30 bg-black/70 px-3 py-2 text-xs text-amber-200" }, () => s.panoramaError);
			})),
		when(() => s.arFiltersOpen, () => {
			return el("div", { class: "panel pointer-events-auto thin-scroll grid max-h-[55dvh] gap-4 overflow-y-auto rounded-2xl p-4" },
				el("div", { class: "flex items-center justify-between" },
					el("span", { class: "text-sm font-semibold" }, "Filters"),
					Button({ variant: "ghost", size: "sm", class: "h-7 text-xs", onclick: () => {
						s.arFiltersOpen = false;
					} }, "Done")),
				section("Radius", el("div", { class: "flex flex-wrap gap-1" }, ...radiusButtons())),
				section("Kind", chipGroup(KINDS, [s, "kinds"], kindCounts)),
				section("Band",
					ToggleGroup({ type: "single", variant: "outline", size: "sm", spacing: 1.5, value: [s, "band"], class: "flex flex-wrap justify-start", onValueChange: () => {
						s.minMhz = "";
						s.maxMhz = "";
					} },
					...BANDS.map((band) => {
						return ToggleGroupItem({ value: band.id, class: "h-8 rounded-full px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground" }, band.label);
					}))),
				el("span", { class: "text-[11px] text-muted-foreground" }, "These are the map's filters; the map changes with them."));
		}));
};

const panoramaOverlay = () => {
	return when(() => s.panoramaOpen, () => {
		const slot = el("div", { class: "h-full" });

		if (!panorama) {
			panorama = createPanorama({
				kinds: KINDS,
				onSite: openSite,
				onSites: (sites) => {
					s.panoramaSites = sites.length;
				},
				onCompass: () => {
					if (s.panoramaError === NO_COMPASS) {
						s.panoramaError = "";
					}
				}
			});
			panorama.setRows(visibleRows());
		}

		panorama.setRadius(untracked(() => s.panoramaRadius) * 1000);
		panorama.setObserver(panoramaAt);
		slot.appendChild(panorama.element);

		panoramaRoot = el("div", { class: () => s.panoramaAr ? "fixed inset-0 z-50 flex flex-col bg-black" : "panel fixed inset-0 z-40 flex flex-col gap-3 p-3 md:inset-6 md:rounded-2xl md:p-4" },
			el("div", { class: () => s.panoramaAr ? "hidden" : "flex flex-wrap items-center gap-2" },
				el("h2", { class: "mr-1 text-base font-semibold tracking-tight" }, el("span", { class: "glow-text" }, "RF"), " panorama"),
				el("span", { class: "min-w-0 truncate text-xs text-muted-foreground" }, panoramaSummary),
				el("div", { class: "ml-auto flex flex-wrap items-center gap-1" },
					...radiusButtons(),
					Button({ variant: "outline", size: "sm", class: "h-7 rounded-full px-3 text-xs", onclick: openAroundMe }, "My location"),
					Button({ variant: "outline", size: "sm", class: "h-7 rounded-full px-3 text-xs", onclick: toggleAr }, "AR camera"),
					Button({ variant: "ghost", size: "icon", class: "size-8", onclick: closePanorama, "aria-label": "Close" }, XIcon({ class: "size-4" })))),
			when(() => s.panoramaError !== "" && !s.panoramaAr, () => {
				return el("div", { class: "rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200" }, () => s.panoramaError);
			}),
			el("div", { class: "relative min-h-0 flex-1" },
				slot,
				when(() => s.panoramaAr, arControls)),
			el("div", { class: () => s.panoramaAr ? "hidden" : "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground" },
				...Object.keys(KINDS).map((kind) => {
					return legendDot(KINDS[kind].color, KINDS[kind].label);
				}),
				el("span", { class: "basis-full md:basis-auto md:ml-auto" }, "Bearing left to right, nearer sites higher. Drag to look around, scroll to widen or narrow the view, click a site to list it. Follows the map filters.")));

		return panoramaRoot;
	});
};

// --- UI: legend + loading ---------------------------------------------------

const legend = () => {
	return el("div", { class: "panel absolute bottom-4 left-[392px] hidden items-center gap-4 rounded-full px-4 py-2 text-xs text-muted-foreground lg:flex" },
		...Object.keys(KINDS).map((kind) => {
			return el("span", { class: "flex items-center gap-1.5" }, el("span", { class: "dot !size-2", style: "color:" + KINDS[kind].color }), KINDS[kind].label);
		}),
		el("span", { class: "text-white/20" }, "|"),
		el("span", {}, "Click a pin for details"));
};

const loadingView = () => {
	return el("div", { class: "absolute inset-0 grid place-items-center bg-background" },
		el("div", { class: "grid place-items-center gap-4" },
			el("div", { class: "spinner" }),
			el("span", { class: "text-sm text-muted-foreground" }, "Loading emitters…")));
};

// --- boot -------------------------------------------------------------------

const app = () => {
	return when(() => s.loading, loadingView, () => {
		return el("div", { class: "contents" }, mobileBar(), filterPanel(), detailPanel(), legend(), explorerOverlay(), panoramaOverlay());
	});
};

const mapReady = new Promise((resolve) => {
	map.on("load", resolve);
});

mount(document.getElementById("app"), app);

Promise.all([loadData(), mapReady]).then(() => {
	addLayers();
	wireMap();
	applyFilterQuery(location.search);
	s.total = data.rows.length;
	s.loading = false;

	onChange(readFilter, (filter) => {
		scheduleFilter(filter);
		replaceUrl();
	}, { immediate: true });

	map.on("moveend", replaceUrl);
	openRoute({ fly: !initialView });
});

matchMedia(MOBILE_QUERY).addEventListener("change", (event) => {
	s.mobile = event.matches;
});

window.addEventListener("popstate", () => {
	if (parseRoute()) {
		openRoute({ fly: true });
	} else if (s.detailId !== null && s.selection.length > 1) {
		s.detailId = null;
		s.detail = null;
		setTitle(null);
	} else {
		clearSelection();
	}
});

document.addEventListener("keydown", (event) => {
	// Escape closes the topmost thing: panorama / explorer, then details, then filters
	if (event.key === "Escape" && s.panoramaAr) {
		toggleAr();
	} else if (event.key === "Escape" && s.panoramaOpen) {
		closePanorama();
	} else if (event.key === "Escape" && s.explorerOpen) {
		closeExplorer();
	} else if (event.key === "Escape" && s.selection.length > 0) {
		closeSelection();
	} else if (event.key === "Escape" && s.filtersOpen) {
		s.filtersOpen = false;
	}

	if (event.key === "/" && document.activeElement && document.activeElement.tagName !== "INPUT") {
		event.preventDefault();
		const search = document.getElementById(s.mobile ? "search-mobile" : "search");

		if (search) {
			search.focus();
		}
	}
});
