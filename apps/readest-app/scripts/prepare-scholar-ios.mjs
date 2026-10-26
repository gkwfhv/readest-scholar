import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appleDir = process.env['SCHOLAR_IOS_PROJECT_DIR']
  ? path.resolve(process.env['SCHOLAR_IOS_PROJECT_DIR'])
  : path.join(appDir, 'src-tauri/gen/apple');
const upstreamId = 'com.bilingify.readest';
const scholarId = 'io.github.gkwfhv.readestscholar';

// The tracked XcodeGen project and extension code retain the upstream identity
// after `tauri ios init`. Keep all three targets and their App Group in one
// namespace before regenerating the Xcode project.
const files = [
  'project.yml',
  'Readest_iOS/Readest_iOS.entitlements',
  'ShareExtension/ShareExtension.entitlements',
  'ShareExtension/ShareViewController.swift',
  'ShareExtension/AppGroupBridge.swift',
  'ReadestWidget/ReadestWidget.entitlements',
  'ReadestWidget/WidgetSnapshot.swift',
];
let replacements = 0;
for (const relative of files) {
  const file = path.join(appleDir, relative);
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(upstreamId).length - 1;
  replacements += count;
  let updated = original.replaceAll(upstreamId, scholarId);
  if (relative === 'project.yml') {
    updated = updated.replace(
      'PRODUCT_NAME: Readest\n',
      'PRODUCT_NAME: Readest\n      INFOPLIST_KEY_CFBundleDisplayName: Readest Scholar\n',
    );
  }
  if (updated !== original) fs.writeFileSync(file, updated);
}
if (replacements < 7) {
  throw new Error(`expected upstream iOS app, extension, widget and App Group IDs; found ${replacements}`);
}
console.log(`Prepared iOS app, extension and widget for ${scholarId}`);
