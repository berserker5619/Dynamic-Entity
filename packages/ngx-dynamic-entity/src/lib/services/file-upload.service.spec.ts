import { TestBed } from '@angular/core/testing';
import type { FileUploadHandler } from '@dynamic-entity/core';
import { EMPTY, of, throwError } from 'rxjs';
import { UPLOAD_HANDLER } from '../tokens/injection-tokens';
import { FileUploadService } from './file-upload.service';

function configure(handler?: FileUploadHandler): FileUploadService {
  TestBed.configureTestingModule({
    providers: handler ? [{ provide: UPLOAD_HANDLER, useValue: handler }] : [],
  });
  return TestBed.inject(FileUploadService);
}

const file = (name = 'a.png', type = 'image/png') => new File(['xyz'], name, { type });

describe('FileUploadService', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('without an upload handler', () => {
    it('reports no handler', () => {
      expect(configure().hasHandler).toBe(false);
    });

    it('stores the File with descriptive metadata and no url', async () => {
      const ref = await configure().toFileRef(file('report.pdf', 'application/pdf'));

      expect(ref.file).toBeInstanceOf(File);
      expect(ref.url).toBeUndefined();
      expect(ref.name).toBe('report.pdf');
      expect(ref.mimeType).toBe('application/pdf');
      expect(ref.size).toBe(3);
    });
  });

  describe('with an upload handler', () => {
    it('accepts a plain result', async () => {
      const ref = await configure(() => ({ url: 'https://cdn/a.png' })).toFileRef(file());
      expect(ref.url).toBe('https://cdn/a.png');
      expect(ref.file).toBeUndefined();
    });

    it('accepts a Promise', async () => {
      const ref = await configure(() => Promise.resolve({ url: 'https://cdn/p.png' })).toFileRef(file());
      expect(ref.url).toBe('https://cdn/p.png');
    });

    it('accepts an Observable', async () => {
      const ref = await configure(() => of({ url: 'https://cdn/o.png' })).toFileRef(file());
      expect(ref.url).toBe('https://cdn/o.png');
    });

    it('lets the handler override the display name', async () => {
      const ref = await configure(() => ({ url: 'https://cdn/x', name: 'renamed.png' })).toFileRef(file());
      expect(ref.name).toBe('renamed.png');
    });

    it('keeps the browser file name when the handler does not supply one', async () => {
      const ref = await configure(() => ({ url: 'https://cdn/x' })).toFileRef(file('original.png'));
      expect(ref.name).toBe('original.png');
    });

    it('rejects when the handler errors', async () => {
      const service = configure(() => throwError(() => new Error('boom')));
      await expect(service.toFileRef(file())).rejects.toThrow('boom');
    });

    it('rejects when the handler completes without a result', async () => {
      const service = configure(() => EMPTY as never);
      await expect(service.toFileRef(file())).rejects.toThrow(/without emitting/i);
    });

    it('rejects when a Promise handler rejects', async () => {
      const service = configure(() => Promise.reject(new Error('nope')));
      await expect(service.toFileRef(file())).rejects.toThrow('nope');
    });
  });

  describe('preview urls', () => {
    it('returns a persisted url as-is', () => {
      expect(configure().previewUrlFor({ url: 'https://cdn/a.png' })).toBe('https://cdn/a.png');
    });

    it('mints an object url for an unpersisted File', () => {
      const createObjectURL = jest.fn().mockReturnValue('blob:fake');
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;

      expect(configure().previewUrlFor({ file: file() })).toBe('blob:fake');
      expect(createObjectURL).toHaveBeenCalled();
    });

    it('returns null for an empty ref', () => {
      const service = configure();
      expect(service.previewUrlFor(null)).toBeNull();
      expect(service.previewUrlFor({})).toBeNull();
    });

    it('revokes only blob urls', () => {
      const revokeObjectURL = jest.fn();
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
      const service = configure();

      service.revokePreviewUrl('blob:fake');
      service.revokePreviewUrl('https://cdn/a.png');
      service.revokePreviewUrl(null);

      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    });
  });
});
