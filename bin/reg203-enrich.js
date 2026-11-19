// Add HTML-only fields (holder name/address, inspection and start dates, full
// station description) to reg203 by walking all ~8k search pages, then refresh
// the reg203 emitters. Run `yarn fetch ratel-reg203` first.
const parseArgs = require("util").parseArgs;
const reg203 = require("../src/reg203");
const reg203Database = require("../src/reg203/database");
const ratelReg203 = require("../src/sources/ratel-reg203");
const storage = require("../src/storage");
const geo = require("../src/geo");

const DEFAULT_WORKERS = 4;

const USAGE = `Usage: yarn reg203-enrich [options]

  --workers <n>        parallel HTML fetches (default 4)
  --limit-pages <n>    (testing) enrich only the first N pages`;

const args = parseArgs({
	options: {
		"workers": { type: "string", default: String(DEFAULT_WORKERS) },
		"limit-pages": { type: "string" },
		"help": { type: "boolean", short: "h", default: false }
	}
}).values;

if (args.help) {
	console.log(USAGE);
	process.exit(0);
}

const database = reg203Database.open();

reg203.enrich(database, {
	workers: Number(args.workers),
	limitPages: args["limit-pages"] ? Number(args["limit-pages"]) : null
})
	.then(() => {
		const count = storage.replaceEmitters(ratelReg203, database.getEmitters());
		console.log(ratelReg203.id + ": refreshed " + count + " emitters");
		geo.resolve();
		storage.close();
		// TODO: drop once queue-promised stops re-arming runWaiter on an empty queue (keeps the process alive)
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
