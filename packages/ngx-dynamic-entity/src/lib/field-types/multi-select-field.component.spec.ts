import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectFieldComponent } from './multi-select-field.component';

describe('MultiSelectFieldComponent', () => {
  let component: MultiSelectFieldComponent;
  let fixture: ComponentFixture<MultiSelectFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MultiSelectFieldComponent, ReactiveFormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(MultiSelectFieldComponent);
    component = fixture.componentInstance;
    component.field = { 
      label: { en: 'Tags' },
      options: [
        { en: 'One' },
        { en: 'Two' }
      ]
    } as any;
    component.control = new FormControl([{ en: 'One' }, { en: 'Two' }]);
    fixture.detectChanges();
  });

  it('should render multiple select', () => {
    const el = fixture.nativeElement.querySelector('select');
    expect(el.multiple).toBeTrue();
  });

  it('should join labels in readonly mode', () => {
    component.readonly = true;
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.ngx-field__value');
    expect(val.textContent).toBe('One, Two');
  });
});
