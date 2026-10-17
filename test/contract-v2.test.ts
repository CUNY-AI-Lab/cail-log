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
    subjectVersion: "v1",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => { events.push(event); },
    onDiagnostic: (code) => { diagnostics.push(code); },
    clock: () => NOW_MS,
  });
  return { diagnostics, events, logger };
}

function validOptions() {
  return {
    service: "kale-gateway",
    release: "218328f",
    env: "production" as const,
    sourceClass: "platform" as const,
    subjectVersion: "v1",
    catalog: CAIL_EVENT_CATALOG,
    sink: () => {},
  };
}

function definition(source: string, required: readonly string[] = []) {
  return { source, severity: "info", required, optional: [] };
}

afterEach(() => vi.restoreAllMocks());

describe("schema v2 and closed event definitions", () => {
  it("emits the immutable canonical envelope", () => {
    const { events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
    });
    expect(CAIL_LOG_SCHEMA_VERSION).toBe(2);
    expect(events).toEqual([
      {
        schema_version: 2,
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
    // SAFETY: the invalid name and empty fields intentionally bypass the
    // compile-time catalog contract to exercise the runtime rejection path.
    logger.emit("student essay text" as never, {} as never);
    expect(events[0]).toMatchObject({
      event_name: CAIL_EVENT_INVALID,
      body: "Event name rejected.",
      severity_number: 17,
    });
    expect(JSON.stringify(events)).not.toContain("student essay");
    expect(diagnostics).toEqual(["event_invalid"]);
  });

  it("deeply freezes a defined catalog", () => {
    const catalog = defineEventCatalog({
      "test.ready": {
        source: "both",
        severity: "info",
        required: ["request_id"],
        optional: ["route"],
      },
    });
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog["test.ready"])).toBe(true);
    expect(Object.isFrozen(catalog["test.ready"]!.required)).toBe(true);
  });

  it.each([
    { label: "an event name with a space", catalog: { "bad event": definition("both") } },
    { label: "the reserved cail. namespace", catalog: { "cail.action.terminal": definition("platform") } },
    { label: "the reserved invalid-event name", catalog: { "event.invalid": definition("both") } },
    { label: "a platform field on a tenant event", catalog: { "test.bad": definition("tenant", ["product_id"]) } },
  ])("rejects a service catalog with $label", ({ catalog }) => {
    // SAFETY: each row deliberately violates the runtime catalog contract; the
    // cast bypasses only the compile-time catalog type.
    expect(() => defineEventCatalog(catalog as never)).toThrow(TypeError);
  });

  it("extends the canonical catalog with a service event", () => {
    const catalog = extendCailEventCatalog({
      "sandbox_bridge.outbox.retried": {
        source: "platform",
        severity: "warn",
        required: ["usage_id", "product_id", "retry_count"],
        optional: ["error_type"],
      },
    });
    const events: CailLogEvent[] = [];
    const logger = createCailLogger({
      service: "sandbox-bridge", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1", catalog,
      sink: (event) => { events.push(event); },
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

  it("rejects an extension that redefines a canonical event", () => {
    expect(() =>
      extendCailEventCatalog({
        [CAIL_EVENTS.ACTION_TERMINAL]: {
          source: "platform",
          severity: "debug",
          required: [],
          optional: [],
        },
      }),
    ).toThrow(TypeError);
  });

  it.each([
    { label: "a service that is not a slug", options: { ...validOptions(), service: "Has Spaces" } },
    { label: "an empty release", options: { ...validOptions(), release: "" } },
    { label: "a noncanonical environment", options: { ...validOptions(), env: "prod" } },
    { label: "an unknown source class", options: { ...validOptions(), sourceClass: "unknown" } },
    {
      label: "a catalog without library provenance",
      options: { ...validOptions(), catalog: { "forged.event": definition("platform") } },
    },
  ])("throws a TypeError for $label", ({ options }) => {
    // SAFETY: each row deliberately bypasses the closed options type to exercise
    // constructor validation at runtime.
    expect(() => createCailLogger(options as never)).toThrow(TypeError);
  });

  it("throws a TypeError for null options", () => {
    // SAFETY: null intentionally bypasses the required options object type to
    // exercise the constructor's readable-object boundary.
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
      subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: (event) => { events.push(event); },
      onDiagnostic: (code) => { diagnostics.push(code); },
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
      subjectVersion: "v1",
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
