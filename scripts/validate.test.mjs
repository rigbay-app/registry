// node --test scripts/
// Every file in scripts/fixtures is a registry.json; expectations.json says whether it must pass and what the first error must mention.
// The Rigbay host repository carries a copy of these fixtures and checks that the host reads them with the same verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateRegistry, compareWithBase, compareSemver, isZipOfRepo, parseRepo } from './validate.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const expectations = JSON.parse(readFileSync(join(dir, 'expectations.json'), 'utf8'));

function load(file) {
  const raw = readFileSync(join(dir, file), 'utf8');
  try { return JSON.parse(raw); } catch { return { __notJson: true }; }
}

test('every fixture has an expectation and every expectation a fixture', () => {
  const files = readdirSync(dir).filter((f) => f !== 'expectations.json').sort();
  assert.deepEqual(files, Object.keys(expectations).sort());
});

for (const [file, expected] of Object.entries(expectations)) {
  test(`fixture ${file}`, () => {
    const doc = load(file);
    const errors = doc.__notJson ? ['not valid JSON'] : validateRegistry(doc);
    if (expected.valid) {
      assert.deepEqual(errors, [], errors.join('; '));
    } else {
      assert.ok(errors.length > 0, 'expected problems, found none');
      assert.ok(errors.some((e) => e.toLowerCase().includes(expected.mention.toLowerCase())), `no error mentions '${expected.mention}': ${errors.join(' | ')}`);
    }
  });
}

test('semantic version order', () => {
  const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  for (let i = 0; i < order.length - 1; i++) assert.equal(compareSemver(order[i], order[i + 1]), -1, `${order[i]} < ${order[i + 1]}`);
  assert.equal(compareSemver('1.0.0+a', '1.0.0+b'), 0);
});

test('a zip address must be a release download of the same repo', () => {
  const repo = 'https://github.com/rigbay-app/module-demo';
  assert.ok(isZipOfRepo('https://github.com/rigbay-app/module-demo/releases/download/v1/x.zip', repo));
  assert.ok(isZipOfRepo('https://GitHub.com/Rigbay-App/Module-Demo/releases/download/v1/x.ZIP', repo));
  for (const bad of [
    'http://github.com/rigbay-app/module-demo/releases/download/v1/x.zip',
    'https://github.com/evil/module-demo/releases/download/v1/x.zip',
    'https://github.com.evil.com/rigbay-app/module-demo/releases/download/v1/x.zip',
    'https://github.com/rigbay-app/module-demo/releases/download/v1/x.exe',
    'https://github.com/rigbay-app/module-demo/releases/download/v1/x.zip?a=1',
    'https://github.com/rigbay-app/module-demo/releases/download/v1/%2e%2e/x.zip',
    'https://user@github.com/rigbay-app/module-demo/releases/download/v1/x.zip',
    'https://github.com/rigbay-app/module-demo/releases/download/v1/a/b.zip',
  ]) assert.equal(isZipOfRepo(bad, repo), false, bad);
  assert.equal(parseRepo('https://github.com/rigbay-app/module-demo/'), null);
  assert.deepEqual(parseRepo('https://github.com/rigbay-app/module-demo'), { owner: 'rigbay-app', name: 'module-demo' });
});

test('a published release may not be changed, but may be yanked', () => {
  const base = JSON.parse(readFileSync(join(dir, 'valid-two-releases-prerelease.json'), 'utf8'));
  const same = structuredClone(base);
  assert.deepEqual(compareWithBase(same, base), { errors: [], warnings: [] });

  const changed = structuredClone(base);
  changed.modules[0].versions[0].sha256 = 'b'.repeat(64);
  assert.equal(compareWithBase(changed, base).errors.length, 1);

  const added = structuredClone(base);
  added.modules[0].versions.push({ ...base.modules[0].versions[2], version: '1.2.0', zip: 'https://github.com/rigbay-app/module-example/releases/download/v1.2.0/e.zip' });
  assert.deepEqual(compareWithBase(added, base), { errors: [], warnings: [] });

  const yanked = structuredClone(base);
  yanked.modules[0].versions.splice(1, 1);
  const r = compareWithBase(yanked, base);
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 1);

  const moved = structuredClone(base);
  moved.modules[0].repo = 'https://github.com/rigbay-app/module-other';
  assert.equal(compareWithBase(moved, base).errors.length, 1);
});

test('the registry in this repository is valid', () => {
  const doc = JSON.parse(readFileSync(join(dir, '..', '..', 'registry.json'), 'utf8'));
  assert.deepEqual(validateRegistry(doc), []);
});

test('registry.schema.json parses and every $ref in it resolves', () => {
  const schema = JSON.parse(readFileSync(join(dir, '..', '..', 'registry.schema.json'), 'utf8'));
  const refs = [];
  (function walk(n) {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { if (k === '$ref') refs.push(v); else walk(v); }
  })(schema);
  assert.ok(refs.length >= 5);
  for (const ref of refs) {
    const target = ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], schema);
    assert.ok(target, `unresolved ${ref}`);
  }
});
