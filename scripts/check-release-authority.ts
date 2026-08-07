import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publishedAuthorityPath = resolve(
  root,
  "evidence/package-release-authority-published.json",
);
const currentPublishedAuthorityPath = resolve(
  root,
  "evidence/package-release-authority-published-0.6.1.json",
);

const packageName = "@cuny-ai-lab/cail-log";
const publishedVersion = "0.6.0";
const currentVersion = "0.6.1";
const publishedRuntimeSha256 =
  "ebae96498da12b10b402bbb9754bbf58fbb2d675761282c0fadfba21f7b0632b";
const publishedSource = {
  tag: "v0.6.0",
  commit: "7d093f4c4d28367056c5124889a283d5ff9908c4",
  tree: "b0150aa34f31de914a9a32493c5abf3bb4d5ad43",
} as const;
const publishedRegistryVersion = {
  id: 1066236862,
  name: publishedVersion,
  created_at: "2026-07-25T16:40:58Z",
} as const;
const publishedArtifact = {
  tarball:
    "https://npm.pkg.github.com/download/@cuny-ai-lab/cail-log/0.6.0/632c8a3d74bc4709c23b9636b73471c1291d7679",
  artifact_sha1: "632c8a3d74bc4709c23b9636b73471c1291d7679",
  integrity:
    "sha512-Hlj1K7TXL2XOI6nOkh5SKRafCldr87Zp+aHm73MqiV0hajAPMiqp7QuBlndzok7Vy0fIX7C6msi093s/a9Yesw==",
  artifact_bytes: 50269,
  artifact_sha256:
    "8689422456eb4b7c672538ba91efb7606e9287df473a99a91ee2a60b5f9ba215",
  artifact_git_tree_sha256:
    "92564c897d172b0f9742bfa852f3ba55a147dc5339fdef862650d9b084a415e6",
} as const;
const currentSource = {
  tag: "v0.6.1",
  commit: "038269d1d27d857ab537d07928fd604482144219",
  tree: "ba45e27921e3eed709a85d667793341823131ca2",
} as const;
const currentRegistryVersion = {
  id: 1108499365,
  name: currentVersion,
  created_at: "2026-08-07T11:56:09Z",
} as const;
const currentArtifact = {
  tarball:
    "https://npm.pkg.github.com/download/@cuny-ai-lab/cail-log/0.6.1/1b33369223ff745e8647931041a031ea99993680",
  artifact_sha1: "1b33369223ff745e8647931041a031ea99993680",
  integrity:
    "sha512-2GkC0DRkXndWW5HVBasUbif1/9F4e3ram4Fkmg1eGi39/WLqgho9e9aROg0ZM89Q2Si3bgUVtv/LAjwuUCp1cw==",
  artifact_bytes: 50662,
  artifact_sha256:
    "8576448c206808b9974b82c4548cade0cb826e620a6aced1497059fde7bfc0b9",
  artifact_git_tree_sha256:
    "fdd0da5ec61556ce550aaf7cbda334aa3b746f0283cc658053773be41ce41202",
} as const;

type UnknownRecord = Record<string, unknown>;

