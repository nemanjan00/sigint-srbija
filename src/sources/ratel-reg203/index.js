// RATEL licence register reg203: downloads the full CSV export, rebuilds the
// reg203_* detail tables and returns every assignment as an emitter.
// HTML-only fields are added separately with `yarn reg203-enrich` (slow).
const fs = require("fs");
const path = require("path");
const reg203 = require("../../reg203");
const reg203Database = require("../../reg203/database");
const storage = require("../../storage");

const CSV_DIR = path.join(storage.DB_DIR, "reg203");
// raw exports are ~100 MB each; keep the newest few
const KEEP_CSV = Number(process.env.REG203_KEEP_CSV) || 7;

const pruneCsv = () => {
	fs.readdirSync(CSV_DIR).filter((name) => {
		return /^reg203_\d{4}-\d{2}-\d{2}\.csv$/.test(name);
	}).sort().reverse().slice(KEEP_CSV).forEach((name) => {
		fs.unlinkSync(path.join(CSV_DIR, name));
		console.log("  removed old export " + name);
	});
};

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
				pruneCsv();
				return database.getEmitters();
			});
	}
};

module.exports = ratelReg203;
