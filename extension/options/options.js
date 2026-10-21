// GhostCheck options: description-model toggle and allowed careers sites.
const MODEL_CACHE = 'transformers-cache'; // Transformers.js browser cache name
const status = document.getElementById('status');
const semantic = document.getElementById('semantic');
const modelStatus = document.getElementById('model-status');
const say = (text) => {
  status.textContent = text;
};

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {};
}

async function refreshModelStatus() {
  try {
    const cache = (await caches.has(MODEL_CACHE)) ? await caches.open(MODEL_CACHE) : null;
    const files = cache ? await cache.keys() : [];
    modelStatus.textContent = files.length ? `downloaded (${files.length} files)` : 'not downloaded yet';
  } catch {
    modelStatus.textContent = 'unknown';
  }
}

async function refreshOrigins() {
  const list = document.getElementById('origins');
  list.textContent = '';
  const required = new Set(chrome.runtime.getManifest().host_permissions);
  const { origins = [] } = await chrome.permissions.getAll();
  const optional = origins.filter((o) => !required.has(o) && o !== 'https://*/*');
  if (!optional.length) {
    const li = document.createElement('li');
    li.textContent = 'None yet.';
    list.append(li);
    return;
  }
  for (const origin of optional) {
    const li = document.createElement('li');
    const name = document.createElement('code');
    name.textContent = origin.replace(/\/\*$/, '');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [origin] });
      say(`Removed access to ${name.textContent}.`);
      refreshOrigins();
    });
    li.append(name, remove);
    list.append(li);
  }
}

semantic.addEventListener('change', async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ settings: { ...settings, semantic: semantic.checked } });
  say(semantic.checked ? 'Description matching is on.' : 'Description matching is off. The model will not be downloaded.');
});

document.getElementById('delete-model').addEventListener('click', async () => {
  await caches.delete(MODEL_CACHE);
  say('Downloaded model deleted. It will be downloaded again only if description matching is on.');
  refreshModelStatus();
});

(async () => {
  semantic.checked = (await getSettings()).semantic !== false;
  refreshModelStatus();
  refreshOrigins();
})();
