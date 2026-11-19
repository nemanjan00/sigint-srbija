const tls = require("tls");
const X509Certificate = require("crypto").X509Certificate;
const got = require("got-verbose");
const withRetry = require("../../utils/retry").withRetry;

const BASE_URL = "https://registar.ratel.rs";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// registar.ratel.rs does not send its intermediate certificate, so a verifying
// client fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE. We fetch the intermediate
// from the issuer (URL from the leaf's Authority Information Access) and add it
// to the CA list, which keeps full verification.
const INTERMEDIATE_CERT_URL = "http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt";

const SEARCH_PARAMS = {
	action: "table",
	source: "1000",
	filter: "",
	vazece: "",
	nosilacNaziv: "",
	vrstaSluzbe: "",
	vrstaStanice: "",
	freqOd: "",
	freqOdJedinica: "6",
	freqDo: "",
	freqDoJedinica: "6"
};

const REQUEST_TIMEOUT = 300 * 1000;
const EXPORT_TIMEOUT = 900 * 1000;

const ratelRegistry = {
	_client: null,

	_getClient: () => {
		if (ratelRegistry._client) {
			return ratelRegistry._client;
		}

		ratelRegistry._client = got.get(INTERMEDIATE_CERT_URL, { responseType: "buffer" }).then((response) => {
			const intermediate = new X509Certificate(response.body).toString();

			return got.extend({
				prefixUrl: BASE_URL,
				headers: {
					"user-agent": USER_AGENT
				},
				https: {
					certificateAuthority: tls.rootCertificates.concat([intermediate])
				},
				timeout: {
					request: REQUEST_TIMEOUT
				}
			});
		});

		return ratelRegistry._client;
	},

	/**
	 * GET a path on the registry
	 * @param {string} path - Path without leading slash
	 * @param {Object} [options] - Extra got options
	 * @returns {Promise<Object>} got response
	 */
	_get: withRetry((path, options) => {
		return ratelRegistry._getClient().then((client) => {
			return client.get(path, options || {});
		});
	}),

	/**
	 * Search results of register (20 rows per page)
	 * @param {string} register - Register id, e.g. "reg203"
	 * @param {Object} [params] - Overrides of SEARCH_PARAMS (e.g. { page: "3" })
	 * @returns {Promise<string>} HTML
	 */
	getSearchPage: (register, params) => {
		return ratelRegistry._get("cyr/" + register, {
			searchParams: Object.assign({}, SEARCH_PARAMS, params || {})
		}).then((response) => {
			return response.body;
		});
	},

	/**
	 * Whole register as the site's CSV export (UTF-16LE with BOM, TSV)
	 * @param {string} register - Register id, e.g. "reg203"
	 * @returns {Promise<Buffer>} raw bytes
	 */
	getCsvExport: (register) => {
		return ratelRegistry._get("cyr/" + register, {
			searchParams: Object.assign({}, SEARCH_PARAMS, { format: "csv" }),
			responseType: "buffer",
			timeout: {
				request: EXPORT_TIMEOUT
			}
		}).then((response) => {
			return response.body;
		});
	},

	/**
	 * Register landing page with the search form (code tables, updated date)
	 * @param {string} register - Register id, e.g. "reg203"
	 * @returns {Promise<string>} HTML
	 */
	getFormPage: (register) => {
		return ratelRegistry._get("cyr/" + register).then((response) => {
			return response.body;
		});
	}
};

module.exports = ratelRegistry;
