// got 11's built-in retry can crash the process ("The `onCancel` handler was
// attached after the promise settled"), so retries are done here instead.
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_DELAY = 2000;

const sleep = (ms) => {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
};

// 4xx responses will not get better by retrying
const isRetryable = (error) => {
	const status = error.response && error.response.statusCode;
	return !(status >= 400 && status < 500);
};

/**
 * Wrap a promise-returning function so failed calls are retried with linear backoff
 * @param {Function} fn
 * @param {Object} [options]
 * @param {number} [options.attempts] - Total tries (default 4)
 * @param {number} [options.delay] - Backoff step in ms, waits delay * attempt (default 2000)
 * @returns {Function}
 */
const withRetry = (fn, options) => {
	const settings = Object.assign({ attempts: DEFAULT_ATTEMPTS, delay: DEFAULT_DELAY }, options || {});

	const attempt = (args, number) => {
		return fn.apply(null, args).catch((error) => {
			if (number >= settings.attempts || !isRetryable(error)) {
				throw error;
			}

			return sleep(settings.delay * number).then(() => {
				return attempt(args, number + 1);
			});
		});
	};

	return function () {
		return attempt(Array.from(arguments), 1);
	};
};

module.exports = {
	withRetry: withRetry
};
