// RATEL licence register reg203: downloads the full CSV export, rebuilds the
// reg203_* detail tables and returns every assignment as an emitter.
// HTML-only fields are added separately with `yarn reg203-enrich` (slow).
const path = require("path");
const reg203 = require("../../reg203");
const reg203Database = require("../../reg203/database");
const storage = require("../../storage");

const CSV_DIR = path.join(storage.DATA_DIR, "reg203");

const ratelReg203 = {
	id: "ratel-reg203",
	description: "RATEL register of radio-frequency licences (reg203), incl. aircraft and ships",
	url: "https://registar.ratel.rs/cyr/reg203",

	fetch: () => {
		const csvFile = path.join(CSV_DIR, "reg203_" + new Date().toISOString().slice(0, 10) + ".csv");
		const database = reg203Database.open();

		return reg203.download(csvFile)
			.then(() => {
				return reg203.build(database, csvFile);
			})
			.then(() => {
				return database.getEmitters();
			});
	}
};

module.exports = ratelReg203;
