import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: node check-scholar-npm-licenses.mjs <pnpm-licenses.json>");
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
if (!report || typeof report !== "object" || Array.isArray(report)) {
  throw new Error("Expected pnpm's grouped JSON license report");
}

let packageCount = 0;
const unknown = [];
for (const [license, packages] of Object.entries(report)) {
  if (!Array.isArray(packages)) {
    throw new Error(`Invalid license group: ${license}`);
  }
  packageCount += packages.length;
  if (license.toLowerCase() === "unknown") unknown.push(...packages);
}

if (unknown.length > 0) {
  const expected = unknown.length === 1 &&
    unknown[0]?.name === "khroma" &&
    unknown[0]?.versions?.length === 1 &&
    unknown[0].versions[0] === "2.1.0";
  if (!expected) {
    throw new Error(`Unreviewed Unknown npm license: ${JSON.stringify(
      unknown.map(({ name, versions }) => ({ name, versions }))
    )}`);
  }

  // The exact published tarball carries an MIT license file although its
  // package.json omits the license field. Pin this exception to its lock hash.
  const integrity = "sha512-Ls993zuzfayK269Svk9hzpeGUKob/sIgZzyHYdjQoAdQetRKpOLj+k/QQQ/6Qi0Yz65mlROrfd+Ev+1+7dz9Kw==";
  const lockedEntry = `  khroma@2.1.0:
    resolution: {integrity: ${integrity}}`;
  if (!readFileSync("pnpm-lock.yaml", "utf8").includes(lockedEntry)) {
    throw new Error("The khroma@2.1.0 license exception no longer matches the locked tarball");
  }
}

console.log(
  `Reviewed ${packageCount} production npm package records; ` +
  `${unknown.length} pinned Unknown-license exception(s)`
);
