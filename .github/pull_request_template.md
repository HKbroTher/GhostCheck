## What does this change?

<!-- One or two sentences. -->

## Type

- [ ] Add or fix a company in `data/companies.json`
- [ ] Change scoring in `rules.yaml`
- [ ] Fix LinkedIn selectors in `extension/content/selectors.js`
- [ ] Code change
- [ ] Docs

## Checklist

- [ ] `node --test` passes
- [ ] If I changed `core/`, `rules.yaml` or `data/companies.json`: I ran `node scripts/sync.mjs` and committed `extension/`
- [ ] If I added a company: the `linkedin` id and board `slug` come from the company's real pages
- [ ] If I changed a weight or threshold: I updated the scoring table in `README.md` and explained why, ideally with real job examples
- [ ] If I changed selectors: I tested on a real LinkedIn job page (which layout: job page, search panel, logged out?)
