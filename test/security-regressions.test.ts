import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  CAIL_LOG_SCHEMA_VERSION,
  CAIL_PLATFORM_FIELD_NAMES,
  createAnalyticsEngineSink,
  createCailLogger,
  defineEventCatalog,
  fanoutSinks,
  jsonLineSink,
  toAnalyticsEngineDataPoint,
  toWorkersLogEvent,
  workersStructuredSink,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";
const SK_LIVE_CANARY = ["sk", "live", "syntheticsecret7f3a"].join("_");
const RK_LIVE_CANARY = ["rk", "live", "syntheticsecret7f3a"].join("_");
const NPM_CANARY = ["npm", "syntheticsecret0123456789abcdef"].join("_");
const GITLAB_CANARY = ["glpat", "syntheticsecret0123456789"].join("-");
const HUGGING_FACE_CANARY = [
  "hf",
  "syntheticsecret0123456789abcdef",
].join("_");
const GRAMMAR_CATALOG = defineEventCatalog({
  "test.secret_grammars": {
    source: "platform",
    severity: "info",
    required: [],
    optional: CAIL_PLATFORM_FIELD_NAMES,
  },
});

function forgedEvent(): CailLogEvent {
  return Object.freeze({
    schema_version: CAIL_LOG_SCHEMA_VERSION,
    timestamp: "2026-07-14T12:00:00.000Z",
    severity_text: "INFO",
    severity_number: 9,
    event_name: "forged.user_content",
    body: "student essay text",
    resource: Object.freeze({
      "service.namespace": "cuny-ai-lab",
      "service.name": "forged-service",
      "service.version": "local",
      "deployment.environment.name": "test" as const,
    }),
    attributes: Object.freeze({
      "cail.source.class": "platform" as const,
      "cail.key.id": "sk-cail-synthetic-secret-7f3a",
    }),
  });
}

