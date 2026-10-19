#!/usr/bin/env node
// Probe the browser-facing routes of a Readest Compose stack. The REST root
// requires the public anon key and therefore also checks PostgREST's database
// connection; no service-role credential is used or printed.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const envFile = process.env.SCHOLAR_ENV_FILE ?? fileURLToPath(new URL('../../docker/.env', import.meta.url));
const webUrl = process.env.SCHOLAR_WEB_URL ?? 'http://127.0.0.1:3000';
const apiUrl = process.env.SCHOLAR_API_URL ?? 'http://127.0.0.1:8000';
const objectUrl = process.env.SCHOLAR_S3_URL ?? 'http://127.0.0.1:9000';

const envLine = readFileSync(envFile, 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('ANON_KEY='));
const anonKey = envLine?.slice('ANON_KEY='.length).replace(/^['"]|['"]$/g, '');
if (!anonKey) throw new Error(`ANON_KEY is missing from ${envFile}`);

const probe = (name, baseUrl, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, `${baseUrl.replace(/\/$/, '')}/`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      reject(new Error('expected an HTTP(S) URL without embedded credentials'));
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, { headers, agent: false }, (response) => {
      response.resume();
      response.on('end', () => {
        if (response.statusCode === 200) resolve(name);
        else reject(new Error(`HTTP ${response.statusCode}`));
      });
    });
    request.setTimeout(6000, () => request.destroy(new Error('timed out')));
    request.on('error', reject);
  });

const checks = [
  ['Web', webUrl, '/', {}],
  ['Auth via Kong', apiUrl, '/auth/v1/health', {}],
  ['REST + database via Kong', apiUrl, '/rest/v1/', { apikey: anonKey }],
  ['Object storage', objectUrl, '/minio/health/live', {}],
];

const results = await Promise.allSettled(checks.map(([name, base, path, headers]) => probe(name, base, path, headers)));
for (let index = 0; index < results.length; index += 1) {
  const result = results[index];
  if (result.status === 'fulfilled') console.log(`OK ${result.value}`);
  else {
    console.error(`FAIL ${checks[index][0]}: ${result.reason.message}`);
    process.exitCode = 1;
  }
}
