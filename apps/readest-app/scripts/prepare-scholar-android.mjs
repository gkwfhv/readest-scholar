import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = process.env['SCHOLAR_ANDROID_APP_DIR']
  ? path.resolve(process.env['SCHOLAR_ANDROID_APP_DIR'])
  : path.join(appDir, 'src-tauri/gen/android/app');
const upstreamId = 'com.bilingify.readest';
const scholarId = 'io.github.gkwfhv.readestscholar';
const scholarPath = scholarId.replaceAll('.', '/');

const gradlePath = path.join(androidDir, 'build.gradle.kts');
const gradle = fs.readFileSync(gradlePath, 'utf8');
const occurrences = gradle.split(upstreamId).length - 1;
if (occurrences < 2) {
  throw new Error(`expected upstream namespace and applicationId in ${gradlePath}`);
}
fs.writeFileSync(gradlePath, gradle.replaceAll(upstreamId, scholarId));

for (const [sourceSet, fileName] of [
  ['main', 'MainActivity.kt'],
  ['test', 'KeyLearnCaptureTest.kt'],
]) {
  const javaDir = path.join(androidDir, 'src', sourceSet, 'java');
  const upstreamFile = path.join(javaDir, 'com/bilingify/readest', fileName);
  const scholarFile = path.join(javaDir, scholarPath, fileName);
  const original = fs.readFileSync(upstreamFile, 'utf8');
  if (!original.startsWith(`package ${upstreamId}\n`)) {
    throw new Error(`unexpected package declaration in ${upstreamFile}`);
  }
  fs.mkdirSync(path.dirname(scholarFile), { recursive: true });
  fs.writeFileSync(
    scholarFile,
    original.replace(`package ${upstreamId}\n`, `package ${scholarId}\n`),
  );
  fs.rmSync(upstreamFile);
}

console.log(`Prepared Android namespace and activity for ${scholarId}`);