describe("validated event provenance", () => {
  it("rejects caller-constructed envelopes at every exported adapter", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const writes: unknown[] = [];
    const forged = forgedEvent();

    expect(() => jsonLineSink(forged)).toThrow(TypeError);
    expect(() => toWorkersLogEvent(forged)).toThrow(TypeError);
    expect(() => workersStructuredSink(forged)).toThrow(TypeError);
    expect(() => toAnalyticsEngineDataPoint(forged)).toThrow(TypeError);
    expect(() =>
      createAnalyticsEngineSink({ writeDataPoint: (point) => writes.push(point) })(
        forged,
      ),
    ).toThrow(TypeError);
    expect(() => fanoutSinks(() => writes.push("delivered"))(forged)).toThrow(
      TypeError,
    );

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("content-free service catalogs", () => {
  it("assigns one library-owned body to service-defined events", () => {
    const catalog = defineEventCatalog({
      "service.ready": {
        source: "tenant",
        severity: "info",
        required: [],
        optional: [],
      },
    });
    expect(catalog["service.ready"]!.body).toBe("Service event recorded.");
  });

  it("rejects a runtime body escape hatch even when types are bypassed", () => {
    expect(() =>
      defineEventCatalog({
        "service.leak": {
          body: "student essay text",
          source: "tenant",
          severity: "info",
          required: [],
          optional: [],
        },
      } as never),
    ).toThrow(TypeError);
  });

  it("rejects a secret-shaped event name", () => {
    expect(() =>
      defineEventCatalog({
        "sk-cail-synthetic-secret-7f3a": {
          source: "tenant",
          severity: "info",
          required: [],
          optional: [],
        },
      }),
    ).toThrow(TypeError);
  });
});

describe("identifier and subject privacy boundaries", () => {
  it("keeps route-template provenance as an explicit producer obligation", () => {
    const events: CailLogEvent[] = [];
    const logger = createCailLogger({
      service: "gateway",
      release: "local",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: (event) => events.push(event),
    });
    logger.emit(CAIL_EVENTS.REQUEST_RECEIVED, {
      request_id: "0af7651b-16f9-4a3b-8f42-00f067aa0ba9",
      product_id: "kale-workbench",
      http_method: "GET",
      route: "/users/alice.example",
    });

    // Grammar cannot distinguish a static route from an identifier-bearing path.
    expect(events[0]?.attributes["url.template"]).toBe(
      "/users/alice.example",
    );
  });

  it("drops a secret-shaped value that otherwise satisfies key_id grammar", () => {
    for (const canary of [
      "sk-cail-synthetic-secret-7f3a",
      "sk-admin-1234abcd",
      "sk-abcdefghijklmnop123",
      SK_LIVE_CANARY,
      RK_LIVE_CANARY,
      NPM_CANARY,
      GITLAB_CANARY,
      HUGGING_FACE_CANARY,
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "github_pat_synthetic_secret_7f3a",
      "AKIA0123456789ABCDEF",
      "AIza0123456789abcdefghijklmnop",
      "xoxb-synthetic-secret-7f3a",
      "eyJsyntheticheader.payload.signature",
    ]) {
      const events: CailLogEvent[] = [];
      const diagnostics: string[] = [];
      const logger = createCailLogger({
        service: "gateway",
        release: "local",
        env: "test",
        sourceClass: "platform",
        subjectVersion: "v1",
        catalog: CAIL_EVENT_CATALOG,
        sink: (event) => events.push(event),
        onDiagnostic: (code) => diagnostics.push(code),
      });
      logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "app" },
        key_id: canary,
      });
      expect(events, canary).toEqual([]);
      expect(diagnostics, canary).toEqual(["event_contract_error"]);
    }
  });

  it("rejects secret canaries that satisfy every admitted string grammar", () => {
    const cases = [
      ["error_type", "sk-cail-synthetic-secret-7f3a"],
      ["cohort", SK_LIVE_CANARY],
      ["product_id", RK_LIVE_CANARY],
      ["project", NPM_CANARY],
      ["provider", GITLAB_CANARY],
      ["key_id", HUGGING_FACE_CANARY],
      ["request_model", SK_LIVE_CANARY],
      ["response_model", RK_LIVE_CANARY],
      ["route", `/${NPM_CANARY}`],
    ] as const;
    for (const [field, canary] of cases) {
      const events: CailLogEvent[] = [];
      const diagnostics: string[] = [];
      const logger = createCailLogger({
        service: "gateway",
        release: "local",
        env: "test",
        sourceClass: "platform",
        subjectVersion: "v1",
        catalog: GRAMMAR_CATALOG,
        sink: (event) => events.push(event),
        onDiagnostic: (code) => diagnostics.push(code),
      });
      logger.emit("test.secret_grammars", { [field]: canary } as never);
      expect(events, field).toEqual([]);
      expect(diagnostics, field).toEqual(["event_contract_error"]);
    }

    const base = {
      env: "test" as const,
      sourceClass: "platform" as const,
      subjectVersion: "v1",
      catalog: GRAMMAR_CATALOG,
      sink: () => {},
    };
    expect(() =>
      createCailLogger({
        ...base,
        service: "sk-cail-synthetic-secret-7f3a",
        release: "local",
      }),
    ).toThrow(TypeError);
    expect(() =>
      createCailLogger({
        ...base,
        service: "gateway",
        release: "sk-cail-synthetic-secret-7f3a",
      }),
    ).toThrow(TypeError);
  });

  it("requires the platform logger's configured subject version", () => {
    const events: CailLogEvent[] = [];
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "gateway",
      release: "local",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: (event) => events.push(event),
      onDiagnostic: (code) => diagnostics.push(code),
    });
    for (const subject of [
      "cail-0123456789abcdef0123456789abcdef",
      "cail-v2-0123456789abcdef0123456789abcdef",
    ]) {
      logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "user", subject },
      });
    }
    expect(events).toEqual([]);
    expect(diagnostics).toEqual([
      "event_contract_error",
      "event_contract_error",
    ]);
  });

  it("fails closed when subject version configuration is absent or misplaced", () => {
    const base = {
      service: "gateway",
      release: "local",
      env: "test" as const,
      catalog: CAIL_EVENT_CATALOG,
      sink: () => {},
    };
    expect(() =>
      createCailLogger({
        ...base,
        sourceClass: "platform",
      } as never),
    ).toThrow(TypeError);
    expect(() =>
      createCailLogger({
        ...base,
        sourceClass: "tenant",
        subjectVersion: "v1",
      } as never),
    ).toThrow(TypeError);
  });
});

