// Mirror documents (PDF/DOC/XLS/...) published on www.ratel.rs, one directory
// per page, following the site's menu hierarchy.
//
// Every page renders the complete page tree in <section id="menu">, so the menu
// is parsed once; then every page in the chosen subtree is visited and every
// document linked from the page body is downloaded. Existing files are skipped.
//
// Some upload URLs contain bytes that are not valid UTF-8, so page bodies are
// handled as latin1 strings (1 char = 1 byte) to keep links byte-exact.
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const decodeHTML = require("entities").decodeHTML;
const ratelWebsite = require("../services/ratel-website");

const DOC_EXTENSION = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|odt|ods)$/i;
const SLUG_HREF = /^(?:https:\/\/www\.ratel\.rs)?\/sr\/([^/?#"]+)$/;
const MENU_SECTION = /<section id="menu">[\s\S]*?<\/section>/;
const MAX_LABEL_LENGTH = 150;
const URL_SAFE_BYTE = /[A-Za-z0-9_.\-~:/%]/;

const latin1ToUtf8 = (text) => {
	return Buffer.from(text, "latin1").toString("utf8");
};

// Percent-decode to raw bytes (%XX -> byte, other chars -> their latin1 byte)
const percentDecode = (text) => {
	const bytes = [];
	let index = 0;

	while (index < text.length) {
		const hex = text.slice(index + 1, index + 3);

		if (text[index] === "%" && /^[0-9a-fA-F]{2}$/.test(hex)) {
			bytes.push(parseInt(hex, 16));
			index += 3;
		} else {
			bytes.push(text.charCodeAt(index) & 0xff);
			index++;
		}
	}

	return Buffer.from(bytes);
};

// Percent-encode every byte except [A-Za-z0-9_.-~:/%]
const percentEncode = (text) => {
	return Array.from(Buffer.from(text, "latin1")).map((byte) => {
		const char = String.fromCharCode(byte);

		if (byte < 0x80 && URL_SAFE_BYTE.test(char)) {
			return char;
		}

		return "%" + byte.toString(16).toUpperCase().padStart(2, "0");
	}).join("");
};

const safeName = (text) => {
	return text.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
};

const parseMenuItems = ($, list) => {
	return list.children("li").toArray().map((item) => {
		const link = $(item).children("a").first();
		const match = (link.attr("href") || "").match(SLUG_HREF);

		return {
			slug: match ? match[1] : null,
			title: match ? link.text().trim() : "",
			children: $(item).children("ul").toArray().reduce((children, sublist) => {
				return children.concat(parseMenuItems($, $(sublist)));
			}, [])
		};
	});
};

// Site menu -> [{ slug, title, children }]
const parseMenu = (html) => {
	const $ = cheerio.load(html);
	const menu = $("section#menu");

	if (menu.length === 0) {
		throw new Error("Site menu not found on page");
	}

	return menu.children("ul").toArray().reduce((items, list) => {
		return items.concat(parseMenuItems($, $(list)));
	}, []);
};

const findNode = (nodes, slug) => {
	return nodes.reduce((found, node) => {
		if (found) {
			return found;
		}

		if (node.slug === slug) {
			return node;
		}

		return findNode(node.children, slug);
	}, null);
};

const formatTree = (node, indent) => {
	const depth = indent || 0;
	const line = "  ".repeat(depth) + node.slug + "  (" + node.title + ")";

	return [line].concat(node.children.map((child) => {
		return formatTree(child, depth + 1);
	})).join("\n");
};

// href (latin1) -> link text, for every document linked from the page body
const parseDocuments = (pageLatin1) => {
	const withoutMenu = pageLatin1.replace(MENU_SECTION, "");
	const main = withoutMenu.match(/<main[^>]*>([\s\S]*?)<\/main>/);
	const body = main ? main[1] : withoutMenu;

	return Array.from(body.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)).reduce((documents, match) => {
		const href = match[1];

		if (!DOC_EXTENSION.test(href) && !href.includes("/storage/upload/")) {
			return documents;
		}

		const label = decodeHTML(latin1ToUtf8(match[2]).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
		const known = documents[href];

		if (known === undefined || (["", "preuzmi"].includes(known.toLowerCase()) && label)) {
			documents[href] = label;
		}

		return documents;
	}, {});
};

// File name from URL; hashed, garbled or extension-less names use the link text
const fileNameFor = (url, label) => {
	const decoded = percentDecode(url.slice(url.lastIndexOf("/") + 1)).toString("utf8").normalize("NFC");
	const name = decoded.replace(/�/g, "_").replace(/\//g, "-");
	const hashed = /^[A-Za-z0-9_-]{30,}\.\w+$/.test(name);
	const garbled = decoded.includes("�");
	const usableLabel = label && label.toLowerCase() !== "preuzmi";

	if ((hashed || garbled || !DOC_EXTENSION.test(name)) && usableLabel) {
		const extension = name.match(DOC_EXTENSION);
		return safeName(label).slice(0, MAX_LABEL_LENGTH) + (extension ? extension[0] : ".pdf");
	}

	return name;
};

/**
 * Download one document unless it already exists
 * @param {string} hrefLatin1 - href as found in page (latin1, HTML-escaped)
 * @param {string} directory - Output directory
 * @param {string} label - Link text
 * @returns {Promise<{status: string, name: string, detail: string}>} status: ok | skip | fail
 */
const downloadDocument = (hrefLatin1, directory, label) => {
	const href = decodeHTML(hrefLatin1);
	let url = href;

	if (href.startsWith("/")) {
		url = ratelWebsite.baseUrl + href;
	}

	const name = fileNameFor(url, label);
	const destination = path.join(directory, name);

	if (fs.existsSync(destination)) {
		return Promise.resolve({ status: "skip", name: name, detail: "" });
	}

	return ratelWebsite.download(percentEncode(url)).then((response) => {
		if (response.statusCode === 200 && response.body.length > 0 && !response.contentType.includes("text/html")) {
			fs.writeFileSync(destination, response.body);
			return { status: "ok", name: name, detail: "" };
		}

		return { status: "fail", name: name, detail: response.statusCode + " " + response.contentType };
	}).catch((error) => {
		return { status: "fail", name: name, detail: error.code || error.message };
	});
};

const getMenu = (slug) => {
	return ratelWebsite.getPage(slug).then((page) => {
		return parseMenu(page.toString("utf8"));
	});
};

/**
 * Mirror a menu node and all its subpages into directory/<slug>/...
 * @param {Object} node - Menu node from getMenu
 * @param {string} directory - Parent output directory
 * @param {Object} stats - Counters, mutated: pages, ok, skip, fail
 */
const mirror = (node, directory, stats) => {
	const nodeDirectory = path.join(directory, node.slug);
	fs.mkdirSync(nodeDirectory, { recursive: true });

	return ratelWebsite.getPage(node.slug).then((page) => {
		return parseDocuments(page.toString("latin1"));
	}).catch((error) => {
		console.error("  page " + node.slug + " failed: " + error.message);
		return {};
	}).then((documents) => {
		const hrefs = Object.keys(documents);
		stats.pages++;
		console.log("=== " + nodeDirectory + " [" + node.title + "]: " + hrefs.length + " docs");

		return hrefs.reduce((chain, href) => {
			return chain.then(() => {
				return downloadDocument(href, nodeDirectory, documents[href]);
			}).then((result) => {
				stats[result.status]++;

				if (result.status !== "ok") {
					console.log("  " + (result.status + " " + result.detail).trim().padStart(6) + " " + result.name);
				}
			});
		}, Promise.resolve());
	}).then(() => {
		return node.children.reduce((chain, child) => {
			return chain.then(() => {
				return mirror(child, nodeDirectory, stats);
			});
		}, Promise.resolve());
	}).then(() => {
		if (fs.readdirSync(nodeDirectory).length === 0) {
			fs.rmdirSync(nodeDirectory);
		}

		return stats;
	});
};

module.exports = {
	getMenu: getMenu,
	findNode: findNode,
	formatTree: formatTree,
	mirror: mirror,
	parseMenu: parseMenu,
	parseDocuments: parseDocuments,
	fileNameFor: fileNameFor
};
