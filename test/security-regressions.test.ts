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
      createAnalyticsEngineSink({
        writeDataPoint: (point) => {
          writes.push(point);
        },
      })(forged),
    ).toThrow(TypeError);
    expect(() =>
      fanoutSinks(() => {
        writes.push("delivered");
      })(forged),
    ).toThrow(TypeError);

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    vi.restoreAllMocks();
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
      sink: (event) => { events.push(event); },
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
        sink: (event) => { events.push(event); },
        onDiagnostic: (code) => { diagnostics.push(code); },
      });
      // SAFETY: each secret token deliberately bypasses its field-specific type
      // to exercise runtime secret-pattern rejection.
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
      sink: (event) => { events.push(event); },
      onDiagnostic: (code) => { diagnostics.push(code); },
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
    // SAFETY: the missing subject version deliberately bypasses the platform
    // options union to exercise fail-closed constructor validation.
    expect(() =>
      createCailLogger({
        ...base,
        sourceClass: "platform",
      } as never),
    ).toThrow(TypeError);
    // SAFETY: the tenant subject version deliberately bypasses the tenant
    // options union to exercise fail-closed constructor validation.
    expect(() =>
      createCailLogger({
        ...base,
        sourceClass: "tenant",
        subjectVersion: "v1",
      } as never),
    ).toThrow(TypeError);
  });
});
