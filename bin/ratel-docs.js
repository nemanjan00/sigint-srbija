// Mirror documents from www.ratel.rs sections into lib/. See src/ratel-docs.
const path = require("path");
const parseArgs = require("util").parseArgs;
const ratelDocs = require("../src/ratel-docs");

const DEFAULT_OUT = path.join(__dirname, "..", "lib");
const DEFAULT_SLUGS = ["regulativa-elektronske-komunikacije", "rf-spektar"];

const USAGE = `Usage: yarn ratel-docs [options] [slug ...]

  slug           page slug (part after /sr/) to mirror with all subpages
                 (default: ${DEFAULT_SLUGS.join(" ")})
  --out <dir>    output root directory (default lib)
  --tree         only print the subtree(s), download nothing`;

const parsed = parseArgs({
	allowPositionals: true,
	options: {
		"out": { type: "string", default: DEFAULT_OUT },
		"tree": { type: "boolean", default: false },
		"help": { type: "boolean", short: "h", default: false }
	}
});
const args = parsed.values;

if (args.help) {
	console.log(USAGE);
	process.exit(0);
}

let slugs = DEFAULT_SLUGS;

if (parsed.positionals.length > 0) {
	slugs = parsed.positionals;
}

const stats = { pages: 0, ok: 0, skip: 0, fail: 0 };

ratelDocs.getMenu(slugs[0])
	.then((menu) => {
		const nodes = slugs.map((slug) => {
			const node = ratelDocs.findNode(menu, slug);

			if (!node) {
				throw new Error("Slug not found in site menu: " + slug);
			}

			return node;
		});

		return nodes.reduce((chain, node) => {
			return chain.then(() => {
				if (args.tree) {
					console.log(ratelDocs.formatTree(node));
					return null;
				}

				return ratelDocs.mirror(node, args.out, stats);
			});
		}, Promise.resolve());
	})
	.then(() => {
		if (!args.tree) {
			console.log(stats);
		}
	})
	.catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
