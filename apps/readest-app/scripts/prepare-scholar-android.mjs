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

// The fork must not claim readest.com App Links or intercept upstream
// OAuth redirects. Provider redirects need Scholar-owned credentials.
const manifestPath = path.join(androidDir, 'src/main/AndroidManifest.xml');
const manifest = fs.readFileSync(manifestPath, 'utf8');
let removedFilters = 0;
const preparedManifest = manifest.replace(
  /<intent-filter\b[^>]*>[\s\S]*?<\/intent-filter>/g,
  (filter) => {
    if (filter.includes('android:host="auth-callback"') && filter.includes('android:scheme="readest"')) {
      return filter.replace('android:scheme="readest"', 'android:scheme="readest-scholar"');
    }
    if (
      filter.includes('android:host="web.readest.com"') ||
      filter.includes('android:scheme="readest"') ||
      filter.includes('android:scheme="readest-onedrive"') ||
      filter.includes('android:scheme="com.googleusercontent.apps.209390247301-ctpmep68ppfa56r1b8tr35e4qi4p60kq"')
    ) {
      removedFilters++;
      return '';
    }
    return filter;
  },
);
if (removedFilters < 3 || !preparedManifest.includes('android:scheme="readest-scholar"')) {
  throw new Error('expected upstream Android App Link and OAuth intent filters');
}
fs.writeFileSync(manifestPath, preparedManifest);

console.log(`Prepared Android namespace and activity for ${scholarId}`);
