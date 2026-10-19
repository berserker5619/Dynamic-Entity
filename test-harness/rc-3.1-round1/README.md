# 3.1 release-candidate round 1

The scripts behind round 1 in [`docs/3.1-rc-feedback.md`](../../docs/3.1-rc-feedback.md): Dynamic
Entity `3.1.0-rc.1` and sheet-to-schema `1.3.0`, **as published on npm, never this repository's
source**, in fresh projects outside the monorepo. Nothing here is a workspace or published, and no
CI job runs it. Kept so the round can be repeated against a later candidate.

| File | What it does |
| --- | --- |
| `app-main.ts` | The Angular app. One source, two builds: `csv-app` never imports `ngx-dynamic-entity/xlsx`; `full-app` does, behind `?parser=xlsx`. `?plan=grouped` makes each suggestion a grouped plan, and `?transport=http&api=/api/on` uses `HttpImportTransport`. |
| `setup.mjs` | Writes both apps beside itself, installs the version given, `ng build`s each, and reports whether `exceljs` is installed and which chunks hold ExcelJS. |
| `server/server.mjs` | The full app and three real servers on `:4611`: `/api/on` (3.1, `grouping: true`), `/api/off` (3.1, the default) and `/api/v30` (the published 3.0.0, from a project of its own). The CSV-only app is on `:4612`. |
| `drive.mjs` | Every case in Chromium, Firefox and WebKit, with screenshots. |

```bash
W=/path/to/scratch && mkdir -p $W/fixtures && cd $W
cp /path/to/Dynamic-Entity/test-harness/rc-3.1-round1/* . && cp -r /path/to/Dynamic-Entity/test-harness/rc-3.1-round1/server .
cp /path/to/Dynamic-Entity/packages/core/test-fixtures/sheet-to-schema/*.xlsx fixtures/
npm init -y && npm pkg set type=module
npm install playwright@1.64.1 @dynamic-entity/core@$VERSION sheet-to-schema exceljs@4.4.0
npx playwright install chromium firefox webkit

node setup.mjs $VERSION                       # csv-app/ and full-app/, each ng build
(cd server && npm init -y && npm pkg set type=module && npm install @dynamic-entity/server@$VERSION @dynamic-entity/core@$VERSION express@5)
# The 3.0.0 server peers on @dynamic-entity/core ^3.0.0, which a prerelease does not satisfy:
mkdir -p $TMP/de-published-server-3.0.0 && (cd $TMP/de-published-server-3.0.0 && npm init -y && npm install @dynamic-entity/server@3.0.0 @dynamic-entity/core@3.0.0 express@5)
(cd server && echo '{}' > configs.json && node server.mjs &)
node drive.mjs /path/to/Dynamic-Entity/docs/3.1-screens/round
```

`DE30_DIR` points the server at the 3.0.0 project if it is elsewhere. The typings case is Round 3's
`c-typings` (`../rc-round3/README.md`, case c), run against `$VERSION`.
