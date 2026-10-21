/**
 * Badge and detail card. Both render inside Shadow DOM so LinkedIn's CSS and
 * GhostCheck's CSS cannot affect each other. All page/API data is inserted with
 * textContent, never innerHTML.
 */
(() => {
  const BADGE_TAG = 'ghostcheck-badge';
  const CARD_TAG = 'ghostcheck-card';

  const LOADING = { badge: 'loading', emoji: '⏳', label: 'Checking…' };

  const DETECTED_LABELS = {
    company: 'Company',
    title: 'Job title',
    location: 'Location',
    applyType: 'Apply type',
    applyUrl: 'Apply link',
    salaryText: 'Pay shown',
    descriptionChars: 'Description length',
    linkedinCompanySlug: 'LinkedIn company id',
    ats: 'Careers site',
    board: 'Board id',
    boardSource: 'Board found via',
    boardSize: 'Open jobs on board',
    matchStatus: 'Match result',
    matchedTitle: 'Matched posting',
    closestScore: 'Closest title score',
  };

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      margin-left: 8px; padding: 2px 10px; vertical-align: middle;
      font: 600 13px/20px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
      border-radius: 999px; border: 1px solid var(--border); cursor: pointer;
      background: var(--bg); color: var(--fg); white-space: nowrap;
    }
    .badge:focus-visible { outline: 2px solid #0a66c2; outline-offset: 2px; }
    .badge[data-badge="green"]   { --bg: #e7f6ec; --fg: #0f5a2a; --border: #a6d9b6; }
    .badge[data-badge="yellow"]  { --bg: #fff6d6; --fg: #6b4f00; --border: #f0d77a; }
    .badge[data-badge="red"]     { --bg: #fde8e8; --fg: #8a1c1c; --border: #f2b0b0; }
    .badge[data-badge="unknown"],
    .badge[data-badge="loading"] { --bg: #f1f1f1; --fg: #444; --border: #d4d4d4; }
    :host([data-theme="dark"]) .badge[data-badge="green"]   { --bg: #12351f; --fg: #a8e6bc; --border: #24603a; }
    :host([data-theme="dark"]) .badge[data-badge="yellow"]  { --bg: #3a3110; --fg: #f5dc8a; --border: #6b5a1c; }
    :host([data-theme="dark"]) .badge[data-badge="red"]     { --bg: #401818; --fg: #f5b5b5; --border: #7a2c2c; }
    :host([data-theme="dark"]) .badge[data-badge="unknown"],
    :host([data-theme="dark"]) .badge[data-badge="loading"] { --bg: #2e2e2e; --fg: #ddd; --border: #4a4a4a; }

    .card {
      --card-bg: #fff; --card-fg: #1d1d1d; --muted: #666; --line: #e3e3e3; --link: #0a66c2;
      position: fixed; z-index: 2147483000; width: 360px; max-width: calc(100vw - 16px);
      max-height: min(520px, calc(100vh - 16px)); overflow: auto;
      background: var(--card-bg); color: var(--card-fg);
      border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18);
      font: 14px/1.45 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
      padding: 14px 16px;
    }
    :host([data-theme="dark"]) .card {
      --card-bg: #1f1f1f; --card-fg: #eee; --muted: #aaa; --line: #3a3a3a; --link: #70b5f9;
    }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .verdict { font-weight: 700; font-size: 15px; }
    .close { all: unset; cursor: pointer; padding: 0 4px; font-size: 18px; color: var(--muted); }
    ul.reasons { list-style: none; margin: 0 0 10px; padding: 0; }
    ul.reasons li { display: flex; gap: 8px; padding: 4px 0; }
    ul.reasons .mark { flex: none; width: 16px; text-align: center; font-weight: 700; }
    li[data-polarity="positive"] .mark { color: #1a7f37; }
    li[data-polarity="negative"] .mark { color: #c62828; }
    li[data-polarity="neutral"] .mark  { color: var(--muted); }
    a.official { display: inline-block; margin-bottom: 10px; color: var(--link); font-weight: 600; text-decoration: none; }
    a.official:hover { text-decoration: underline; }
    details { border-top: 1px solid var(--line); padding-top: 8px; margin-bottom: 8px; }
    summary { cursor: pointer; color: var(--muted); font-size: 13px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 8px 0 0; font-size: 12px; }
    dt { color: var(--muted); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px;
            border-top: 1px solid var(--line); padding-top: 8px; font-size: 12px; color: var(--muted); }
    .recheck { all: unset; cursor: pointer; color: var(--link); font-weight: 600; white-space: nowrap; }
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

  const MARKS = { positive: '+', negative: '−', neutral: '•' };

  class GhostCheckUI {
    constructor({ onRecheck } = {}) {
      this.onRecheck = onRecheck || (() => {});
      this.state = LOADING;
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

    setLoading() {
      this.state = LOADING;
      this._renderBadge();
      if (this.card) this._renderCard();
    }

    /** @param {object} result  CheckResult from the service worker */
    setResult(result) {
      this.state = result;
      this._renderBadge();
      if (this.card) this._renderCard();
    }

    remove() {
      this.closeCard();
      if (this.badge) this.badge.host.remove();
      this.badge = null;
    }

    toggleCard() {
      if (this.card) this.closeCard();
      else this.openCard();
    }

    openCard() {
      if (this.card || !this.badge) return;
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
      this.closeCard();
    }

    _onKey(e) {
      if (e.key === 'Escape') this.closeCard();
    }

    _reposition() {
      if (!this.card || !this.badge) return;
      if (!this.badge.host.isConnected) return this.closeCard();
      const card = this.card.shadow.querySelector('.card');
      const anchor = this.badge.button.getBoundingClientRect();
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
      button.title = s.badge === 'loading' ? 'GhostCheck is checking this job' : 'GhostCheck: click for details';
      button.setAttribute('aria-label', `GhostCheck: ${s.label}. Show details`);
    }

    _renderCard() {
      const { shadow } = this.card;
      shadow.querySelector('.card')?.remove();
      const s = this.state;

      const closeBtn = el('button', { class: 'close', type: 'button', 'aria-label': 'Close' }, '×');
      closeBtn.addEventListener('click', () => this.closeCard());

      const scoreText = typeof s.score === 'number' ? ` · score ${s.score}` : '';
      const card = el(
        'div',
        { class: 'card', role: 'dialog', 'aria-label': 'GhostCheck details' },
        el('div', { class: 'head' }, el('span', { class: 'verdict' }, `${s.emoji} ${s.label}${scoreText}`), closeBtn),
      );

      if (s.badge === 'loading') {
        card.append(el('p', {}, 'Checking the company careers site…'));
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

        if (s.officialUrl && isSafeHttpUrl(s.officialUrl)) {
          card.append(
            el(
              'a',
              { class: 'official', href: s.officialUrl, target: '_blank', rel: 'noopener noreferrer' },
              s.officialLabel || 'View on company careers site ↗',
            ),
          );
        }

        const detected = s.detected || {};
        const rows = Object.entries(DETECTED_LABELS).filter(([k]) => detected[k] !== undefined && detected[k] !== '');
        if (rows.length) {
          const dl = el('dl');
          for (const [key, label] of rows) {
            dl.append(el('dt', {}, label), el('dd', {}, detected[key] === null ? '—' : String(detected[key])));
          }
          card.append(el('details', {}, el('summary', {}, 'What GhostCheck read'), dl));
        }
      }

      const recheck = el('button', { class: 'recheck', type: 'button' }, 'Recheck');
      recheck.addEventListener('click', () => this.onRecheck());
      card.append(el('div', { class: 'foot' }, el('span', {}, 'Signals, not verdicts. Use your judgment.'), recheck));

      shadow.append(card);
      this._reposition();
    }
  }

  globalThis.GhostCheckUI = GhostCheckUI;
})();
