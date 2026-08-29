import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TabManagerComponent } from './tab-manager.component';
import { SYSTEM_DEFAULT_CAN_EDIT } from 'ngx-dynamic-entity';
import { SYSTEM_DEFAULT_CAN_EDIT as REEXPORTED_TOKEN } from './tab-manager.component';
import { BuilderStore } from '../builder-store.service';

describe('TabManagerComponent', () => {
  let fixture: ComponentFixture<TabManagerComponent>;
  let store: BuilderStore;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabManagerComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(TabManagerComponent);
    store = TestBed.inject(BuilderStore);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  const addButton = (): HTMLButtonElement =>
    Array.from(host.querySelectorAll('button')).find(b =>
      (b.textContent || '').includes('Add'),
    ) as HTMLButtonElement;

  it('shows the empty hint when there are no tabs', () => {
    expect(host.textContent).toContain('all fields render in a single section');
    expect(host.querySelectorAll('.deb-tabs__row').length).toBe(0);
  });

  it('adds a tab row when Add is clicked', () => {
    addButton().click();
    fixture.detectChanges();

    expect(store.tabs().length).toBe(1);
    expect(host.querySelectorAll('.deb-tabs__row').length).toBe(1);
  });

  it('removes a tab via its delete button', () => {
    store.addTab();
    fixture.detectChanges();
    const row = host.querySelector('.deb-tabs__row') as HTMLElement;
    const del = Array.from(row.querySelectorAll('button')).find(
      b => b.querySelector('mat-icon')?.textContent?.trim() === 'delete',
    ) as HTMLButtonElement;

    del.click();
    fixture.detectChanges();

    expect(store.tabs().length).toBe(0);
  });

  // This file re-exports the token so existing imports from the builder package keep
  // working. It once declared its own InjectionToken of the same name, and since token
  // identity is by reference, a consumer providing the documented one was providing a token
  // nothing injected. Asserting they are the same object is what stops that regressing.
  it('re-exports the renderer’s token, not a look-alike', () => {
    expect(REEXPORTED_TOKEN).toBe(SYSTEM_DEFAULT_CAN_EDIT);
  });

  // With no SYSTEM_DEFAULT_CAN_EDIT provided there is no policy to consult, so a
  // system-default tab stays editable rather than being locked by default.
  it('leaves a system-default tab editable when no predicate is registered', () => {
    addButton().click();
    fixture.detectChanges();
    const tabId = store.tabs()[0].id;
    store.updateTab(tabId, { systemDefault: true });
    fixture.detectChanges();

    expect(host.textContent).toContain('(System)');
    const api = fixture.componentInstance as unknown as {
      canEditTab(t: { systemDefault?: boolean }): boolean;
      tabLabel(t: { label?: unknown }): string;
    };
    expect(api.canEditTab(store.tabs()[0])).toBe(true);
    expect(api.tabLabel({ label: { en: 'Primary' } })).toBe('Primary');
  });
});

/**
 * SYSTEM_DEFAULT_CAN_EDIT's whole contract is `(roles: string[]) => boolean`. It was called
 * with a hardcoded empty array, so any predicate that actually inspected roles answered
 * false for everyone and locked every system-default tab.
 */
describe('TabManagerComponent — SYSTEM_DEFAULT_CAN_EDIT', () => {
  let fixture: ComponentFixture<TabManagerComponent>;
  let store: BuilderStore;
  let seen: string[][];

  async function setup(predicate: (roles: string[]) => boolean): Promise<void> {
    seen = [];
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TabManagerComponent],
      providers: [
        BuilderStore,
        provideNoopAnimations(),
        {
          provide: SYSTEM_DEFAULT_CAN_EDIT,
          useValue: (roles: string[]) => {
            seen.push(roles);
            return predicate(roles);
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TabManagerComponent);
    store = TestBed.inject(BuilderStore);
    fixture.detectChanges();
  }

  function addSystemDefaultTab(): void {
    store.addTab();
    const tabId = store.tabs()[0].id;
    store.updateTab(tabId, { systemDefault: true });
    fixture.detectChanges();
  }

  it('passes the builder user’s roles to the predicate', async () => {
    await setup(roles => roles.includes('admin'));
    store.setUserRoles(['admin']);
    addSystemDefaultTab();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(r => r.includes('admin'))).toBe(true);
  });

  it('locks a system-default tab for a user without the role', async () => {
    await setup(roles => roles.includes('admin'));
    store.setUserRoles(['viewer']);
    addSystemDefaultTab();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toBeTruthy();
    expect(seen.every(r => r.includes('viewer'))).toBe(true);
    expect(seen.some(r => r.length === 0)).toBe(false);
  });
});
