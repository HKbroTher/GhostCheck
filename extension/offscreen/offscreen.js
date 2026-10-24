/**
 * Offscreen document that hosts the sentence-embedding model.
 * The service worker sends { target: 'ghostcheck-offscreen', type: 'embed', texts }
 * and gets back { vectors } or { error }.
 *
 * Code is loaded only from the extension package; the model weights (data)
 * are downloaded from Hugging Face once and kept in the browser cache.
 */
import { env, pipeline } from '../vendor/transformers/transformers.min.js';

const MODELS = {
  english: 'Xenova/all-MiniLM-L6-v2',
  multilingual: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
};
const IDLE_CLOSE_MS = 5 * 60000;

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
// Never fetch the ONNX runtime from a CDN: use the copy shipped in vendor/.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/transformers/');
env.backends.onnx.wasm.numThreads = 1; // no cross-origin isolation in extensions
env.backends.onnx.wasm.proxy = false;

// One model in memory at a time; switching models replaces it.
let current = { name: null, promise: null };
function getExtractor(name) {
  const model = MODELS[name] ? name : 'english';
  if (current.name !== model) {
    current.promise?.then((e) => e.dispose?.()).catch(() => {});
    current = {
      name: model,
      promise: pipeline('feature-extraction', MODELS[model], { dtype: 'q8', device: 'wasm' }).catch((err) => {
        current = { name: null, promise: null }; // allow a retry later (e.g. after a network error)
        throw err;
      }),
    };
  }
  return current.promise;
}

let idleTimer = null;
function touch() {
  clearTimeout(idleTimer);
  // Free the model's memory when unused; the service worker closes this page.
  idleTimer = setTimeout(() => chrome.runtime.sendMessage({ type: 'ghostcheck:offscreen-idle' }).catch(() => {}), IDLE_CLOSE_MS);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'ghostcheck-offscreen' || sender.id !== chrome.runtime.id) return false;
  touch();
  if (message.type === 'embed') {
    const texts = Array.isArray(message.texts) ? message.texts.filter((t) => typeof t === 'string').slice(0, 64) : [];
    getExtractor(message.model)
      .then((extractor) => extractor(texts, { pooling: 'mean', normalize: true }))
      .then((tensor) => sendResponse({ vectors: tensor.tolist() }))
      .catch((err) => sendResponse({ error: String(err?.message || err) }));
    return true;
  }
  if (message.type === 'warmup') {
    getExtractor(message.model).then(
      () => sendResponse({ ready: true }),
      (err) => sendResponse({ error: String(err?.message || err) }),
    );
    return true;
  }
  return false;
});

touch();
