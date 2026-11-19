const got = require("got-verbose");
const withRetry = require("../../utils/retry").withRetry;

const BASE_URL = "https://www.ratel.rs";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const PAGE_TIMEOUT = 120 * 1000;
const DOWNLOAD_TIMEOUT = 600 * 1000;

const ratelWebsite = {
	_client: got.extend({
		headers: {
			"user-agent": USER_AGENT
		}
	}),

	baseUrl: BASE_URL,

	/**
	 * Page of www.ratel.rs as raw bytes. Some upload links on the site contain
	 * bytes that are not valid UTF-8, so decoding is left to the caller.
	 * @param {string} slug - Part of URL after /sr/
	 * @returns {Promise<Buffer>}
	 */
	getPage: withRetry((slug) => {
		return ratelWebsite._client.get(BASE_URL + "/sr/" + slug, {
			responseType: "buffer",
			timeout: {
				request: PAGE_TIMEOUT
			}
		}).then((response) => {
			return response.body;
		});
	}),

	/**
	 * Download a file; HTTP errors are returned, not thrown (the site has dead links)
	 * @param {string} url - Absolute, already percent-encoded URL
	 * @returns {Promise<{statusCode: number, contentType: string, body: Buffer}>}
	 */
	download: withRetry((url) => {
		return ratelWebsite._client.get(url, {
			responseType: "buffer",
			throwHttpErrors: false,
			timeout: {
				request: DOWNLOAD_TIMEOUT
			}
		}).then((response) => {
			return {
				statusCode: response.statusCode,
				contentType: response.headers["content-type"] || "",
				body: response.body
			};
		});
	})
};

module.exports = ratelWebsite;
