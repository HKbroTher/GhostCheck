/**
 * Content script entry point. LinkedIn is a single-page app, so this script
 * watches for job changes (URL + DOM), waits until the details pane really
 * shows the new job, then asks the service worker for a verdict.
 */
(() => {
  if (globalThis.__ghostCheckLoaded) return;
  globalThis.__ghostCheckLoaded = true;

  const { extractJob, getJobIdFromUrl } = globalThis.GhostCheckExtract;

  const SCAN_THROTTLE_MS = 250;
  const URL_POLL_MS = 1000;
  const READY_RETRY_MS = 300;
  const READY_MAX_TRIES = 25; // ~7.5 s
  const SAME_CONTENT_GRACE_TRIES = 6; // wait ~1.8 s if the pane still shows the previous job

  const state = {
    jobId: null,
    token: 0, // increments on every new check; stale responses are dropped
    lastKey: null, // "title|company" of the job we last checked
    lastJob: null,
    lastResult: null,
  };

  // Interface language: the options-page setting, else the browser language
  // (same rule as resolveLanguage() in core/i18n.js).
  const STRINGS = globalThis.GhostCheckStrings;
  let lang = /^zh\b/i.test(chrome.i18n.getUILanguage()) ? 'zh' : 'en';
  const stringsFor = (l) => STRINGS[l] || STRINGS.en;

  const ui = new globalThis.GhostCheckUI({
    strings: stringsFor(lang),
    onRecheck: () => runCheck(state.jobId, { force: true }),
    onAction: (action) => {
      if (action.type === 'grant-origin') {
        chrome.runtime
          .sendMessage({ type: 'ghostcheck:grant-origin', origin: action.origin, all: action.scope === 'all' })
          .catch(() => {});
      }
    },
  });

  async function loadLanguage() {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      const setting = settings?.language;
      const next = setting === 'en' || setting === 'zh' ? setting : /^zh\b/i.test(chrome.i18n.getUILanguage()) ? 'zh' : 'en';
      if (next !== lang) {
        lang = next;
        ui.setStrings(stringsFor(lang));
        return true;
      }
    } catch {
      // keep the current language
    }
    return false;
  }
  const languageReady = loadLanguage();

  // Language switched on the options page: re-render and re-check (reasons
  // come from the service worker in the chosen language).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    loadLanguage().then((changed) => {
      if (changed && state.jobId) runCheck(state.jobId);
    });
  });

  // The permission page asks us to check again once access was granted.
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'ghostcheck:recheck' && state.jobId) {
      runCheck(state.jobId, { force: true });
    }
  });

  /** Ask the service worker; never throws. */
  async function requestCheck(job, force) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'ghostcheck:check', job, force });
      if (response && response.badge) return response;
      throw new Error('empty response');
    } catch (err) {
      const invalidated = !chrome.runtime?.id;
      return {
        badge: 'unknown',
        emoji: '⚪',
        label: ui.t('badge.unknown'),
        score: null,
        officialUrl: null,
        detected: {},
        reasons: [
          {
            id: 'extension_error',
            polarity: 'neutral',
            text: ui.t(invalidated ? 'error.reloaded' : 'error.failed'),
          },
        ],
      };
    }
  }

  /**
   * Wait until the details pane shows `jobId`, then check it.
   * @param {string} jobId
   * @param {{force?: boolean}} [opts]
   */
  async function runCheck(jobId, { force = false } = {}) {
    const token = ++state.token;
    await languageReady;
    for (let attempt = 0; attempt < READY_MAX_TRIES; attempt++) {
      if (token !== state.token) return;
      const { titleEl, data } = extractJob();
      const ready = titleEl && data.title && data.company;
      const paneMismatch = data.paneJobId && data.paneJobId !== jobId;
      const key = `${data.title}|${data.company}`;
      // Without a job id in the pane, identical text right after a switch most
      // likely means LinkedIn has not re-rendered yet.
      const looksStale =
        !force && !data.paneJobId && key === state.lastKey && state.lastJob !== jobId && attempt < SAME_CONTENT_GRACE_TRIES;
      const descriptionPending = !data.description && attempt < 10;

      if (ready && !paneMismatch && !looksStale && !descriptionPending) {
        ui.attach(titleEl);
        ui.setLoading();
        state.lastKey = key;
        state.lastJob = jobId;
        const result = await requestCheck({ ...data, jobId }, force);
        if (token !== state.token) return; // user moved on to another job
        state.lastResult = result;
        ui.setResult(result);
        return;
      }
      await new Promise((r) => setTimeout(r, READY_RETRY_MS));
    }
    // The page never looked like a job: show no badge rather than guess, but
    // leave a diagnostic so users can report a LinkedIn layout change.
    if (token === state.token) {
      const { titleEl, data, method } = extractJob();
      console.info('[GhostCheck] Could not recognise this job page (LinkedIn layout may have changed).', {
        jobId,
        method,
        tabTitle: document.title,
        titleFound: !!titleEl,
        title: data.title,
        company: data.company,
        url: window.location.href,
      });
    }
  }

  /** Called on any URL or DOM change. Cheap when nothing changed. */
  function scan() {
    const jobId = getJobIdFromUrl(window.location.href);
    if (!jobId) {
      if (state.jobId) {
        state.jobId = null;
        state.token++;
        ui.remove();
      }
      return;
    }
    if (jobId !== state.jobId) {
      state.jobId = jobId;
      state.lastResult = null;
      ui.closeCard();
      runCheck(jobId);
      return;
    }
    // Same job, but LinkedIn may have re-rendered the title and dropped our badge.
    if (state.lastResult && !ui.isAttached()) {
      const { titleEl } = extractJob();
      if (titleEl) {
        ui.attach(titleEl);
        ui.setResult(state.lastResult);
      }
    }
  }

  // Throttle rather than debounce: LinkedIn mutates the DOM almost
  // continuously, which would starve a pure debounce.
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, SCAN_THROTTLE_MS);
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleScan);
  let lastHref = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      scheduleScan();
    }
  }, URL_POLL_MS);

  scan();
})();
