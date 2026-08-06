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
    expect(host.querySelectorAll('button').length).toBe(FIELD_TYPE_CATALOG.length);
  });

  it('emits the picked field type when a button is clicked', () => {
    const picked: string[] = [];
    fixture.componentInstance.pick.subscribe(t => picked.push(t));

    (host.querySelectorAll('button')[0] as HTMLButtonElement).click();

    expect(picked).toEqual([FIELD_TYPE_CATALOG[0].type]); // 'text'
  });
});
