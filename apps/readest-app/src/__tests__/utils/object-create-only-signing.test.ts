import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signedS3: vi.fn(), signedR2: vi.fn() }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mocks.signedS3(...args),
}));
vi.mock('aws4fetch', () => ({
  AwsClient: class {
    sign(request: Request, options: unknown) {
      return mocks.signedR2(request, options);
    }
  },
}));

import { s3Storage } from '@/utils/s3';
import { r2Storage } from '@/utils/r2';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signedS3.mockResolvedValue('https://example.invalid/upload');
  mocks.signedR2.mockImplementation(async (request: Request) => ({ url: new URL(request.url) }));
  process.env['R2_ACCOUNT_ID'] = 'synthetic';
});

describe('create-once signed PUT', () => {
  it('binds If-None-Match to the S3 signature', async () => {
    await s3Storage.getUploadSignedUrl('bucket', 'owner/Scholar/versions/new', 12, 300, true);
    const command = mocks.signedS3.mock.calls[0]?.[1];
    const options = mocks.signedS3.mock.calls[0]?.[2];
    expect(command.input.IfNoneMatch).toBe('*');
    expect(options.signableHeaders.has('if-none-match')).toBe(true);
  });

  it('binds If-None-Match to the R2 signed request', async () => {
    await r2Storage.getUploadSignedUrl('bucket', 'owner/Scholar/versions/new', 12, 300, true);
    const request = mocks.signedR2.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('If-None-Match')).toBe('*');
  });

  it('keeps legacy signed PUT behavior for existing callers', async () => {
    await s3Storage.getUploadSignedUrl('bucket', 'legacy', 12, 300);
    const command = mocks.signedS3.mock.calls[0]?.[1];
    expect(command.input.IfNoneMatch).toBeUndefined();
  });
});
