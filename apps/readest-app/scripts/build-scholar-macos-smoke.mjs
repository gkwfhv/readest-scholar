#!/usr/bin/env node
// Unsigned local smoke build for the approved Scholar product identity.
// Require an explicit self-hosted target so this bundle cannot silently use
// Readest's production API defaults from the shared frontend configuration.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_API_BASE_URL',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env['NEXT_PUBLIC_SELF_HOSTED'] !== 'true') {
  console.error(
    `Scholar smoke build requires NEXT_PUBLIC_SELF_HOSTED=true and ${required.join(', ')}.`,
  );
  process.exit(1);
}

for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_API_BASE_URL']) {
  let url;
  try {
    url = new URL(process.env[name]);
  } catch {
    console.error(`${name} must be an HTTP(S) URL.`);
    process.exit(1);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const upstream = /(^|\.)readest\.com$|(^|\.)supabase\.co$/i.test(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback) || upstream) {
    console.error(`${name} must point to Scholar staging or a self-hosted HTTPS service.`);
    process.exit(1);
  }
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_SCHOLAR_RELEASE: 'true',
      PATH: `${path.join(appDir, 'node_modules/.bin')}:${process.env.PATH}`,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(path.join(appDir, 'node_modules/.bin/dotenv'), [
  '-e',
  '.env.tauri',
  '--',
  'next',
  'build',
  '--webpack',
]);
run(process.execPath, [
  'scripts/tauri.mjs',
  'build',
  '--debug',
  '--bundles',
  'app',
  '--no-sign',
  '--ci',
  '--config',
  'src-tauri/scholar.release.json',
]);
