import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TabManagerComponent } from './tab-manager.component';
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
});
