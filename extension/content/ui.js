/**
 * Badge and detail card. Both render inside Shadow DOM so LinkedIn's CSS and
 * GhostCheck's CSS cannot affect each other. All page/API data is inserted with
 * textContent, never innerHTML.
 */
(() => {
  const BADGE_TAG = 'ghostcheck-badge';
  const CARD_TAG = 'ghostcheck-card';

  /** Fields shown under "What GhostCheck read", in this order (labels in strings.js). */
  const DETECTED_FIELDS = [
    'company', 'title', 'location', 'applyType', 'applyUrl', 'jobBoard', 'salaryText', 'descriptionChars', 'linkedinCompanySlug',
    'website', 'ats', 'board', 'boardSource', 'boardSize', 'matchStatus', 'matchedTitle', 'closestScore', 'descriptionMatch',
    'unsupportedAts', 'firstSeen', 'linkedinPosted',
  ];

  /**
   * Amber CRT look, light version: phosphor colours, scanlines and glow, no
   * curvature or flicker. Verdicts keep distinct colours (plus their emoji).
   * Motion (cursor blink, result flash) is off for prefers-reduced-motion.
   */
  const FONT = `"GhostCheckVT323", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace`;
  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .badge, .card {
      --amber: #ffb000; --amber-hi: #ffd27a; --amber-dim: #b9822a; --screen: #120b02;
      --green: #7dff8f; --red: #ff6040; --grey: #c9a86a;
    }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      margin-left: 10px; padding: 2px 10px 1px; vertical-align: middle;
      font: 400 19px/22px ${FONT}; letter-spacing: .3px; white-space: nowrap;
      color: var(--c); background: var(--screen);
      border: 1px solid var(--c); border-radius: 4px; cursor: pointer;
      text-shadow: 0 0 6px var(--c);
      box-shadow: 0 0 10px color-mix(in srgb, var(--c) 45%, transparent), inset 0 0 8px color-mix(in srgb, var(--c) 25%, transparent);
      background-image: repeating-linear-gradient(rgba(0,0,0,.35) 0 1px, transparent 1px 3px);
    }
    .badge:hover { filter: brightness(1.2); }
    .badge:focus-visible { outline: 2px solid var(--amber-hi); outline-offset: 2px; }
    .badge[data-badge="green"]   { --c: var(--green); }
    .badge[data-badge="yellow"]  { --c: var(--amber); }
    .badge[data-badge="red"]     { --c: var(--red); }
    .badge[data-badge="unknown"] { --c: var(--grey); }
    .badge[data-badge="loading"] { --c: var(--amber); }
    .badge[data-badge="loading"]::after { content: "▌"; animation: blink 1s steps(1) infinite; }

    .card {
      position: fixed; z-index: 2147483000; width: 380px; max-width: calc(100vw - 16px);
      max-height: min(560px, calc(100vh - 16px)); overflow: auto;
      color: var(--amber-hi);
      background:
        repeating-linear-gradient(rgba(0,0,0,.28) 0 1px, transparent 1px 3px),
        radial-gradient(ellipse at 50% 40%, #241805 0%, #120b02 70%, #080501 100%);
      background-attachment: local, local;
      border: 1px solid color-mix(in srgb, var(--amber) 55%, transparent); border-radius: 8px;
      box-shadow: 0 0 0 1px #000, 0 0 26px rgba(255,176,0,.28), 0 12px 32px rgba(0,0,0,.55);
      font: 14px/1.5 -apple-system, system-ui, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      text-shadow: 0 0 3px rgba(255,176,0,.45);
      padding: 0 16px 12px;
    }
    .card.fresh { animation: power-on .5s ease-out; }
    .bar {
      display: flex; align-items: center; justify-content: space-between;
      margin: 0 -16px 10px; padding: 4px 12px;
      font: 16px/20px ${FONT}; letter-spacing: 1px; color: var(--amber-dim);
      border-bottom: 1px solid color-mix(in srgb, var(--amber) 30%, transparent);
    }
    .bar .cursor { animation: blink 1s steps(1) infinite; }
    .close { all: unset; cursor: pointer; padding: 0 4px; font: 20px/20px ${FONT}; color: var(--amber); }
    .close:hover { color: #fff; }
    .verdict { font: 28px/30px ${FONT}; margin-bottom: 8px; color: var(--c); text-shadow: 0 0 8px var(--c); }
    .verdict[data-badge="green"]   { --c: var(--green); }
    .verdict[data-badge="yellow"]  { --c: var(--amber); }
    .verdict[data-badge="red"]     { --c: var(--red); }
    .verdict[data-badge="unknown"] { --c: var(--grey); }
    .verdict[data-badge="loading"] { --c: var(--amber); }
    .verdict .score { font-size: 20px; opacity: .8; white-space: nowrap; }
    ul.reasons { list-style: none; margin: 0 0 12px; padding: 0; }
    ul.reasons li { display: flex; gap: 8px; padding: 3px 0; }
    ul.reasons .mark { flex: none; width: 14px; text-align: center; font: 20px/21px ${FONT}; }
    li[data-polarity="positive"] .mark { color: var(--green); text-shadow: 0 0 6px var(--green); }
    li[data-polarity="negative"] .mark { color: var(--red); text-shadow: 0 0 6px var(--red); }
    li[data-polarity="neutral"] .mark  { color: var(--amber-dim); }
    a.official { display: inline-block; margin-bottom: 10px; color: var(--amber); font-weight: 600; text-decoration: none; border-bottom: 1px dashed var(--amber); }
    a.official:hover { color: #fff; border-bottom-color: #fff; }
    details { border-top: 1px dashed color-mix(in srgb, var(--amber) 35%, transparent); padding-top: 8px; margin-bottom: 8px; }
    summary { cursor: pointer; color: var(--amber-dim); font: 17px/20px ${FONT}; letter-spacing: .5px; }
    ul.checks, ul.dates { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12px; }
    ul.checks li, ul.dates li { display: flex; gap: 8px; align-items: baseline; padding: 1px 0; }
    ul.checks .mark { flex: none; width: 12px; text-align: center; font: 16px/16px ${FONT}; }
    ul.checks .what, ul.dates .what { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    ul.checks .status, ul.dates .status { flex: none; color: var(--amber-dim); }
    ul.checks li[data-status="found"] .mark, ul.checks li[data-status="found"] .status { color: var(--green); }
    ul.checks li[data-status="missing"] .mark, ul.checks li[data-status="closed"] .mark { color: var(--red); }
    ul.dates.disagree .status { color: var(--red); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 8px 0 0; font-size: 12px; }
    dt { color: var(--amber-dim); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .foot {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border-top: 1px dashed color-mix(in srgb, var(--amber) 35%, transparent); padding-top: 8px;
      font-size: 12px; color: var(--amber-dim);
    }
    .foot .when { font: 16px/18px ${FONT}; white-space: nowrap; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
    .action {
      display: block; margin: 0; padding: 4px 12px; border-radius: 4px; cursor: pointer;
      font: 18px/22px ${FONT}; color: #120b02; background: var(--amber); border: 1px solid var(--amber);
      box-shadow: 0 0 10px rgba(255,176,0,.45); text-shadow: none;
    }
    .action.secondary { color: var(--amber); background: transparent; }
    .action:hover { filter: brightness(1.15); }
    .recheck {
      all: unset; cursor: pointer; white-space: nowrap; padding: 1px 8px;
      font: 17px/20px ${FONT}; color: var(--amber); border: 1px solid var(--amber); border-radius: 3px;
    }
    .recheck:hover { background: var(--amber); color: #120b02; }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes power-on {
      0% { filter: brightness(2.2) saturate(.4); transform: scaleY(.96); }
      100% { filter: none; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .badge[data-badge="loading"]::after, .bar .cursor { animation: none; }
      .card.fresh { animation: none; }
    }
  `;

  /** Small DOM helper: el('div', {class: 'x'}, child, 'text'). */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function isSafeHttpUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function currentTheme() {
    const html = document.documentElement;
    const body = document.body;
    const dark = html.classList.contains('theme--dark') || (body && body.classList.contains('theme--dark'));
    return dark ? 'dark' : 'light';
  }

  function makeHost(tag) {
    const host = document.createElement(tag);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(el('style', {}, STYLE));
    return { host, shadow };
  }

  /**
   * Register the pixel font once per page. The bytes come from the service
   * worker, because a web_accessible_resource would let LinkedIn detect the
   * extension. Until (or unless) it loads, the monospace fallback is used.
   */
  let fontRequested = false;
  function loadFont() {
    if (fontRequested || !globalThis.chrome?.runtime?.sendMessage || !globalThis.FontFace) return;
    fontRequested = true;
    chrome.runtime
      .sendMessage({ type: 'ghostcheck:font' })
      .then((base64) => {
        if (typeof base64 !== 'string') return;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const face = new FontFace('GhostCheckVT323', bytes.buffer);
        document.fonts.add(face);
        return face.load();
      })
      .catch(() => {});
  }

  function extensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return '';
    }
  }

  /** "14:05" today, otherwise a short date and time, in the interface language. */
  function formatTime(iso, lang) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const locale = lang === 'zh' ? 'zh-CN' : 'en';
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const MARKS = { positive: '+', negative: '−', neutral: '•' };
  const CHECK_MARKS = { found: '✓', missing: '✗', closed: '✗', unknown: '?', skipped: '–' };

  class GhostCheckUI {
    constructor({ onRecheck, onAction, onDismiss, strings } = {}) {
      this.strings = strings || globalThis.GhostCheckStrings?.en || {};
      this.onRecheck = onRecheck || (() => {});
      this.onAction = onAction || (() => {});
      this.onDismiss = onDismiss || (() => {}); // the user closed the card
      loadFont();
      this.state = this._loading();
      this.badge = null; // { host, shadow, button }
      this.card = null; // { host, shadow }
      this._onDocPointer = this._onDocPointer.bind(this);
      this._onKey = this._onKey.bind(this);
      this._reposition = this._reposition.bind(this);
    }

    /** Insert (or move) the badge right after the title text. */
    attach(titleEl) {
      if (!this.badge) {
        const { host, shadow } = makeHost(BADGE_TAG);
        const button = el('button', { class: 'badge', type: 'button', 'aria-haspopup': 'dialog' });
        button.addEventListener('click', (e) => {
          // The title is often a link: never let our click navigate.
          e.preventDefault();
          e.stopPropagation();
          this.toggleCard();
        });
        shadow.append(button);
        this.badge = { host, shadow, button };
      }
      if (this.badge.host.parentElement !== titleEl) titleEl.append(this.badge.host);
      this.badge.host.dataset.theme = currentTheme();
      this._renderBadge();
    }

    isAttached(titleEl) {
      return !!this.badge && this.badge.host.isConnected && (!titleEl || titleEl.contains(this.badge.host));
    }

    /** Translate a key (see core/i18n.js); falls back to English, then the key. */
    t(key, vars = {}) {
      const text = this.strings[key] ?? globalThis.GhostCheckStrings?.en?.[key] ?? key;
      return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
    }

    /** Switch language; the current badge and card re-render. */
    setStrings(strings) {
      this.strings = strings || {};
      if (this.state.badge === 'loading') this.state = this._loading();
      this._renderBadge();
      if (this.card) this._renderCard();
    }

    _lang() {
      return this.strings === globalThis.GhostCheckStrings?.zh ? 'zh' : 'en';
    }

    _loading() {
      return { badge: 'loading', emoji: '⏳', label: this.t('badge.loading') };
    }

    setLoading() {
      this.state = this._loading();
      this._renderBadge();
      if (this.card) this._renderCard();
    }

    /**
     * @param {object} result  CheckResult from the service worker
     * @param {{fresh?: boolean}} [opts]  fresh: a new result, flash an open card
     */
    setResult(result, { fresh = false } = {}) {
      this.state = result;
      this._renderBadge();
      if (this.card) {
        this._fresh = fresh;
        this._renderCard();
      }
    }

    isCardOpen() {
      return !!this.card;
    }

    remove() {
      this.closeCard();
      if (this.badge) this.badge.host.remove();
      this.badge = null;
    }

    toggleCard() {
      if (this.card) this.dismissCard();
      else this.openCard();
    }

    /** Close because the user asked to (close button, Escape, click outside, badge). */
    dismissCard() {
      if (!this.card) return;
      this.closeCard();
      this.onDismiss();
    }

    /** @param {{fresh?: boolean}} [opts]  fresh: play the power-on flash */
    openCard({ fresh = false } = {}) {
      if (this.card || !this.badge) return;
      this._fresh = fresh;
      const { host, shadow } = makeHost(CARD_TAG);
      host.dataset.theme = currentTheme();
      document.body.append(host);
      this.card = { host, shadow };
      this._renderCard();
      this._reposition();
      this.badge.button.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', this._onDocPointer, true);
      document.addEventListener('keydown', this._onKey, true);
      window.addEventListener('scroll', this._reposition, true);
      window.addEventListener('resize', this._reposition);
    }

    closeCard() {
      if (!this.card) return;
      this.card.host.remove();
      this.card = null;
      if (this.badge) this.badge.button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', this._onDocPointer, true);
      document.removeEventListener('keydown', this._onKey, true);
      window.removeEventListener('scroll', this._reposition, true);
      window.removeEventListener('resize', this._reposition);
    }

    _onDocPointer(e) {
      const path = e.composedPath();
      if (path.includes(this.card?.host) || path.includes(this.badge?.host)) return;
      this.dismissCard();
    }

    _onKey(e) {
      if (e.key === 'Escape') this.dismissCard();
    }

    _reposition() {
      if (!this.card || !this.badge) return;
      if (!this.badge.host.isConnected) return this.closeCard();
      const card = this.card.shadow.querySelector('.card');
      const anchor = this.badge.button.getBoundingClientRect();
      // LinkedIn scrolls the details pane, not the window: while the badge is
      // scrolled out of sight, hide the card instead of leaving it floating.
      const offscreen = anchor.bottom < 0 || anchor.top > window.innerHeight || (!anchor.width && !anchor.height);
      card.style.visibility = offscreen ? 'hidden' : '';
      const margin = 8;
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      let left = Math.min(anchor.left, window.innerWidth - width - margin);
      left = Math.max(margin, left);
      let top = anchor.bottom + 6;
      if (top + height > window.innerHeight - margin && anchor.top - height - 6 > margin) {
        top = anchor.top - height - 6; // flip above when there is no room below
      }
      card.style.left = `${left}px`;
      card.style.top = `${Math.max(margin, top)}px`;
    }

    _renderBadge() {
      if (!this.badge) return;
      const { button } = this.badge;
      const s = this.state;
      button.dataset.badge = s.badge;
      button.textContent = '';
      button.append(el('span', { 'aria-hidden': 'true' }, s.emoji), el('span', {}, s.label));
      button.title = this.t(s.badge === 'loading' ? 'ui.badgeLoadingTitle' : 'ui.badgeTitle');
      button.setAttribute('aria-label', this.t('ui.badgeAria', { label: s.label }));
    }

    _renderCard() {
      const { shadow } = this.card;
      shadow.querySelector('.card')?.remove();
      const s = this.state;

      const closeBtn = el('button', { class: 'close', type: 'button', 'aria-label': this.t('ui.close') }, '×');
      closeBtn.addEventListener('click', () => this.dismissCard());

      const version = extensionVersion();
      const scoreText = typeof s.score === 'number' ? ` · ${this.t('ui.score', { score: s.score })}` : '';
      const card = el(
        'div',
        { class: this._fresh ? 'card fresh' : 'card', role: 'dialog', 'aria-label': this.t('ui.cardAria') },
        el(
          'div',
          { class: 'bar' },
          el('span', {}, `GHOSTCHECK${version ? ` v${version}` : ''} `, el('span', { class: 'cursor', 'aria-hidden': 'true' }, '▌')),
          closeBtn,
        ),
        el('div', { class: 'verdict', 'data-badge': s.badge }, `${s.emoji} ${s.label}`, el('span', { class: 'score' }, scoreText)),
      );
      this._fresh = false;

      if (s.badge === 'loading') {
        card.append(el('p', {}, this.t('ui.checking')));
      } else {
        const list = el('ul', { class: 'reasons' });
        for (const r of (s.reasons || []).slice(0, 5)) {
          list.append(
            el(
              'li',
              { 'data-polarity': r.polarity },
              el('span', { class: 'mark', 'aria-hidden': 'true' }, MARKS[r.polarity] || '•'),
              el('span', {}, r.text),
            ),
          );
        }
        card.append(list);

        // Something the user can do to make the check possible.
        if (s.action?.type === 'grant-origin' && typeof s.action.origin === 'string') {
          const site = el('button', { class: 'action', type: 'button' }, s.action.label || this.t('ui.allowSite', { host: '' }));
          site.addEventListener('click', () => this.onAction({ ...s.action, scope: 'site' }));
          const all = el('button', { class: 'action secondary', type: 'button' }, s.action.allLabel || this.t('ui.allowAll'));
          all.addEventListener('click', () => this.onAction({ ...s.action, scope: 'all' }));
          card.append(el('div', { class: 'actions' }, site, all));
        }

        if (s.officialUrl && isSafeHttpUrl(s.officialUrl)) {
          card.append(
            el(
              'a',
              { class: 'official', href: s.officialUrl, target: '_blank', rel: 'noopener noreferrer' },
              s.officialLabel || this.t('ui.viewJob'),
            ),
          );
        }

        // Every source GhostCheck asked, and what it said.
        if (Array.isArray(s.checks) && s.checks.length) {
          const list = el('ul', { class: 'checks' });
          for (const c of s.checks) {
            list.append(
              el(
                'li',
                { 'data-status': c.status, title: c.detail || '' },
                el('span', { class: 'mark', 'aria-hidden': 'true' }, CHECK_MARKS[c.status] || '?'),
                el('span', { class: 'what' }, c.label),
                el('span', { class: 'status' }, this.t(`checkStatus.${c.status}`)),
              ),
            );
          }
          card.append(el('details', { open: '' }, el('summary', {}, this.t('ui.checks')), list));
        }

        // When each source says the job was posted; flagged when they disagree.
        if (Array.isArray(s.dates) && s.dates.length) {
          const disagree = s.signals?.reposted_to_look_new === true;
          const list = el('ul', { class: disagree ? 'dates disagree' : 'dates' });
          for (const d of s.dates) {
            list.append(el('li', {}, el('span', { class: 'what' }, d.source), el('span', { class: 'status' }, `${this.t('ui.daysAgo', { days: d.days })} · ${d.date}`)));
          }
          card.append(el('details', disagree ? { open: '' } : {}, el('summary', {}, `${disagree ? '⚠ ' : ''}${this.t('ui.dates')}`), list));
        }

        const detected = s.detected || {};
        const rows = DETECTED_FIELDS.filter((k) => detected[k] !== undefined && detected[k] !== '');
        if (rows.length) {
          const dl = el('dl');
          for (const key of rows) {
            dl.append(el('dt', {}, this.t(`field.${key}`)), el('dd', {}, detected[key] === null ? '—' : String(detected[key])));
          }
          card.append(el('details', {}, el('summary', {}, this.t('ui.detected')), dl));
        }
      }

      const recheck = el('button', { class: 'recheck', type: 'button' }, this.t('ui.recheck'));
      recheck.addEventListener('click', () => this.onRecheck());
      const when = s.checkedAt ? formatTime(s.checkedAt, this._lang()) : '';
      card.append(
        el(
          'div',
          { class: 'foot' },
          el('span', {}, this.t('ui.footer'), when ? el('br') : null, when ? el('span', { class: 'when' }, this.t('ui.checkedAt', { time: when })) : null),
          recheck,
        ),
      );

      shadow.append(card);
      this._reposition();
    }
  }

  globalThis.GhostCheckUI = GhostCheckUI;
})();
