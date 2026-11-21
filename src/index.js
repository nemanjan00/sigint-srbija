const web = require("./web");
const live = require("./live");
const aprs = require("./aprs");
const hoseRelay = require("./hose-relay");

const PORT = Number(process.env.PORT) || 3000;

const server = web.listen(PORT, (error) => {
	if (error) {
		console.error("Cannot listen on port " + PORT + ": " + error.message);
		process.exit(1);
	}

	console.log("sigint-srbija map on http://localhost:" + PORT);

	// BrandMeister last heard and APRS-IS (SIGINT_LIVE=0 turns them off)
	if (process.env.SIGINT_LIVE !== "0") {
		live.start();
		aprs.start();
	}
});

// Hoseline audio for browsers that can't reach BrandMeister directly
hoseRelay.attach(server);
