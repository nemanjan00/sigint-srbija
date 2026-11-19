// Public, read-only MCP server (Streamable HTTP, stateless) at POST /mcp.
// Every request gets its own server + transport; tools only read the database.
const McpServer = require("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
const StreamableHTTPServerTransport = require("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;
const z = require("zod");
const search = require("../search");
const emitters = require("../web/emitters");
const sector = require("../reg203/sector");
const bandplan = require("../bandplan");

const SERVER_NAME = "sigint-srbija";
const SERVER_VERSION = require("../../package.json").version;
const DEFAULT_TOLERANCE_KHZ = 12.5;

const INSTRUCTIONS = `Public radio signal sources in Serbia: amateur repeaters, APRS digipeaters and beacons (SRS, BrandMeister) and RATEL's public registers: every radio licence (reg203, ~161k frequency assignments: holder, TX/RX, site, station/service type), FM radio and TV transmitters (reg204, kind broadcast), mobile network base stations of Telekom Srbija, Yettel and A1 (reg221, kind cell, one per operator site; bands and 2G-5G in raw) and registered licence-exempt Wi-Fi / RLAN stations and E-band links (reg215, kind link), and Meshtastic LoRa mesh routers / repeaters (jugomesh.com, kind mesh, 869.525 MHz).
- Positions are WGS 84. Licences without a position are mobile stations. Some positions are guesses (city centre, grid square): see position_source and accuracy_m.
- Police and military are not in the public register. There is no modulation / emission class data.
- sector and owner of licences are guessed from the holder's name.
- Text search matches substrings of folded text (Cyrillic and Latin both work, no diacritics needed). Serbian words are inflected, so search by stem: "hitn" finds "hitna" and "hitnu".
- Every result has a url to open it on the map; share those with the user.
- band_plan tells what a frequency is allocated to in Serbia (RATEL band plan: services, applications, who may use it, licensing) and what you are likely to hear there; get_emitter includes the same for the emitter's frequency.`;

const KINDS = ["repeater", "digipeater", "beacon", "licence", "broadcast", "cell", "link", "mesh"];
const SOURCES = ["yu1srs-repeaters", "yu1srs-map", "brandmeister", "ratel-reg203", "ratel-reg204", "ratel-reg221", "ratel-reg215", "jugomesh"];
const SECTORS = sector.getSectors().map((item) => {
	return item.id;
}).concat(["amateur"]);

// Band plan entry in the shape tools return (uses that apply at the frequency, unless all)
const bandSummary = (band, all) => {
	if (!band) {
		return null;
	}

	return {
		band: band.label,
		services: band.services.map((service) => {
			return service.en + (service.primary ? " (primary)" : " (secondary)");
		}),
		uses: band.uses.filter((use) => {
			return all || (use.here && !use.background);
		}).map((use) => {
			return withoutEmpty({
				application: use.en || use.application,
				application_sr: use.application,
				condition_sr: use.condition,
				reserved_for: use.users.length ? use.users : null,
				licensing: use.licensing_en.length ? use.licensing_en.join(" / ") : null,
				applies_here: all ? use.here : null
			});
		}),
		footnotes: band.footnotes
	};
};

const emitterPath = (source, key) => {
	return "/e/" + encodeURIComponent(source) + "/" + key.split("/").map(encodeURIComponent).join("/");
};

const mhz = (hz) => {
	return hz === null || hz === undefined ? null : hz / 1e6;
};

const withoutEmpty = (object) => {
	return Object.keys(object).reduce((result, key) => {
		if (object[key] !== null && object[key] !== undefined && object[key] !== "") {
			result[key] = object[key];
		}

		return result;
	}, {});
};

// Compact, model-friendly view of a search row
const summarize = (row, baseUrl) => {
	return withoutEmpty({
		url: baseUrl + emitterPath(row.source, row.source_key),
		source: row.source,
		key: row.source_key,
		kind: row.kind,
		mode: row.mode,
		callsign: row.callsign,
		dmr_id: row.dmr_id,
		name: row.name,
		operator: row.operator,
		tx_mhz: mhz(row.tx_hz),
		tx_high_mhz: row.tx_high_hz !== row.tx_hz ? mhz(row.tx_high_hz) : null,
		rx_mhz: mhz(row.rx_hz),
		rx_high_mhz: row.rx_high_hz !== row.rx_hz ? mhz(row.rx_high_hz) : null,
		site: row.location,
		city: row.city,
		lat: row.lat,
		lon: row.lon,
		position_source: row.coord_source,
		accuracy_m: row.coord_accuracy_m,
		distance_km: row.distance_km === undefined ? null : Math.round(row.distance_km * 100) / 100,
		valid: row.active === null || row.active === undefined ? null : row.active === 1,
		sector: row.sector,
		owner: row.owner,
		station_type: row.station_type,
		service_type: row.service_type
	});
};

const jsonResult = (value) => {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 1) }],
		structuredContent: value
	};
};

