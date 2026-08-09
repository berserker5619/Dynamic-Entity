import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import type { FileUploadHandler, NestedFieldConfig } from '@dynamic-entity/core';
import { UPLOAD_HANDLER } from '../tokens/injection-tokens';
import { FileFieldComponent } from './file-field.component';

const mockField: NestedFieldConfig = {
  id: 'contract',
  type: 'file',
  label: { en: 'Contract' },
};

async function setup(handler?: FileUploadHandler): Promise<ComponentFixture<FileFieldComponent>> {
  await TestBed.configureTestingModule({
    imports: [FileFieldComponent],
    providers: handler ? [{ provide: UPLOAD_HANDLER, useValue: handler }] : [],
  }).compileComponents();

  const fixture = TestBed.createComponent(FileFieldComponent);
  fixture.componentInstance.field = mockField;
  fixture.componentInstance.control = new FormControl(null);
  fixture.detectChanges();
  return fixture;
}

describe('FileFieldComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('offers a chooser and no filename with no value', async () => {
    const fixture = await setup();
    expect(fixture.componentInstance.fileName()).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('stores { file } with metadata when no handler is registered', async () => {
    const fixture = await setup();
    await fixture.componentInstance.onFileSelect(new File(['x'], 'terms.pdf', { type: 'application/pdf' }));

    const value = fixture.componentInstance.control.value;
    expect(value.file).toBeInstanceOf(File);
    expect(value.mimeType).toBe('application/pdf');
    expect(fixture.componentInstance.fileName()).toBe('terms.pdf');
  });

  it('stores { url } when a handler is registered', async () => {
    const fixture = await setup(() => ({ url: 'https://cdn/terms.pdf' }));
    await fixture.componentInstance.onFileSelect(new File(['x'], 'terms.pdf'));

    expect(fixture.componentInstance.fileUrl()).toBe('https://cdn/terms.pdf');
  });

  it('derives a display name from the url when none was supplied', async () => {
    const fixture = await setup();
    fixture.componentInstance.control.setValue({ url: 'https://cdn/files/report.docx' });
    expect(fixture.componentInstance.fileName()).toBe('report.docx');
  });

  it('renders a download link when readonly', async () => {
    const fixture = await setup();
    fixture.componentInstance.control.setValue({ url: 'https://cdn/a.pdf' });
    fixture.componentInstance.readonly = true;
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.ngx-field__file-link');
    expect(link.getAttribute('href')).toBe('https://cdn/a.pdf');
  });

  it('masks the value for masked roles', async () => {
    const fixture = await setup();
    fixture.componentInstance.masked = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ngx-field__value--masked')).toBeTruthy();
  });
});
