# demo-angular

The showcase application and the home of the Playwright E2E suite. **Not published** — it
exists to exercise the packages and to be something you can click through.

```bash
npm run dev --workspace=demo-angular   # http://localhost:4200
```

## What it demonstrates

- Every field type, rendered from the configs in `../../test_data.json`
- The role switcher, showing masking and `permissions.view` in action
- The visual builder with live preview
- Records persisted to `localStorage` via a mock store, so there is no backend to run

## Its stylesheet is a reference

`src/styles.css` is a fuller treatment than the optional base stylesheet the renderer ships
(`ngx-dynamic-entity/styles.css`). If you want to see how far the BEM hooks can be taken,
read it.

## E2E

```bash
npm run e2e                             # from the repo root
npx playwright test e2e/demo.spec.ts    # one spec, from here
```

`test-data-json-rendering.spec.ts` is the one worth knowing about: it asserts that every field
type in `test_data.json` exists in the catalog, fails on any `[ngx-dynamic-entity]` console
warning, and requires a tab declaring fields to actually render controls. It previously watched
only for uncaught exceptions and so passed green over three field types the renderer refused
to draw.

The full suite is slow — `playwright.config.ts` sets `workers: 1` and two builder specs drive
hundreds of interactions each — so CI runs a fast subset per pull request and the whole thing
nightly.
