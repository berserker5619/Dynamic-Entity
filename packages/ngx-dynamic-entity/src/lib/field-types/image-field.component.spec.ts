import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import type { FileUploadHandler, NestedFieldConfig } from '@dynamic-entity/core';
import { of, throwError } from 'rxjs';
import { UPLOAD_HANDLER } from '../tokens/injection-tokens';
import { ImageFieldComponent } from './image-field.component';

const mockField: NestedFieldConfig = {
  id: 'avatar',
  type: 'image',
  label: { en: 'Avatar' },
};

function makeFile(name = 'pic.png'): File {
  return new File(['x'], name, { type: 'image/png' });
}

async function setup(handler?: FileUploadHandler): Promise<ComponentFixture<ImageFieldComponent>> {
  await TestBed.configureTestingModule({
    imports: [ImageFieldComponent],
    providers: handler ? [{ provide: UPLOAD_HANDLER, useValue: handler }] : [],
  }).compileComponents();

  const fixture = TestBed.createComponent(ImageFieldComponent);
  fixture.componentInstance.field = mockField;
  fixture.componentInstance.control = new FormControl(null);
  fixture.detectChanges();
  return fixture;
}

describe('ImageFieldComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a placeholder with no value', async () => {
    const fixture = await setup();
    expect(fixture.nativeElement.querySelector('.ngx-field__image-placeholder')).toBeTruthy();
  });

  it('stores { file } with metadata when no upload handler is registered', async () => {
    const fixture = await setup();
    await fixture.componentInstance.onFileSelect(makeFile());

    const value = fixture.componentInstance.control.value;
    expect(value.file).toBeInstanceOf(File);
    expect(value.url).toBeUndefined();
    expect(value.name).toBe('pic.png');
    expect(value.mimeType).toBe('image/png');
  });

  it('stores { url } when a Promise-returning handler is registered', async () => {
    const fixture = await setup(() => Promise.resolve({ url: 'https://cdn/pic.png' }));
    await fixture.componentInstance.onFileSelect(makeFile());

    expect(fixture.componentInstance.control.value.url).toBe('https://cdn/pic.png');
    expect(fixture.componentInstance.uploadError()).toBeNull();
  });

  it('accepts an Observable-returning handler', async () => {
    const fixture = await setup(() => of({ url: 'https://cdn/obs.png' }));
    await fixture.componentInstance.onFileSelect(makeFile());

    expect(fixture.componentInstance.control.value.url).toBe('https://cdn/obs.png');
  });

  it('surfaces an error and leaves the value untouched when upload fails', async () => {
    const fixture = await setup(() => throwError(() => new Error('boom')));
    await fixture.componentInstance.onFileSelect(makeFile());

    expect(fixture.componentInstance.uploadError()).toContain('Upload failed');
    expect(fixture.componentInstance.control.value).toBeNull();
    expect(fixture.componentInstance.uploading()).toBe(false);
  });

  it('previews a persisted url directly', async () => {
    const fixture = await setup();
    fixture.componentInstance.control.setValue({ url: 'https://cdn/a.png' });
    expect(fixture.componentInstance.previewUrl()).toBe('https://cdn/a.png');
  });

  it('clears the value on remove', async () => {
    const fixture = await setup();
    fixture.componentInstance.control.setValue({ url: 'https://cdn/a.png' });
    fixture.componentInstance.remove();
    expect(fixture.componentInstance.control.value).toBeNull();
  });
});
