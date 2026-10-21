// Requests access to one careers site. Opened by the service worker when the
// user clicks "Allow checking <site>" on a GhostCheck card.
import { resolveLanguage, t } from '../core/i18n.js';

const params = new URLSearchParams(location.search);
const origin = params.get('origin') || '';
const tabId = Number(params.get('tab'));
const $ = (id) => document.getElementById(id);

const { settings } = await chrome.storage.local.get('settings').catch(() => ({}));
const lang = resolveLanguage(settings?.language, chrome.i18n.getUILanguage());
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

let host = '';
let valid = false;
try {
  const u = new URL(origin);
  valid = u.protocol === 'https:' && u.origin === origin;
  host = u.hostname;
} catch {
  // handled below
}

document.title = t(lang, 'perm.pageTitle');
$('heading').textContent = t(lang, 'perm.heading', { host });
$('body').textContent = t(lang, 'perm.body', { host });
$('scope').textContent = t(lang, 'perm.scope', { origin: `${origin}/*` });
$('privacy').textContent = t(lang, 'perm.privacy');
$('allow').textContent = t(lang, 'perm.allow');
$('cancel').textContent = t(lang, 'perm.cancel');
if (!valid) {
  $('allow').disabled = true;
  $('status').textContent = t(lang, 'perm.invalid');
}

async function closeSelf() {
  try {
    if (Number.isInteger(tabId)) await chrome.tabs.update(tabId, { active: true });
    const me = await chrome.tabs.getCurrent();
    if (me?.id) await chrome.tabs.remove(me.id);
  } catch {
    window.close();
  }
}

$('allow').addEventListener('click', async () => {
  $('allow').disabled = true;
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch (err) {
    $('status').textContent = t(lang, 'perm.refused', { error: err?.message || err });
  }
  if (!granted) {
    $('allow').disabled = false;
    if (!$('status').textContent) $('status').textContent = t(lang, 'perm.denied');
    return;
  }
  $('status').textContent = t(lang, 'perm.granted');
  if (Number.isInteger(tabId)) await chrome.tabs.sendMessage(tabId, { type: 'ghostcheck:recheck' }).catch(() => {});
  setTimeout(closeSelf, 600);
});

$('cancel').addEventListener('click', closeSelf);
