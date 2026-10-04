# E2E coverage — plan to close the gaps

**Input:** the e2e audit of Oct 4, 2026 (47 spec files, 266 tests, run green at `bf5cffd`). It
found two real bugs and several shipped features that no browser test exercises. This plan fixes
the bugs first, then adds the missing coverage in order of risk.

**Ground rules**

- One commit per step, straight to `main`. Each step leaves `npm test`, `npm run lint` and the
  full `npm run e2e` green.
- A new e2e test must be able to fail. Each one asserts what the user sees *and* what was
  persisted (`localStorage` record or the server's stored rows), not only that something rendered.
- Selectors use `data-testid`. Where a control has none, the step adds one to the component.
  Adding a test hook is the only product change allowed in the coverage steps.
- Every new spec runs in both Playwright projects (default and `[narrow]`). A test that cannot
  hold at phone width is skipped there with a reason, as the auto-layout test already is.
- Effort: S ≈ ½ day, M ≈ 1–2 days.

## Order at a glance

| Step | What | Kind | Effort |
|---|---|---|---|
| 1 | `validateConfig` rejects unknown operators and target-less rules | Bug, core | S |
| 2 | Fix `test_data.json` rules; every shipped config validates clean | Bug, data | S |
| 3 | Demo rules the coverage steps need | Demo data | S |
| 4 | `import-mapping.spec.ts` — the 2.3 import features | E2E | M |
| 5 | `field-types-2-2.spec.ts` — url, phone, color, tags, slider, rating, time | E2E | M |
| 6 | `rules-banners-and-tabs.spec.ts` — info banners, hidden tabs, more operators | E2E | S |
| 7 | `builder-structure.spec.ts` — the builder operations nothing drives | E2E + test hooks | M |
| 8 | Smaller gaps and weak tests | E2E | S |

Steps 4–7 do not depend on each other. Step 6 depends on 3.

---

## Step 1 — `validateConfig` rejects what the engine silently ignores

**Problem.** `test_data.json`'s `complexFullTest` rules use `EQUALS` and `GREATER_THAN`. The
operators are `EQUAL` and `MORE_THAN`, so `evaluateCondition` returns `false` and both rules
never fire. Its info rule also has no targets, so even a firing rule would show nothing.
`validateConfig(config, { rules })` reports no problem for either, and neither does the CLI CI
uses.

**Work** (`packages/core/src/validate-config.ts`, in the existing per-rule loop):

1. `error` for a condition whose `operator` is not a `RuleOperator`: "Unknown operator
   "EQUALS"; the condition can never hold." Add a "did you mean" for the near misses (`EQUALS` →
   `EQUAL`, `GREATER_THAN` → `MORE_THAN`, `LESS_THAN_OR_EQUAL` → `LESS_THAN_EQUAL`). Take the
   operator list from one exported constant, so the type and the check cannot drift.
2. `error` for an unknown `action.type`, if not already checked.
3. `warning` for a rule with an empty `targets` array: "This rule has no targets; it changes
   nothing when it fires." It is a warning, not an error, because a disabled draft rule is
   legitimate.
4. `compareType: 'field'` without `compareToField` — confirm it is already reported; add it if not.

**Specs:** each case in `validate-config.spec.ts`; the CLI exits `1` on the operator typo
(`cli.spec.ts`).

**Changelog:** under 2.3.1 / Fixed. A config with a typo'd operator now fails validation, which
is the point, so note it under Upgrading.

## Step 2 — Fix the shipped data, and keep it fixed

1. `test_data.json` `complexFullTest`: `EQUALS` → `EQUAL`, `GREATER_THAN` → `MORE_THAN`, and
   give the info rule the target it was evidently meant for (the budget field).
2. Re-run `server/src/all-configs.spec.ts`. The rules now fire, so the synthesised row may be
   hidden or flagged differently. Adjust the synthesiser rather than the assertion if a row now
   fails for a real reason, and say so in the commit.
3. Check `complex-full-flow.spec.ts` still passes: the hide rule now actually hides `bioNotes`
   when its condition holds.
