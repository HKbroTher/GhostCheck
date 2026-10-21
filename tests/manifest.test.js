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

test('every file referenced by the manifest exists', () => {
  const files = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => c.js),
    ...Object.values(manifest.icons),
    'rules.yaml',
    'data/companies.json',
  ];
  for (const f of files) assert.ok(existsSync(new URL(f, root)), `missing: extension/${f}`);
});

test('no remote code: manifest has no external script sources', () => {
  assert.equal(manifest.content_security_policy, undefined);
  assert.equal(JSON.stringify(manifest).includes('http://'), false);
});
