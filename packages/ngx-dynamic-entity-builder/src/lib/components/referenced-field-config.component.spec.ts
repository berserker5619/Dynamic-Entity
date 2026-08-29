import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { ConfigSourceService } from 'ngx-dynamic-entity';
import { BuilderStore } from '../builder-store.service';
import { ReferencedFieldConfigComponent } from './referenced-field-config.component';

const SOURCE_CONFIG: EntityFormConfig = {
  entity: 'individuals',
  version: 1,
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First Name' }, validators: { required: true } },
      ],
    },
  ],
};

describe('ReferencedFieldConfigComponent', () => {
  let fixture: ComponentFixture<ReferencedFieldConfigComponent>;
  let store: BuilderStore;
  let getConfig: jest.Mock;

  async function setup(): Promise<void> {
    getConfig = jest.fn().mockResolvedValue(SOURCE_CONFIG);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ReferencedFieldConfigComponent],
      providers: [
        BuilderStore,
        provideNoopAnimations(),
        { provide: ConfigSourceService, useValue: { getConfig } },
      ],
    }).compileComponents();

    store = TestBed.inject(BuilderStore);
    store.setEntityName('clients');
    fixture = TestBed.createComponent(ReferencedFieldConfigComponent);
    fixture.detectChanges();
  }

  beforeEach(setup);

  const api = () => fixture.componentInstance as unknown as {
    toggleReferenced(f: unknown, enabled: boolean): void;
    updateEntityKey(f: unknown, key: string): void;
    updateFieldId(f: unknown, id: string): void;
    syncWithSource(f: unknown): Promise<void>;
  };

  function addSelectedField(id = 'clientName'): Record<string, any> {
    const created = store.addField('text');
    store.renameField(created, id);
    store.selectField(id);
    fixture.detectChanges();
    return store.fields().find(f => f.id === id) as Record<string, any>;
  }

  it('renders nothing until a field is selected', () => {
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('marks a field as referenced when linked', () => {
    const field = addSelectedField();
    api().toggleReferenced(field, true);

    expect(store.fields()[0].isReferenced).toBe(true);
  });

  it('unlinks a field when the toggle is turned off', () => {
    const field = addSelectedField();
    api().toggleReferenced(field, true);
    api().toggleReferenced(store.fields()[0], false);

    expect(store.fields()[0].isReferenced).toBeFalsy();
  });

  it('stores a trimmed source entity key and clears it when blank', () => {
    const field = addSelectedField();
    api().updateEntityKey(field, '  individuals  ');
    expect(store.fields()[0].referencedEntityKey).toBe('individuals');

    api().updateEntityKey(store.fields()[0], '   ');
    expect(store.fields()[0].referencedEntityKey).toBeUndefined();
  });

  it('stores a trimmed source field id and clears it when blank', () => {
    const field = addSelectedField();
    api().updateFieldId(field, '  firstName  ');
    expect(store.fields()[0].referencedFieldId).toBe('firstName');

    api().updateFieldId(store.fields()[0], '');
    expect(store.fields()[0].referencedFieldId).toBeUndefined();
  });

  /**
   * checkDriftForField(fieldId) used to ignore its argument and read selectedField()
   * instead, so editing a referenced field that was not the selected one checked drift
   * against the wrong entity — or bailed out when nothing was selected.
   */
  it('checks drift against the edited field, not whichever is selected', async () => {
    const field = addSelectedField('clientName');
    api().toggleReferenced(field, true);
    api().updateEntityKey(store.fields()[0], 'individuals');
    api().updateFieldId(store.fields()[0], 'firstName');

    // Select a different field, then edit the referenced one.
    const other = store.addField('text');
    store.selectField(other);
    fixture.detectChanges();
    getConfig.mockClear();

    api().updateFieldId(store.fields().find(f => f.id === 'clientName')!, 'firstName');
    await Promise.resolve();
    await Promise.resolve();

    expect(getConfig).toHaveBeenCalledWith('individuals');
  });

  it('does not consult the source when the field is not referenced', async () => {
    const field = addSelectedField();
    getConfig.mockClear();

    api().updateEntityKey(field, 'individuals');
    await Promise.resolve();

    expect(getConfig).not.toHaveBeenCalled();
  });

  it('syncs a referenced field from its source definition', async () => {
    const field = addSelectedField();
    api().toggleReferenced(field, true);
    api().updateEntityKey(store.fields()[0], 'individuals');
    api().updateFieldId(store.fields()[0], 'firstName');

    await api().syncWithSource(store.fields()[0]);

    expect(store.fields()[0].validators?.required).toBe(true);
  });

  it('does nothing on sync when the reference is incomplete', async () => {
    const field = addSelectedField();
    api().toggleReferenced(field, true);
    getConfig.mockClear();

    await api().syncWithSource(store.fields()[0]);

    expect(getConfig).not.toHaveBeenCalled();
  });

  // The source walk recurses into group children. A reference pointing at a field nested
  // inside a group is the case that distinguishes it from a flat scan of tabs[].fields.
  describe('finding the field in the source config', () => {
    const NESTED_SOURCE: EntityFormConfig = {
      entity: 'individuals',
      version: 1,
      tabs: [
        { id: 'empty', label: { en: 'Empty' }, fields: [] },
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            { id: 'firstName', type: 'text', label: { en: 'First Name' } },
            {
              id: 'address',
              type: 'group',
              label: { en: 'Address' },
              children: [
                { id: 'street', type: 'text', label: { en: 'Street' } },
                {
                  id: 'geo',
                  type: 'group',
                  label: { en: 'Geo' },
                  children: [
                    { id: 'postcode', type: 'text', label: { en: 'Postcode' }, validators: { required: true } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    async function linkTo(fieldId: string): Promise<void> {
      getConfig.mockResolvedValue(NESTED_SOURCE);
      const field = addSelectedField();
      api().toggleReferenced(field, true);
      api().updateEntityKey(store.fields()[0], 'individuals');
      api().updateFieldId(store.fields()[0], fieldId);
      await api().syncWithSource(store.fields()[0]);
    }

    it('syncs from a field nested two groups deep', async () => {
      await linkTo('postcode');
      expect(store.fields()[0].validators?.required).toBe(true);
    });

    it('leaves the field alone when the source has no such id', async () => {
      await linkTo('nothingNamedThis');
      expect(store.fields()[0].validators?.required).toBeFalsy();
    });
  });

  /**
   * `checkDriftForField` looks the edited field up in `store.fields()`. That view used to
   * stop at top-level tabs, so editing a referenced field on a sub-tab found nothing and
   * returned without ever asking the source config — drift on a nested field was silently
   * never checked.
   */
  it('checks drift for a referenced field that lives on a sub-tab', async () => {
    store.load({
      entity: 'clients',
      version: 1,
      tabs: [
        {
          id: 'top',
          label: { en: 'Top' },
          children: [
            {
              id: 'details',
              label: { en: 'Details' },
              fields: [{ id: 'nestedRef', type: 'text', label: { en: 'Nested Ref' } }],
            },
          ],
        },
      ],
    });
    store.selectField('nestedRef');
    fixture.detectChanges();

    const field = store.fields().find(f => f.id === 'nestedRef') as unknown as Record<string, unknown>;
    api().toggleReferenced(field, true);
    api().updateEntityKey(store.fields().find(f => f.id === 'nestedRef')!, 'individuals');
    getConfig.mockClear();
    api().updateFieldId(store.fields().find(f => f.id === 'nestedRef')!, 'firstName');
    await Promise.resolve();

    expect(getConfig).toHaveBeenCalledWith('individuals');
  });
});
