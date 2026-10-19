import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(0, 'utf8'));
const expected = new Set(['client:3000', 'kong:8000', 'minio:9000', 'minio:9001']);
const actual = new Set();

for (const [service, definition] of Object.entries(config.services ?? {})) {
  for (const port of definition.ports ?? []) {
    if (port.host_ip !== '127.0.0.1') {
      throw new Error(`${service}:${port.target} is exposed on ${port.host_ip ?? 'all interfaces'}`);
    }
    actual.add(`${service}:${port.target}`);
  }
}

if (actual.size !== expected.size || [...expected].some((port) => !actual.has(port))) {
  throw new Error(`Unexpected published ports: ${[...actual].sort().join(', ')}`);
}

console.log(`Verified ${actual.size} loopback-only Compose ports.`);
