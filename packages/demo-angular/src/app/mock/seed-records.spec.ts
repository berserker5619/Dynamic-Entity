import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DynamicFormComponent, type EntityFormConfig } from 'ngx-dynamic-entity';
import { appConfig } from '../app.config';
import { demoRulesFor } from './demo-rules';
import { LocalStore } from './local-store.service';

/**
 * Every record the demo seeds can be saved as it stands.
 *
 * A seed that fails its own config is a record a visitor opens, changes one thing in, and
 * cannot save — with an error on a field they never touched. All three seeded insurance
 * claims shipped like that (a `nationalId` that failed its own pattern) and nothing noticed
 * until an e2e happened to save one.
 *
 * The check is the form's own, not a reimplementation: each record is rendered in
 * `DynamicFormComponent` with the providers and rules the app uses, and Save must not be
 * blocked — no invalid field, no rule error, nothing pending. Seeded exactly as the app
 * seeds, through `LocalStore`, so a new entity or record is checked by existing.
 */
describe('seeded demo records', () => {
  beforeEach(async () => {
    Object.keys(localStorage)
      .filter(key => key.startsWith('de_demo_'))
      .forEach(key => localStorage.removeItem(key));
    await TestBed.configureTestingModule({
      imports: [DynamicFormComponent],
      providers: [...appConfig.providers, provideNoopAnimations()],
    }).compileComponents();
  });

  afterEach(() => {
    Object.keys(localStorage)
      .filter(key => key.startsWith('de_demo_'))
      .forEach(key => localStorage.removeItem(key));
  });

  /** Why this record cannot be saved unedited, or an empty list. */
  async function problemsWith(
    config: EntityFormConfig,
    record: Record<string, unknown>,
  ): Promise<string[]> {
    const fixture = TestBed.createComponent(DynamicFormComponent);
    const form = fixture.componentInstance;
    form.config = config;
    form.initialData = record;
    form.rules = demoRulesFor(config.entity);
    form.userRoles = ['admin'];
    form.ngOnChanges({
      config: new SimpleChange(undefined, config, true),
      initialData: new SimpleChange(undefined, record, true),
    });
    fixture.detectChanges();

    // Async validators (the demo's uniqueEmail) hold the form pending until they answer.
    // Polled: the form-level statusChanges does not reliably fire when a child's async
    // check settles, and waiting on it hung the spec.
    for (let waited = 0; form.form.pending && waited < 3000; waited += 50) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    fixture.detectChanges();

    const problems = [
      ...form.invalidFields().map(entry => `${entry.field.id}: ${entry.message}`),
      ...Object.entries(form.ruleValidationErrors).map(([target, message]) => `${target}: ${message} (rule)`),
    ];
    if (form.submitBlocked && problems.length === 0) {
      problems.push('Save is blocked with nothing listed in the error summary');
    }
    fixture.destroy();
    return problems;
  }

  it('can each be saved without an edit', async () => {
    const store = TestBed.inject(LocalStore);
    const configs = store.listConfigs() as unknown as EntityFormConfig[];
    expect(configs.length).toBeGreaterThan(5);

    const failures: string[] = [];
    let checked = 0;
    for (const config of configs) {
      for (const record of store.getAllRecords(config.entity)) {
        checked++;
        for (const problem of await problemsWith(config, record)) {
          failures.push(`${config.entity}/${String(record['_id'])} — ${problem}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(20);
    expect(failures).withContext('seeded records that cannot be saved as they stand').toEqual([]);
    // Every record with an async validator waits out its check, on purpose.
  }, 60_000);
});
