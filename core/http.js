/**
 * fetch() wrapper with timeout, retry and per-host rate limiting.
 * Works in the extension service worker and in Node 18+.
 */

export class HttpError extends Error {
  /**
   * @param {'timeout' | 'network' | 'http' | 'parse'} kind
   * @param {string} message
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.status = status ?? null;
  }

  /** True when the resource does not exist (wrong slug), as opposed to a failure. */
  get isNotFound() {
    return this.kind === 'http' && (this.status === 404 || this.status === 410);
  }
}

/**
 * Per-host limiter: at most `maxConcurrent` requests in flight per host and at
 * least `minIntervalMs` between request starts to the same host.
 */
export class RateLimiter {
  constructor({ minIntervalMs = 400, maxConcurrent = 2 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxConcurrent = maxConcurrent;
    /** @type {Map<string, {active: number, lastStart: number, queue: Function[]}>} */
    this.hosts = new Map();
  }

  /**
   * @template T
   * @param {string} host
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  schedule(host, task) {
    if (!this.hosts.has(host)) this.hosts.set(host, { active: 0, lastStart: 0, queue: [] });
    const h = this.hosts.get(host);
    return new Promise((resolve, reject) => {
      h.queue.push(() => task().then(resolve, reject));
      this._pump(host);
    });
  }

  _pump(host) {
    const h = this.hosts.get(host);
    if (!h.queue.length || h.active >= this.maxConcurrent || h.timer) return;
    const wait = h.lastStart + this.minIntervalMs - Date.now();
    if (wait > 0) {
      h.timer = setTimeout(() => {
        h.timer = null;
        this._pump(host);
      }, wait);
      return;
    }
    const run = h.queue.shift();
    h.active++;
    h.lastStart = Date.now();
    run().finally(() => {
      h.active--;
      this._pump(host);
    });
    this._pump(host);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Fetch and parse JSON.
 * @param {string} url
 * @param {object} [opts]
 * @param {'GET' | 'POST'} [opts.method]
 * @param {unknown} [opts.body]          JSON-serialized when provided
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]       extra attempts for timeouts, network errors, 429 and 5xx
 * @param {RateLimiter} [opts.limiter]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<any>}
 * @throws {HttpError}
 */
export async function fetchJson(url, opts = {}) {
  const { method = 'GET', body, timeoutMs = 12000, retries = 1, limiter, fetchImpl = globalThis.fetch } = opts;
  const host = new URL(url).host;

  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (err) {
      throw controller.signal.aborted
        ? new HttpError('timeout', `Timed out after ${timeoutMs} ms: ${url}`)
        : new HttpError('network', `Network error: ${err?.message || err}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const error = new HttpError('http', `HTTP ${res.status} for ${url}`, res.status);
      error.retryAfterMs = Math.min(Number(res.headers?.get?.('retry-after')) * 1000 || 0, 5000);
      throw error;
    }
    try {
      return await res.json();
    } catch {
      throw new HttpError('parse', `Invalid JSON from ${url}`, res.status);
    }
  };

  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await (limiter ? limiter.schedule(host, attempt) : attempt());
    } catch (err) {
      lastError = err;
      const retryable =
        err.kind === 'timeout' || err.kind === 'network' || (err.kind === 'http' && RETRYABLE_STATUS.has(err.status));
      if (!retryable || i === retries) break;
      await sleep(err.retryAfterMs || 800 * 2 ** i);
    }
  }
  throw lastError;
}

/**
 * Fetch a text resource (HTML, XML, robots.txt). Unlike fetchJson, HTTP error
 * statuses are returned, not thrown, because a 404 is meaningful here.
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxBytes]     larger bodies are rejected
 * @param {RateLimiter} [opts.limiter]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ status: number, ok: boolean, url: string, text: string }>}
 * @throws {HttpError} on timeout, network failure or oversized bodies
 */
export async function fetchText(url, opts = {}) {
  const { timeoutMs = 12000, maxBytes = 3_000_000, limiter, fetchImpl = globalThis.fetch } = opts;
  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5' },
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
      });
      const length = Number(res.headers?.get?.('content-length'));
      if (length > maxBytes) throw new HttpError('parse', `Response too large (${length} bytes): ${url}`, res.status);
      const text = res.ok ? await res.text() : '';
      if (text.length > maxBytes) throw new HttpError('parse', `Response too large: ${url}`, res.status);
      return { status: res.status, ok: res.ok, url: res.url || url, text };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw controller.signal.aborted
        ? new HttpError('timeout', `Timed out after ${timeoutMs} ms: ${url}`)
        : new HttpError('network', `Network error: ${err?.message || err}`);
    } finally {
      clearTimeout(timer);
    }
  };
  return limiter ? limiter.schedule(new URL(url).host, attempt) : attempt();
}
