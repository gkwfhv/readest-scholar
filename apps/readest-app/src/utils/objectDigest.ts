import { createHash } from 'node:crypto';
import { getStorageType } from './storage';
import { s3Storage } from './s3';
import { r2Storage } from './r2';

/** Verify the bytes that actually reached object storage before publishing a file version. */
export async function getObjectDigest(
  objectKey: string,
): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  const update = (chunk: Uint8Array) => {
    hash.update(chunk);
    size += chunk.byteLength;
  };

  let stream: ReadableStream<Uint8Array>;
  if (getStorageType() === 'r2') {
    const response = await r2Storage.getObject(objectKey);
    if (!response.ok || !response.body) throw new Error('Object unavailable');
    stream = response.body;
  } else {
    const response = await s3Storage.getObject(objectKey);
    if (!response.Body) throw new Error('Object unavailable');
    stream = response.Body.transformToWebStream();
  }
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { sha256: hash.digest('hex'), size };
}
