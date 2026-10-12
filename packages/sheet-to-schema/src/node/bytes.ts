/**
 * bytes.ts — the three things every reader here needs from a byte stream.
 *
 * Deliberately framework-neutral: a `ByteSource` is anything you can `for await` bytes out of,
 * which a Node `Readable`, a `Buffer`, and a hand-rolled async generator all are. Nothing in
 * this file knows what a request is.
 */

import { ImportError } from './errors';

/** Anything bytes can be pulled from — a request, a file handle, a buffer, a test fixture. */
export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array;

/** Normalise the three shapes above into one async iterable. */
export async function* toByteStream(source: ByteSource): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (Symbol.asyncIterator in source) {
    for await (const chunk of source as AsyncIterable<Uint8Array>) yield asBytes(chunk);
    return;
  }
  for (const chunk of source as Iterable<Uint8Array>) yield asBytes(chunk);
}

/** A Node stream in object-ish mode can hand back a string; treat it as UTF-8 bytes. */
function asBytes(chunk: Uint8Array | string): Uint8Array {
  return typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
}

/**
 * Refuse the upload at the byte that crosses the line, not once it has all arrived.
 *
 * Counting after the body is buffered is the guard that has already lost: the memory it was
 * protecting is spent by the time it runs. This throws mid-stream, and the caller destroys
 * the source — so a hostile 4 GB body costs `maxBytes` plus one chunk.
 */
export async function* limitBytes(
  source: AsyncIterable<Uint8Array>,
  maxBytes: number,
): AsyncGenerator<Uint8Array> {
  let seen = 0;
  for await (const chunk of source) {
    seen += chunk.byteLength;
    if (seen > maxBytes) {
      throw new ImportError('TOO_LARGE', `The file is larger than the ${maxBytes} byte limit.`);
    }
    yield chunk;
  }
}

/**
 * Take the first `n` bytes without consuming them.
 *
 * Format is decided by what a file *is* rather than by what its name claims, which means
 * looking at its first four bytes before choosing a reader — and then handing those same
 * bytes to the reader that was chosen. Returning the head separately and re-yielding it is
 * the whole trick; buffering the file to seek back to zero is the thing being avoided.
 */
export async function peek(
  source: AsyncIterable<Uint8Array>,
  n: number,
): Promise<{ head: Uint8Array; stream: AsyncGenerator<Uint8Array> }> {
  const iterator = source[Symbol.asyncIterator]();
  const taken: Uint8Array[] = [];
  let size = 0;

  while (size < n) {
    const next = await iterator.next();
    if (next.done) break;
    taken.push(next.value);
    size += next.value.byteLength;
  }

  const head = Buffer.concat(taken.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));

  async function* replay(): AsyncGenerator<Uint8Array> {
    for (const chunk of taken) yield chunk;
    // `iterator`, not `source`: an async iterator is consumed once, and starting a second
    // `for await` over the source would either replay nothing or start a second read.
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      yield next.value;
    }
  }

  return { head: head.subarray(0, n), stream: replay() };
}

/** Best-effort close of whatever the bytes came from, once a guard has decided to stop. */
export function destroySource(source: unknown): void {
  const candidate = source as { destroy?: (error?: Error) => void; return?: () => unknown };
  try {
    if (typeof candidate?.destroy === 'function') candidate.destroy();
    else if (typeof candidate?.return === 'function') candidate.return();
  } catch {
    // Already closed, or never closeable. There is nothing useful to do about it here, and
    // throwing from a cleanup path would replace the real error with this one.
  }
}
