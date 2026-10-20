// Run from apps/readest-app so this resolves the package pinned by pnpm-lock.yaml.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.cwd(), 'package.json'));
const { connect } = await import(require.resolve('@tursodatabase/database'));

let seed = 0x51c0ffee;
function rand() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function vector(n, scale) {
  return Array.from({ length: n }, () => Math.round((rand() * 20 - 10) * scale * 10000) / 10000);
}
function exact(a, b) {
  return Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0));
}

const db = await connect(':memory:');
const out = [];
try {
  for (const kind of ['vector32', 'vector64']) {
    for (const dim of [2, 8, 128, 768]) {
      for (const scale of [0.01, 1, 1000]) {
        let maxAbs = 0;
        let maxRel = 0;
        let sumRel = 0;
        let worst = null;
        let over0_1pct = 0;
        let over0_2pct = 0;
        const samples = 100;
        for (let i = 0; i < samples; i++) {
          const a = vector(dim, scale);
          const b = vector(dim, scale);
          const expected = exact(
            kind === 'vector32' ? a.map(Math.fround) : a,
            kind === 'vector32' ? b.map(Math.fround) : b,
          );
          const sql = `SELECT vector_distance_l2(${kind}(?), ${kind}(?)) AS d`;
          const result = await db.prepare(sql).all(JSON.stringify(a), JSON.stringify(b));
          const actual = result[0].d;
          const abs = Math.abs(actual - expected);
          const rel = expected === 0 ? abs : abs / expected;
          if (rel > maxRel) worst = { a: a.slice(0, 5), b: b.slice(0, 5), expected, actual };
          maxAbs = Math.max(maxAbs, abs);
          maxRel = Math.max(maxRel, rel);
          sumRel += rel;
          if (rel > 0.001) over0_1pct++;
          if (rel > 0.002) over0_2pct++;
        }
        out.push({ kind, dim, scale, samples, maxAbs, maxRel, meanRel: sumRel / samples, over0_1pct, over0_2pct, worst });
      }
    }
  }
  const examples = [];
  for (const kind of ['vector32', 'vector64']) {
    for (const b of [[3, 4], [1, 1], [0, 0], [1000, 1000]]) {
      const result = await db.prepare(`SELECT vector_distance_l2(${kind}(?), ${kind}(?)) AS d`).all('[0,0]', JSON.stringify(b));
      examples.push({ kind, b, expected: exact([0, 0], b), actual: result[0].d });
    }
  }
  const nearTieScans = [];
  for (const kind of ['vector32', 'vector64']) {
    for (const center of [0.1, 1, 5, 100]) {
      let inversions = 0;
      let previous = -Infinity;
      let largestDrop = 0;
      const samples = 1001;
      for (let i = 0; i < samples; i++) {
        const x = center * (1 + (i - 500) * 0.000002);
        const result = await db.prepare(`SELECT vector_distance_l2(${kind}(?), ${kind}(?)) AS d`).all('[0,0]', JSON.stringify([x, 0]));
        const actual = result[0].d;
        if (actual < previous) {
          inversions++;
          largestDrop = Math.max(largestDrop, previous - actual);
        }
        previous = actual;
      }
      nearTieScans.push({ kind, center, samples, inversions, largestDrop });
    }
  }
  console.log(JSON.stringify({ node: process.version, arch: process.arch, platform: process.platform, examples, groups: out, nearTieScans }, null, 2));
} finally {
  await db.close();
}
