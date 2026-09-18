/**
 * multipart.ts — get one file and a few small fields off a request, under bounds.
 *
 * Every limit busboy takes is set, because busboy's defaults are "no limit" and a parser with
 * no limits on an attacker-reachable endpoint is a parse loop waiting to be pointed at. Field
 * count, field-name length, field value length, and file count are all attacker-chosen, and
 * none of them are the file.
 *
 * **One import is one file, whatever `maxFiles` says.** That limit is what busboy is told, so
 * it decides when the *parser* gives up; this reader takes the first file part and refuses a
 * second either way. A request carrying two files is a request whose author and whose reader
 * disagree about which one was imported, and guessing is the wrong way to resolve that.
 *
 * **The fields must precede the file, and that is a real constraint rather than an oversight.**
 * The whole point of this package is that the file is never held, so the import has to start
 * while the file is still arriving — which means the `plan` has to have arrived already. A
 * client that sends them the other way round gets told so, in as many words. `FormData` in
 * every browser preserves append order, so the client half simply appends the plan first.
 */

import Busboy from 'busboy';
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import { ImportError } from './errors';
import type { ImportLimits } from './limits';

export interface Upload {
  /** Non-file parts that arrived before the file. */
  fields: Record<string, string>;
  /** Display only. It never reaches a header and never decides a format. */
  filename: string;
  /** The file's bytes. Reading it is what drives the rest of the request. */
  stream: Readable;
}

/**
 * Wait for the first file part, with whatever fields came before it.
 *
 * Resolves as soon as the file *starts*, not when it finishes — the caller then streams it.
 * Rejects if the body has no file, has more than one, or breaches a bound on the way.
 */
export function receiveUpload(request: IncomingMessage, limits: ImportLimits): Promise<Upload> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let file: Readable | null = null;

    /**
     * Refuse — before the file has been handed over by rejecting, and after it by failing the
     * stream the reader is already pulling from.
     *
     * The second half matters: `limits.files` makes busboy *drop* a second file part rather
     * than complain about it, so without this a request carrying two files would be read as
     * though it carried one and answered with a cheerful 200.
     */
    const fail = (error: ImportError): void => {
      if (settled) {
        file?.destroy(error);
        return;
      }
      settled = true;
      request.unpipe(parser);
      reject(error);
    };

    let parser: Busboy.Busboy;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          fileSize: limits.maxBytes,
          files: limits.maxFiles,
          fields: limits.maxFields,
          fieldSize: limits.maxFieldBytes,
          fieldNameSize: limits.maxFieldNameBytes,
          // A part that is neither a field nor a file still costs a parse.
          parts: limits.maxFields + limits.maxFiles,
        },
      });
    } catch (cause) {
      // A missing or unparseable Content-Type. Busboy throws synchronously for it.
      reject(new ImportError('MALFORMED_FILE', 'This is not a multipart upload.', { cause }));
      return;
    }

    const fields: Record<string, string> = {};
    let sawFile = false;

    parser.on('field', (name, value, info) => {
      // Truncation is busboy's way of enforcing a limit, and a silently shortened JSON plan
      // would fail to parse later with a message about JSON rather than about a limit.
      if (info.nameTruncated || info.valueTruncated) {
        fail(new ImportError('TOO_LARGE', `The "${safeFieldName(name)}" field is too long.`));
        return;
      }
      fields[name] = value;
    });

    parser.on('file', (_name, stream, info) => {
      if (sawFile) {
        stream.resume();
        fail(new ImportError('TOO_MANY_FILES', 'Send one file at a time.'));
        return;
      }
      sawFile = true;
      file = stream;

      // A stream that emits `error` with nobody listening takes the process down, and there is
      // a window where exactly that happens: the reader stops first — on its own byte limit,
      // say — and busboy's own limit then fires on a stream nothing is pulling from any more.
      stream.on('error', () => undefined);

      // busboy truncates at `fileSize` rather than failing, so the truncation is turned back
      // into the refusal it was meant to be — and into one the reader will see, because it
      // arrives as an error on the stream it is already reading.
      stream.on('limit', () => {
        stream.destroy(
          new ImportError('TOO_LARGE', `The file is larger than the ${limits.maxBytes} byte limit.`),
        );
      });

      if (settled) {
        stream.resume();
        return;
      }
      settled = true;
      resolve({ fields, filename: String(info.filename ?? ''), stream });
    });

    parser.on('filesLimit', () => fail(new ImportError('TOO_MANY_FILES', 'Send one file at a time.')));
    parser.on('fieldsLimit', () => fail(new ImportError('TOO_LARGE', 'The upload has too many fields.')));
    parser.on('partsLimit', () => fail(new ImportError('TOO_LARGE', 'The upload has too many parts.')));

    parser.on('error', cause =>
      fail(new ImportError('MALFORMED_FILE', 'The upload could not be read.', { cause })),
    );
    parser.on('close', () => {
      if (!sawFile) fail(new ImportError('NO_FILE', 'No file was uploaded.'));
    });

    // `'close'` and `complete`, not `'aborted'`. The latter is deprecated on Node 18+ and may
    // never fire, which makes it protection that reads as real and is not; `complete` is false
    // exactly when the body stopped arriving before it ended.
    request.on('close', () => {
      if (!request.complete) fail(new ImportError('TIMEOUT', 'The upload did not finish.'));
    });
    request.pipe(parser);
  });
}

/**
 * A field name, fit to appear in a message.
 *
 * The name is attacker-chosen and the message goes back to them, which is harmless on its own
 * — but a message is also a log line, and a log line with a newline in it is two log lines.
 */
export function safeFieldName(name: string): string {
  return String(name).replace(/[^\w.-]/g, '').slice(0, 40) || 'unnamed';
}

/** Parse the JSON `plan` field, saying which of the several ways it can be wrong it was. */
export function readPlanField(fields: Record<string, string>): unknown {
  const raw = fields['plan'];
  if (raw === undefined) {
    throw new ImportError(
      'INVALID_PLAN',
      'No mapping plan was sent. The "plan" field must come before the file part.',
    );
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new ImportError('INVALID_PLAN', 'The mapping plan is not valid JSON.', { cause });
  }
}
