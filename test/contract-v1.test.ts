import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENT_INVALID,
  CAIL_EVENTS,
  CAIL_LOG_SCHEMA_VERSION,
  createCailLogger,
  defineEventCatalog,
  extendCailEventCatalog,
  type CailLogEvent,
} from "../src/index.js";

const NOW_MS = Date.UTC(2026, 6, 13, 16, 0, 0);
const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";

function capture() {
  const events: CailLogEvent[] = [];
  const diagnostics: string[] = [];
  const logger = createCailLogger({
    service: "kale-gateway",
    release: "218328f",
    env: "production",
    sourceClass: "platform",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => events.push(event),
    onDiagnostic: (code) => diagnostics.push(code),
    clock: () => NOW_MS,
  });
  return { diagnostics, events, logger };
}

afterEach(() => vi.restoreAllMocks());

describe("schema v1 and closed event definitions", () => {
  it("emits the immutable canonical envelope", () => {
    const { events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
    });
    expect(CAIL_LOG_SCHEMA_VERSION).toBe(1);
    expect(events).toEqual([
      {
        schema_version: 1,
        timestamp: "2026-07-13T16:00:00.000Z",
        severity_text: "INFO",
        severity_number: 9,
        event_name: "cail.action.admitted",
        body: "Action admitted.",
        resource: {
          "service.namespace": "cuny-ai-lab",
          "service.name": "kale-gateway",
          "service.version": "218328f",
          "deployment.environment.name": "production",
        },
        attributes: {
          "cail.source.class": "platform",
          "cail.action.id": ACTION_ID,
          "cail.product.id": "kale-workbench",
          "cail.principal.type": "anonymous",
        },
      },
    ]);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0]!.attributes)).toBe(true);
  });

  it("never echoes an unknown event name", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit("student essay text" as never, {} as never);
    expect(events[0]).toMatchObject({
      event_name: CAIL_EVENT_INVALID,
      body: "Event name rejected.",
      severity_number: 17,
    });
    expect(JSON.stringify(events)).not.toContain("student essay");
    expect(diagnostics).toEqual(["event_invalid"]);
  });

  it("validates and deeply freezes catalog definitions", () => {
    const catalog = defineEventCatalog({
      "test.ready": {
        body: "Test ready.",
        source: "both",
        severity: "info",
        required: ["request_id"],
        optional: ["route"],
      },
    });
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog["test.ready"])).toBe(true);
    expect(Object.isFrozen(catalog["test.ready"]!.required)).toBe(true);
    expect(() =>
      defineEventCatalog({
        "bad event": {
          body: "Bad.", source: "both", severity: "info",
          required: [], optional: [],
        },
      }),
    ).toThrow(TypeError);
    expect(() =>
      defineEventCatalog({
        "cail.action.terminal": {
          body: "Conflicting definition.", source: "platform", severity: "info",
          required: [], optional: [],
        },
      }),
    ).toThrow(TypeError);
    expect(() =>
      defineEventCatalog({
        "test.bad": {
          body: "Bad.", source: "tenant", severity: "info",
          required: ["product_id"], optional: [],
        },
      } as never),
    ).toThrow(TypeError);
  });

  it("extends the canonical catalog without permitting redefinition", () => {
    const catalog = extendCailEventCatalog({
      "sandbox_bridge.outbox.retried": {
        body: "Sandbox outbox delivery retried.",
        source: "platform",
        severity: "warn",
        required: ["usage_id", "product_id", "retry_count"],
        optional: ["error_type"],
      },
    });
    const events: CailLogEvent[] = [];
    const logger = createCailLogger({
      service: "sandbox-bridge", release: "local", env: "test",
      sourceClass: "platform", catalog, sink: (event) => events.push(event),
    });
    logger.emit("sandbox_bridge.outbox.retried", {
      usage_id: "8b9ec144-39aa-4f1f-bda5-4c645facf2cd",
      product_id: "kale-workbench",
      retry_count: 2,
      error_type: "accounting_unavailable",
    });
    expect(events[0]).toMatchObject({
      event_name: "sandbox_bridge.outbox.retried",
      severity_number: 13,
    });
  });

  it("fails loudly on invalid constructor context", () => {
    const base = {
      service: "kale-gateway",
      release: "218328f",
      env: "production" as const,
      sourceClass: "platform" as const,
      catalog: CAIL_EVENT_CATALOG,
      sink: () => {},
    };
    expect(() => createCailLogger({ ...base, service: "Has Spaces" })).toThrow(TypeError);
    expect(() => createCailLogger({ ...base, release: "" })).toThrow(TypeError);
    expect(() => createCailLogger({ ...base, env: "prod" as never })).toThrow(TypeError);
    expect(() => createCailLogger({ ...base, sourceClass: "unknown" as never })).toThrow(TypeError);
    expect(() => createCailLogger({
      ...base,
      catalog: {
        "forged.event": {
          body: "Forged.", source: "platform", severity: "info",
          required: [], optional: [],
        },
      } as never,
    })).toThrow(TypeError);
    expect(() => createCailLogger(null as never)).toThrow(TypeError);
  });
});

describe("failure containment", () => {
  it("contains configured and fallback clock failure", () => {
    const diagnostics: string[] = [];
    const events: CailLogEvent[] = [];
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("fallback secret");
    });
    const logger = createCailLogger({
      service: "kale-gateway",
      release: "local",
      env: "test",
      sourceClass: "platform",
      catalog: CAIL_EVENT_CATALOG,
      sink: (event) => events.push(event),
      onDiagnostic: (code) => diagnostics.push(code),
      clock: () => {
        throw new Error("configured secret");
      },
    });
    expect(() => logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
    })).not.toThrow();
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["clock_error", "event_dropped"]);
  });

  it("contains sink and diagnostic failures without exposing messages", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "kale-gateway",
      release: "local",
      env: "test",
      sourceClass: "platform",
      catalog: CAIL_EVENT_CATALOG,
      sink: () => { throw new Error("SECRET sink payload"); },
      onDiagnostic: () => { throw new Error("SECRET diagnostic"); },
    });
    expect(() => logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
    })).not.toThrow();
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("SECRET");
  });
});
