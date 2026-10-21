/**
 * Read the public job information shown on the current LinkedIn page.
 * Only the job details pane is read; nothing about the signed-in user.
 */
(() => {
  const S = globalThis.GhostCheckSelectors;
  const MAX_DESCRIPTION_CHARS = 20000;
  const CURRENCY_RE = /[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|CHF|SGD|INR|JPY)\b/i;

  /** Collapse whitespace and trim. */
  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  /** First element matching any candidate selector, preferring non-empty text. */
  function queryFirst(root, candidates, { needText = true } = {}) {
    for (const selector of candidates) {
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch {
        continue; // an invalid selector must not break extraction
      }
      for (const el of nodes) {
        if (!needText || clean(el.textContent)) return el;
      }
    }
    return null;
  }

  function textOf(root, candidates) {
    const el = queryFirst(root, candidates);
    return el ? clean(el.innerText || el.textContent) : '';
  }

  /**
   * Job id from the URL. Supports /jobs/view/123, /jobs/view/some-title-123
   * and ?currentJobId=123 (search and collections pages).
   * @returns {string | null}
   */
  function getJobIdFromUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    if (!url.pathname.startsWith('/jobs')) return null;
    const fromParam = url.searchParams.get('currentJobId');
    if (fromParam && /^\d+$/.test(fromParam)) return fromParam;
    const m = url.pathname.match(/^\/jobs\/view\/(?:[^/]*?-)?(\d+)\/?/);
    return m ? m[1] : null;
  }

  /** Job id of the details pane, read from the title link if it has one. */
  function getPaneJobId(titleEl) {
    if (!titleEl) return null;
    const link = titleEl.closest('a[href]') || titleEl.querySelector('a[href]');
    if (!link) return null;
    const m = link.getAttribute('href').match(/\/jobs\/view\/(?:[^/?]*?-)?(\d+)/);
    return m ? m[1] : null;
  }

  function getDetailsRoot() {
    return queryFirst(document, S.detailsRoot, { needText: false }) || document;
  }

  /** Text of the element without GhostCheck's own badge. */
  function titleText(el) {
    return clean(el.innerText || el.textContent);
  }

  function findSalaryText(root) {
    for (const selector of S.salary) {
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of nodes) {
        const t = clean(el.textContent);
        if (t && CURRENCY_RE.test(t) && /\d/.test(t)) return t;
      }
    }
    return '';
  }

  function findApply(root) {
    const embedded = queryFirst(document, S.embeddedApplyUrl, { needText: false });
    if (embedded && embedded.innerHTML.trim()) {
      return { applyType: 'external', applyHref: embedded.innerHTML.trim() };
    }

    const control = queryFirst(root, S.applyControl, { needText: false });
    if (!control) return { applyType: 'unknown', applyHref: null };

    const href = control.tagName === 'A' ? control.getAttribute('href') : null;
    if (queryFirst(control, S.easyApplyIcon, { needText: false })) {
      return { applyType: 'easy', applyHref: null };
    }
    if (href || queryFirst(control, S.externalApplyIcon, { needText: false })) {
      return { applyType: 'external', applyHref: href };
    }
    // Last resort; English-only, so it is not the primary signal.
    if (/easy apply/i.test(control.getAttribute('aria-label') || control.textContent)) {
      return { applyType: 'easy', applyHref: null };
    }
    return { applyType: 'unknown', applyHref: null };
  }

  function companySlugFromLink(root) {
    const link = queryFirst(root, S.companyLink, { needText: false });
    const href = link && link.getAttribute('href');
    const m = href && href.match(/\/company\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  }

  // ------------------------------------------------------------------
  // Fallback for layouts whose class names we do not know (LinkedIn ships
  // obfuscated class names in some redesigns). It relies on structure only:
  // the tab title, font size, links and the "·" separators.

  /**
   * "(13) Software Engineer | Acme | LinkedIn" (signed in) or
   * "Acme hiring Software Engineer in Tokyo, Japan | LinkedIn" (signed out).
   * @returns {{ title: string, company: string } | null}
   */
  function parseDocumentTitle(raw = document.title) {
    const t = clean(raw).replace(/^\(\d+\+?\)\s*/, '');
    const parts = t.split(' | ').map(clean);
    if (parts.length >= 3 && /^linkedin$/i.test(parts[parts.length - 1])) {
      return { title: parts[0], company: parts[1] };
    }
    const m = t.match(/^(.+?) hiring (.+?)(?: in .+)? \| LinkedIn$/i);
    return m ? { title: clean(m[2]), company: clean(m[1]) } : null;
  }

  const MIN_TITLE_FONT_PX = 18; // detail headings are ~24px, list items ~16px

  /** Elements whose text is the title (allowing a short suffix, e.g. a hidden "Verified" label). */
  function findTitleCandidates(title) {
    const want = title.toLowerCase();
    const prefix = want.slice(0, 24);
    const found = new Map(); // element -> rendered font size
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.toLowerCase().includes(prefix)) continue;
      // Innermost element that holds the whole title (the text may be split
      // across a few inline elements).
      let el = node.parentElement;
      while (el && !clean(el.textContent).toLowerCase().startsWith(want)) el = el.parentElement;
      const text = clean(el?.textContent).toLowerCase();
      if (!el || text.length > title.length + 40) continue;
      // Size of the text as rendered, not of an outer container.
      const font = parseFloat(getComputedStyle(node.parentElement).fontSize) || 0;
      if (!found.has(el) || found.get(el) < font) found.set(el, font);
    }
    return [...found].map(([el, font]) => ({ el, font }));
  }

  /** Largest ancestor of titleEl that does not also contain the job list. */
  function findPane(titleEl, others) {
    let pane = titleEl;
    while (pane.parentElement && pane.parentElement !== document.body) {
      const parent = pane.parentElement;
      if (others.some((o) => parent.contains(o))) break;
      pane = parent;
    }
    return pane;
  }

  /**
   * The description is the biggest block of text in the pane outside the
   * title area. Take the largest such child, then keep descending while one
   * child holds most of the text (dropping headings, buttons, side boxes).
   */
  function findDescription(root, titleEl) {
    const largestChild = (el) => {
      let best = null;
      let bestLen = 0;
      for (const child of el.children) {
        if (child.contains(titleEl)) continue;
        const len = (child.textContent || '').length;
        if (len > bestLen) {
          best = child;
          bestLen = len;
        }
      }
      return { best, bestLen };
    };
    // Climb from the title until a level has a big block beside it (the pane
    // root may be far above the description in deeply nested layouts).
    let el = root;
    let { best, bestLen } = largestChild(el);
    if (!best || bestLen < 200) return '';
    el = best;
    for (;;) {
      ({ best, bestLen } = largestChild(el));
      if (!best || bestLen < 0.6 * (el.textContent || '').length || bestLen < 200) break;
      el = best;
    }
    return clean(el.innerText || el.textContent);
  }

  /** "Tokyo, Japan · 3 weeks ago · 83 applicants": the first short "·" line after the title. */
  function findMetaLine(pane, titleEl) {
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.includes('·')) continue;
      if (!(titleEl.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      let el = node.parentElement;
      while (el && el !== pane && clean(el.textContent).replace(/[·\s]/g, '').length < 3) el = el.parentElement;
      const text = clean(el?.textContent);
      if (text && text.length < 200 && /[^·\s]/.test(text.split('·')[0])) return text;
    }
    return '';
  }

  function findSalaryLoose(pane) {
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = clean(node.nodeValue);
      if (t.length < 80 && CURRENCY_RE.test(t) && /\d/.test(t)) return t;
    }
    return '';
  }

  /** Apply control by link target, icon or label. */
  function findApplyLoose(pane) {
    const controls = [...pane.querySelectorAll('a[href], button')];
    for (const c of controls) {
      const href = c.getAttribute('href') || '';
      if (/externalApply|\/redir\/redirect|\/safety\/go/.test(href)) return { applyType: 'external', applyHref: href };
    }
    for (const c of controls) {
      const label = clean(`${c.getAttribute('aria-label') || ''} ${c.textContent}`);
      if (queryFirst(c, S.easyApplyIcon, { needText: false }) || /easy apply/i.test(label)) return { applyType: 'easy', applyHref: null };
      if (queryFirst(c, S.externalApplyIcon, { needText: false }) || /^apply\b|apply on company/i.test(label)) {
        const href = c.tagName === 'A' ? c.getAttribute('href') : null;
        return { applyType: 'external', applyHref: href };
      }
    }
    return { applyType: 'unknown', applyHref: null };
  }

  /** Same text, ignoring case, spacing and a short suffix such as a "Verified" label. */
  const sameTitle = (a, b) => {
    const x = clean(a).toLowerCase();
    const y = clean(b).toLowerCase();
    return !!x && !!y && (x === y || (x.startsWith(y) && x.length <= y.length + 40));
  };

  function extractLoose(doc) {
    const candidates = findTitleCandidates(doc.title).sort((a, b) => b.font - a.font);
    const top = candidates[0];
    // The details heading is clearly larger than list entries; if it is not
    // there yet (LinkedIn still rendering), report nothing and try again.
    if (!top || top.font < MIN_TITLE_FONT_PX) return null;
    const titleEl = top.el;
    const pane = findPane(titleEl, candidates.slice(1).map((c) => c.el));
    const companyLink = [...pane.querySelectorAll('a[href*="/company/"]')].find((a) => clean(a.textContent));
    const slug = companyLink?.getAttribute('href').match(/\/company\/([^/?#]+)/)?.[1];
    const meta = findMetaLine(pane, titleEl);
    return {
      titleEl,
      data: {
        title: doc.title,
        company: doc.company || clean(companyLink?.textContent),
        linkedinCompanySlug: slug ? decodeURIComponent(slug).toLowerCase() : null,
        location: meta ? clean(meta.split('·')[0]) : '',
        metaText: meta,
        salaryText: findSalaryLoose(pane),
        description: findDescription(pane, titleEl).slice(0, MAX_DESCRIPTION_CHARS),
        ...findApplyLoose(pane),
      },
    };
  }

  /**
   * Extract everything GhostCheck needs from the page.
   * Returns the title element separately so the UI can anchor to it.
   */
  function extractJob() {
    const base = {
      jobId: getJobIdFromUrl(window.location.href),
      pageUrl: window.location.href.split('#')[0],
    };
    const doc = parseDocumentTitle();
    const root = getDetailsRoot();
    let titleEl = queryFirst(root, S.title);
    // Generic fallbacks (h1, main) can hit the wrong heading: trust them only
    // if they agree with the tab title.
    if (titleEl && doc && !sameTitle(titleText(titleEl), doc.title)) titleEl = null;
    const company = textOf(root, S.company);

    if (titleEl && company) {
      const meta = textOf(root, S.metaLine);
      let location = textOf(root, S.location);
      // Some layouts put "City · 2 weeks ago · 40 applicants" in one element.
      if (location.includes('·')) location = clean(location.split('·')[0]);
      if (!location && meta) location = clean(meta.split('·')[0]);
      return {
        titleEl,
        data: {
          ...base,
          paneJobId: getPaneJobId(titleEl),
          title: titleText(titleEl),
          company,
          linkedinCompanySlug: companySlugFromLink(root),
          location,
          metaText: meta,
          salaryText: findSalaryText(root),
          description: textOf(root, S.description).slice(0, MAX_DESCRIPTION_CHARS),
          ...findApply(root),
        },
        method: 'selectors',
      };
    }

    const loose = doc && extractLoose(doc);
    if (loose) return { titleEl: loose.titleEl, data: { ...base, paneJobId: getPaneJobId(loose.titleEl), ...loose.data }, method: 'structure' };
    return { titleEl: null, data: { ...base, paneJobId: null, title: '', company: '' }, method: 'none' };
  }

  globalThis.GhostCheckExtract = { extractJob, getJobIdFromUrl, getPaneJobId, parseDocumentTitle };
})();
