import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const [candidateArg, expectedCommit, target, workflowRunId, outputArg] = process.argv.slice(2);
const targets = {
  "x86_64-unknown-linux-gnu": {
    bundle: "deb", extension: ".deb", runner: "ubuntu-22.04",
    artifact: "scholar-linux-x86_64-debug",
    scope: "deb-payload-files", property: ["scholar:architecture", "amd64"],
  },
  "aarch64-apple-darwin": {
    bundle: "dmg", extension: ".dmg", runner: "macos-15",
    artifact: "scholar-desktop-aarch64-apple-darwin-debug",
    scope: "macos-app-files", property: ["scholar:target", "aarch64-apple-darwin"],
  },
  "x86_64-apple-darwin": {
    bundle: "dmg", extension: ".dmg", runner: "macos-15-intel",
    artifact: "scholar-desktop-x86_64-apple-darwin-debug",
    scope: "macos-app-files", property: ["scholar:target", "x86_64-apple-darwin"],
  },
  "x86_64-pc-windows-msvc": {
    bundle: "nsis", extension: ".exe", runner: "windows-2022",
    artifact: "scholar-desktop-x86_64-pc-windows-msvc-debug",
    scope: "windows-install-dir-files",
    property: ["scholar:target", "x86_64-pc-windows-msvc"],
  },
};
if (!candidateArg || !/^[0-9a-f]{40}$/.test(expectedCommit ?? "") ||
    !Object.hasOwn(targets, target) || !/^[1-9][0-9]{5,}$/.test(workflowRunId ?? "") || !outputArg) {
  console.error("Usage: node verify-scholar-candidate.mjs <candidate-dir> <40-char-commit> <target> <workflow-run-id> <output.json>");
  process.exit(2);
}

const expected = targets[target];
const directory = resolve(candidateArg);
const output = resolve(outputArg);
if (resolve(directory, basename(output)) !== output || basename(output) !== "PROVENANCE.json") {
  throw new Error("Output must be candidate/PROVENANCE.json");
}
const version = JSON.parse(await readFile(
  "apps/readest-app/src-tauri/scholar.release.json", "utf8"
)).version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("Scholar candidate version must be a semantic version");
}

const entries = await readdir(directory);
const required = ["BUILD.txt", "SHA256SUMS", "PAYLOAD-FILES.cdx.json", "npm-licenses.json"];
const bundles = entries.filter((entry) => entry.endsWith(expected.extension));
if (bundles.length !== 1) throw new Error("Expected exactly one " + expected.extension + " bundle");
const bundle = bundles[0];
const allowed = new Set([...required, bundle]);
for (const entry of entries) {
  if (!allowed.has(entry)) throw new Error("Unexpected candidate file: " + entry);
  if (!(await lstat(join(directory, entry))).isFile()) {
    throw new Error("Candidate entry is not a regular file: " + entry);
  }
}
for (const entry of required) {
  if (!entries.includes(entry)) throw new Error("Missing candidate evidence: " + entry);
}
if (!bundle.startsWith(`Readest Scholar_${version}_`)) {
  throw new Error("Bundle filename does not match the Scholar version: " + bundle);
}

async function sha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
const bundleHash = await sha256(join(directory, bundle));
const sums = (await readFile(join(directory, "SHA256SUMS"), "utf8"))
  .replace(/\r\n/g, "\n").trimEnd().split("\n");
if (sums.length !== 1 || ![`${bundleHash}  ${bundle}`, `${bundleHash} *${bundle}`].includes(sums[0])) {
  throw new Error("SHA256SUMS does not match the only candidate bundle");
}

