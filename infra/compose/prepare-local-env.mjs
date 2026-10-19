import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const example = resolve(root, 'docker/.env.example');
const destination = resolve(root, 'docker/.env');
const jwtSecret = randomBytes(48).toString('base64url');
const jwt = (role) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  const signature = createHmac('sha256', jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
};

let env = readFileSync(example, 'utf8');
const values = {
  HOST_IP: '127.0.0.1',
  READEST_IMAGE:
    'ghcr.io/readest/readest:sha-2d37bbf@sha256:9655943b3a363da8a1708582e91e3216e6ed1c9662d2b527821207a09a515d99',
  POSTGRES_PASSWORD: randomBytes(36).toString('base64url'),
  JWT_SECRET: jwtSecret,
  ANON_KEY: jwt('anon'),
  SERVICE_ROLE_KEY: jwt('service_role'),
  MINIO_ROOT_PASSWORD: randomBytes(36).toString('base64url'),
  API_EXTERNAL_URL: 'http://127.0.0.1:8000',
  SITE_URL: 'http://127.0.0.1:3000',
  ADDITIONAL_REDIRECT_URLS: 'http://127.0.0.1:3000/**,http://127.0.0.1:8000/**',
};

for (const [key, value] of Object.entries(values)) {
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (!line.test(env)) throw new Error(`Missing ${key} in docker/.env.example`);
  env = env.replace(line, `${key}=${value}`);
}

writeFileSync(destination, env, { flag: 'wx', mode: 0o600 });
console.log(`Created ${destination} with local test credentials.`);
