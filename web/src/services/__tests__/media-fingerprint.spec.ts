import { describe, expect, it } from 'vitest';
import { hashFile } from '../../workers/media-fingerprint.worker';

describe('bounded content fingerprint', () => {
  it('hashes the actual bytes and keeps every file read at or below 2 MiB', async () => {
    const reads: Array<[number, number]> = [];
    const size = 5 * 1024 * 1024;
    const file = {
      size,
      arrayBuffer() { throw new Error('Whole-file reads are forbidden'); },
      slice(start: number, end: number) {
        reads.push([start, end]);
        return { async arrayBuffer() { return new Uint8Array(Math.min(size, end) - start).buffer; } };
      },
    } as unknown as Blob;
    // Independently generated with Node's SHA-256 over 5 MiB of zero bytes.
    expect(await hashFile(file)).toBe('c036cbb7553a909f8b8877d4461924307f27ecb66cff928eeeafd569c3887e29');
    expect(reads).toEqual([[0, 2097152], [2097152, 4194304], [4194304, 6291456]]);
  });
  it('stops before reading file bytes when cancellation has already arrived', async () => {
    const controller = new AbortController(); controller.abort();
    const file = { size: 99, slice() { throw new Error('Should not read a cancelled file'); } } as unknown as Blob;
    await expect(hashFile(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
