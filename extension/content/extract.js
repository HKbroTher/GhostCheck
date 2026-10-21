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

  /**
   * Extract everything GhostCheck needs from the page.
   * Returns the title element separately so the UI can anchor to it.
   */
  function extractJob() {
    const root = getDetailsRoot();
    const titleEl = queryFirst(root, S.title);
    const meta = textOf(root, S.metaLine);
    let location = textOf(root, S.location);
    // Some layouts put "City · 2 weeks ago · 40 applicants" in one element.
    if (location.includes('·')) location = clean(location.split('·')[0]);
    if (!location && meta) location = clean(meta.split('·')[0]);

    const description = textOf(root, S.description).slice(0, MAX_DESCRIPTION_CHARS);

    return {
      titleEl,
      data: {
        jobId: getJobIdFromUrl(window.location.href),
        paneJobId: getPaneJobId(titleEl),
        pageUrl: window.location.href.split('#')[0],
        title: titleEl ? titleText(titleEl) : '',
        company: textOf(root, S.company),
        linkedinCompanySlug: companySlugFromLink(root),
        location,
        metaText: meta,
        salaryText: findSalaryText(root),
        description,
        ...findApply(root),
      },
    };
  }

  globalThis.GhostCheckExtract = { extractJob, getJobIdFromUrl, getPaneJobId };
})();
