import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const [configPath, cargoPath, licensePath, licensesPath, outputPath] = process.argv.slice(2);
if (!configPath || !cargoPath || !licensePath || !licensesPath || !outputPath) {
  console.error("Usage: node check-scholar-release-identity.mjs <scholar.release.json> <Cargo.toml> <LICENSE> <LICENSES.md> <RELEASE-IDENTITY.json>");
  process.exit(2);
}

const output = resolve(outputPath);
if (basename(output) !== "RELEASE-IDENTITY.json") {
  throw new Error("Output filename must be RELEASE-IDENTITY.json");
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function packageMetadata(manifest) {
  const match = manifest.match(/^\[package\]\r?\n([\s\S]*?)(?=^\[)/m);
  const packageSection = match?.[1];
  requireValue(packageSection, "Cargo manifest has no complete [package] section");
  const metadata = {};
  for (const key of ["name", "version", "description", "authors", "license", "repository"]) {
    const entry = packageSection.match(new RegExp("^" + key + "\\s*=\\s*(.+)$", "m"));
    requireValue(entry, "Cargo package is missing " + key);
    metadata[key] = entry[1].trim();
  }
  return metadata;
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const cargo = packageMetadata(await readFile(cargoPath, "utf8"));
const license = await readFile(licensePath, "utf8");
const licenseRegister = await readFile(licensesPath, "utf8");

requireValue(config.productName === "Readest Scholar", "Scholar productName must be Readest Scholar");
requireValue(config.identifier === "io.github.gkwfhv.readestscholar", "Scholar identifier mismatch");
requireValue(config.mainBinaryName === "readest-scholar", "Scholar mainBinaryName mismatch");
requireValue(/^\d+\.\d+\.\d+$/.test(config.version ?? ""), "Scholar version must be X.Y.Z");
requireValue(config.bundle?.createUpdaterArtifacts === false, "Scholar must not create updater artifacts");
const updater = config.plugins?.updater;
requireValue(Array.isArray(updater?.endpoints) && updater.endpoints.length === 0, "Scholar updater endpoints must be empty");
requireValue(updater?.pubkey === "", "Scholar updater public key must be empty");
const mobileSchemes = config.plugins?.["deep-link"]?.mobile?.flatMap((item) => item?.scheme ?? []);
const desktopSchemes = config.plugins?.["deep-link"]?.desktop?.schemes;
requireValue(Array.isArray(mobileSchemes) && mobileSchemes.length === 1 && mobileSchemes[0] === "readest-scholar", "Scholar mobile URL scheme mismatch");
requireValue(Array.isArray(desktopSchemes) && desktopSchemes.length === 1 && desktopSchemes[0] === "readest-scholar", "Scholar desktop URL scheme mismatch");
requireValue(license.trimStart().startsWith("GNU AFFERO GENERAL PUBLIC LICENSE"), "Root LICENSE must be AGPL-3.0 text");
requireValue(licenseRegister.includes("待人工复核，不能用于发布"), "LICENSES.md must retain its manual-review warning");
requireValue(licenseRegister.includes("确认没有把上游商标"), "LICENSES.md must retain the upstream trademark review requirement");

const metadataReview = [];
if (cargo.name !== '"Readest Scholar"') {
  metadataReview.push({ field: "name", value: cargo.name, reason: "Cargo package name differs from the formal Scholar product name; verify final package metadata and compatibility before changing it." });
}
if (cargo.description !== '"Readest Scholar"') {
  metadataReview.push({ field: "description", value: cargo.description, reason: "Cargo package description is not the approved formal product description." });
}
if (cargo.license === '""') {
  metadataReview.push({ field: "license", value: cargo.license, reason: "Cargo package license is blank although the repository root is AGPL-3.0; determine final package metadata after legal review." });
}
if (cargo.repository === '""') {
  metadataReview.push({ field: "repository", value: cargo.repository, reason: "Cargo package repository is blank; determine the final distribution metadata." });
}
if (cargo.authors !== '["Readest Scholar Contributors"]') {
  metadataReview.push({ field: "authors", value: cargo.authors, reason: "Cargo package authorship needs an explicit copyright and contributor review." });
}

const report = {
  schemaVersion: 1,
  status: "identity-config-verified-manual-review-required",
  product: config.productName,
  version: config.version,
  formalIdentity: {
    identifier: config.identifier,
    mainBinaryName: config.mainBinaryName,
    urlScheme: "readest-scholar",
    updater: "disabled",
  },
  checks: {
    tauriReleaseConfiguration: "passed",
    rootLicense: "AGPL-3.0",
    licenseRegisterWarning: "present",
  },
  cargoPackageMetadata: cargo,
  metadataReview,
  releaseReady: false,
  requiredManualReviews: [
    "Confirm trademark and branding rights, including any remaining upstream Readest references.",
    "Review repository, package, container, submodule, and final-artifact third-party license notices.",
    "Define and approve the AGPL corresponding-source offer for each distributed artifact.",
    "Approve final package copyright, author, description, license, and repository metadata.",
  ],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log("Verified Scholar release identity configuration; " + metadataReview.length + " package metadata item(s) require manual review");
