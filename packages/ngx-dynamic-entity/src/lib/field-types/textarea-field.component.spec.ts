import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TextareaFieldComponent } from './textarea-field.component';

describe('TextareaFieldComponent', () => {
  let component: TextareaFieldComponent;
  let fixture: ComponentFixture<TextareaFieldComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TextareaFieldComponent, ReactiveFormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(TextareaFieldComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('field', { label: { en: 'Notes' } } as any);
    fixture.componentRef.setInput('control', new FormControl('Some notes'));
    fixture.detectChanges();
  });

  it('should render textarea', () => {
    const el = fixture.nativeElement.querySelector('textarea');
    expect(el).toBeTruthy();
    expect(el.value).toBe('Some notes');
  });
});
