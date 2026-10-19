/**
 * import-messages.ts — what the wizard tells a user about each failure it knows by code (3.1, C2).
 *
 * The failures that reach the wizard carry a code, from sheet-to-schema (`ImportError`,
 * `ImportFailure`), from a server's error envelope (kept by `HttpImportTransport`), or from the
 * transport itself (`ImportCapabilityError`). Each known code gets a message a user can act on,
 * in `UI_TEXT`, so a host translates it like the rest of the wizard. Anything else is shown as
 * its own message, as before 3.1.
 *
 * `UNSUPPORTED_FORMAT` covers several files, and its message from sheet-to-schema names
 * sheet-to-schema's API, not what this user can do. The wizard reads the file's first bytes, as
 * sheet-to-schema does, to say which file it is and what to save it as. It never matches a
 * message's text.
 */
import type { UiTextKey, UiTextParams } from '../services/ui-text.service';

/** What a failure says about itself, wherever it came from. */
interface Coded {
  code?: unknown;
  details?: unknown;
  feature?: unknown;
  message?: unknown;
}

/** The kinds of file `UNSUPPORTED_FORMAT` is said of, by their first bytes. */
export type RefusedFileKind = 'zip' | 'xls' | 'utf16' | 'other';

/** What a file's first bytes say it is, by the same signatures sheet-to-schema uses. */
export function refusedFileKind(head: Uint8Array): RefusedFileKind {
  const starts = (...bytes: number[]) => bytes.every((byte, i) => head[i] === byte);
  if (starts(0x50, 0x4b)) return 'zip';
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'xls';
  if (starts(0xff, 0xfe) || starts(0xfe, 0xff)) return 'utf16';
  return 'other';
}

/** A `UI_TEXT` key and its parameters, or `null` for a failure to show as its own message. */
export interface ImportMessage {
  key: UiTextKey;
  params?: UiTextParams;
}

/** The group key a failure names, as the user reads it in the sheet. */
const keyText = (details: unknown): string => {
  const key = (details as { key?: unknown } | undefined)?.key;
  return Array.isArray(key) ? key.join(' / ') : '';
};
const rowsOf = (details: unknown): number[] => {
  const rows = (details as { rows?: unknown } | undefined)?.rows;
  return Array.isArray(rows) ? rows.filter((row): row is number => typeof row === 'number') : [];
};

/** The reason a server gave for refusing a grouped plan, if it gave one (sheet-to-schema 1.2). */
function planGroupReason(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined;
  const problem = details.find(p => (p as { code?: unknown })?.code === 'PLAN_GROUP' && typeof (p as { reason?: unknown }).reason === 'string');
  return (problem as { reason?: string } | undefined)?.reason;
}

/**
 * The message for `error`, or `null` to show its own.
 *
 * @param file what the user chose, for `UNSUPPORTED_FORMAT`: its first bytes, and whether the
 *   picker offers `.xlsx` (whether this app reads workbooks at all).
 */
export function importMessage(error: unknown, file?: { head: Uint8Array; readsXlsx: boolean }): ImportMessage | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, details, feature } = error as Coded;
  switch (code) {
    case 'UNSUPPORTED_RUNTIME':
      return { key: 'importUnsupportedRuntime' };
    case 'PEER_MISSING': {
      const peer = (details as { peer?: unknown } | undefined)?.peer;
      return { key: 'importPeerMissing', params: { peer: typeof peer === 'string' ? peer : 'exceljs' } };
    }
    case 'UNSUPPORTED_FORMAT': {
      if (!file) return null;
      const kind = refusedFileKind(file.head);
      if (kind === 'zip') return { key: file.readsXlsx ? 'importFormatNotWorkbook' : 'importFormatXlsxNotRead' };
      if (kind === 'xls') return { key: file.readsXlsx ? 'importFormatXls' : 'importFormatXlsCsvOnly' };
      if (kind === 'utf16') return { key: 'importFormatWideText' };
      return null;
    }
    case 'UNSUPPORTED_BY_SERVER':
      return feature === 'group' ? { key: 'importServerCannotGroup' } : null;
    case 'INVALID_PLAN': {
      const reason = planGroupReason(details);
      if (reason === 'grouping-disabled') return { key: 'importServerCannotGroup' };
      if (reason === 'non-contiguous') return { key: 'importGroupScatteredRefused' };
      return null;
    }
    case 'GROUP_NOT_CONTIGUOUS': {
      const [ended, again] = rowsOf(details);
      return { key: 'importGroupNotContiguous', params: { key: keyText(details), ended: String(ended ?? ''), again: String(again ?? '') } };
    }
    case 'GROUP_TOO_LARGE': {
      const [first, last] = rowsOf(details);
      return { key: 'importGroupTooLarge', params: { key: keyText(details), first: String(first ?? ''), last: String(last ?? '') } };
    }
    case 'TOO_MANY_GROUPS':
      return { key: 'importTooManyGroups', params: { row: String(rowsOf(details)[0] ?? '') } };
    default:
      return null;
  }
}
