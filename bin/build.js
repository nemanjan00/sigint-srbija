// Builds the map page: src/web/client -> src/web/dist (served by src/web).
// JS is bundled by esbuild (qrp-shadcdn, maplibre-gl from node_modules), CSS
// by the Tailwind CLI (scans the client sources for class names).
//
//   node bin/build.js           one minified build
//   node bin/build.js --watch   rebuild on change (development)
const path = require("path");
const fs = require("fs");
const childProcess = require("child_process");
const esbuild = require("esbuild");

const CLIENT_DIR = path.join(__dirname, "..", "src", "web", "client");
const DIST_DIR = path.join(__dirname, "..", "src", "web", "dist");
const TAILWIND = path.join(__dirname, "..", "node_modules", ".bin", "tailwindcss");
const STATIC_FILES = ["index.html"];

const watch = process.argv.includes("--watch");

const JS_OPTIONS = {
	entryPoints: [path.join(CLIENT_DIR, "app.js")],
	outfile: path.join(DIST_DIR, "app.js"),
	bundle: true,
	format: "esm",
	target: "es2020",
	minify: !watch,
	sourcemap: true,
	logLevel: "info"
};

const copyStatic = () => {
	STATIC_FILES.forEach((file) => {
		fs.copyFileSync(path.join(CLIENT_DIR, file), path.join(DIST_DIR, file));
	});
};

/**
 * @param {boolean} keepWatching run the CLI in --watch mode (never resolves)
 */
const buildCss = (keepWatching) => {
	const args = ["-i", path.join(CLIENT_DIR, "index.css"), "-o", path.join(DIST_DIR, "app.css")];
	const extra = keepWatching ? ["--watch"] : ["--minify"];

	return new Promise((resolve, reject) => {
		const child = childProcess.spawn(TAILWIND, args.concat(extra), { stdio: "inherit" });

		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error("tailwindcss exited with " + code));
			}
		});
	});
};

const buildOnce = () => {
	return Promise.all([
		esbuild.build(JS_OPTIONS),
		buildCss(false)
	]);
};

const buildWatching = () => {
	fs.watch(CLIENT_DIR, (_event, file) => {
		if (STATIC_FILES.includes(file)) {
			copyStatic();
		}
	});

	return esbuild.context(JS_OPTIONS)
		.then((context) => {
			return Promise.all([context.watch(), buildCss(true)]);
		});
};

fs.mkdirSync(DIST_DIR, { recursive: true });
copyStatic();

(watch ? buildWatching() : buildOnce())
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
