// Spectrum explorer: an interactive band plan with every known signal on it.
// Canvas on a log-frequency axis (3 kHz - 3 THz): wheel / pinch to zoom, drag
// to pan, hover for details, click a signal to open it, click a band to zoom
// to it. Lanes, top to bottom: band allocations (coloured by primary
// service), reserved sub-bands (police, military, ...), wide blocks (cell
// downlinks, Wi-Fi bands, links), signals (height = how many share it), ruler.

const MIN_HZ = 3e3;
const MAX_HZ = 3e12;
const MIN_SPAN_HZ = 2e3;
const WHEEL_ZOOM = 0.0015;
// Wider than this, a TX range is a block (band) rather than one signal
const BLOCK_MIN_HZ = 2e6;
const HOVER_RADIUS_PX = 5;
const LABEL_GAP_PX = 6;

const LANES = {
	band: { top: 0, height: 30 },
	use: { top: 32, height: 16 },
	block: { top: 50, height: 10 },
	signalTop: 64,
	ruler: 20
};

// Band colour = category of its first primary service
const CATEGORIES = [
	{ match: /^amateur/, color: "#22d3ee", label: "Amateur" },
	{ match: /^broadcasting/, color: "#f43f5e", label: "Broadcasting" },
	{ match: /aeronautical/, color: "#38bdf8", label: "Aeronautical" },
	{ match: /maritime/, color: "#3b82f6", label: "Maritime" },
	{ match: /satellite|space|earth exploration|inter-satellite/i, color: "#8b5cf6", label: "Satellite & space" },
	{ match: /radio astronomy/, color: "#d946ef", label: "Radio astronomy" },
	{ match: /radiolocation|radionavigation/, color: "#a3e635", label: "Radar & navigation" },
	{ match: /^(land )?mobile/, color: "#f59e0b", label: "Mobile" },
	{ match: /^fixed/, color: "#64748b", label: "Fixed" },
	{ match: /meteorological|standard frequency/, color: "#2dd4bf", label: "Science & time" },
	{ match: /./, color: "#475569", label: "Other" }
];

const USER_COLORS = {
	"Police (MUP)": "#60a5fa",
	"Emergency services": "#f87171",
	"Military": "#a3e635",
	"Security agency (BIA)": "#c084fc",
	"Anyone": "#94a3b8"
};

const log10 = Math.log10;

export const categoryOf = (band) => {
	const service = band.services.find((candidate) => {
		return candidate.primary;
	}) || band.services[0];
	const name = service ? service.en : "";

	return CATEGORIES.find((category) => {
		return category.match.test(name);
	});
};

export const CATEGORY_LEGEND = CATEGORIES.slice(0, -1);

export const formatHz = (hz, digits) => {
	const precision = digits || 6;
	const units = [[1e9, "GHz"], [1e6, "MHz"], [1e3, "kHz"], [1, "Hz"]];
	const unit = units.find((candidate) => {
		return Math.abs(hz) >= candidate[0];
	}) || units[3];

	return Number((hz / unit[0]).toPrecision(precision)) + " " + unit[1];
};

// Typical occupied bandwidth of a map row, when its source gives none
const signalWidth = (row) => {
	if (row.tx_high_hz && row.tx_high_hz > row.tx_hz) {
		return row.tx_high_hz - row.tx_hz;
	}

	if (row.kind === "broadcast") {
		return row.mode === "TV" ? 8e6 : 2e5;
	}

	if (row.kind === "beacon") {
		return 500;
	}

	if (row.tx_hz < 30e6) {
		return 3e3;
	}

	return row.tx_hz < 1e9 ? 12500 : 1e6;
};

const MAX_LABEL = 28;

const labelOf = (row) => {
	const label = row.callsign || row.name || row.operator || row.location || "";
	return label.length > MAX_LABEL ? label.slice(0, MAX_LABEL - 1) + "…" : label;
};

/**
 * Group rows by frequency: narrow signals by (centre, width), blocks by range.
 * @returns {{ signals: Array, blocks: Array }} each sorted by low edge
 */
