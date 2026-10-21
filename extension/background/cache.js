/**
 * Small TTL cache on chrome.storage.local, with pruning so storage cannot
 * grow without bound.
 */

const PREFIX = 'gc:';
const MAX_ENTRIES = 300;
const PRUNE_EVERY_WRITES = 25;

let writesSincePrune = 0;

/**
 * @param {string} key
 * @returns {Promise<any | undefined>} the stored value, or undefined if missing/expired
 */
export async function cacheGet(key) {
  const k = PREFIX + key;
  try {
    const { [k]: entry } = await chrome.storage.local.get(k);
    if (!entry || typeof entry.expires !== 'number') return undefined;
    if (entry.expires < Date.now()) {
      chrome.storage.local.remove(k).catch(() => {});
      return undefined;
    }
    return entry.value;
  } catch {
    return undefined; // storage failures only cost a refetch
  }
}

/**
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs
 */
export async function cacheSet(key, value, ttlMs) {
  try {
    await chrome.storage.local.set({ [PREFIX + key]: { value, expires: Date.now() + ttlMs, stored: Date.now() } });
    if (++writesSincePrune >= PRUNE_EVERY_WRITES) {
      writesSincePrune = 0;
      await pruneCache();
    }
  } catch (err) {
    console.warn('[GhostCheck] cache write failed', err);
  }
}

/** @param {string} key */
export async function cacheDelete(key) {
  try {
    await chrome.storage.local.remove(PREFIX + key);
  } catch {
    // ignore
  }
}

/** Remove expired entries, then the oldest ones beyond MAX_ENTRIES. */
export async function pruneCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const live = [];
    const remove = [];
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(PREFIX)) continue;
      if (!v || typeof v.expires !== 'number' || v.expires < now) remove.push(k);
      else live.push([k, v.stored || 0]);
    }
    live.sort((a, b) => b[1] - a[1]);
    for (const [k] of live.slice(MAX_ENTRIES)) remove.push(k);
    if (remove.length) await chrome.storage.local.remove(remove);
  } catch (err) {
    console.warn('[GhostCheck] cache prune failed', err);
  }
}