describe("repository verification contract", () => {
  it("compiles an ordinary exact-optional-false consumer without runtime-only traps", () => {
    const temporary = mkdtempSync(join(tmpdir(), "cail-log-consumer-types-"));
    try {
      const importPath = resolve("dist/index.js");
      writeFileSync(
        join(temporary, "consumer.ts"),
        `
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  defineEventCatalog,
} from ${JSON.stringify(importPath)};

const platform = createCailLogger({
  service: "gateway",
  release: "local",
  env: "test",
  sourceClass: "platform",
  subjectVersion: "v1",
  catalog: CAIL_EVENT_CATALOG,
  sink: () => {},
});
platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
  action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7",
  product_id: "kale-workbench",
  principal: { type: "anonymous", subject: undefined },
  request_id: undefined,
});
platform.emit(CAIL_EVENTS.ACTION_TERMINAL, {
  action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7",
  product_id: "kale-workbench",
  principal: { type: "anonymous" },
  terminal: { outcome: "ok", reason: "completed" },
  duration_ms: 1,
  error_type: undefined,
});

const tenantCatalog = defineEventCatalog({
  "tenant.ready": {
    body: undefined,
    source: "tenant",
    severity: "info",
    required: [],
    optional: [],
  },
});
createCailLogger({
  service: "tenant-service",
  release: "local",
  env: "test",
  sourceClass: "tenant",
  subjectVersion: undefined,
  catalog: tenantCatalog,
  sink: () => {},
});
`,
      );
      writeFileSync(
        join(temporary, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            exactOptionalPropertyTypes: false,
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            strict: true,
            target: "ES2022",
          },
          include: ["consumer.ts"],
        }),
      );
      const result = spawnSync(
        resolve("node_modules/.bin/tsc"),
        ["-p", join(temporary, "tsconfig.json")],
        { encoding: "utf8" },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("checks committed dist parity in local verification and CI", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["verify"]).toContain("check:dist");
    expect(packageJson.scripts["prepublishOnly"]).toBe("bun run verify");
    expect(packageJson.version).toBe("0.6.0");
    expect(existsSync(".github/workflows/ci.yml")).toBe(true);
    const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ciWorkflow).toContain("bun run verify");
    expect(ciWorkflow).toContain("--ignore-scripts");
    expect(ciWorkflow).toContain("persist-credentials: false");
    expect(ciWorkflow).toContain(
      "node --input-type=module",
    );

    const publishWorkflow = readFileSync(
      ".github/workflows/publish.yml",
      "utf8",
    );
    expect(publishWorkflow).toContain("release:");
    expect(publishWorkflow).toContain("types: [published]");
    expect(publishWorkflow).toContain("packages: write");
    expect(publishWorkflow).toContain("bun run verify");
    expect(publishWorkflow).toContain("--ignore-scripts");
    expect(publishWorkflow).toContain("persist-credentials: false");
    expect(publishWorkflow).toContain('PACKAGE_VERSION="$(bun -p');
    expect(publishWorkflow).toContain(
      ['test "v$', '{PACKAGE_VERSION}" = "$', '{GITHUB_REF_NAME}"'].join(""),
    );
    expect(publishWorkflow).toContain("bun publish");
    expect(publishWorkflow).not.toContain("npm publish");
    expect(publishWorkflow).not.toContain("node -p");
    expect(publishWorkflow).toContain("NODE_AUTH_TOKEN:");
    expect(publishWorkflow.match(/NODE_AUTH_TOKEN:/g)).toHaveLength(1);

    for (const workflow of [ciWorkflow, publishWorkflow]) {
      expect(workflow).toContain(
        "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      );
      expect(workflow).toContain(
        "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      );
      expect(workflow).toContain(
        "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      );
    }
  });

  it("fails the parity check for stale generated output", () => {
    const temporary = mkdtempSync(join(tmpdir(), "cail-log-stale-dist-"));
    try {
      cpSync("dist", temporary, { recursive: true });
      writeFileSync(
        join(temporary, "index.js"),
        `${readFileSync(join(temporary, "index.js"), "utf8")}\n// stale\n`,
      );
      const result = spawnSync(
        "bun",
        ["scripts/check-dist.ts", temporary],
        { encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "does not match source build",
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
