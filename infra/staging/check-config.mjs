import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(0, 'utf8'));
if (process.env.SCHOLAR_COMPOSE_VARIANT && process.env.SCHOLAR_COMPOSE_VARIANT !== 'restore') {
  throw new Error(`Unknown Compose variant: ${process.env.SCHOLAR_COMPOSE_VARIANT}`);
}
const restore = process.env.SCHOLAR_COMPOSE_VARIANT === 'restore';
const project = restore ? 'scholar-restore-rehearsal' : 'scholar-staging';
if (config.name !== project) throw new Error(`Unexpected Compose project: ${config.name}`);

const expectedPorts = new Map([
  ['client:3000', restore ? 3140 : 3130],
  ['kong:8000', restore ? 8140 : 8130],
  ['minio:9000', restore ? 9140 : 9130],
  ['minio:9001', restore ? 9141 : 9131],
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

for (const service of ['db', 'kong', 'auth', 'rest', 'minio', 'minio-setup', 'client']) {
  if (!config.services[service]?.image?.includes('@sha256:')) {
    throw new Error(`Unpinned staging image: ${service}`);
  }
}
for (const service of ['db', 'kong', 'auth', 'rest', 'minio', 'client']) {
  if (config.services[service]?.container_name !== `${restore ? 'scholar-restore' : 'scholar-staging'}-${service}`) {
    throw new Error(`Unexpected container name: ${service}`);
  }
}
for (const [name, definition] of Object.entries(config.volumes ?? {})) {
  if (definition.name !== `${project}_${name}`) {
    throw new Error(`Unexpected volume name: ${name}`);
  }
}
console.log(`Verified isolated, loopback-only ${project} Compose configuration.`);
