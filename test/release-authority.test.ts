import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isValidArtifactIdentity,
  isValidCurrentPublishedAuthority,
  isValidLiveVersions,
  isValidPublishedAuthority,
  isValidPublishedRegistryVersion,
  isValidPublishedSourceTag,
  runtimeDigest,
} from "../scripts/check-release-authority.js";
import {
  type GithubJson,
  verifyReleaseRef,
} from "../scripts/check-release-ref.js";

const root = resolve(import.meta.dirname, "..");
const authority = JSON.parse(
  readFileSync(
    resolve(root, "evidence/package-release-authority-published.json"),
    "utf8",
  ),
);
const currentAuthority = JSON.parse(
  readFileSync(
    resolve(root, "evidence/package-release-authority-published-0.6.1.json"),
    "utf8",
  ),
);
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const publishWorkflow = readFileSync(
  resolve(root, ".github/workflows/publish.yml"),
  "utf8",
);
const ciWorkflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const readme = readFileSync(resolve(root, "README.md"), "utf8");

const currentHead = "a".repeat(40);
const oldHead = "b".repeat(40);
const annotatedTag = "c".repeat(40);
const nestedTag = "d".repeat(40);

function releaseApi(
  tag: string,
  branch: string,
  options: { annotated?: boolean; nested?: boolean } = {},
): GithubJson {
  const responses = new Map<string, unknown>([
    ["/repos/CUNY-AI-Lab/cail-log", { default_branch: "main" }],
    [
      "/repos/CUNY-AI-Lab/cail-log/git/ref/heads/main",
      { object: { sha: branch, type: "commit" } },
    ],
  ]);
  if (!options.annotated) {
    responses.set("/repos/CUNY-AI-Lab/cail-log/git/ref/tags/v0.6.0", {
      object: { sha: tag, type: "commit" },
    });
  } else {
    responses.set("/repos/CUNY-AI-Lab/cail-log/git/ref/tags/v0.6.0", {
      object: { sha: annotatedTag, type: "tag" },
    });
    responses.set(`/repos/CUNY-AI-Lab/cail-log/git/tags/${annotatedTag}`, {
      object: options.nested
        ? { sha: nestedTag, type: "tag" }
        : { sha: tag, type: "commit" },
    });
    if (options.nested) {
      responses.set(`/repos/CUNY-AI-Lab/cail-log/git/tags/${nestedTag}`, {
        object: { sha: tag, type: "commit" },
      });
    }
  }
  return async (path) => {
    if (!responses.has(path)) throw new Error(`unexpected API path: ${path}`);
    return responses.get(path);
  };
}

const exactContext = {
  packageVersion: "0.6.0",
  repository: "CUNY-AI-Lab/cail-log",
  refType: "tag",
  refName: "v0.6.0",
  sha: currentHead,
} as const;

