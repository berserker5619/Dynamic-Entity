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