type RegistryVersion = {
  id?: unknown;
  name?: unknown;
  created_at?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is UnknownRecord {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function hasFields(
  value: unknown,
  expected: readonly string[],
): value is UnknownRecord {
  return (
    isRecord(value) &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

function runtimePaths(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "contract" &&
    value[1] === "src"
  );
}

export function isValidPublishedSourceTag(value: unknown): boolean {
  return (
    hasFields(value, ["tag", "commit", "tree"]) &&
    value.tag === publishedSource.tag &&
    value.commit === publishedSource.commit &&
    value.tree === publishedSource.tree
  );
}

export function isValidArtifactIdentity(value: unknown): boolean {
  if (
    !hasExactKeys(value, [
      "tarball",
      "artifact_sha1",
      "integrity",
      "artifact_bytes",
      "artifact_sha256",
      "artifact_git_tree_sha256",
    ])
  ) {
    return false;
  }
  if (typeof value.tarball !== "string") return false;
  const tarballHash = value.tarball.split("/").at(-1);
  return (
    value.tarball === publishedArtifact.tarball &&
    value.artifact_sha1 === publishedArtifact.artifact_sha1 &&
    tarballHash === value.artifact_sha1 &&
    value.integrity === publishedArtifact.integrity &&
    value.artifact_bytes === publishedArtifact.artifact_bytes &&
    value.artifact_sha256 === publishedArtifact.artifact_sha256 &&
    value.artifact_git_tree_sha256 === publishedArtifact.artifact_git_tree_sha256
  );
}

export function isValidPublishedRegistryVersion(
  value: unknown,
): boolean {
  return (
    hasFields(value, ["id", "name", "created_at"]) &&
    value.id === publishedRegistryVersion.id &&
    value.name === publishedRegistryVersion.name &&
    value.created_at === publishedRegistryVersion.created_at
  );
}

export function isValidPublishedAuthority(value: unknown): boolean {
  if (
    !hasExactKeys(value, [
      "schema_version",
      "package",
      "behavior_authority",
      "release",
      "registry",
    ]) ||
    value.schema_version !== 1 ||
    !hasExactKeys(value.package, ["name", "version"]) ||
    value.package.name !== packageName ||
    value.package.version !== publishedVersion ||
    !hasExactKeys(value.behavior_authority, [
      "commit",
      "tree",
      "runtime_paths",
      "runtime_sha256",
    ]) ||
    !validSha(value.behavior_authority.commit) ||
    value.behavior_authority.commit !==
      "cb6ffc0cfd4cb544639cbf288ff6eb24c7027e98" ||
    !validSha(value.behavior_authority.tree) ||
    value.behavior_authority.tree !==
      "618c4bdfae0effadbe23cfd6c4dfb1fcf6440697" ||
    !runtimePaths(value.behavior_authority.runtime_paths) ||
    value.behavior_authority.runtime_sha256 !== publishedRuntimeSha256 ||
    !hasExactKeys(value.release, [
      "tag",
      "commit",
      "tree",
      "release_id",
      "release_url",
      "published_at",
      "workflow_run_id",
      "workflow_run_url",
      "workflow_job_id",
      "workflow_job_url",
      "run_status",
      "run_conclusion",
    ]) ||
    !isValidPublishedSourceTag({
      tag: value.release.tag,
      commit: value.release.commit,
      tree: value.release.tree,
    }) ||
    value.release.release_id !== 359804957 ||
    value.release.release_url !==
      "https://github.com/CUNY-AI-Lab/cail-log/releases/tag/v0.6.0" ||
    value.release.published_at !== "2026-07-25T16:40:26Z" ||
    value.release.workflow_run_id !== 30166097999 ||
    value.release.workflow_run_url !==
      "https://github.com/CUNY-AI-Lab/cail-log/actions/runs/30166097999" ||
    value.release.workflow_job_id !== 89699267926 ||
    value.release.workflow_job_url !==
      "https://github.com/CUNY-AI-Lab/cail-log/actions/runs/30166097999/job/89699267926" ||
    value.release.run_status !== "completed" ||
    value.release.run_conclusion !== "success" ||
    !hasExactKeys(value.registry, [
      "url",
      "api",
      "package_id",
      "package_version_id",
      "version",
      "state",
      "created_at",
      "observed_at",
      "tarball",
      "artifact_sha1",
      "integrity",
      "artifact_bytes",
      "artifact_sha256",
      "artifact_git_tree_sha256",
    ]) ||
    value.registry.url !== "https://npm.pkg.github.com" ||
    value.registry.api !==
      "https://api.github.com/orgs/CUNY-AI-Lab/packages/npm/cail-log/versions" ||
    value.registry.package_id !== 13479479 ||
    !isValidPublishedRegistryVersion({
      id: value.registry.package_version_id,
      name: value.registry.version,
      created_at: value.registry.created_at,
    }) ||
    value.registry.state !== "published" ||
    typeof value.registry.observed_at !== "string" ||
    !isValidArtifactIdentity({
      tarball: value.registry.tarball,
      artifact_sha1: value.registry.artifact_sha1,
      integrity: value.registry.integrity,
      artifact_bytes: value.registry.artifact_bytes,
      artifact_sha256: value.registry.artifact_sha256,
      artifact_git_tree_sha256: value.registry.artifact_git_tree_sha256,
    })
  ) {
    return false;
  }
  return true;
}

export function isValidCurrentPublishedAuthority(value: unknown): boolean {
  if (
    !hasExactKeys(value, [
      "schema_version",
      "package",
      "behavior_authority",
      "release",
      "registry",
    ]) ||
    value.schema_version !== 1 ||
    !hasExactKeys(value.package, ["name", "version"]) ||
    value.package.name !== packageName ||
    value.package.version !== currentVersion ||
    !hasExactKeys(value.behavior_authority, [
      "commit",
      "tree",
      "runtime_paths",
      "runtime_sha256",
    ]) ||
    !validSha(value.behavior_authority.commit) ||
    value.behavior_authority.commit !==
      "cb6ffc0cfd4cb544639cbf288ff6eb24c7027e98" ||
    !validSha(value.behavior_authority.tree) ||
    value.behavior_authority.tree !==
      "618c4bdfae0effadbe23cfd6c4dfb1fcf6440697" ||
    !runtimePaths(value.behavior_authority.runtime_paths) ||
    value.behavior_authority.runtime_sha256 !== publishedRuntimeSha256 ||
    !hasExactKeys(value.release, [
      "tag",
      "commit",
      "tree",
      "release_id",
      "release_url",
      "published_at",
      "workflow_run_id",
      "workflow_run_url",
      "workflow_job_id",
      "workflow_job_url",
      "run_status",
      "run_conclusion",
    ]) ||
    value.release.tag !== currentSource.tag ||
    value.release.commit !== currentSource.commit ||
    value.release.tree !== currentSource.tree ||
    value.release.release_id !== 366717356 ||
    value.release.release_url !==
      "https://github.com/CUNY-AI-Lab/cail-log/releases/tag/v0.6.1" ||
    value.release.published_at !== "2026-08-07T11:55:33Z" ||
    value.release.workflow_run_id !== 31176048181 ||
    value.release.workflow_run_url !==
      "https://github.com/CUNY-AI-Lab/cail-log/actions/runs/31176048181" ||
    value.release.workflow_job_id !== 92858162874 ||
    value.release.workflow_job_url !==
      "https://github.com/CUNY-AI-Lab/cail-log/actions/runs/31176048181/job/92858162874" ||
    value.release.run_status !== "completed" ||
    value.release.run_conclusion !== "success" ||
    !hasExactKeys(value.registry, [
      "url",
      "api",
      "package_id",
      "package_version_id",
      "version",
      "state",
      "created_at",
      "observed_at",
      "tarball",
      "artifact_sha1",
      "integrity",
      "artifact_bytes",
      "artifact_sha256",
      "artifact_git_tree_sha256",
    ]) ||
    value.registry.url !== "https://npm.pkg.github.com" ||
    value.registry.api !==
      "https://api.github.com/orgs/CUNY-AI-Lab/packages/npm/cail-log/versions" ||
    value.registry.package_id !== 13479479 ||
    value.registry.package_version_id !== currentRegistryVersion.id ||
    value.registry.version !== currentRegistryVersion.name ||
    value.registry.created_at !== currentRegistryVersion.created_at ||
    value.registry.state !== "published" ||
    typeof value.registry.observed_at !== "string" ||
    typeof value.registry.tarball !== "string" ||
    value.registry.tarball !== currentArtifact.tarball ||
    value.registry.artifact_sha1 !== currentArtifact.artifact_sha1 ||
    value.registry.tarball.split("/").at(-1) !== value.registry.artifact_sha1 ||
    value.registry.integrity !== currentArtifact.integrity ||
    value.registry.artifact_bytes !== currentArtifact.artifact_bytes ||
    value.registry.artifact_sha256 !== currentArtifact.artifact_sha256 ||
    value.registry.artifact_git_tree_sha256 !==
      currentArtifact.artifact_git_tree_sha256
  ) {
    return false;
  }
  return true;
}

function validRegistryVersion(value: unknown): value is RegistryVersion {
  return (
    hasFields(value, ["id", "name", "created_at"]) &&
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.created_at === "string" &&
    value.created_at.length > 0
  );
}

/** Returns true only for a complete paginated registry response with no occupied version. */
export function isValidLiveVersions(
  versions: unknown,
  candidateVersion: string,
): versions is RegistryVersion[] {
  if (
    typeof candidateVersion !== "string" ||
    candidateVersion.length === 0 ||
    !Array.isArray(versions) ||
    versions.length === 0
  ) {
    return false;
  }
  for (let index = 0; index < versions.length; index += 1) {
    if (
      !Object.prototype.hasOwnProperty.call(versions, index) ||
      !validRegistryVersion(versions[index])
    ) {
      return false;
    }
  }
  return !versions.some((version) => version.name === candidateVersion);
}

export function runtimeDigest(): string {
  const files = ["contract", "src"]
    .flatMap((path) => filesBelow(resolve(root, path)))
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    const contents = readFileSync(path);
    hash.update(`${relative(root, path)}\0${contents.length}\0`);
    hash.update(contents);
  }
  return hash.digest("hex");
}

function filesBelow(path: string): string[] {
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

function main(): void {
  const publishedAuthority = JSON.parse(
    readFileSync(publishedAuthorityPath, "utf8"),
  ) as unknown;
  const currentPublishedAuthority = JSON.parse(
    readFileSync(currentPublishedAuthorityPath, "utf8"),
  ) as unknown;
  const packageJson = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (
    !isValidPublishedAuthority(publishedAuthority) ||
    !isValidCurrentPublishedAuthority(currentPublishedAuthority) ||
    packageJson.name !== packageName ||
    packageJson.version !== currentVersion
  ) {
    throw new Error("cail-log: local published release authority is invalid");
  }
  if (process.argv.includes("--live")) {
    const versionsPath = process.env.CAIL_REGISTRY_VERSIONS_FILE;
    if (!versionsPath) {
      throw new Error(
        "cail-log: live registry preflight requires CAIL_REGISTRY_VERSIONS_FILE",
      );
    }
    const versions = JSON.parse(readFileSync(versionsPath, "utf8")) as unknown;
    const currentPackage = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as { version?: unknown };
    if (
      typeof currentPackage.version !== "string" ||
      !isValidLiveVersions(versions, currentPackage.version)
    ) {
      throw new Error(
        `cail-log: registry version ${String(currentPackage.version)} is occupied or the live snapshot is invalid`,
      );
    }
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invoked === fileURLToPath(import.meta.url)) main();
