import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// Each read is bounded; a 512 MiB video never becomes a single browser ArrayBuffer.
export async function hashFile(file: Blob, signal?: AbortSignal): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += 2 * 1024 * 1024) {
    if (signal?.aborted) throw new DOMException('上传已停止', 'AbortError');
    hash.update(new Uint8Array(await file.slice(offset, offset + 2 * 1024 * 1024).arrayBuffer()));
  }
  if (signal?.aborted) throw new DOMException('上传已停止', 'AbortError');
  return bytesToHex(hash.digest());
}

// This file is also importable for the bounded-read unit test. Window must never install this handler.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.onmessage = (event: MessageEvent<{ file: File }>) => {
    void hashFile(event.data.file).then(
      fingerprint => self.postMessage({ fingerprint }),
      () => self.postMessage({ error: '无法校验文件内容' }),
    );
  };
}
