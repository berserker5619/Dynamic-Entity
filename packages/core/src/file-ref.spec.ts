import { fileRefName, isPersistedFileRef } from './file-ref.types';

describe('isPersistedFileRef', () => {
  it('is true only when a url is present', () => {
    expect(isPersistedFileRef({ url: 'https://cdn/a.png' })).toBe(true);
    expect(isPersistedFileRef({ name: 'a.png' })).toBe(false);
    expect(isPersistedFileRef(null)).toBe(false);
    expect(isPersistedFileRef(undefined)).toBe(false);
  });
});

describe('fileRefName', () => {
  it('prefers an explicit name', () => {
    expect(fileRefName({ name: 'contract.pdf', url: 'https://cdn/x.pdf' })).toBe('contract.pdf');
  });

  it('falls back to the url basename', () => {
    expect(fileRefName({ url: 'https://cdn/files/report.docx' })).toBe('report.docx');
  });

  it('returns an empty string for an empty ref', () => {
    expect(fileRefName(null)).toBe('');
    expect(fileRefName({})).toBe('');
  });
});

describe('fileRefName — unpersisted and URL-derived names', () => {
  /**
   * A ref with no explicit name but a File attached is the unpersisted case: no upload
   * handler is registered, so the browser's File is held until the consumer uploads on
   * submit. The chooser still has to show something.
   */
  it('falls back to the attached File name', () => {
    const file = new File(['x'], 'contract-v2.pdf', { type: 'application/pdf' });
    expect(fileRefName({ file })).toBe('contract-v2.pdf');
  });

  it('prefers an explicit name over the attached File name', () => {
    const file = new File(['x'], 'tmp-upload.bin');
    expect(fileRefName({ name: 'Signed Contract.pdf', file })).toBe('Signed Contract.pdf');
  });

  it('falls back to the last URL segment when there is no name or File', () => {
    expect(fileRefName({ url: 'https://cdn.example.com/files/report.xlsx' })).toBe('report.xlsx');
  });

  it('returns the whole URL when it has no path segment to take', () => {
    expect(fileRefName({ url: 'report.xlsx' })).toBe('report.xlsx');
  });

  it('returns an empty string for an empty ref', () => {
    expect(fileRefName({})).toBe('');
    expect(fileRefName(null)).toBe('');
    expect(fileRefName(undefined)).toBe('');
  });
});
