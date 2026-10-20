import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(0, 'utf8'));
if (config.name !== 'scholar-staging') throw new Error(`Unexpected Compose project: ${config.name}`);

const expectedPorts = new Map([
  ['client:3000', 3130],
  ['kong:8000', 8130],
  ['minio:9000', 9130],
  ['minio:9001', 9131],
]);
for (const [service, definition] of Object.entries(config.services ?? {})) {
  for (const port of definition.ports ?? []) {
    const key = `${service}:${port.target}`;
    if (port.host_ip !== '127.0.0.1' || expectedPorts.get(key) !== Number(port.published)) {
      throw new Error(`Unexpected staging port: ${key} ${port.host_ip}:${port.published}`);
    }
    expectedPorts.delete(key);
  }
}
if (expectedPorts.size) throw new Error(`Missing staging ports: ${[...expectedPorts.keys()].join(', ')}`);

for (const service of ['client', 'minio', 'minio-setup']) {
  if (!config.services[service]?.image?.includes('@sha256:')) {
    throw new Error(`Unpinned staging image: ${service}`);
  }
}
for (const service of ['db', 'kong', 'auth', 'rest', 'minio', 'client']) {
  if (config.services[service]?.container_name !== `scholar-staging-${service}`) {
    throw new Error(`Unexpected container name: ${service}`);
  }
}
for (const [name, definition] of Object.entries(config.volumes ?? {})) {
  if (definition.name !== `scholar-staging_${name}`) {
    throw new Error(`Unexpected volume name: ${name}`);
  }
}
console.log('Verified isolated, loopback-only staging Compose configuration.');
