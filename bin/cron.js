// Scheduled database update: fetch every source, then enrich reg203.
// Steps run as child processes, so each starts clean and exits on its own
// (queue-promised keeps a finished process alive, see CLAUDE.md).
const path = require("path");
const spawn = require("child_process").spawn;
const cron = require("node-cron");

const SCHEDULE = process.env.UPDATE_SCHEDULE || "0 4 * * *";
const TIMEZONE = process.env.UPDATE_TIMEZONE || "Europe/Belgrade";
const RUN_ON_START = process.env.UPDATE_ON_START === "1";
const ROOT = path.join(__dirname, "..");
const STEPS = ["bin/fetch.js", "bin/reg203-enrich.js"];

let running = false;

const log = (message) => {
	console.log(new Date().toISOString() + " " + message);
};

const runStep = (script) => {
	const start = Date.now();
	log("start " + script);

	return new Promise((resolve) => {
		const child = spawn(process.execPath, [script], { cwd: ROOT, stdio: "inherit", env: process.env });

		child.on("close", (code) => {
			log("done " + script + " (exit " + code + ", " + Math.round((Date.now() - start) / 1000) + "s)");
			resolve(code);
		});
	});
};

// A failed step does not stop the next one: enrichment of the previous data is still useful
const update = () => {
	if (running) {
		log("previous update still running, skipping");
		return Promise.resolve();
	}

	running = true;

	return STEPS.reduce((chain, script) => {
		return chain.then(() => {
			return runStep(script);
		});
	}, Promise.resolve()).then(() => {
		running = false;
	});
};

if (!cron.validate(SCHEDULE)) {
	console.error("Invalid UPDATE_SCHEDULE: " + SCHEDULE);
	process.exit(1);
}

cron.schedule(SCHEDULE, update, { timezone: TIMEZONE });
log("database update scheduled: " + SCHEDULE + " (" + TIMEZONE + ")");

if (RUN_ON_START) {
	update();
}
