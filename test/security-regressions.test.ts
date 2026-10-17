import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  CAIL_LOG_SCHEMA_VERSION,
  CAIL_PLATFORM_FIELD_NAMES,
  createAnalyticsEngineSink,
  createCailLogger,
  defineEventCatalog,
  fanoutSinks,
  isOperationalLogSubject,
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
  const writes: unknown[] = [];
  const adapters = [
    ["toWorkersLogEvent", toWorkersLogEvent],
    ["workersStructuredSink", workersStructuredSink],
    ["toAnalyticsEngineDataPoint", toAnalyticsEngineDataPoint],
    ["an Analytics Engine sink", createAnalyticsEngineSink({
      writeDataPoint: (point) => { writes.push(point); },
    })],
    ["a fanout sink", fanoutSinks(() => { writes.push("delivered"); })],
  ] as const;

  afterEach(() => {
    writes.length = 0;
    vi.restoreAllMocks();
  });

  it.each(adapters)("%s rejects a caller-constructed envelope without output", (_name, adapter) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => adapter(forgedEvent())).toThrow(TypeError);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
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

    // SAFETY: the changing getters deliberately return invalid second-read
    // values; the casted branches prove options are snapshotted exactly once.
    const logger = createCailLogger({
      get service() {
        return changing("service", "fixture-service", "private-service");
      },
      get release() {
        return changing("release", "fixture", "private-release");
      },
      get env() {
        // SAFETY: the second getter value intentionally violates the closed
        // environment type to prove it is never read.
        return changing("env", "test" as const, "student-secret" as never);
      },
      get sourceClass() {
        // SAFETY: the second getter value intentionally violates the closed
        // source-class type to prove it is never read.
        return changing("sourceClass", "tenant" as const, "platform" as never);
      },
      get subjectVersion() {
        // SAFETY: the second getter value intentionally violates the tenant
        // options union to prove it is never read.
        return changing("subjectVersion", undefined, "private-version" as never);
      },
      get catalog() {
        // SAFETY: the second getter value intentionally lacks catalog
        // provenance to prove it is never read.
        return changing("catalog", safeCatalog, forgedCatalog as never);
      },
      get sink() {
        return changing(
          "sink",
          (event: CailLogEvent) => { events.push(event); },
          () => {
            throw new Error("private-sink-sentinel");
          },
        );
      },
      get onDiagnostic() {
        return changing(
          "onDiagnostic",
          (code: string) => { diagnostics.push(code); },
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
  });

  it.each([
    {
      label: "a throwing option getter",
      options: {
        get service(): never {
          throw new Error("private-option-sentinel");
        },
      },
    },
    {
      label: "a throwing prototype trap",
      options: new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("private-option-sentinel");
          },
        },
      ),
    },
  ])("contains $label in logger options without echoing it", ({ options }) => {
    let thrown: unknown;
    try {
      // SAFETY: hostile objects intentionally bypass the logger options type
      // to exercise contained reflection and getter failures.
      createCailLogger(options as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).not.toContain("private-option-sentinel");
  });

  it.each(["service", "release", "subjectVersion"] as const)(
    "rejects a proxy-valued %s option without reflecting it",
    (field) => {
      let prototypeReads = 0;
      const hostileValue = new Proxy(
        {},
        {
          getPrototypeOf() {
            prototypeReads += 1;
            throw new Error("private-prototype-sentinel");
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
        // SAFETY: the hostile field deliberately bypasses the option type to
        // prove unrelated values are never reflected or inspected.
        createCailLogger(options as never);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(TypeError);
      expect(prototypeReads).toBe(0);
      expect(String(thrown)).not.toContain("private-prototype-sentinel");
    },
  );

  it("rejects a runtime body escape hatch even when types are bypassed", () => {
    // SAFETY: the caller-owned body deliberately bypasses the bodyless catalog
    // type to exercise the runtime fixed-body boundary.
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
  it.each([
    ["error_type", "sk-cail-synthetic-secret-7f3a"],
    ["cohort", SK_LIVE_CANARY],
    ["product_id", RK_LIVE_CANARY],
    ["provider", GITLAB_CANARY],
    ["request_model", SK_LIVE_CANARY],
    ["response_model", RK_LIVE_CANARY],
    ["route", `/${NPM_CANARY}`],
  ] as const)("drops an event whose %s is a grammatical secret token", (field, canary) => {
    const events: CailLogEvent[] = [];
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "gateway",
      release: "local",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: GRAMMAR_CATALOG,
      sink: (event) => { events.push(event); },
      onDiagnostic: (code) => { diagnostics.push(code); },
    });
    // SAFETY: the secret token deliberately bypasses its field-specific type
    // to exercise runtime secret-pattern rejection.
    logger.emit("test.secret_grammars", { [field]: canary } as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it.each([
    ["service", { service: "sk-cail-synthetic-secret-7f3a", release: "local" }],
    ["release", { service: "gateway", release: "sk-cail-synthetic-secret-7f3a" }],
  ] as const)("rejects a secret token as the logger %s", (_field, identity) => {
    expect(() =>
      createCailLogger({
        env: "test",
        sourceClass: "platform",
        subjectVersion: "v1",
        catalog: GRAMMAR_CATALOG,
        sink: () => {},
        ...identity,
      }),
    ).toThrow(TypeError);
  });

  it.each([
    ["an unversioned ownership subject", "cail-0123456789abcdef0123456789abcdef"],
    ["another subject version", "cail-v2-0123456789abcdef0123456789abcdef"],
  ])("drops a user principal carrying %s", (_label, subject) => {
    const events: CailLogEvent[] = [];
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "gateway",
      release: "local",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: (event) => { events.push(event); },
      onDiagnostic: (code) => { diagnostics.push(code); },
    });
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "user", subject },
    });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it("requires a subjectVersion on a platform logger", () => {
    // SAFETY: the missing subject version deliberately bypasses the platform
    // options union to exercise fail-closed constructor validation.
    expect(() =>
      createCailLogger({
        service: "gateway",
        release: "local",
        env: "test",
        sourceClass: "platform",
        catalog: CAIL_EVENT_CATALOG,
        sink: () => {},
      } as never),
    ).toThrow(TypeError);
  });

  it("forbids a subjectVersion on a tenant logger", () => {
    // SAFETY: the tenant subject version deliberately bypasses the tenant
    // options union to exercise fail-closed constructor validation.
    expect(() =>
      createCailLogger({
        service: "gateway",
        release: "local",
        env: "test",
        sourceClass: "tenant",
        subjectVersion: "v1",
        catalog: CAIL_EVENT_CATALOG,
        sink: () => {},
      } as never),
    ).toThrow(TypeError);
  });

  it.each([
    { label: "a v1 pseudonym", value: "cail-v1-0123456789abcdef0123456789abcdef", expected: true },
    { label: "a multi-character version", value: "cail-v2_beta-0123456789abcdef0123456789abcdef", expected: true },
    { label: "an unversioned ownership subject", value: "cail-0123456789abcdef0123456789abcdef", expected: false },
    { label: "uppercase hex", value: "cail-v1-0123456789ABCDEF0123456789ABCDEF", expected: false },
    { label: "31 hex characters", value: "cail-v1-0123456789abcdef0123456789abcde", expected: false },
    { label: "surrounding whitespace", value: " cail-v1-0123456789abcdef0123456789abcdef", expected: false },
    { label: "a version starting with an underscore", value: "cail-_v1-0123456789abcdef0123456789abcdef", expected: false },
    { label: "a 17-character version", value: `cail-${"v".repeat(17)}-0123456789abcdef0123456789abcdef`, expected: false },
    { label: "a boxed string", value: new String("cail-v1-0123456789abcdef0123456789abcdef"), expected: false },
    { label: "a number", value: 42, expected: false },
    { label: "undefined", value: undefined, expected: false },
  ])("isOperationalLogSubject returns $expected for $label", ({ value, expected }) => {
    expect(isOperationalLogSubject(value)).toBe(expected);
  });
});
