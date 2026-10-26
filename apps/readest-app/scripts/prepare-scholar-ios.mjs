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
  'ReadestWidget/ReadingWidgetViews.swift',
];
let replacements = 0;
for (const relative of files) {
  const file = path.join(appleDir, relative);
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(upstreamId).length - 1;
  replacements += count;
  let updated = original.replaceAll(upstreamId, scholarId);
  if (relative === 'project.yml') {
    updated = updated
      .replace(
        'PRODUCT_NAME: Readest\n',
        'PRODUCT_NAME: Readest\n      INFOPLIST_KEY_CFBundleDisplayName: Readest Scholar\n',
      )
      .replaceAll('CFBundleDisplayName: Readest\n', 'CFBundleDisplayName: Readest Scholar\n');
  }
  if (relative === 'ShareExtension/ShareViewController.swift') {
    updated = updated.replace('scheme: "readest"', 'scheme: "readest-scholar"');
  }
  if (relative === 'ReadestWidget/ReadingWidgetViews.swift') {
    updated = updated.replace('readest://book/', 'readest-scholar://book/');
  }
  if (updated !== original) fs.writeFileSync(file, updated);
}
// Tauri creates the app Info.plist during `ios init`; XcodeGen creates the
// widget plist later using the Scholar display name in project.yml.
for (const relative of [
  'Readest_iOS/Info.plist',
  'ShareExtension/Info.plist',
]) {
  const file = path.join(appleDir, relative);
  const original = fs.readFileSync(file, 'utf8');
  let updated = original
    .replaceAll(upstreamId, scholarId)
    .replaceAll('Readest uses', 'Readest Scholar uses')
    .replaceAll('Readest needs', 'Readest Scholar needs')
    .replaceAll('<string>Readest</string>', '<string>Readest Scholar</string>');
  if (relative === 'Readest_iOS/Info.plist') {
    updated = updated.replaceAll('<string>readest</string>', '<string>readest-scholar</string>');
  }
  if (updated !== original) fs.writeFileSync(file, updated);
}

// The upstream associated domain belongs to readest.com. Scholar has no
// approved Universal Link domain yet, so omit that entitlement until one is
// configured for this bundle ID.
const appEntitlements = path.join(appleDir, 'Readest_iOS/Readest_iOS.entitlements');
const entitlements = fs.readFileSync(appEntitlements, 'utf8');
const withoutUpstreamDomain = entitlements.replace(
  /\s*<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>\s*<string>applinks:web\.readest\.com<\/string>\s*<\/array>/,
  '',
);
if (withoutUpstreamDomain === entitlements) {
  throw new Error('expected upstream Universal Link entitlement');
}
fs.writeFileSync(appEntitlements, withoutUpstreamDomain);

if (replacements < 7) {
  throw new Error(`expected upstream iOS app, extension, widget and App Group IDs; found ${replacements}`);
}
console.log(`Prepared iOS app, extension and widget for ${scholarId}`);
