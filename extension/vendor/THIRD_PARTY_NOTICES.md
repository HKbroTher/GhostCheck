# Third-party code bundled with GhostCheck

Everything below ships inside the extension. Nothing is loaded from a CDN.

| Component | Version | License | Files |
|---|---|---|---|
| [Transformers.js](https://github.com/huggingface/transformers.js) | 3.7.6 | Apache-2.0 | `vendor/transformers/transformers.min.js` |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (bundled by Transformers.js) | 1.22.0-dev.20250409 | MIT | `vendor/transformers/ort-wasm-simd-threaded.jsep.{mjs,wasm}` |
| [js-yaml](https://github.com/nodeca/js-yaml) | 4.1.0 | MIT | `core/vendor/js-yaml.mjs` |

Files are copied unmodified from the published npm packages
(`@huggingface/transformers@3.7.6`, `js-yaml@4.1.0`).

## Downloaded at runtime (data, not code)

| Model | License | When |
|---|---|---|
| [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (8-bit quantized ONNX, ~23 MB) | Apache-2.0 | The first time GhostCheck compares job descriptions. Cached by the browser afterwards. Can be turned off on the options page. |
