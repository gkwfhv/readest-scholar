/** Synthetic, loopback-only MinIO probe for signed create-once PUT and streamed SHA-256. */
import { createHash, randomUUID } from 'node:crypto';
import { deleteObject, getUploadSignedUrl } from '../src/utils/object';
import { getObjectDigest } from '../src/utils/objectDigest';

async function main() {
  if (process.env['OBJECT_STORAGE_TYPE'] !== 's3') throw new Error('S3 staging only');
  const endpoint = new URL(process.env['S3_PUBLIC_ENDPOINT'] || '');
  if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
    throw new Error('Object probe requires loopback storage endpoint');
  }
  const key = `synthetic/Scholar/versions/${randomUUID()}`;
  const original = Buffer.from('immutable-v1');
  const replacement = Buffer.from('overwritten?');
  if (original.length !== replacement.length) throw new Error('probe sizes must match');
  let created = false;
  try {
    const url = await getUploadSignedUrl(key, original.length, 300, undefined, true);
    const put = (bytes: Buffer) =>
      fetch(url, {
        method: 'PUT',
        headers: {
          'If-None-Match': '*',
          'Content-Length': String(bytes.length),
        },
        body: Uint8Array.from(bytes).buffer,
      });
    const first = await put(original);
    if (!first.ok) throw new Error(`first create-only PUT returned ${first.status}`);
    created = true;
    const second = await put(replacement);
    if (second.status !== 412)
      throw new Error(`second PUT returned ${second.status}, expected 412`);
    const actual = await getObjectDigest(key);
    const sha256 = createHash('sha256').update(original).digest('hex');
    if (actual.sha256 !== sha256 || actual.size !== original.length) {
      throw new Error('object content changed after rejected PUT');
    }
    process.stdout.write('create-only PUT 200/412; streamed SHA-256 and size matched\n');
  } finally {
    if (created) await deleteObject(key);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
