import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ type: vi.fn(), s3: vi.fn(), r2: vi.fn() }));
vi.mock('@/utils/storage', () => ({ getStorageType: mocks.type }));
vi.mock('@/utils/s3', () => ({ s3Storage: { getObject: mocks.s3 } }));
vi.mock('@/utils/r2', () => ({ r2Storage: { getObject: mocks.r2 } }));

import { getObjectDigest } from '@/utils/objectDigest';

const expected = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getObjectDigest', () => {
  it('streams S3 chunks into SHA-256 and counts the full byte length', async () => {
    mocks.type.mockReturnValue('s3');
    mocks.s3.mockResolvedValue({
      Body: {
        transformToWebStream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Buffer.from('original-'));
              controller.enqueue(Buffer.from('bytes'));
              controller.close();
            },
          }),
      },
    });
    const bytes = Buffer.from('original-bytes');
    await expect(getObjectDigest('owner/Scholar/versions/v1')).resolves.toEqual({
      sha256: expected(bytes),
      size: bytes.length,
    });
    expect(mocks.s3).toHaveBeenCalledWith('owner/Scholar/versions/v1');
  });

  it('streams an R2 response without buffering the whole object', async () => {
    mocks.type.mockReturnValue('r2');
    const bytes = Buffer.from('second-version');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 6));
        controller.enqueue(bytes.subarray(6));
        controller.close();
      },
    });
    mocks.r2.mockResolvedValue({ ok: true, body: stream });
    await expect(getObjectDigest('owner/Scholar/versions/v2')).resolves.toEqual({
      sha256: expected(bytes),
      size: bytes.length,
    });
  });

  it('rejects a missing object instead of certifying empty bytes', async () => {
    mocks.type.mockReturnValue('r2');
    mocks.r2.mockResolvedValue({ ok: false, status: 404, body: null });
    await expect(getObjectDigest('missing')).rejects.toThrow('Object unavailable');
  });
});