const build = await readFile(join(directory, "BUILD.txt"), "utf8");
if (!build.startsWith("Readest Scholar unsigned debug")) {
  throw new Error("BUILD.txt does not identify an unsigned Scholar candidate");
}
const fields = new Map();
for (const line of build.trimEnd().split("\n").slice(1)) {
  const index = line.indexOf("=");
  if (index < 1) throw new Error("Malformed BUILD.txt field");
  const key = line.slice(0, index);
  if (fields.has(key)) throw new Error("Duplicate BUILD.txt field: " + key);
  fields.set(key, line.slice(index + 1));
}
for (const [key, value] of [
  ["commit", expectedCommit], ["runner", expected.runner], ["bundle", expected.bundle],
]) {
  if (fields.get(key) !== value) throw new Error(`BUILD.txt ${key} mismatch`);
}
if (target !== "x86_64-unknown-linux-gnu" && fields.get("target") !== target) {
  throw new Error("BUILD.txt target mismatch");
}
if (!fields.get("scope")?.includes("not signed")) {
  throw new Error("BUILD.txt does not mark unsigned scope");
}

const bom = JSON.parse(await readFile(join(directory, "PAYLOAD-FILES.cdx.json"), "utf8"));
const app = bom?.metadata?.component;
if (bom?.bomFormat !== "CycloneDX" || app?.name !== "readest-scholar" ||
    !Array.isArray(bom.components) || bom.components.length === 0) {
  throw new Error("Invalid installed-file CycloneDX inventory");
}
const seenNames = new Set();
for (const component of bom.components) {
  const name = component?.name;
  if (component?.type !== "file" || typeof name !== "string" || !name ||
      name.startsWith("/") || name.split("/").some((part) => part === "..") ||
      seenNames.has(name)) {
    throw new Error("Invalid or duplicate installed-file inventory entry");
  }
  seenNames.add(name);
  const regularHash = component.hashes?.some(
    (hash) => hash.alg === "SHA-256" && /^[0-9a-f]{64}$/.test(hash.content)
  );
  const symlink = component.properties?.some(
    (property) => property.name === "scholar:symlink-target" &&
      typeof property.value === "string"
  );
  if (!regularHash && !symlink) {
    throw new Error("Installed-file inventory entry lacks hash or symlink target: " + name);
  }
}
if (!app.hashes?.some((hash) => hash.alg === "SHA-256" && hash.content === bundleHash)) {
  throw new Error("Installed-file inventory references another installer hash");
}
const properties = new Map((app.properties ?? []).map((item) => [item.name, item.value]));
for (const [key, value] of [
  ["scholar:inventory-scope", expected.scope], expected.property,
]) {
  if (properties.get(key) !== value) throw new Error("Installed-file inventory property mismatch: " + key);
}
if (app.version !== undefined && app.version !== version) {
  throw new Error("Installed-file inventory version mismatch");
}
if (properties.has("scholar:installer-filename") &&
    properties.get("scholar:installer-filename") !== bundle) {
  throw new Error("Installed-file inventory installer filename mismatch");
}

const licenses = JSON.parse(await readFile(join(directory, "npm-licenses.json"), "utf8"));
if (!licenses || typeof licenses !== "object" || Array.isArray(licenses) ||
    Object.keys(licenses).length === 0) {
  throw new Error("Missing production npm license records");
}
const provenance = {
  schemaVersion: 1,
  status: "unsigned-debug-candidate",
  product: "Readest Scholar",
  version,
  sourceCommit: expectedCommit,
  workflowRunId,
  workflowUrl: `https://github.com/gkwfhv/readest-scholar/actions/runs/${workflowRunId}`,
  repository: "gkwfhv/readest-scholar",
  runner: expected.runner,
  target,
  artifactName: expected.artifact,
  bundle: {
    filename: bundle,
    sha256: bundleHash,
  },
  evidence: {
    installedFiles: bom.components.length,
    installedFileInventorySha256: await sha256(join(directory, "PAYLOAD-FILES.cdx.json")),
    npmLicenseReportSha256: await sha256(join(directory, "npm-licenses.json")),
  },
  releaseReady: false,
};
await writeFile(output, JSON.stringify(provenance, null, 2) + "\n", { flag: "wx" });
console.log(`Verified unsigned Scholar ${target} candidate ${bundleHash}; wrote ${output}`);
