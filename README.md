# GhostCheck

GhostCheck is a Chrome extension that checks whether a LinkedIn job is really hiring. It compares the job with the company's own careers site.

> **Status: early development (stage 2 of 6).** Jobs whose company hires through Greenhouse, Lever or Ashby are checked against the company's own job board. Every other job shows ⚪ *Can't verify*.

## Install (no build step)

1. Clone this repository or download it as a ZIP and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.

Then open any LinkedIn job page. A badge appears next to the job title. Click it for details.

## Repository layout

| Path | Purpose |
|---|---|
| `extension/` | The ready-to-load extension (manifest, content scripts, service worker, UI) |
| `core/` | Shared logic (link resolution, matching, scoring). **Source of truth.** |
| `extension/core/` | Copy of `core/`. Do not edit by hand. Run `node scripts/sync.mjs` |
| `tests/` | Unit tests (`node --test`, no dependencies) |
| `extension/content/selectors.js` | Every LinkedIn DOM selector, in one place |
| `rules.yaml` | Scoring signals, weights and reason texts |
| `data/companies.json` | LinkedIn company → ATS board mapping (used for Easy Apply jobs) |

## Development

You need Node 20 or newer. There is nothing to install.

```sh
node scripts/sync.mjs          # copy core/ into extension/ after editing core/
node --test                    # run unit tests
node scripts/sync.mjs --check  # what CI runs to catch a forgotten sync
node scripts/validate-companies.mjs   # check companies.json against the live APIs
```

To preview every badge state, open `chrome-extension://<extension id>/dev/preview.html`.

## License

MIT
