import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "scholar-release-identity-"));
const checker = resolve("infra/release/check-scholar-release-identity.mjs");
const configPath = join(root, "scholar.release.json");
const cargoPath = join(root, "Cargo.toml");
const licensePath = join(root, "LICENSE");
const licensesPath = join(root, "LICENSES.md");
const outputPath = join(root, "RELEASE-IDENTITY.json");
const config = {
  productName: "Readest Scholar",
  version: "0.12.17",
  mainBinaryName: "readest-scholar",
  identifier: "io.github.gkwfhv.readestscholar",
  bundle: { createUpdaterArtifacts: false },
  plugins: {
    "deep-link": {
      mobile: [{ scheme: ["readest-scholar"], appLink: false }],
      desktop: { schemes: ["readest-scholar"] },
    },
    updater: { endpoints: [], pubkey: "" },
  },
};
const cargo = [
  "[package]",
  'name = "Readest"',
  'version = "0.2.2"',
  'description = "Your online library"',
  'authors = ["Bilingify LLC"]',
  'license = ""',
  'repository = ""',
  "",
  "[lib]",
  'name = "readestlib"',
  "",
].join("\n");

function run() {
  return spawnSync(process.execPath, [checker, configPath, cargoPath, licensePath, licensesPath, outputPath], {
    encoding: "utf8",
  });
}

try {
  await Promise.all([
    writeFile(configPath, JSON.stringify(config)),
    writeFile(cargoPath, cargo),
    writeFile(licensePath, "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3\n"),
    writeFile(licensesPath, "# 待人工复核，不能用于发布\n确认没有把上游商标当成 Scholar 的品牌。\n"),
  ]);
  const accepted = run();
  if (accepted.status !== 0) throw new Error(accepted.stderr || accepted.stdout);
  const report = JSON.parse(await readFile(outputPath, "utf8"));
  if (report.releaseReady !== false || report.formalIdentity?.identifier !== "io.github.gkwfhv.readestscholar" ||
      !Array.isArray(report.metadataReview) || report.metadataReview.length < 4) {
    throw new Error("Identity report omitted formal values or manual metadata review");
  }

  config.plugins.updater.endpoints = ["https://upstream.example/update"];
  await writeFile(configPath, JSON.stringify(config));
  await rm(outputPath);
  const rejected = run();
  if (rejected.status === 0 || !rejected.stderr.includes("updater endpoints")) {
    throw new Error("Identity checker accepted an updater endpoint");
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Scholar release identity checker accepts the formal config and rejects an updater endpoint");
