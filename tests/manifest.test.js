import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SOURCE_HOSTS } from '../core/sources/index.js';
import { RAW_BASE } from '../core/config.js';
import { waybackQueryUrl } from '../core/wayback.js';

const root = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));

test('manifest grants every host the extension calls', () => {
  const hosts = new Set(manifest.host_permissions.map((p) => new URL(p.replace('/*', '/')).host));
  for (const h of [...SOURCE_HOSTS, new URL(RAW_BASE).host, new URL(waybackQueryUrl('x')).host]) assert.ok(hosts.has(h), `missing host permission: ${h}`);
});

test('workday hosts and optional careers-site access are declared', () => {
  assert.ok(manifest.host_permissions.includes('https://*.myworkdayjobs.com/*'));
  assert.ok(manifest.host_permissions.includes('https://*.myworkdaysite.com/*'));
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
});

test('every file referenced by the manifest exists', () => {
  const files = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => c.js),
    ...Object.values(manifest.icons),
    'rules.yaml',
    manifest.options_ui.page,
    'offscreen/offscreen.html',
    'permission/permission.html',
    'data/companies.json',
  ];
  for (const f of files) assert.ok(existsSync(new URL(f, root)), `missing: extension/${f}`);
});

test('no remote code: scripts only from the extension itself', () => {
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
  assert.equal(JSON.stringify(manifest).includes('http://'), false);
});

test('the bundled model runtime is local and the offscreen page points at it', () => {
  for (const f of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
    assert.ok(existsSync(new URL(`vendor/transformers/${f}`, root)), `missing vendor/transformers/${f}`);
  }
  const offscreen = readFileSync(new URL('offscreen/offscreen.js', root), 'utf8');
  assert.match(offscreen, /wasmPaths = chrome\.runtime\.getURL\('vendor\/transformers\/'\)/);
  assert.ok(manifest.permissions.includes('offscreen'));
});
