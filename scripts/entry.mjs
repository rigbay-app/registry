#!/usr/bin/env node
// Prints the registry entry for one release, from the zip you are about to publish and its module.json, so the hash, the size and the
// declarations are not typed by hand:
//
//   node scripts/entry.mjs <release.zip> <module.json> <zip address on GitHub>
//
// Example:
//   node scripts/entry.mjs dist/steam-access-0.3.1.zip src/SteamAccess/module.json \
//        https://github.com/rigbay-app/module-steam-access/releases/download/v0.3.1/steam-access-0.3.1.zip
//
// It prints the object for "versions" (paste it at the end of that module's list) and, for a first release, the whole module entry.
// It does not open the zip: use the module.json that is inside it (the host checks that they agree and refuses the install if not).

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { validateRegistry } from './validate.mjs';

const [zipPath, manifestPath, zipUrl] = process.argv.slice(2);
if (!zipPath || !manifestPath || !zipUrl) {
  console.error('usage: node scripts/entry.mjs <release.zip> <module.json> <zip address>');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
const zip = readFileSync(zipPath);
const requires = manifest.requires ?? {};
const release = {
  version: manifest.version,
  hostApi: manifest.hostApi,
  zip: zipUrl,
  sha256: createHash('sha256').update(zip).digest('hex'),
  size: statSync(zipPath).size,
  released: new Date().toISOString().slice(0, 10),
  declares: {
    admin: requires.admin === true,
    network: requires.network ?? [],
    registry: requires.registry ?? [],
    services: requires.services ?? [],
    outsideFiles: manifest.probePaths ?? [],
  },
};
const repo = zipUrl.split('/releases/download/')[0];
const module = { id: manifest.id, name: manifest.name, description: manifest.description, repo, versions: [release] };

const problems = validateRegistry({ schemaVersion: 1, modules: [module] });
console.log('// the release (add it to the end of the module\'s "versions"):');
console.log(JSON.stringify(release, null, 2));
console.log('\n// the whole module entry (first release of a new module):');
console.log(JSON.stringify(module, null, 2));
if (problems.length > 0) {
  console.error('\nThe entry has problems that the pull request check would also find:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
