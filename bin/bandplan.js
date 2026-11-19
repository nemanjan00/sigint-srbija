// Parse RATEL's band plan table (PDF) into data/bandplan.json. Needs
// `pdftotext` (poppler). The PDF comes with `yarn ratel-docs regulativa-elektronske-komunikacije`.
//   yarn bandplan [path/to/Tabela-1.pdf]
const execFile = require("child_process").execFile;
const fs = require("fs");
const path = require("path");
const parser = require("../src/bandplan/parser");

const DEFAULT_PDF = path.join(__dirname, "../lib/regulativa-elektronske-komunikacije/plan-namene-i-planovi-raspodele/Plan-namene-RF-opsega---Tabela-1---Namena-RF-opsega-u-Republici-Srbiji-(002).pdf");
const OUTPUT = path.join(__dirname, "../data/bandplan.json");
const SOURCE = {
	title: "Plan namene radiofrekvencijskih opsega — Tabela 1 (nezvanično prečišćen tekst)",
	url: "https://www.ratel.rs/sr/regulativa-elektronske-komunikacije/plan-namene-i-planovi-raspodele"
};
const MAX_BUFFER = 256 * 1024 * 1024;

const pdf = process.argv[2] || DEFAULT_PDF;

const pdfToBbox = (file) => {
	return new Promise((resolve, reject) => {
		execFile("pdftotext", ["-bbox", file, "-"], { maxBuffer: MAX_BUFFER }, (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}

			resolve(stdout);
		});
	});
};

const pdfDate = (file) => {
	return new Promise((resolve) => {
		execFile("pdfinfo", ["-isodates", file], (error, stdout) => {
			const match = !error && stdout.match(/CreationDate:\s+(\S+)/);
			resolve(match ? match[1].slice(0, 10) : null);
		});
	});
};

Promise.all([pdfToBbox(pdf), pdfDate(pdf)])
	.then((results) => {
		const bands = parser.parse(results[0]);
		const plan = Object.assign({}, SOURCE, { file: path.basename(pdf), date: results[1], bands: bands });

		fs.writeFileSync(OUTPUT, JSON.stringify(plan) + "\n");
		console.log("bandplan:", bands.length, "bands,", bands[0].label, "...", bands[bands.length - 1].label, "->", OUTPUT);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