const indexSignals = (rows) => {
	const groups = new Map();

	rows.forEach((row) => {
		if (!row.tx_hz) {
			return;
		}

		const width = signalWidth(row);
		const centre = row.tx_high_hz && row.tx_high_hz > row.tx_hz ? (row.tx_hz + row.tx_high_hz) / 2 : row.tx_hz;
		const key = centre + "|" + width;
		const group = groups.get(key);

		if (group) {
			group.count++;
			group.kinds[row.kind] = (group.kinds[row.kind] || 0) + 1;
			return;
		}

		groups.set(key, { low: centre - width / 2, high: centre + width / 2, centre: centre, count: 1, id: row.id, label: labelOf(row), kinds: { [row.kind]: 1 } });
	});

	const all = Array.from(groups.values()).map((group) => {
		const kind = Object.keys(group.kinds).sort((a, b) => {
			return group.kinds[b] - group.kinds[a];
		})[0];
		return Object.assign(group, { kind: kind });
	}).sort((a, b) => {
		return a.low - b.low;
	});

	return {
		signals: all.filter((group) => {
			return group.high - group.low < BLOCK_MIN_HZ;
		}),
		blocks: all.filter((group) => {
			return group.high - group.low >= BLOCK_MIN_HZ;
		})
	};
};

// First index whose low edge is >= hz (sorted by low)
const lowerBound = (items, hz) => {
	let low = 0;
	let high = items.length;

	while (low < high) {
		const middle = (low + high) >> 1;

		if (items[middle].low < hz) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}

	return low;
};

// Ruler ticks for the view: decades when wide, linear steps when zoomed in
const ticks = (low, high, width) => {
	const maxTicks = Math.max(2, Math.floor(width / 90));

	if (high / low > 8) {
		const decadeTicks = (steps) => {
			const result = [];

			for (let exponent = Math.floor(log10(low)); exponent <= Math.ceil(log10(high)); exponent++) {
				steps.forEach((step) => {
					const hz = step * Math.pow(10, exponent);
					if (hz >= low && hz <= high) {
						result.push({ hz: hz, major: true });
					}
				});
			}

			return result;
		};

		// the densest set of 1-2-3-5 style steps that still has room for labels
		return [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 5, 7], [1, 2, 5], [1, 3], [1]].map(decadeTicks).find((result) => {
			return result.length <= maxTicks;
		}) || decadeTicks([1]).filter((_, index) => {
			return index % 2 === 0;
		});
	}

	const rough = (high - low) / maxTicks;
	const magnitude = Math.pow(10, Math.floor(log10(rough)));
	const step = [1, 2, 2.5, 5, 10].map((factor) => {
		return factor * magnitude;
	}).find((candidate) => {
		return candidate >= rough;
	});
	const result = [];

	for (let hz = Math.ceil(low / step) * step; hz <= high; hz += step) {
		result.push({ hz: hz, major: true });
	}

	return result;
};

const clampView = (view) => {
	let low = Math.max(log10(MIN_HZ), view.low);
	let high = Math.min(log10(MAX_HZ), view.high);
	const centre = (low + high) / 2;
	const minSpan = log10((Math.pow(10, centre) + MIN_SPAN_HZ / 2) / Math.max(1, Math.pow(10, centre) - MIN_SPAN_HZ / 2));

	if (high - low < minSpan) {
		low = centre - minSpan / 2;
		high = centre + minSpan / 2;
	}

	return { low: low, high: high };
};

/**
 * @param {Object} options
 * @param {Object} options.plan - /api/bandplan payload
 * @param {Object} options.kinds - kind -> { label, color }
 * @param {Function} options.onOpen - called with an emitter id when a signal is clicked
 * @param {Function} [options.onView] - called with { low, high } (Hz) after the view changes
 * @returns {{ element, setSignals, setSelected, setView, showBand, view, destroy }}
 */