4. **Guard against recurrence:** a core spec that loads every config the repository ships —
   `test_data.json`, `demo-angular/src/app/mock/configs/*.json`, and `DEMO_RULES` — and asserts
   `validateConfig(config, { rules })` has **no errors**. A typo then fails `npm test` instead of
   silently disabling a rule.

## Step 3 — Demo rules the coverage needs

The demo only ships rules for `employees` (one show, one validation). Add to `DEMO_RULES` for
`patientIntake`, each documented the way the existing two are:

| Rule | Exercises |
|---|---|
| `info` banner when pain level ≥ 8 | `info` action, `MORE_THAN_EQUAL`, the record view's dismissible banner |
| Hide the consent sub-tab while the patient is a minor | hiding a **tab**, `DATE_AFTER` on date of birth |
| `validation` warning when the triage level changes | `VALUE_CHANGED` against the loaded record |
| Show a field when allergies `HAS_ITEMS` | `HAS_ITEMS` on a `tags` or array field |

Pick the fields while implementing, from what Patient Intake actually has. `check-demo-coverage.mjs`
must stay green.

---

## Step 4 — `import-mapping.spec.ts`

Runs against the in-browser transport, and repeats the transport-sensitive cases with
`?transport=http`, the way `import-all-configs.spec.ts` does. Needs an entity with an `array`
field; use `insuranceClaims` or `employees`, whichever has one with two or more children.

