import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FieldPaletteComponent } from './field-palette.component';
import { FIELD_TYPE_CATALOG } from '../field-catalog';

describe('FieldPaletteComponent', () => {
  let fixture: ComponentFixture<FieldPaletteComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FieldPaletteComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(FieldPaletteComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('renders one button per catalog entry', () => {
    expect(host.querySelectorAll('.deb-palette__item').length).toBe(FIELD_TYPE_CATALOG.length);
  });

  it('emits the picked field type when a button is clicked', () => {
    const picked: string[] = [];
    fixture.componentInstance.pick.subscribe(t => picked.push(t));

    (host.querySelectorAll('.deb-palette__item')[0] as HTMLButtonElement).click();

    expect(picked).toEqual([FIELD_TYPE_CATALOG[0].type]); // 'text'
  });

  it('filters catalog entries by description and label', () => {
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'money';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const buttons = host.querySelectorAll('.deb-palette__item');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Currency');
  });

  it('clears the search filter when clear button is clicked', () => {
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'money';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const clearBtn = host.querySelector('.deb-palette__clear') as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    clearBtn.click();
    fixture.detectChanges();

    expect(host.querySelectorAll('.deb-palette__item').length).toBe(FIELD_TYPE_CATALOG.length);
  });

  it('shows empty message when query does not match any items', () => {
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'xyznonexistent123';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(host.querySelectorAll('.deb-palette__item').length).toBe(0);
    expect(host.querySelector('[data-testid="palette-no-match"]')?.textContent).toContain('xyznonexistent123');
  });
});
