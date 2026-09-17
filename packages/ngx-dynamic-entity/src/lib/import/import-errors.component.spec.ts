import { TestBed } from '@angular/core/testing';
import { ImportErrorsComponent } from './import-errors.component';



describe('ImportErrorsComponent', () => {
  it('groups problems by the row number the spreadsheet shows', async () => {
    await TestBed.configureTestingModule({ imports: [ImportErrorsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportErrorsComponent);

    fixture.componentRef.setInput('errors', [
      { row: 4, ref: 'personal.status', message: 'bad status' },
      { row: 2, ref: 'personal.firstName', message: 'required' },
      { row: 4, ref: 'personal.firstName', message: 'required' },
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="import-error-row-"]');
    expect(rows.length).toBe(3);
    // Row 2 before row 4, and row 4's two problems share one row heading.
    expect(rows[0].getAttribute('data-testid')).toBe('import-error-row-2');
    expect(fixture.nativeElement.querySelector('th[rowspan="2"]')).toBeTruthy();
  });

  it('renders nothing when there is nothing wrong', async () => {
    await TestBed.configureTestingModule({ imports: [ImportErrorsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ImportErrorsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="import-errors"]')).toBeNull();
  });
});
