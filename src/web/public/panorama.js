// RF panorama: every known transmitter site around an observer, as a 360°
// horizon strip (bearing left to right, nearer = higher and bigger) and a
// north-up radar. Drag the strip to look around, wheel to change the field of
// view. AR mode puts the strip over the rear camera, steered by the compass
// (heading) and tilt; the observer then follows GPS.

const EARTH_RADIUS_M = 6371000;
const DEFAULT_FOV = 360;
// Narrow screens start with a partial view: 360° on a phone is a wall of dots
const NARROW_FOV = 120;
const NARROW_PX = 600;
// Only the nearest sites get a stem down to the horizon
const MAX_STEMS = 150;
const LABEL_EVERY_PX = 22;
const AR_FOV = 60;
const MIN_FOV = 20;
const SITE_DECIMALS = 4;
const STRIP_LABEL_GAP = 4;
const RADAR_HIT_PX = 10;
const STRIP_HIT_PX = 12;
const CARDINALS = [["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SW", 225], ["W", 270], ["NW", 315]];

const toRad = (deg) => {
	return deg * Math.PI / 180;
};

const toDeg = (rad) => {
	return rad * 180 / Math.PI;
};

// Great-circle distance (m) and initial bearing (deg from north) from a to b
export const bearingDistance = (a, b) => {
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const dLat = lat2 - lat1;
	const dLon = toRad(b.lon - a.lon);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	const y = Math.sin(dLon) * Math.cos(lat2);
	const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

	return { distance: 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)), bearing: (toDeg(Math.atan2(y, x)) + 360) % 360 };
};

const formatDistance = (metres) => {
	return metres < 1000 ? Math.round(metres) + " m" : (metres / 1000).toFixed(metres < 10000 ? 1 : 0) + " km";
};

const wrap = (deg) => {
	return ((deg % 360) + 540) % 360 - 180;
};

/**
 * Group rows into sites (same position) within radius of the observer.
 * @returns {Array<{ lat, lon, bearing, distance, ids, kinds, label, kind }>} nearest first
 */
const sitesAround = (rows, observer, radiusM) => {
	const sites = new Map();

	rows.forEach((row) => {
		if (row.lat === null || row.lon === null) {
			return;
		}

		const key = row.lat.toFixed(SITE_DECIMALS) + "," + row.lon.toFixed(SITE_DECIMALS);
		const site = sites.get(key);

		if (site) {
			site.ids.push(row.id);
			site.kinds[row.kind] = (site.kinds[row.kind] || 0) + 1;
			return;
		}

		sites.set(key, { lat: row.lat, lon: row.lon, ids: [row.id], kinds: { [row.kind]: 1 }, label: row.callsign || row.name || row.location || row.operator || "" });
	});

	return Array.from(sites.values()).map((site) => {
		const where = bearingDistance(observer, site);
		const kind = Object.keys(site.kinds).sort((a, b) => {
			return site.kinds[b] - site.kinds[a];
		})[0];

		return Object.assign(site, where, { kind: kind });
	}).filter((site) => {
		return site.distance <= radiusM && site.distance > 1;
	}).sort((a, b) => {
		return a.distance - b.distance;
	});
};

/**
 * @param {Object} options
 * @param {Object} options.kinds - kind -> { label, color }
 * @param {Function} options.onSite - called with a site's emitter ids when it is clicked
 * @returns {Object} api
 */
