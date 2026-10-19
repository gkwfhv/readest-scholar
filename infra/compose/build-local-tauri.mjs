// Build an isolated Tauri frontend against the local, empty Phase 0 stack.
// Reads only the generated test .env; never prints its JWT or password fields.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const text = readFileSync(resolve(root, 'docker/.env'), 'utf8');
const values = Object.fromEntries(
  text
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_][A-Z_0-9]*=/.test(line))
    .map((line) => {
      const split = line.indexOf('=');
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);

if (
  values.API_EXTERNAL_URL !== 'http://127.0.0.1:8000' ||
  values.SITE_URL !== 'http://127.0.0.1:3000' ||
  !values.ANON_KEY
) {
  throw new Error('This helper only accepts the generated local Phase 0 environment.');
}

const result = spawnSync('pnpm', ['build'], {
  cwd: resolve(root, 'apps/readest-app'),
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: values.API_EXTERNAL_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
    NEXT_PUBLIC_API_BASE_URL: values.SITE_URL,
    NEXT_PUBLIC_SELF_HOSTED: 'true',
    NEXT_PUBLIC_OBJECT_STORAGE_TYPE: 's3',
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