| Test | Asserts |
|---|---|
| Numbered headers map themselves | A sheet headed `Phone 1 Number, phone_2_number, Number (3)` lands on slots 0–2, each with the **Guessed** badge (`import-guess-<ref>`) |
| The sheet sizes the slots | Headers up to `Phone 6 Number` give six rows per array (`import-map-<array>.5.<child>` exists, `.6.` does not) |
| Add a row | `import-add-slot-<array>` adds one row per child; mapping it imports a record with that row filled |
| Required field warning | Unmapping a required field shows `import-required-unmapped`; mapping it clears it |
| Semicolon CSV | `Name;Amount` with `"Rao; Jr."` and `1,5` imports `Rao; Jr.` and `1.5`; the review step shows `import-delimiter` with the semicolon text |
| TSV | A `.tsv` upload imports into the right columns with no custom parser |
| Server parity | The same semicolon file through `?transport=http` stores identical records |
| A Word file | Uploading a `.docx` through `?transport=http` shows the "not an Excel workbook" refusal |
| Rules by `[ref]` | A row leaving a rule-hidden required field blank imports (needs a `[ref]` rule on the entity — reuse the `employees` show rule's counterpart, or add one in step 3) |

**Not reachable from the demo:** the mapper keeping fixed values and stale entries only applies
to a plan passed *in*, and `ngx-entity-import` takes no plan input. That behaviour stays covered
by `import-mapper.component.spec.ts`. If a stored-plan input is ever added to the wizard, add the
e2e then. Say this in the spec's header comment so the gap is visible.

## Step 5 — `field-types-2-2.spec.ts`

`clients` carries `url`, `phone`, `color` and `tags`; `patientIntake` carries `slider` and
`rating`; `test_data.json` carries a `time` field. For each type: edit, save, reload, assert the
stored value and the re-rendered control.

| Type | Beyond the round trip |
|---|---|
| `url` | An invalid URL with `validators.url` is refused with its message; read-only, an `https:` value is a link and a `javascript:` value is not |
| `phone` | An invalid number is refused; separators are kept as typed |
| `color` | `#ABC` is stored as `#aabbcc` |
| `tags` | Enter, comma and semicolon each add a tag; Backspace in an empty box removes the last; a repeated tag is handled as `normalizeTags` specifies (check the rule before asserting it) |
| `slider` | Arrow keys move by `step`; an untouched slider says it is unset rather than showing its midpoint |
| `rating` | Keyboard selection works (radios), and the stored value is the star count |
| `time` | `HH:mm` round-trips without a date or a timezone shift |

Plus the data-only and record-view presentations render each value correctly (one pass over
all seven).

## Step 6 — `rules-banners-and-tabs.spec.ts`

Against the step 3 rules on `patientIntake`:

- the info banner appears when the condition holds and goes when it stops; in the record view it
  can be dismissed and stays dismissed until the condition re-fires;
- the consent tab disappears for a minor and returns for an adult, and a required field on it
  does not block Save while it is hidden;
- the `VALUE_CHANGED` warning appears only after the triage level differs from the loaded value;
- the `HAS_ITEMS` field appears when the first item is added.

## Step 7 — `builder-structure.spec.ts`

Test hooks already exist for most of this (`row-delete-`, `row-duplicate-`, `tab-row-`,
`subtab-row-`, `collapse-fields`, `expand-fields`, `collapse-preview`, `expand-preview`,
`builder-rule-graph`, `edge-card-`, `rule-up-`, `rule-down-`, `rule-delete-`, `builder-problems`).
**Add hooks** where there are none: the tab manager's Add tab button, tab rename and reorder, the
rule enable toggle, and the permissions editor's role chips.

| Test | Asserts |
|---|---|
| Remove a field | It leaves the canvas and the preview; undo restores it |
| Duplicate a field | The copy has a suffixed id and the same settings |
| Tabs | Add, rename and reorder a tab and a sub-tab; the emitted config reflects each |
| Centre panels | Fields canvas and Live Preview collapse and expand independently, through the toolbar and the card buttons; state survives a reload (the demo binds them) |
| Rule graph navigation | Clicking an edge or node selects that field in the canvas and the inspector |
| Rule list | Reorder changes `priority`; disabling a rule stops it firing in the preview; delete removes it from `rulesChange` |
| Permissions | Adding a role to `edit` lets that role edit in the demo form, and removing it locks the form |
| Save refused on errors | A duplicate id puts an error in `builder-problems` and Save does not persist the config |

Check first whether the demo persists the centre-panel state. If it binds only the side panels,
wire the other two the same way (`de_demo_` keys).

## Step 8 — Smaller gaps and weak tests

- **`readOnlyFields`**: not wired in the demo. Add a demo control (e.g. lock the email on
  `clients` for the `viewer` role), then assert the field is read-only while the rest stay
  editable. `check-demo-coverage.mjs` will want the input demonstrated anyway.
- **`error` state**: the demo binds `[loading]` but not `[error]`. Wire a failing-load path, or
  leave it to unit tests and say so in this plan's follow-up notes.
- **`field-catalog-and-show-when.spec.ts`**: its title says an "18-type catalog"; the catalog has
  27. Retitle it and assert the palette offers all 27, not four.
- **`enterprise-templates.spec.ts`**: keep it as a navigation smoke test, now that step 5 covers
  the field types it was standing in for.
- **`rules-and-record-form.spec.ts`**: fold its two render-only checks into a spec that asserts
  behaviour, or delete it if step 6 covers the same ground.

## Explicitly not e2e

These keep unit or script coverage, because a browser adds nothing:
- the full operator matrix (`rules-engine.operators.spec.ts`);
- the CLI and SSR (the scripts);
- zip limits (`xlsx-source.spec.ts`);
- the typed-cell parser path (`local-import-transport.spec.ts`);
- timezones (`check-timezones.mjs`).

## Done when

- Steps 1–2: `validateConfig` and the CLI reject the shipped typo, and every shipped config
  validates clean in `npm test`.
- Steps 3–8: every row in the audit's "no e2e at all" list is either covered by a test above or
  listed under "Explicitly not e2e" / "Not reachable from the demo" with its reason.
- Full `npm run e2e` green in both projects. The expected added runtime is 3–4 minutes.

---

## Outcome (Oct 4, 2026)

All eight steps landed on `main`. Writing the tests turned up five more real bugs, each fixed in
its own commit ahead of the test that found it.

**Bugs found while writing the tests**

| Bug | Found by | Fix |
|---|---|---|
| `required: true` on the field (not under `validators`) is read by nothing. Fifteen fields in `patient-intake.json` and `it-assets.json` were silently optional | step 6: an adult intake saved with no consent | `validateConfig` error; data moved under `validators` |
| A rule-hidden tab's fields stayed in form validity. Save refused with no error summary, because the summary lists visible tabs only. Import already relaxed them | step 6: a minor's intake would not save | renderer disables every field a non-rendered tab owns |
| Seeded insurance claims failed their own `nationalId` pattern, so none could be saved unedited | step 5: saving `claim_001` | seed IDs fixed |
| The demo never bound `[rules]` on the import page, and `import-server.mjs` passed none, so imports ignored `DEMO_RULES` | step 4: the `[ref]` rule test | both transports get `DEMO_RULES` |
| The builder could not resolve a field inside a `group`. Its row highlighted, but the inspector stayed empty, and remove, duplicate, move and setters did nothing | step 7: selecting `contact.email` | lookups and list edits walk `children` |
| Builder rows below 560px showed no field name (0px label), and the selected row's buttons overlapped the badge | step 7, narrow project | actions take a full second line |

**Where the implementation departs from the plan, and why**

- *Step 1:* also rejects unknown target types, and treats a whitespace-only `compareToField` as
  missing.
- *Step 2:* the guard spec is `server/src/shipped-configs.spec.ts`, not a core spec. It imports
  `DEMO_RULES` (TypeScript that imports core's types). Server tests run against a built core;
  core's own do not. The `complex-full-flow.spec.ts` check was moot, because the demo never
  loads `test_data.json`'s rules.
- *Step 3:* Patient Intake had no `tags` or `array` field and no sub-tabs. The config gains
  `knownAllergens` (tags) and `allergyActionPlan` (shown only by the `HAS_ITEMS` rule). The
  consent "sub-tab" is a top-level tab.
- *Step 4:* import stores array rows compacted, with empty slots dropped, so slot 6 is the
  second address rather than index 5. The header grammar's trailing-`s` singular means
  `Address 1 Street` does not map for an array labelled "Addresses"; the spec uses
  `Addresses 1 Street`. Both are documented behaviour, recorded in the spec header.
- *Step 5:* the form displays a stored `#ABC` as `#aabbcc` but does not rewrite it on save. Only
  import normalises it, so the assertion is split in two.
- *Step 6:* a dismissed record-view banner stays dismissed for the session even when its rule
  re-fires, and is re-armed when the record is loaded again. That is the documented contract on
  `DynamicRecordFormComponent.dismissed`, and the test asserts it rather than "until the
  condition re-fires".
- *Step 7:* sub-tabs have no reorder control, so there is nothing to test. The demo's live
  preview gets no `[rules]`, so a disabled rule is proved in the record form after Save. The
  builder never lets a duplicate id exist (it suffixes), so the refused save uses an empty
  entity name. The demo already persisted the centre panels.
- *Step 8:* `check-demo-coverage.mjs` does not check component inputs, but `readOnlyFields` is
  wired anyway (IT Support cannot edit a client's email) and asserted in `demo.spec.ts`. `[error]`
  had no unit test either, so it now has unit tests on both form components rather than a
  contrived failing-load path in the demo. `rules-and-record-form.spec.ts` is deleted: both its
  checks were already asserted elsewhere, more strongly.

**Follow-ups**

- *Done:* `import-all-configs.spec.ts` now covers `patientIntake` and `itAssets` on both
  transports, and a new test compares its entity list with the picker, so the next entity
  cannot be skipped.
- *Done:* `demo-angular/src/app/mock/seed-records.spec.ts` renders every seeded record in the
  real form, with the app's providers and rules, and fails if Save would be blocked. It fails
  on the old claims seed, and it found one more bug: `order_001` held its values at the record
  root instead of under the `order` tab, so it opened empty and could not be saved. That seed is
  now fixed.
- *Open:* on a new record every field counts as changed, so `VALUE_CHANGED` fires as soon as a
  value is entered. That is correct by the operator's definition, but noisy for the triage
  warning.
