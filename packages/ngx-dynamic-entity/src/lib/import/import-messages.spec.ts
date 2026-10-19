/** importMessage (3.1, C2): which message each coded failure gets, and which keep their own. */
import { DEFAULT_UI_TEXT } from '../services/ui-text.service';
import { importMessage, refusedFileKind } from './import-messages';

const coded = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`raw ${code}`), { code, ...extra });
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
const XLS = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const UTF16 = Uint8Array.from([0xff, 0xfe, 0x61, 0x00]);
const TEXT = new TextEncoder().encode('a,b');

describe('refusedFileKind', () => {
  it('tells a zip, an .xls and UTF-16 text (either byte order) apart from anything else', () => {
    expect(refusedFileKind(ZIP)).toBe('zip');
    expect(refusedFileKind(XLS)).toBe('xls');
    expect(refusedFileKind(UTF16)).toBe('utf16');
    expect(refusedFileKind(Uint8Array.from([0xfe, 0xff, 0x00, 0x61]))).toBe('utf16');
    expect(refusedFileKind(TEXT)).toBe('other');
    expect(refusedFileKind(new Uint8Array())).toBe('other');
  });
});

describe('importMessage', () => {
  it('says which browsers read .xlsx for UNSUPPORTED_RUNTIME', () => {
    expect(importMessage(coded('UNSUPPORTED_RUNTIME'))).toEqual({ key: 'importUnsupportedRuntime' });
    expect(DEFAULT_UI_TEXT.importUnsupportedRuntime).toMatch(/Chrome or Edge 103, Firefox 113 and Safari 16\.4.*CSV/);
  });

  it('names the package for PEER_MISSING, exceljs when the failure does not say', () => {
    expect(importMessage(coded('PEER_MISSING', { details: { peer: 'exceljs' } }))).toEqual({ key: 'importPeerMissing', params: { peer: 'exceljs' } });
    expect(importMessage(coded('PEER_MISSING'))).toEqual({ key: 'importPeerMissing', params: { peer: 'exceljs' } });
  });

  it('says what an UNSUPPORTED_FORMAT file is, and what to save it as, from its bytes and what this app reads', () => {
    const format = coded('UNSUPPORTED_FORMAT');
    expect(importMessage(format, { head: ZIP, readsXlsx: false })).toEqual({ key: 'importFormatXlsxNotRead' });
    expect(importMessage(format, { head: ZIP, readsXlsx: true })).toEqual({ key: 'importFormatNotWorkbook' });
    expect(importMessage(format, { head: XLS, readsXlsx: true })).toEqual({ key: 'importFormatXls' });
    expect(importMessage(format, { head: XLS, readsXlsx: false })).toEqual({ key: 'importFormatXlsCsvOnly' });
    expect(importMessage(format, { head: UTF16, readsXlsx: true })).toEqual({ key: 'importFormatWideText' });
    // A file it cannot place, or no file to look at: the failure's own message.
    expect(importMessage(format, { head: TEXT, readsXlsx: true })).toBeNull();
    expect(importMessage(format)).toBeNull();
  });

  it('says the server does not group, for the capability refusal and for a server that refused by reason', () => {
    expect(importMessage(coded('UNSUPPORTED_BY_SERVER', { feature: 'group', refused: ['group'] }))).toEqual({ key: 'importServerCannotGroup' });
    expect(importMessage(coded('UNSUPPORTED_BY_SERVER', { refused: ['group', 'lists'] }))).toBeNull();
    const refusal = (reason?: string) => coded('INVALID_PLAN', { details: [{ level: 'warning', code: 'PLAN_LEGACY_REF' }, { level: 'error', code: 'PLAN_GROUP', path: 'group', ...(reason ? { reason } : {}) }] });
    expect(importMessage(refusal('grouping-disabled'))).toEqual({ key: 'importServerCannotGroup' });
    expect(importMessage(refusal('non-contiguous'))).toEqual({ key: 'importGroupScatteredRefused' });
    // A PLAN_GROUP problem with no reason is a plan that is wrong, which says so itself.
    expect(importMessage(refusal())).toBeNull();
    expect(importMessage(coded('INVALID_PLAN', { details: 'not a list' }))).toBeNull();
  });

  it('names the key and rows of each group failure', () => {
    expect(importMessage(coded('GROUP_NOT_CONTIGUOUS', { details: { key: ['A-1', 'Paris'], rows: [4, 9] } }))).toEqual({
      key: 'importGroupNotContiguous',
      params: { key: 'A-1 / Paris', ended: '4', again: '9' },
    });
    expect(importMessage(coded('GROUP_TOO_LARGE', { details: { key: ['A-1'], rows: [2, 10002] } }))).toEqual({
      key: 'importGroupTooLarge',
      params: { key: 'A-1', first: '2', last: '10002' },
    });
    expect(importMessage(coded('TOO_MANY_GROUPS', { details: { key: ['Z'], rows: [200002] } }))).toEqual({ key: 'importTooManyGroups', params: { row: '200002' } });
    // Details that are not there leave the slots empty rather than "undefined".
    expect(importMessage(coded('GROUP_TOO_LARGE'))).toEqual({ key: 'importGroupTooLarge', params: { key: '', first: '', last: '' } });
    expect(importMessage(coded('TOO_MANY_GROUPS', { details: { rows: 'x' } }))).toEqual({ key: 'importTooManyGroups', params: { row: '' } });
  });

  it('leaves everything else to its own message', () => {
    for (const error of [coded('MALFORMED_FILE'), coded('TOO_LARGE'), new Error('plain'), 'a string', null, undefined, 42]) {
      expect(importMessage(error)).toBeNull();
    }
  });
});