const errorResult = (message) => {
	return { content: [{ type: "text", text: message }], isError: true };
};

const resultPage = (found, baseUrl, limit, offset) => {
	return {
		total: found.total,
		returned: found.rows.length,
		offset: offset || 0,
		has_more: (offset || 0) + found.rows.length < found.total,
		results: found.rows.map((row) => {
			return summarize(row, baseUrl);
		})
	};
};

const filterSchema = {
	kinds: z.array(z.enum(KINDS)).optional().describe("Only these kinds. licence = RATEL register entries"),
	sources: z.array(z.enum(SOURCES)).optional(),
	sectors: z.array(z.enum(SECTORS)).optional().describe("Licence holder sector (guessed from the name); amateur for SRS/BrandMeister stations"),
	owner: z.enum(["public", "private", "amateur"]).optional(),
	station_types: z.array(z.string()).optional().describe("reg203 station type codes, e.g. FX fixed, FB base, ML land mobile, MO mobile"),
	service_types: z.array(z.string()).optional().describe("reg203 service codes, e.g. CO official, OT operational, CP public correspondence"),
	include_expired: z.boolean().optional().describe("Also return expired licences (default false)"),
	include_duplicates: z.boolean().optional().describe("Also return other sources' listings of the same station (default false)"),
	limit: z.number().int().min(1).max(search.MAX_LIMIT).optional().describe("Default " + search.DEFAULT_LIMIT),
	offset: z.number().int().min(0).optional()
};

const toSearchOptions = (args) => {
	return {
		kinds: args.kinds,
		sources: args.sources,
		sectors: args.sectors,
		owner: args.owner,
		stationTypes: args.station_types,
		serviceTypes: args.service_types,
		activeOnly: !args.include_expired,
		includeDuplicates: Boolean(args.include_duplicates),
		limit: args.limit,
		offset: args.offset
	};
};

/**
 * MCP server for one request
 * @param {string} baseUrl - Public site URL, for result links
 */
