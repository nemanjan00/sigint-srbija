const web = require("./web");
const live = require("./live");

const PORT = Number(process.env.PORT) || 3000;

web.listen(PORT, (error) => {
	if (error) {
		console.error("Cannot listen on port " + PORT + ": " + error.message);
		process.exit(1);
	}

	console.log("sigint-srbija map on http://localhost:" + PORT);

	// BrandMeister last heard (SIGINT_LIVE=0 turns it off)
	if (process.env.SIGINT_LIVE !== "0") {
		live.start();
	}
});
