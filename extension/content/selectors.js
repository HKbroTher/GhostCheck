/**
 * All LinkedIn DOM selectors live here so a LinkedIn redesign can be fixed in
 * one place. Each entry is an ordered list of candidates; the first selector
 * that matches a non-empty element wins.
 *
 * Covered layouts:
 *   - logged-in job view:     /jobs/view/{id}
 *   - logged-in search panel: /jobs/search/?currentJobId={id}, /jobs/collections/...
 *   - logged-out public page: /jobs/view/{slug}-{id}
 *
 * Avoid selectors that depend on visible text: users run LinkedIn in many
 * languages.
 */
globalThis.GhostCheckSelectors = {
  /** Container of the job currently shown (scopes every other lookup). */
  detailsRoot: [
    '.jobs-search__job-details--container',
    '.jobs-details',
    '.job-view-layout',
    '.scaffold-layout__detail',
    'main .top-card-layout',
    'main',
  ],

  title: [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    '.top-card-layout__title',
    'h1.t-24',
    'h1',
  ],

  company: [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    '.topcard__org-name-link',
    '.top-card-layout__second-subline a',
  ],

  location: [
    '.job-details-jobs-unified-top-card__primary-description-container .tvm__text:first-child',
    '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text:first-child',
    '.job-details-jobs-unified-top-card__bullet',
    '.jobs-unified-top-card__bullet',
    '.topcard__flavor--bullet',
  ],

  description: [
    '#job-details',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.show-more-less-html__markup',
    '.description__text',
  ],

  /** Text snippets that may contain a pay range shown by LinkedIn itself. */
  salary: [
    '.job-details-preferences-and-skills__pill',
    '.job-details-jobs-unified-top-card__job-insight',
    '#SALARY',
    '.compensation__salary',
    '.salary',
  ],

  /** Apply control: an <a> (external) or a <button> (Easy Apply / JS-driven). */
  applyControl: [
    '.jobs-apply-button--top-card a',
    '.jobs-apply-button--top-card button',
    '.jobs-s-apply a',
    '.jobs-s-apply button',
    'a.jobs-apply-button',
    'button.jobs-apply-button',
    'a[href*="/jobs/view/externalApply/"]',
    '.top-card-layout__cta-container a',
  ],

  /** Logged-out pages embed the external apply URL in an HTML comment here. */
  embeddedApplyUrl: ['code#applyUrl'],

  /** Icons inside the apply control, used to tell Easy Apply from external. */
  easyApplyIcon: ['[data-test-icon^="linkedin-bug"]', 'li-icon[type^="linkedin-bug"]'],
  externalApplyIcon: ['[data-test-icon^="link-external"]', 'li-icon[type^="link-external"]'],

  /** Link to the company's LinkedIn page (its slug is a stable company key). */
  companyLink: [
    '.job-details-jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name a',
    'a.topcard__org-name-link',
  ],

  /** Secondary top-card line: location, posted time, applicant count. */
  metaLine: [
    '.job-details-jobs-unified-top-card__primary-description-container',
    '.job-details-jobs-unified-top-card__tertiary-description-container',
    '.jobs-unified-top-card__subtitle-primary-grouping',
    '.topcard__flavor-row',
  ],
};