export const createPanorama = (options) => {
	const element = document.createElement("div");
	const video = document.createElement("video");
	const strip = document.createElement("canvas");
	const radar = document.createElement("canvas");
	const tooltip = document.createElement("div");
	const state = {
		observer: null,
		rows: [],
		radiusM: 30000,
		sites: [],
		heading: 0,
		pitch: 0,
		fov: null,
		ar: null,
		drag: null,
		frame: 0,
		hits: { strip: [], radar: [] }
	};

	element.className = "grid h-full w-full gap-3 md:grid-cols-[1fr_minmax(260px,34%)]";
	const stripBox = document.createElement("div");
	stripBox.className = "relative min-h-[220px] touch-none select-none overflow-hidden rounded-xl bg-black/30";
	video.className = "absolute inset-0 hidden h-full w-full object-cover";
	video.setAttribute("playsinline", "");
	video.muted = true;
	strip.className = "absolute inset-0 h-full w-full cursor-grab";
	tooltip.className = "pointer-events-none absolute z-10 hidden max-w-[260px] rounded-lg border border-white/10 bg-[color-mix(in_oklch,var(--popover)_94%,transparent)] px-2.5 py-2 text-[11px] leading-snug shadow-xl";
	stripBox.append(video, strip, tooltip);
	const radarBox = document.createElement("div");
	radarBox.className = "relative hidden aspect-square touch-none select-none overflow-hidden rounded-xl bg-black/30 md:block";
	radar.className = "h-full w-full cursor-pointer";
	radarBox.append(radar);
	element.append(stripBox, radarBox);

	const colorOf = (kind) => {
		return (options.kinds[kind] || { color: "#94a3b8" }).color;
	};

	const sizeCanvas = (canvas, box) => {
		const ratio = window.devicePixelRatio || 1;
		const width = box.clientWidth;
		const height = box.clientHeight;

		if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
		}

		const context = canvas.getContext("2d");
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		return { context: context, width: width, height: height };
	};

	// --- horizon strip --------------------------------------------------------

	const drawStrip = () => {
		const { context, width, height } = sizeCanvas(strip, stripBox);

		if (state.fov === null && width) {
			state.fov = width < NARROW_PX ? NARROW_FOV : DEFAULT_FOV;
		}

		const maxLabels = Math.max(6, Math.round(width / LABEL_EVERY_PX));
		// AR: the horizon moves with the phone's tilt (pitch 0 = held upright)
		const verticalFov = state.fov * height / width;
		// AR: horizon mid-screen, moved by tilt; otherwise low, sites need the room above it
		const horizon = state.ar ? height * 0.6 + state.pitch / verticalFov * height : height * 0.86;
		const pxPerDeg = width / state.fov;
		const x = (bearing) => {
			return width / 2 + wrap(bearing - state.heading) * pxPerDeg;
		};
		const placed = [];
		let labels = 0;

		state.hits.strip = [];

		if (!state.ar) {
			const gradient = context.createLinearGradient(0, 0, 0, height);
			gradient.addColorStop(0, "rgb(34 211 238 / 0.04)");
			gradient.addColorStop(1, "rgb(0 0 0 / 0)");
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, horizon);
		}

		context.fillStyle = "rgb(255 255 255 / 0.25)";
		context.fillRect(0, horizon, width, 1);

		// compass ticks every 15°, cardinal letters
		context.font = "600 11px Inter, sans-serif";
		for (let deg = 0; deg < 360; deg += 15) {
			const px = x(deg);

			if (px < -20 || px > width + 20) {
				continue;
			}

			const cardinal = CARDINALS.find((item) => {
				return item[1] === deg;
			});
			context.fillStyle = cardinal ? "rgb(255 255 255 / 0.7)" : "rgb(255 255 255 / 0.3)";
			context.fillRect(px, horizon, 1, cardinal ? 10 : 5);

			if (cardinal || pxPerDeg * 15 > 28) {
				context.fillText(cardinal ? cardinal[0] : String(deg), px - (cardinal ? 4 : 8), horizon + 24);
			}
		}

		// far first, so near sites end up on top
		const count = state.sites.length;
		state.sites.slice().reverse().forEach((site, reverseIndex) => {
			const px = x(site.bearing);

			if (px < -10 || px > width + 10) {
				return;
			}

			const nearness = 1 - Math.sqrt(site.distance / state.radiusM);
			const top = horizon - 8 - nearness * (horizon - 40);
			const radius = 2.5 + nearness * 6 + Math.min(4, Math.log(site.ids.length));
			const color = colorOf(site.kind);

			context.fillStyle = color;

			if (count - reverseIndex <= MAX_STEMS) {
				context.globalAlpha = 0.35 + nearness * 0.5;
				context.fillRect(px - 0.5, top, 1, horizon - top);
			}

			context.globalAlpha = 0.45 + nearness * 0.55;
			context.beginPath();
			context.arc(px, top, radius, 0, Math.PI * 2);
			context.fill();
			context.globalAlpha = 1;
			state.hits.strip.push({ x: px, y: top, site: site });
		});

		// labels for the nearest sites that do not overlap
		context.font = "11px Inter, sans-serif";
		state.hits.strip.slice().reverse().forEach((hit) => {
			if (labels >= maxLabels || !hit.site.label) {
				return;
			}

			const text = hit.site.label + " · " + formatDistance(hit.site.distance);
			const textWidth = context.measureText(text).width;
			const box = { x0: hit.x + 8, x1: hit.x + 12 + textWidth, y0: hit.y - 14, y1: hit.y };
			const overlaps = placed.some((other) => {
				return box.x0 < other.x1 + STRIP_LABEL_GAP && box.x1 + STRIP_LABEL_GAP > other.x0 && box.y0 < other.y1 && box.y1 > other.y0;
			});

			if (overlaps || box.x1 > width) {
				return;
			}

			placed.push(box);
			labels++;
			context.fillStyle = "rgb(0 0 0 / 0.55)";
			context.fillRect(box.x0 - 3, box.y0 - 1, textWidth + 6, 15);
			context.fillStyle = "rgb(241 245 249 / 0.95)";
			context.fillText(text, box.x0, box.y1 - 3);
		});

		// heading readout
		context.font = "600 12px 'JetBrains Mono', monospace";
		context.fillStyle = "rgb(103 232 249 / 0.9)";
		context.fillText(Math.round((state.heading + 360) % 360) + "°", width / 2 - 14, 18);
		context.fillRect(width / 2, 24, 1, 8);
	};

	// --- radar ----------------------------------------------------------------

	const drawRadar = () => {
		if (!radarBox.clientWidth) {
			return;
		}

		const { context, width, height } = sizeCanvas(radar, radarBox);
		const centre = { x: width / 2, y: height / 2 };
		const maxR = Math.min(width, height) / 2 - 16;
		// square-root distance scale keeps nearby sites apart
		const r = (metres) => {
			return Math.sqrt(metres / state.radiusM) * maxR;
		};

		state.hits.radar = [];
		context.strokeStyle = "rgb(255 255 255 / 0.12)";
		context.fillStyle = "rgb(255 255 255 / 0.45)";
		context.font = "10px 'JetBrains Mono', monospace";

		[0.1, 0.25, 0.5, 1].forEach((share) => {
			const metres = state.radiusM * share;
			context.beginPath();
			context.arc(centre.x, centre.y, r(metres), 0, Math.PI * 2);
			context.stroke();
			context.fillText(formatDistance(metres), centre.x + 3, centre.y - r(metres) + 11);
		});

		CARDINALS.filter((item) => {
			return item[0].length === 1;
		}).forEach((item) => {
			const angle = toRad(item[1]);
			context.fillText(item[0], centre.x + Math.sin(angle) * (maxR + 8) - 3, centre.y - Math.cos(angle) * (maxR + 8) + 4);
		});

		// view cone
		if (state.fov < 360) {
			context.fillStyle = "rgb(103 232 249 / 0.08)";
			context.beginPath();
			context.moveTo(centre.x, centre.y);
			context.arc(centre.x, centre.y, maxR, toRad(state.heading - state.fov / 2 - 90), toRad(state.heading + state.fov / 2 - 90));
			context.fill();
		}

		state.sites.forEach((site) => {
			const angle = toRad(site.bearing);
			const px = centre.x + Math.sin(angle) * r(site.distance);
			const py = centre.y - Math.cos(angle) * r(site.distance);

			context.fillStyle = colorOf(site.kind);
			context.globalAlpha = 0.85;
			context.beginPath();
			context.arc(px, py, 2 + Math.min(4, Math.log(site.ids.length + 1)), 0, Math.PI * 2);
			context.fill();
			context.globalAlpha = 1;
			state.hits.radar.push({ x: px, y: py, site: site });
		});

		context.fillStyle = "#67e8f9";
		context.beginPath();
		context.arc(centre.x, centre.y, 4, 0, Math.PI * 2);
		context.fill();
	};

	const draw = () => {
		state.frame = 0;
		drawStrip();
		drawRadar();
	};

	const redraw = () => {
		if (!state.frame) {
			state.frame = requestAnimationFrame(draw);
		}
	};

	const recompute = () => {
		state.sites = state.observer ? sitesAround(state.rows, state.observer, state.radiusM) : [];
		redraw();

		if (options.onSites) {
			options.onSites(state.sites);
		}
	};

	// --- input ----------------------------------------------------------------

	const nearest = (hits, px, py, radius) => {
		return hits.reduce((best, hit) => {
			const distance = Math.hypot(hit.x - px, hit.y - py);
			return distance <= radius && (!best || distance < best.distance) ? { hit: hit, distance: distance } : best;
		}, null);
	};

	const pointIn = (canvas, event) => {
		const box = canvas.getBoundingClientRect();
		return { x: event.clientX - box.left, y: event.clientY - box.top };
	};

	const kindsText = (site) => {
		return Object.keys(site.kinds).map((kind) => {
			return site.kinds[kind] + " " + (options.kinds[kind] || { label: kind }).label.toLowerCase();
		}).join(", ");
	};

	const showTooltip = (px, py, site) => {
		tooltip.innerHTML = "";
		const title = document.createElement("div");
		title.className = "font-medium";
		title.style.color = colorOf(site.kind);
		title.textContent = site.label || "Site";
		const body = document.createElement("div");
		body.className = "text-muted-foreground";
		body.textContent = formatDistance(site.distance) + " at " + Math.round(site.bearing) + "° · " + kindsText(site);
		tooltip.append(title, body);
		tooltip.classList.remove("hidden");
		tooltip.style.left = Math.min(px + 12, stripBox.clientWidth - tooltip.offsetWidth - 4) + "px";
		tooltip.style.top = Math.max(4, py - tooltip.offsetHeight - 8) + "px";
	};

	strip.addEventListener("pointerdown", (event) => {
		strip.setPointerCapture(event.pointerId);
		state.drag = { x: event.clientX, heading: state.heading, moved: false };
	});

	strip.addEventListener("pointermove", (event) => {
		const point = pointIn(strip, event);

		// in AR the compass turns the view; drag only without one
		if (state.drag && (!state.ar || !state.compass)) {
			const dx = event.clientX - state.drag.x;
			state.drag.moved = state.drag.moved || Math.abs(dx) > 4;
			state.heading = (state.drag.heading - dx / strip.clientWidth * state.fov + 360) % 360;
			redraw();
			return;
		}

		const found = nearest(state.hits.strip, point.x, point.y, STRIP_HIT_PX);

		if (found) {
			showTooltip(point.x, point.y, found.hit.site);
		} else {
			tooltip.classList.add("hidden");
		}
	});

	strip.addEventListener("pointerup", (event) => {
		const point = pointIn(strip, event);
		const tap = !state.drag || !state.drag.moved;
		state.drag = null;

		if (tap) {
			const found = nearest(state.hits.strip, point.x, point.y, STRIP_HIT_PX);
			if (found) {
				options.onSite(found.hit.site.ids);
			}
		}
	});

	strip.addEventListener("wheel", (event) => {
		event.preventDefault();
		state.fov = Math.min(360, Math.max(MIN_FOV, state.fov * Math.exp(event.deltaY * 0.0015)));
		redraw();
	}, { passive: false });

	radar.addEventListener("click", (event) => {
		const point = pointIn(radar, event);
		const found = nearest(state.hits.radar, point.x, point.y, RADAR_HIT_PX);

		if (found) {
			options.onSite(found.hit.site.ids);
		}
	});

	const resize = new ResizeObserver(redraw);
	resize.observe(stripBox);
	resize.observe(radarBox);

	// --- AR: camera + compass + GPS ---------------------------------------------

	const onOrientation = (event) => {
		// iOS gives the compass heading directly; elsewhere alpha is counter-clockwise from north
		let heading = null;

		if (typeof event.webkitCompassHeading === "number") {
			heading = event.webkitCompassHeading;
		} else if (event.absolute !== false && typeof event.alpha === "number") {
			heading = 360 - event.alpha;
		}

		if (heading === null) {
			return;
		}

		state.compass = true;
		const screenAngle = (screen.orientation && screen.orientation.angle) || 0;
		state.heading = (heading + screenAngle + 360) % 360;
		// beta 90 = phone upright; tilting the top back raises the view
		state.pitch = typeof event.beta === "number" ? event.beta - 90 : 0;
		redraw();
	};

	const requestOrientation = () => {
		const Orientation = window.DeviceOrientationEvent;

		if (Orientation && typeof Orientation.requestPermission === "function") {
			return Orientation.requestPermission().then((answer) => {
				if (answer !== "granted") {
					throw new Error("Motion sensor access was denied");
				}
			});
		}

		return Promise.resolve();
	};

	const stopAr = () => {
		if (!state.ar) {
			return;
		}

		state.ar.stream.getTracks().forEach((track) => {
			track.stop();
		});

		if (state.ar.watch !== null) {
			navigator.geolocation.clearWatch(state.ar.watch);
		}

		window.removeEventListener("deviceorientationabsolute", onOrientation);
		window.removeEventListener("deviceorientation", onOrientation);
		video.classList.add("hidden");
		video.srcObject = null;
		state.ar = null;
		state.fov = null;
		state.pitch = 0;
		redraw();
	};

	/**
	 * Camera + compass (+ GPS when followLocation). Must be called from a tap
	 * (iOS asks for motion sensor permission then).
	 * @returns {Promise<void>}
	 */
	const startAr = (followLocation) => {
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			return Promise.reject(new Error("This browser has no camera access (it needs HTTPS)"));
		}

		// without the compass the camera still works; the view is then turned by dragging
		const compass = requestOrientation().then(() => {
			return true;
		}).catch(() => {
			return false;
		});

		return compass
			.then((hasCompass) => {
				state.compass = hasCompass;
				return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
			})
			.then((stream) => {
				const watch = followLocation && navigator.geolocation ? navigator.geolocation.watchPosition((position) => {
					api.setObserver({ lat: position.coords.latitude, lon: position.coords.longitude });
				}, null, { enableHighAccuracy: true, maximumAge: 5000 }) : null;

				state.ar = { stream: stream, watch: watch };
				state.fov = AR_FOV;
				video.srcObject = stream;
				video.classList.remove("hidden");
				video.play();
				// absolute orientation (true north) where the browser has it
				window.addEventListener("ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation", onOrientation);
				redraw();
			});
	};

	const api = {
		element: element,

		setObserver: (observer) => {
			state.observer = observer;
			recompute();
		},

		setRows: (rows) => {
			state.rows = rows;
			recompute();
		},

		setRadius: (metres) => {
			state.radiusM = metres;
			recompute();
		},

		sites: () => {
			return state.sites;
		},

		startAr: startAr,
		stopAr: stopAr,

		arActive: () => {
			return Boolean(state.ar);
		},

		// false while AR runs without motion sensor access
		hasCompass: () => {
			return state.compass !== false;
		},

		destroy: () => {
			stopAr();
			resize.disconnect();
			cancelAnimationFrame(state.frame);
		}
	};

	return api;
};
