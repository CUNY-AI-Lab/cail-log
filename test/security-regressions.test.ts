import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  it("snapshots every logger option once before validation and emission", () => {
    const safeCatalog = defineEventCatalog({
      "service.ready": {
        source: "tenant",
        severity: "info",
        required: [],
        optional: [],
      },
    });
    const forgedCatalog = Object.freeze({
      "service.leak": Object.freeze({
        body: "private-body-sentinel",
        source: "tenant",
        severity: "info",
        required: Object.freeze([]),
        optional: Object.freeze([]),
      }),
    });
    const events: CailLogEvent[] = [];
    const diagnostics: string[] = [];
    const reads = new Map<string, number>();
    const changing = <Value>(name: string, first: Value, later: Value) => {
      const count = (reads.get(name) ?? 0) + 1;
      reads.set(name, count);
      return count === 1 ? first : later;
    };

    const logger = createCailLogger({
      get service() {
        return changing("service", "fixture-service", "private-service");
      },
      get release() {
        return changing("release", "fixture", "private-release");
      },
      get env() {
        return changing("env", "test" as const, "student-secret" as never);
      },
      get sourceClass() {
        return changing("sourceClass", "tenant" as const, "platform" as never);
      },
      get subjectVersion() {
        return changing("subjectVersion", undefined, "private-version" as never);
      },
      get catalog() {
        return changing("catalog", safeCatalog, forgedCatalog as never);
      },
      get sink() {
        return changing(
          "sink",
          (event: CailLogEvent) => events.push(event),
          () => {
            throw new Error("private-sink-sentinel");
          },
        );
      },
      get onDiagnostic() {
        return changing(
          "onDiagnostic",
          (code: string) => diagnostics.push(code),
          () => {
            throw new Error("private-diagnostic-sentinel");
          },
        );
      },
      get clock() {
        return changing(
          "clock",
          () => Date.UTC(2026, 6, 22, 12),
          () => {
            throw new Error("private-clock-sentinel");
          },
        );
      },
    });

    logger.emit("service.ready");

    expect(Object.fromEntries(reads)).toEqual({
      service: 1,
      release: 1,
      env: 1,
      sourceClass: 1,
      subjectVersion: 1,
      catalog: 1,
      sink: 1,
      onDiagnostic: 1,
      clock: 1,
    });
    expect(diagnostics).toEqual([]);
    expect(events).toEqual([
      {
        schema_version: 2,
        timestamp: "2026-07-22T12:00:00.000Z",
        severity_text: "INFO",
        severity_number: 9,
        event_name: "service.ready",
        body: "Service event recorded.",
        resource: {
          "service.namespace": "cuny-ai-lab",
          "service.name": "fixture-service",
          "service.version": "fixture",
          "deployment.environment.name": "test",
        },
        attributes: {
          "cail.source.class": "tenant",
        },
      },
    ]);
    expect(JSON.stringify({ diagnostics, events })).not.toContain("private");
    expect(JSON.stringify({ diagnostics, events })).not.toContain("student");
  });

  it("contains hostile logger option access and reflection", () => {
    const getterSentinel = "private-option-getter-sentinel";
    const proxySentinel = "private-option-proxy-sentinel";
    const hostileGetter = {
      get service(): never {
        throw new Error(getterSentinel);
      },
    };
    const hostileProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(proxySentinel);
        },
      },
    );

    for (const options of [hostileGetter, hostileProxy]) {
      let thrown: unknown;
      try {
        createCailLogger(options as never);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect(String(thrown)).not.toContain(getterSentinel);
      expect(String(thrown)).not.toContain(proxySentinel);
    }
  });

  it("rejects proxy-valued string options without reflection", () => {
      const createLogger = createCailLogger;
      for (const field of ["service", "release", "subjectVersion"] as const) {
        const sentinel = `private-${field}-prototype-sentinel`;
        let prototypeReads = 0;
        const hostileValue = new Proxy(
          {},
          {
            getPrototypeOf() {
              prototypeReads += 1;
              throw new Error(sentinel);
            },
          },
        );
        const options = {
          service: "fixture-service",
          release: "fixture",
          env: "test",
          sourceClass: "platform",
          subjectVersion: "v1",
          catalog: CAIL_EVENT_CATALOG,
          sink: () => {},
          [field]: hostileValue,
        };

        let thrown: unknown;
        try {
          createLogger(options as never);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(TypeError);
        expect(prototypeReads).toBe(0);
        expect(String(thrown)).not.toContain(sentinel);
      }
  });

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

  it("rejects secret canaries that satisfy every admitted string grammar", () => {
    const cases = [
      ["error_type", "sk-cail-synthetic-secret-7f3a"],
      ["cohort", SK_LIVE_CANARY],
      ["product_id", RK_LIVE_CANARY],
      ["provider", GITLAB_CANARY],
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

describe("consumer type contract", () => {
  it("compiles an ordinary exact-optional-false consumer without runtime-only traps", () => {
    const temporary = mkdtempSync(join(tmpdir(), "cail-log-consumer-types-"));
    try {
      const importPath = resolve("src/index");
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

});