describe("release authority", () => {
  it("records the independently verified published authority", () => {
    expect(isValidPublishedAuthority(authority)).toBe(true);
    expect(runtimeDigest()).toBe(
      "ebae96498da12b10b402bbb9754bbf58fbb2d675761282c0fadfba21f7b0632b",
    );
    expect(isValidPublishedSourceTag(authority.release)).toBe(true);
    expect(
      isValidPublishedRegistryVersion({
        id: authority.registry.package_version_id,
        name: authority.registry.version,
        created_at: authority.registry.created_at,
      }),
    ).toBe(true);
    expect(
      isValidArtifactIdentity({
        tarball: authority.registry.tarball,
        artifact_sha1: authority.registry.artifact_sha1,
        integrity: authority.registry.integrity,
        artifact_bytes: authority.registry.artifact_bytes,
        artifact_sha256: authority.registry.artifact_sha256,
        artifact_git_tree_sha256: authority.registry.artifact_git_tree_sha256,
      }),
    ).toBe(true);
  });

  it("records the exact 0.6.1 source, workflow, registry, and artifact join", () => {
    expect(isValidCurrentPublishedAuthority(currentAuthority)).toBe(true);
    expect(currentAuthority.package.version).toBe("0.6.1");
    expect(currentAuthority.behavior_authority).toEqual(
      authority.behavior_authority,
    );
    expect(currentAuthority.release).toMatchObject({
      tag: "v0.6.1",
      commit: "038269d1d27d857ab537d07928fd604482144219",
      tree: "ba45e27921e3eed709a85d667793341823131ca2",
      workflow_run_id: 31176048181,
      workflow_job_id: 92858162874,
      run_status: "completed",
      run_conclusion: "success",
    });
    expect(currentAuthority.registry).toMatchObject({
      package_version_id: 1108499365,
      version: "0.6.1",
      state: "published",
      artifact_sha1: "1b33369223ff745e8647931041a031ea99993680",
      artifact_bytes: 50662,
      artifact_sha256:
        "8576448c206808b9974b82c4548cade0cb826e620a6aced1497059fde7bfc0b9",
      artifact_git_tree_sha256:
        "fdd0da5ec61556ce550aaf7cbda334aa3b746f0283cc658053773be41ce41202",
    });
  });

  it("fails closed for forged or extended authority records", () => {
    expect(
      isValidPublishedAuthority({
        ...authority,
        registry: { ...authority.registry, artifact_sha256: "forged" },
      }),
    ).toBe(false);
    expect(
      isValidPublishedAuthority({
        ...authority,
        release: { ...authority.release, commit: "0".repeat(40) },
      }),
    ).toBe(false);
    expect(
      isValidPublishedAuthority({
        ...authority,
        registry: { ...authority.registry, extra: true },
      }),
    ).toBe(false);
    expect(() => isValidPublishedAuthority(null)).not.toThrow();
    expect(
      isValidCurrentPublishedAuthority({
        ...currentAuthority,
        registry: { ...currentAuthority.registry, artifact_sha256: "forged" },
      }),
    ).toBe(false);
    expect(
      isValidCurrentPublishedAuthority({
        ...currentAuthority,
        release: { ...currentAuthority.release, extra: true },
      }),
    ).toBe(false);
  });

  it("rejects occupied, malformed, empty, and incomplete live snapshots", () => {
    expect(
      isValidLiveVersions(
        [{ id: 1066236862, name: "0.6.0", created_at: "2026-07-25T16:40:58Z" }],
        "0.6.0",
      ),
    ).toBe(false);
    expect(
      isValidLiveVersions(
        [{ id: 1066236862, name: "0.6.0", created_at: "2026-07-25T16:40:58Z" }],
        "0.7.0",
      ),
    ).toBe(true);
    expect(isValidLiveVersions([], "0.7.0")).toBe(false);
    expect(isValidLiveVersions([{ name: "0.7.0" }], "0.7.0")).toBe(false);
    expect(isValidLiveVersions(new Array(1), "0.7.0")).toBe(false);
  });

  it("requires the tag, GITHUB_SHA, and live default-branch head to agree", async () => {
    await expect(
      verifyReleaseRef(
        { ...exactContext, sha: oldHead },
        releaseApi(oldHead, currentHead),
      ),
    ).rejects.toThrow("live default-branch head");
    await expect(
      verifyReleaseRef(
        { ...exactContext, sha: oldHead },
        releaseApi(currentHead, currentHead),
      ),
    ).rejects.toThrow("GITHUB_SHA is not the commit named by the release tag");
    await expect(
      verifyReleaseRef(exactContext, releaseApi(oldHead, currentHead)),
    ).rejects.toThrow("GITHUB_SHA is not the commit named by the release tag");
    await expect(
      verifyReleaseRef(exactContext, releaseApi(currentHead, currentHead)),
    ).resolves.toBeUndefined();
    await expect(
      verifyReleaseRef(
        { ...exactContext, refType: "branch" },
        releaseApi(currentHead, currentHead),
      ),
    ).rejects.toThrow("requires a tag ref");
  });

  it("resolves annotated tags, including one nested tag", async () => {
    await expect(
      verifyReleaseRef(
        exactContext,
        releaseApi(currentHead, currentHead, { annotated: true }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyReleaseRef(
        exactContext,
        releaseApi(currentHead, currentHead, { annotated: true, nested: true }),
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps the future preflight separate from historical authority", () => {
    expect(packageJson.version).toBe("0.6.1");
    expect(packageJson.scripts.check).toBe(
      "bun run verify && bun run check:release-authority",
    );
    expect(packageJson.scripts["check:release-authority"]).toBe(
      "bun scripts/check-release-authority.ts",
    );
    expect(packageJson.scripts["check:release-live"]).toBe(
      "bun scripts/check-release-authority.ts --live",
    );
    expect(packageJson.scripts["check:release-ref"]).toBe(
      "bun scripts/check-release-ref.ts",
    );
    expect(packageJson.scripts.prepublishOnly).toContain(
      "bun run check:release-live",
    );
    expect(publishWorkflow).toContain("timeout-minutes: 15");
    expect(publishWorkflow).toContain("bun run check:release-ref");
    expect(publishWorkflow).toContain("GITHUB_SHA: ${{ github.sha }}");
    expect(publishWorkflow).toContain("gh api --paginate");
    expect(publishWorkflow).toContain("jq -s 'add'");
    expect(publishWorkflow).toContain("bun run check:release-live");
    expect(publishWorkflow).toContain(
      "NPM_CONFIG_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    );
    expect(publishWorkflow).toContain(
      "NPM_CONFIG_REGISTRY: https://npm.pkg.github.com",
    );
    expect(publishWorkflow).not.toContain("NODE_AUTH_TOKEN");
    expect(publishWorkflow).not.toContain("NPM_CONFIG_USERCONFIG");
    expect(publishWorkflow).not.toContain("> .npmrc");
    expect(ciWorkflow).toContain("bun install --frozen-lockfile --ignore-scripts");
    expect(ciWorkflow).toContain("bun audit --audit-level high");
    expect(readme).toContain("Version `0.6.0` is the independently verified published artifact");
    expect(readme).toContain("live default-branch head");
    expect(readme).toContain("future release");
  });
});