export const createSpectrum = (options) => {
	const element = document.createElement("div");
	const canvas = document.createElement("canvas");
	const tooltip = document.createElement("div");
	const context = canvas.getContext("2d");
	const plan = options.plan;
	const state = {
		view: { low: log10(MIN_HZ), high: log10(MAX_HZ) },
		index: { signals: [], blocks: [] },
		selected: null,
		pointers: new Map(),
		drag: null,
		hover: null,
		frame: 0,
		width: 0,
		height: 0
	};

	element.className = "relative h-full w-full touch-none select-none overflow-hidden rounded-xl bg-black/30";
	canvas.className = "block h-full w-full cursor-crosshair";
	tooltip.className = "pointer-events-none absolute z-10 hidden max-w-[300px] rounded-lg border border-white/10 bg-[color-mix(in_oklch,var(--popover)_94%,transparent)] px-2.5 py-2 text-[11px] leading-snug text-popover-foreground shadow-xl backdrop-blur";
	element.append(canvas, tooltip);

	const x = (hz) => {
		return (log10(Math.max(hz, 1)) - state.view.low) / (state.view.high - state.view.low) * state.width;
	};

	const hzAt = (px) => {
		return Math.pow(10, state.view.low + px / state.width * (state.view.high - state.view.low));
	};

	const viewHz = () => {
		return { low: Math.pow(10, state.view.low), high: Math.pow(10, state.view.high) };
	};

	const visibleBands = () => {
		const range = viewHz();
		return plan.bands.filter((band) => {
			return band.high_hz > range.low && band.low_hz < range.high;
		});
	};

	const bandAt = (hz) => {
		return plan.bands.find((band) => {
			return hz >= band.low_hz && hz < band.high_hz;
		}) || null;
	};

	const text = (value, px, py, color, font) => {
		context.fillStyle = color;
		context.font = font || "10px Inter, sans-serif";
		context.fillText(value, px, py);
	};

	const fits = (value, width) => {
		return context.measureText(value).width + 6 < width;
	};

	const drawBands = (bands) => {
		const lane = LANES.band;
		context.font = "600 10px Inter, sans-serif";

		bands.forEach((band) => {
			const x0 = Math.max(0, x(band.low_hz));
			const x1 = Math.min(state.width, x(band.high_hz));
			const category = categoryOf(band);
			const primary = band.services.filter((service) => {
				return service.primary;
			}).map((service) => {
				return service.en.toUpperCase();
			}).join(" · ");

			context.globalAlpha = 0.28;
			context.fillStyle = category.color;
			context.fillRect(x0, lane.top, x1 - x0, lane.height);
			context.globalAlpha = 1;
			context.fillRect(x0, lane.top, x1 - x0, 3);
			context.fillStyle = "rgb(0 0 0 / 0.5)";
			context.fillRect(x0, lane.top, 1, lane.height);

			const label = fits(primary, x1 - x0) ? primary : (fits(category.label, x1 - x0) ? category.label : "");
			if (label) {
				context.save();
				context.beginPath();
				context.rect(x0, lane.top, x1 - x0, lane.height);
				context.clip();
				text(label, Math.max(x0, 0) + 4, lane.top + 20, "rgb(255 255 255 / 0.85)", "600 10px Inter, sans-serif");
				context.restore();
			}
		});
	};

	const drawUses = (bands) => {
		const lane = LANES.use;
		const drawn = {};
		let labelEnd = -Infinity;

		bands.forEach((band) => {
			band.uses.filter((use) => {
				return use.ranges.length > 0 && !use.background;
			}).forEach((use) => {
				use.ranges.filter((range) => {
					// the same sub-band is often listed under several services
					const key = range.join("-") + "|" + (use.en || use.sr) + "|" + use.users.join();
					const seen = drawn[key];
					drawn[key] = true;
					return !seen;
				}).forEach((range) => {
					const x0 = Math.max(0, x(range[0]));
					const x1 = Math.min(state.width, x(range[1]));
					const color = USER_COLORS[use.users[0]] || "#94a3b8";
					const label = (use.en || use.sr) + (use.users.length ? " · " + use.users.join(", ") : "");

					if (x1 - x0 < 1) {
						return;
					}

					context.globalAlpha = 0.45;
					context.fillStyle = color;
					context.fillRect(x0, lane.top, Math.max(1, x1 - x0), lane.height);
					context.globalAlpha = 1;
					context.font = "10px Inter, sans-serif";

					if (fits(label, x1 - x0) && x0 > labelEnd) {
						text(label, x0 + 3, lane.top + 12, "rgb(255 255 255 / 0.9)");
						labelEnd = x0 + context.measureText(label).width + LABEL_GAP_PX;
					}
				});
			});
		});
	};

	const drawBlocks = () => {
		const lane = LANES.block;
		const range = viewHz();

		state.index.blocks.forEach((block) => {
			if (block.high < range.low || block.low > range.high) {
				return;
			}

			const x0 = Math.max(0, x(block.low));
			const x1 = Math.min(state.width, x(block.high));
			context.globalAlpha = Math.min(0.85, 0.2 + Math.log(1 + block.count) / 10);
			context.fillStyle = (options.kinds[block.kind] || { color: "#94a3b8" }).color;
			context.fillRect(x0, lane.top, Math.max(1, x1 - x0), lane.height);
		});

		context.globalAlpha = 1;
	};

	const visibleSignals = () => {
		const range = viewHz();
		const signals = state.index.signals;
		// widest narrow signal is < BLOCK_MIN_HZ, so start that far left
		const start = lowerBound(signals, range.low - BLOCK_MIN_HZ);
		const end = lowerBound(signals, range.high);

		return signals.slice(start, end).filter((signal) => {
			return signal.high >= range.low;
		});
	};

	const drawSignals = (signals) => {
		const top = LANES.signalTop;
		const bottom = state.height - LANES.ruler - 2;
		const peak = signals.reduce((max, signal) => {
			return Math.max(max, signal.count);
		}, 1);
		let labelEnd = -Infinity;

		context.fillStyle = "rgb(255 255 255 / 0.03)";
		context.fillRect(0, top, state.width, bottom - top);

		signals.forEach((signal) => {
			const x0 = x(signal.low);
			const x1 = x(signal.high);
			const width = Math.max(1, x1 - x0);
			const height = 6 + Math.log(1 + signal.count) / Math.log(1 + peak) * (bottom - top - 22);
			const hovered = state.hover && state.hover.signal === signal;

			context.globalAlpha = hovered ? 1 : 0.75;
			context.fillStyle = (options.kinds[signal.kind] || { color: "#94a3b8" }).color;
			context.fillRect(x0, bottom - height, width, height);
			context.globalAlpha = 1;

			// label the signal when the view is zoomed in enough to keep labels apart
			const label = signal.label + (signal.count > 1 ? " +" + (signal.count - 1) : "");
			context.font = "10px Inter, sans-serif";
			const labelWidth = context.measureText(label).width;

			if (width >= 3 && x0 > labelEnd + LABEL_GAP_PX && signals.length < 400) {
				text(label, x0, bottom - height - 3, "rgb(226 232 240 / 0.8)");
				labelEnd = x0 + labelWidth;
			}
		});
	};

	const drawSelected = () => {
		if (!state.selected) {
			return;
		}

		const x0 = x(state.selected.low);
		const x1 = x(state.selected.high);
		const middle = (x0 + x1) / 2;

		context.fillStyle = "rgb(103 232 249 / 0.18)";
		context.fillRect(x0, 0, Math.max(2, x1 - x0), state.height - LANES.ruler);
		context.strokeStyle = "#67e8f9";
		context.lineWidth = 1.5;
		context.beginPath();
		context.moveTo(middle, 0);
		context.lineTo(middle, state.height - LANES.ruler);
		context.stroke();

		if (state.selected.rx) {
			const rx = x(state.selected.rx);
			context.setLineDash([3, 3]);
			context.beginPath();
			context.moveTo(rx, LANES.signalTop);
			context.lineTo(rx, state.height - LANES.ruler);
			context.stroke();
			context.setLineDash([]);
		}
	};

	const drawRuler = () => {
		const top = state.height - LANES.ruler;
		const range = viewHz();

		context.fillStyle = "rgb(0 0 0 / 0.35)";
		context.fillRect(0, top, state.width, LANES.ruler);
		context.font = "10px 'JetBrains Mono', monospace";

		const list = ticks(range.low, range.high, state.width);

		list.forEach((tick) => {
			const px = x(tick.hz);
			context.fillStyle = tick.major ? "rgb(255 255 255 / 0.35)" : "rgb(255 255 255 / 0.15)";
			context.fillRect(px, top, 1, 5);
			context.fillStyle = "rgb(255 255 255 / 0.05)";
			context.fillRect(px, LANES.signalTop, 1, top - LANES.signalTop);

			if (tick.major || list.length < 12) {
				text(formatHz(tick.hz, 7), px + 3, top + 14, "rgb(255 255 255 / 0.6)", "10px 'JetBrains Mono', monospace");
			}
		});
	};

	const draw = () => {
		state.frame = 0;
		const ratio = window.devicePixelRatio || 1;
		const width = element.clientWidth;
		const height = element.clientHeight;

		if (!width || !height) {
			return;
		}

		if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
		}

		state.width = width;
		state.height = height;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);

		const bands = visibleBands();
		drawBands(bands);
		drawUses(bands);
		drawBlocks();
		drawSignals(visibleSignals());
		drawSelected();
		drawRuler();
	};

	const redraw = () => {
		if (!state.frame) {
			state.frame = requestAnimationFrame(draw);
		}
	};

	const viewChanged = () => {
		redraw();

		if (options.onView) {
			options.onView(viewHz());
		}
	};

	const setLogView = (view) => {
		state.view = clampView(view);
		viewChanged();
	};

	// Zoom by `factor` (< 1 = in) keeping the frequency under px in place
	const zoomAt = (px, factor) => {
		const anchor = state.view.low + px / state.width * (state.view.high - state.view.low);
		setLogView({ low: anchor - (anchor - state.view.low) * factor, high: anchor + (state.view.high - anchor) * factor });
	};

	const panBy = (dx) => {
		const shift = dx / state.width * (state.view.high - state.view.low);
		const span = state.view.high - state.view.low;
		const low = Math.min(Math.max(state.view.low - shift, log10(MIN_HZ)), log10(MAX_HZ) - span);
		setLogView({ low: low, high: low + span });
	};

	// --- hover ----------------------------------------------------------------

	const signalAt = (px, py) => {
		if (py < LANES.signalTop || py > state.height - LANES.ruler) {
			return null;
		}

		return visibleSignals().reduce((best, signal) => {
			const x0 = x(signal.low) - HOVER_RADIUS_PX;
			const x1 = x(signal.high) + HOVER_RADIUS_PX;
			const distance = Math.abs((x0 + x1) / 2 - px);

			if (px < x0 || px > x1 || (best && best.distance <= distance)) {
				return best;
			}

			return { signal: signal, distance: distance };
		}, null);
	};

	const blocksAt = (hz) => {
		return state.index.blocks.filter((block) => {
			return hz >= block.low && hz <= block.high;
		});
	};

	const row = (label, value) => {
		return "<div class=\"flex gap-2\"><span class=\"w-14 flex-none text-muted-foreground\">" + label + "</span><span>" + value + "</span></div>";
	};

	const escape = (value) => {
		return String(value).replace(/[&<>"]/g, (char) => {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char];
		});
	};

	const showTooltip = (px, py) => {
		const hz = hzAt(px);
		const band = bandAt(hz);
		const found = signalAt(px, py);
		const resolution = (hzAt(px + 1) - hz);
		const digits = Math.max(4, Math.min(10, Math.ceil(log10(hz / Math.max(resolution, 1))) + 1));
		const parts = ["<div class=\"mb-1 font-mono text-[12px] text-foreground\">" + formatHz(hz, digits) + "</div>"];

		state.hover = found ? { signal: found.signal } : null;

		if (found) {
			const signal = found.signal;
			parts.push("<div class=\"mb-1 font-medium\" style=\"color:" + (options.kinds[signal.kind] || {}).color + "\">" + escape(signal.label || "unnamed") + "</div>");
			parts.push(row("TX", formatHz(signal.centre, 9)));
			parts.push(row("Shared", signal.count === 1 ? "only this one" : signal.count + " transmitters"));
			parts.push("<div class=\"mt-1 text-muted-foreground\">Click to open</div>");
		} else if (band) {
			const uses = band.uses.filter((use) => {
				return !use.background && (use.ranges.length === 0 || use.ranges.some((range) => {
					return hz >= range[0] && hz <= range[1];
				}));
			});
			const blocks = blocksAt(hz);

			parts.push(row("Band", escape(band.label)));
			parts.push(row("Services", band.services.map((service) => {
				return service.primary ? "<b>" + escape(service.en.toUpperCase()) + "</b>" : escape(service.en);
			}).join(", ")));

			if (uses.length) {
				parts.push(row("Uses", uses.slice(0, 6).map((use) => {
					return escape(use.en || use.sr) + (use.users.length ? " <span style=\"color:" + USER_COLORS[use.users[0]] + "\">(" + escape(use.users.join(", ")) + ")</span>" : "");
				}).join("<br>")));
			}

			if (blocks.length) {
				parts.push(row("Blocks", blocks.slice(0, 4).map((block) => {
					return escape((options.kinds[block.kind] || { label: block.kind }).label) + " × " + block.count;
				}).join("<br>")));
			}

			parts.push("<div class=\"mt-1 text-muted-foreground\">Click the band bar to zoom to it</div>");
		}

		tooltip.innerHTML = parts.join("");
		tooltip.classList.remove("hidden");

		const left = px + 14 + tooltip.offsetWidth > state.width ? px - 14 - tooltip.offsetWidth : px + 14;
		tooltip.style.left = Math.max(4, left) + "px";
		tooltip.style.top = Math.max(4, Math.min(py + 10, state.height - tooltip.offsetHeight - 4)) + "px";
		redraw();
	};

	const hideTooltip = () => {
		tooltip.classList.add("hidden");
		state.hover = null;
		redraw();
	};

	// --- input ----------------------------------------------------------------

	const localPoint = (event) => {
		const box = canvas.getBoundingClientRect();
		return { x: event.clientX - box.left, y: event.clientY - box.top };
	};

	const onWheel = (event) => {
		event.preventDefault();
		const point = localPoint(event);
		// horizontal wheel / trackpad swipe pans, vertical zooms
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
			panBy(-event.deltaX);
		} else {
			zoomAt(point.x, Math.exp(event.deltaY * WHEEL_ZOOM));
		}
	};

	const onPointerDown = (event) => {
		canvas.setPointerCapture(event.pointerId);
		const point = localPoint(event);
		state.pointers.set(event.pointerId, point);
		state.drag = { start: point, moved: false };
	};

	const onPointerMove = (event) => {
		const point = localPoint(event);
		const previous = state.pointers.get(event.pointerId);

		if (!previous) {
			if (event.pointerType === "mouse") {
				showTooltip(point.x, point.y);
			}
			return;
		}

		if (state.pointers.size === 2) {
			// pinch: zoom by the change of distance between the two fingers
			const other = Array.from(state.pointers.entries()).find((entry) => {
				return entry[0] !== event.pointerId;
			})[1];
			const before = Math.abs(previous.x - other.x);
			const after = Math.abs(point.x - other.x);

			if (before > 10 && after > 10) {
				zoomAt((point.x + other.x) / 2, before / after);
			}
		} else {
			panBy(point.x - previous.x);
		}

		state.pointers.set(event.pointerId, point);

		if (state.drag && Math.abs(point.x - state.drag.start.x) + Math.abs(point.y - state.drag.start.y) > 4) {
			state.drag.moved = true;
			hideTooltip();
		}
	};

	const onPointerUp = (event) => {
		const point = localPoint(event);
		const wasTap = state.drag && !state.drag.moved && state.pointers.size === 1;
		state.pointers.delete(event.pointerId);

		if (!wasTap) {
			return;
		}

		state.drag = null;
		const found = signalAt(point.x, point.y);

		if (found && found.signal.id !== undefined && found.signal.id !== null) {
			options.onOpen(found.signal.id);
			return;
		}

		if (point.y <= LANES.band.top + LANES.band.height) {
			const band = bandAt(hzAt(point.x));
			if (band) {
				api.showBand(band);
			}
			return;
		}

		// touch: a tap shows what is there
		showTooltip(point.x, point.y);
	};

	const onDoubleClick = (event) => {
		zoomAt(localPoint(event).x, 0.4);
	};

	canvas.addEventListener("wheel", onWheel, { passive: false });
	canvas.addEventListener("pointerdown", onPointerDown);
	canvas.addEventListener("pointermove", onPointerMove);
	canvas.addEventListener("pointerup", onPointerUp);
	canvas.addEventListener("pointercancel", onPointerUp);
	canvas.addEventListener("pointerleave", (event) => {
		if (event.pointerType === "mouse") {
			hideTooltip();
		}
	});
	canvas.addEventListener("dblclick", onDoubleClick);

	const resize = new ResizeObserver(redraw);
	resize.observe(element);

	const api = {
		element: element,

		setSignals: (rows) => {
			state.index = indexSignals(rows);
			redraw();
		},

		/**
		 * @param {Object|null} selected - { low, high, rx } in Hz
		 */
		setSelected: (selected) => {
			state.selected = selected;
			redraw();
		},

		// Show [low, high] Hz with a little margin
		setView: (low, high) => {
			hideTooltip();
			const margin = (log10(high) - log10(Math.max(low, 1))) * 0.08;
			setLogView({ low: log10(Math.max(low, MIN_HZ)) - margin, high: log10(high) + margin });
		},

		// Centre on hz with `span` Hz around it
		centre: (hz, span) => {
			hideTooltip();
			const low = Math.max(MIN_HZ, hz - span / 2);
			setLogView({ low: log10(low), high: log10(low + span) });
		},

		showBand: (band) => {
			api.setView(Math.max(band.low_hz, MIN_HZ), band.high_hz);
		},

		bandAt: bandAt,
		view: viewHz,

		zoom: (factor) => {
			hideTooltip();
			zoomAt(state.width / 2, factor);
		},

		destroy: () => {
			resize.disconnect();
			cancelAnimationFrame(state.frame);
		}
	};

	return api;
};
