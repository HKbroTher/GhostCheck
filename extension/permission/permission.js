// Requests access to one careers site. Opened by the service worker when the
// user clicks "Allow checking <site>" on a GhostCheck card.
const params = new URLSearchParams(location.search);
const origin = params.get('origin') || '';
const tabId = Number(params.get('tab'));
const status = document.getElementById('status');
const allow = document.getElementById('allow');

let valid = false;
try {
  const u = new URL(origin);
  valid = u.protocol === 'https:' && u.origin === origin;
  for (const id of ['host', 'host2']) document.getElementById(id).textContent = u.hostname;
  document.getElementById('origin').textContent = `${origin}/*`;
} catch {
  // handled below
}
if (!valid) {
  allow.disabled = true;
  status.textContent = 'This link is not a valid https careers site.';
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

allow.addEventListener('click', async () => {
  allow.disabled = true;
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch (err) {
    status.textContent = `Chrome refused the request: ${err?.message || err}`;
  }
  if (!granted) {
    allow.disabled = false;
    if (!status.textContent) status.textContent = 'Access was not granted. The job stays "Can’t verify".';
    return;
  }
  status.textContent = 'Access granted. Rechecking the job…';
  if (Number.isInteger(tabId)) await chrome.tabs.sendMessage(tabId, { type: 'ghostcheck:recheck' }).catch(() => {});
  setTimeout(closeSelf, 600);
});

document.getElementById('cancel').addEventListener('click', closeSelf);
