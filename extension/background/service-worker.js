/**
 * Background service worker. Every network request, the matching logic and
 * scoring run here, never in the LinkedIn page.
 *
 * Stage 1: resolves the apply link and returns a placeholder verdict.
 */
import { resolveApplyUrl } from '../core/apply-url.js';
import { unknownResult } from '../core/result.js';

/**
 * Accept only well-formed messages from our own content script on LinkedIn.
 * @param {chrome.runtime.MessageSender} sender
 */
function isTrustedSender(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(sender.url || sender.tab?.url || '').hostname);
  } catch {
    return false;
  }
}

/** Keep only the fields we expect, as plain bounded strings. */
function sanitizeJob(job) {
  const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    jobId: str(job?.jobId, 40),
    pageUrl: str(job?.pageUrl, 2000),
    title: str(job?.title),
    company: str(job?.company),
    linkedinCompanySlug: str(job?.linkedinCompanySlug, 200) || null,
    location: str(job?.location),
    metaText: str(job?.metaText),
    salaryText: str(job?.salaryText),
    description: str(job?.description, 20000),
    applyType: ['easy', 'external'].includes(job?.applyType) ? job.applyType : 'unknown',
    applyHref: str(job?.applyHref, 4000) || null,
  };
}

/**
 * @param {ReturnType<typeof sanitizeJob>} job
 * @returns {Promise<import('../core/result.js').CheckResult>}
 */
async function checkJob(job) {
  const applyUrl = resolveApplyUrl(job.applyHref);
  const detected = {
    company: job.company,
    title: job.title,
    location: job.location || null,
    applyType: job.applyType,
    applyUrl,
    salaryText: job.salaryText || null,
    descriptionChars: job.description.length,
    linkedinCompanySlug: job.linkedinCompanySlug,
  };
  return unknownResult('Verification is not available yet in this preview build (stage 1).', { detected });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ghostcheck:check' || !isTrustedSender(sender)) return false;
  checkJob(sanitizeJob(message.job))
    .then(sendResponse)
    .catch((err) => {
      console.warn('[GhostCheck] check failed', err);
      sendResponse(unknownResult('GhostCheck hit an internal error. This is not evidence against the job.'));
    });
  return true; // keep the channel open for the async response
});
