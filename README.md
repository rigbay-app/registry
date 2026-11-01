# Rigbay module registry

The list of modules that the [Rigbay](https://github.com/rigbay-app/rigbay) app can install. The app reads
[`registry.json`](registry.json) from the `main` branch of this repository (`https://raw.githubusercontent.com/rigbay-app/registry/main/registry.json`),
shows each module with what it declares it uses, and installs one only after it has checked the **SHA-256** of the release zip against the value
written here.

This repository is the **trust anchor** of Rigbay's installer. A module runs inside Rigbay as administrator, so an entry here is a statement
"this exact zip is the module". Every change is a pull request that a maintainer reads and merges by hand; nothing merges automatically.

There are no modules in the list yet: entries are added when a module repository publishes its first release.

## What an entry looks like

```json
{
  "schemaVersion": 1,
  "modules": [
    {
      "id": "steam-access",
      "name": "Steam access",
      "description": "DNS and DPI workaround for networks that block Steam.",
      "repo": "https://github.com/rigbay-app/module-steam-access",
      "versions": [
        {
          "version": "0.3.1",
          "hostApi": ">=0.1 <0.2",
          "zip": "https://github.com/rigbay-app/module-steam-access/releases/download/v0.3.1/steam-access-0.3.1.zip",
          "sha256": "<64 lowercase hex digits>",
          "size": 482113,
          "released": "2026-11-01",
          "declares": {
            "admin": true,
            "network": ["tcp:18081 (local proxy)", "dns-over-https"],
            "registry": ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
            "services": [],
            "outsideFiles": []
          }
        }
      ]
    }
  ]
}
```

The full rules are in [`registry.schema.json`](registry.schema.json); [`scripts/validate.mjs`](scripts/validate.mjs) checks them, and a few the
schema cannot say. In short:

| Field | Rule |
| --- | --- |
| `id` | The `id` of the module's `module.json`: lowercase words joined by `-`, 2 to 40 characters, unique in this file. `rigbay`, `host`, `help`, `list`, `version` are reserved. |
| `repo` | `https://github.com/<owner>/<repo>`: where the source is. The app shows it as a link. |
| `versions` | Oldest first, strictly ascending semantic versions (`1.2.3`, `1.3.0-beta.1`). |
| `version` | The `version` of the `module.json` inside the zip. |
| `hostApi` | The host API range the release supports, as in `module.json` (`>=0.1 <0.2`). The app does not offer a release that does not fit its own API. |
| `zip` | `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip` of **the same repository** as `repo`. Nothing else is ever downloaded. |
| `sha256` | SHA-256 of that zip, 64 lowercase hex digits. |
| `size` | Bytes of the zip, at most 64 MB. |
| `declares` | What the `module.json` inside the zip declares: `admin`, and `requires.network`, `requires.registry`, `requires.services` and `probePaths` (as `outsideFiles`). The app refuses the install when the manifest declares **more** than this. |
| `released` | The release date, `YYYY-MM-DD`. |
| `icon` | Optional, a `.svg` or `.png` in the module repository. The app does not fetch it in this version. |

## How to submit a module

1. **Publish a release** in your module repository: a GitHub release whose asset is a zip with `module.json` at its top level, next to the
   module's DLLs (and `lang\` folder, if any), nothing else. The folder layout is the one in
   [`docs/ABSTRACTIONS.md`](https://github.com/rigbay-app/rigbay/blob/main/docs/ABSTRACTIONS.md) section 2. Do not include `Rigbay.Abstractions.dll`.
   The `id` and `version` in `module.json` must be the module's id and this release's version.
2. **Download the asset from GitHub yourself** (not your local build) and make the entry from it:

   ```
   node scripts/entry.mjs <downloaded.zip> <module.json> https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip
   ```

   It prints the release object with the hash, the size and the declarations filled in. For a first release it prints the whole module entry as well.
   (Without Node: `Get-FileHash -Algorithm SHA256 <zip>` and the file size give the two numbers; copy `declares` from `module.json`.)
3. **Add it to `registry.json`** (a new module goes at the end of `modules`, a new release at the end of that module's `versions`) and open a pull request.
   The check runs `node scripts/validate.mjs`; fix what it reports.
4. A maintainer reads the pull request. What is checked: the repository is public and open source, the zip is the release asset of that repository,
   the hash is the hash of that asset, `declares` is what `module.json` says (and is honest about what the code does), the module's text names the
   hardware it is for and does not promise more than it does.

## Rules that are not negotiable

- **A published release is never edited.** The hash is what users were shown. A fix is a new version. The check fails a pull request that changes
  a release that is already on `main`.
- **A release can be removed** (a pull request deleting its entry, saying why) when it turns out to be bad. Installed copies stay; the app stops offering it.
- **One zip, one repository.** An entry cannot point to another repository's assets or to a mirror.
- **No other registry.** The app reads this file and no other: it has no setting for an extra registry address. This list is the thing users trust, so there
  is one of it. (A fork is a fork of Rigbay.)

## Run the checks on your machine

Node 18 or newer, no packages to install.

```
node scripts/validate.mjs                 # registry.json
node --test scripts/validate.test.mjs     # the validator's own tests, over scripts/fixtures
```

`scripts/fixtures` holds one `registry.json` per rule (a valid one, and one that breaks exactly that rule); the Rigbay app repository keeps a copy and
checks that the app reads every fixture with the same verdict as the validator.

## License

MIT, see [LICENSE](LICENSE).