const createServer = (baseUrl) => {
	const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

	server.registerTool("search_emitters", {
		title: "Search emitters",
		description: "Search repeaters, beacons, APRS digipeaters and RATEL licences by text (callsign, DMR ID, holder, site, city), frequency range, area and type. Results are sorted by distance when `near` is given.",
		inputSchema: Object.assign({
			query: z.string().optional().describe("Words that must all appear; substrings of folded text, use stems (\"hitn\", \"vatrogas\", \"g4s\")"),
			min_mhz: z.number().optional().describe("Frequency range start; matches TX or RX"),
			max_mhz: z.number().optional().describe("Frequency range end"),
			near: z.object({
				lat: z.number(),
				lon: z.number(),
				radius_km: z.number().positive().max(500)
			}).optional().describe("Only emitters with a position within radius_km of this point, nearest first")
		}, filterSchema),
		annotations: { readOnlyHint: true, openWorldHint: false }
	}, (args) => {
		const options = Object.assign(toSearchOptions(args), {
			query: args.query,
			minHz: args.min_mhz === undefined ? undefined : args.min_mhz * 1e6,
			maxHz: args.max_mhz === undefined ? undefined : args.max_mhz * 1e6,
			near: args.near ? { lat: args.near.lat, lon: args.near.lon, radiusKm: args.near.radius_km } : undefined
		});

		return jsonResult(resultPage(search.search(options), baseUrl, args.limit, args.offset));
	});

	server.registerTool("find_frequency", {
		title: "Who uses a frequency",
		description: "Everything transmitting or receiving on a frequency (within a tolerance), closest frequency first. Use it to identify a signal heard on a scanner or SDR.",
		inputSchema: Object.assign({
			mhz: z.number().positive().describe("Frequency in MHz, e.g. 145.600"),
			tolerance_khz: z.number().min(0).max(1000).optional().describe("Default " + DEFAULT_TOLERANCE_KHZ + " kHz")
		}, filterSchema),
		annotations: { readOnlyHint: true, openWorldHint: false }
	}, (args) => {
		const centre = args.mhz * 1e6;
		const tolerance = (args.tolerance_khz === undefined ? DEFAULT_TOLERANCE_KHZ : args.tolerance_khz) * 1e3;
		const all = search.search(Object.assign(toSearchOptions(args), {
			minHz: centre - tolerance,
			maxHz: centre + tolerance,
			limit: search.MAX_LIMIT * 50
		}));
		const offFrequency = (row) => {
			return Math.min.apply(null, [row.tx_hz, row.rx_hz].filter((hz) => {
				return hz !== null;
			}).map((hz) => {
				return Math.abs(hz - centre);
			}).concat([Infinity]));
		};
		const sorted = all.rows.slice().sort((a, b) => {
			return offFrequency(a) - offFrequency(b);
		});
		const offset = args.offset || 0;
		const limit = Math.min(args.limit || search.DEFAULT_LIMIT, search.MAX_LIMIT);

		return jsonResult(resultPage({ total: all.total, rows: sorted.slice(offset, offset + limit) }, baseUrl, limit, offset));
	});

	server.registerTool("get_emitter", {
		title: "Emitter details",
		description: "Full record of one emitter: every field, the source record, other sources' listings of the same station, and for licences the full register entry and all assignments on the licence. Pass `url` from a result, or `source` + `key`.",
		inputSchema: {
			url: z.string().optional().describe("A map URL, e.g. https://sigint.nemanja.top/e/brandmeister/220001"),
			source: z.enum(SOURCES).optional(),
			key: z.string().optional()
		},
		annotations: { readOnlyHint: true, openWorldHint: false }
	}, (args) => {
		let source = args.source;
		let key = args.key;

		if (args.url) {
			const match = new URL(args.url, baseUrl).pathname.match(/^\/e\/([^/]+)\/(.+)$/);

			if (!match) {
				return errorResult("Not an emitter URL: " + args.url);
			}

			source = decodeURIComponent(match[1]);
			key = match[2].split("/").map(decodeURIComponent).join("/");
		}

		if (!source || !key) {
			return errorResult("Pass url, or source and key");
		}

		const emitter = emitters.getEmitterByKey(source, key);

		if (!emitter) {
			return errorResult("No emitter " + source + " / " + key);
		}

		const spectrum = emitter.spectrum;
		const onAir = spectrum ? withoutEmpty({
			likely_to_hear: spectrum.hints,
			bandwidth_khz: spectrum.bandwidth ? spectrum.bandwidth.hz / 1e3 : null,
			bandwidth_basis: spectrum.bandwidth ? spectrum.bandwidth.how : null,
			band_plan: bandSummary(spectrum.band, false)
		}) : null;

		return jsonResult(Object.assign({ url: baseUrl + emitterPath(source, key) }, emitter, { spectrum: onAir }));
	});

	server.registerTool("band_plan", {
		title: "Band plan for a frequency",
		description: "What a frequency is allocated to in Serbia, from RATEL's national band plan (Plan namene, Table 1): the band, radio services (primary/secondary), applications with conditions, who it is reserved for (e.g. police, military) and how it is licensed, plus what you are likely to hear there. Conditions are in Serbian.",
		inputSchema: {
			mhz: z.number().min(0).max(3000000).describe("Frequency in MHz, e.g. 446.1"),
			all_uses: z.boolean().optional().describe("Also list uses limited to other parts of the band (default false)")
		},
		annotations: { readOnlyHint: true, openWorldHint: false }
	}, (args) => {
		const hz = Math.round(args.mhz * 1e6);
		const description = bandplan.describe({ tx_hz: hz, tx_high_hz: null });

		if (!description.band) {
			return errorResult("No band plan entry for " + args.mhz + " MHz");
		}

		return jsonResult(withoutEmpty(Object.assign({
			mhz: args.mhz,
			likely_to_hear: description.hints,
			typical_bandwidth_khz: description.bandwidth ? description.bandwidth.hz / 1e3 : null,
			source: description.plan.title + (description.plan.date ? ", " + description.plan.date : "") + " — " + description.plan.url
		}, bandSummary(description.band, Boolean(args.all_uses)))));
	});

	server.registerTool("database_info", {
		title: "Database info",
		description: "Sources with fetch times, counts by kind / source / sector, and the station and service type code tables.",
		inputSchema: {},
		annotations: { readOnlyHint: true, openWorldHint: false }
	}, () => {
		const map = emitters.getMapData();

		return jsonResult(Object.assign({
			map: baseUrl,
			sources: map.sources,
			station_types: map.lookups.stationTypes,
			service_types: map.lookups.serviceTypes,
			sectors: map.lookups.sectors
		}, search.getStats()));
	});

	return server;
};

const publicBaseUrl = (req) => {
	return process.env.PUBLIC_URL || req.protocol + "://" + req.get("host");
};

// Express handler for POST /mcp
const handle = (req, res) => {
	const server = createServer(publicBaseUrl(req));
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

	res.on("close", () => {
		transport.close();
		server.close();
	});

	return server.connect(transport)
		.then(() => {
			return transport.handleRequest(req, res, req.body);
		})
		.catch((error) => {
			console.error(error);

			if (!res.headersSent) {
				res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
			}
		});
};

// Stateless server: no SSE stream, no sessions to delete
const methodNotAllowed = (_req, res) => {
	res.status(405).set("allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
};

module.exports = {
	handle: handle,
	methodNotAllowed: methodNotAllowed
};
