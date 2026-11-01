## What this changes

<!-- New module, new release of a module, or removal of a release (say why). -->

## Checklist

- [ ] The zip is the release asset of the module's own public repository, and I downloaded it from there to make the hash (`node scripts/entry.mjs`).
- [ ] `module.json` is at the top level of the zip; its `id` and `version` are the ones in this entry.
- [ ] `declares` is what `module.json` declares, and the module does not use anything it does not declare.
- [ ] I did not change a release that is already published (a fix is a new version).
- [ ] `node scripts/validate.mjs` passes on my machine.
