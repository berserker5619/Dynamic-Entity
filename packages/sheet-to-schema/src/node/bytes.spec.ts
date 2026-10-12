import { destroySource, limitBytes, peek, toByteStream } from './bytes';
import { ImportError } from './errors';

const collect = async (stream: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts.map(p => Buffer.from(p)));
};

describe('toByteStream', () => {
  it('accepts a single buffer', async () => {
    expect((await collect(toByteStream(Buffer.from('abc')))).toString()).toBe('abc');
  });

  it('accepts a synchronous iterable', async () => {
    const chunks = [Buffer.from('a'), Buffer.from('bc')];
    expect((await collect(toByteStream(chunks))).toString()).toBe('abc');
  });

  it('accepts an async iterable', async () => {
    async function* source(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('a');
      yield Buffer.from('bc');
    }
    expect((await collect(toByteStream(source()))).toString()).toBe('abc');
  });

  it('treats a string chunk as UTF-8, which a Node stream may hand back', async () => {
    const chunks = ['héllo'] as unknown as Iterable<Uint8Array>;
    expect((await collect(toByteStream(chunks))).toString('utf8')).toBe('héllo');
  });
});

describe('limitBytes', () => {
  it('passes a stream that stays inside the bound', async () => {
    const out = await collect(limitBytes(toByteStream(Buffer.from('abcd')), 4));
    expect(out.toString()).toBe('abcd');
  });

  it('refuses at the chunk that crosses the line, not once everything has arrived', async () => {
    // The point of the guard: a hostile 4 GB body must cost `maxBytes` plus one chunk, not
    // 4 GB. So the assertion is about how much the source was asked for, not only that it
    // threw.
    let produced = 0;
    async function* endless(): AsyncGenerator<Uint8Array> {
      for (;;) {
        produced += 1024;
        yield Buffer.alloc(1024);
      }
    }

    await expect(collect(limitBytes(endless(), 4096))).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    expect(produced).toBeLessThanOrEqual(4096 + 1024);
  });

  it('names the limit it enforced', async () => {
    await expect(collect(limitBytes(toByteStream(Buffer.alloc(10)), 4))).rejects.toThrow('4 byte');
  });

  it('throws an ImportError, so a route answers 413 rather than 500', async () => {
    await expect(collect(limitBytes(toByteStream(Buffer.alloc(10)), 4))).rejects.toBeInstanceOf(
      ImportError,
    );
  });
});

describe('peek', () => {
  /** The zip signature, spelled in bytes: a control character in a string literal is banned. */
  const ZIP = [0x50, 0x4b, 0x03, 0x04];

  it('returns the first n bytes and re-yields them', async () => {
    const bytes = Buffer.from([...ZIP, 0x72, 0x65, 0x73, 0x74]);
    async function* source(): AsyncGenerator<Uint8Array> {
      yield bytes;
    }
    const { head, stream } = await peek(source(), 4);
    expect([...head]).toEqual(ZIP);
    expect([...(await collect(stream))]).toEqual([...bytes]);
  });

  it('assembles a head that arrived one byte at a time', async () => {
    const bytes = Buffer.from([...ZIP, 0x61, 0x62, 0x63]);
    async function* dribble(): AsyncGenerator<Uint8Array> {
      for (const byte of bytes) yield Buffer.from([byte]);
    }
    const { head, stream } = await peek(dribble(), 4);
    expect([...head]).toEqual(ZIP);
    expect([...(await collect(stream))]).toEqual([...bytes]);
  });

  it('copes with a stream shorter than the peek', async () => {
    const { head, stream } = await peek(toByteStream(Buffer.from('ab')), 8);
    expect(head.byteLength).toBe(2);
    expect((await collect(stream)).toString()).toBe('ab');
  });

  it('copes with an empty stream', async () => {
    const { head, stream } = await peek(toByteStream([]), 8);
    expect(head.byteLength).toBe(0);
    expect((await collect(stream)).byteLength).toBe(0);
  });

  it('does not read the source twice', async () => {
    // The trap this replaces: iterating `source` again after peeking it, which either replays
    // nothing or starts a second read of the same socket.
    let reads = 0;
    async function* counted(): AsyncGenerator<Uint8Array> {
      for (const part of ['abcd', 'efgh']) {
        reads++;
        yield Buffer.from(part);
      }
    }
    const { stream } = await peek(counted(), 4);
    expect((await collect(stream)).toString()).toBe('abcdefgh');
    expect(reads).toBe(2);
  });
});

describe('destroySource', () => {
  it('destroys what can be destroyed', () => {
    let destroyed = false;
    destroySource({ destroy: () => (destroyed = true) });
    expect(destroyed).toBe(true);
  });

  it('falls back to return() for a bare generator', () => {
    let returned = false;
    destroySource({ return: () => ((returned = true), { done: true, value: undefined }) });
    expect(returned).toBe(true);
  });

  it('swallows a throw, because replacing the real error with this one helps nobody', () => {
    expect(() =>
      destroySource({
        destroy: () => {
          throw new Error('already closed');
        },
      }),
    ).not.toThrow();
  });

  it('accepts something with no way to close at all', () => {
    expect(() => destroySource(Buffer.from('abc'))).not.toThrow();
    expect(() => destroySource(undefined)).not.toThrow();
  });
});
