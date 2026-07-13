import { describe, expect, it, vi } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  defineEventCatalog,
  jsonLineSink,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";
const USAGE_ID = "8b9ec144-39aa-4f1f-bda5-4c645facf2cd";
const SUBJECT = "cail-0123456789abcdef0123456789abcdef";

function capture() {
  const events: CailLogEvent[] = [];
  const diagnostics: string[] = [];
  const logger = createCailLogger({
    service: "sandbox-bridge",
    release: "local",
    env: "test",
    sourceClass: "platform",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => events.push(event),
    onDiagnostic: (code) => diagnostics.push(code),
    clock: () => Date.UTC(2026, 6, 13, 16, 0, 0),
  });
  return { diagnostics, events, logger };
}

describe("canonical event contracts", () => {
  it("emits an exact sandbox settlement with product and principal attribution", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.SANDBOX_USAGE_SETTLED, {
      usage_id: USAGE_ID,
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "user", subject: SUBJECT },
      terminal: { outcome: "ok", reason: "completed" },
      usage: {
        kind: "sandbox_compute",
        unit: "mib_milliseconds",
        quantity: 67_108_864,
      },
      quota: {
        kind: "sandbox_compute",
        unit: "gib_seconds",
        state: "fresh",
        limit: 1_000,
        used: 66,
        reset_at: "2026-08-01T00:00:00.000Z",
      },
    });

    expect(diagnostics).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      severity_text: "INFO",
      event_name: "cail.sandbox.usage.settled",
      attributes: {
        "cail.usage.id": USAGE_ID,
        "cail.action.id": ACTION_ID,
        "cail.product.id": "kale-workbench",
        "cail.principal.type": "user",
        "enduser.pseudo.id": SUBJECT,
        "cail.outcome": "ok",
        "cail.outcome.reason": "completed",
        "cail.usage.kind": "sandbox_compute",
        "cail.usage.unit": "mib_milliseconds",
        "cail.usage.quantity": 67_108_864,
      },
    });
  });

  it("drops a named event when a required field is missing", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.SANDBOX_USAGE_SETTLED, {
      usage_id: USAGE_ID,
      product_id: "kale-workbench",
      principal: { type: "user", subject: SUBJECT },
      terminal: { outcome: "ok", reason: "completed" },
      // @ts-expect-error exact settled usage is required
      usage: undefined,
    });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it("drops contradictory principal and terminal facts", () => {
    const first = capture();
    first.logger.emit(CAIL_EVENTS.ACTION_TERMINAL, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous", subject: SUBJECT },
      terminal: { outcome: "ok", reason: "completed" },
      duration_ms: 1,
    } as never);
    expect(first.events).toEqual([]);
    expect(first.diagnostics).toEqual(["event_contract_error"]);

    const second = capture();
    second.logger.emit(CAIL_EVENTS.ACTION_TERMINAL, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "user", subject: SUBJECT },
      terminal: { outcome: "ok", reason: "timeout" },
      duration_ms: 1,
    } as never);
    expect(second.events).toEqual([]);
    expect(second.diagnostics).toEqual(["event_contract_error"]);
  });

  it("drops a known field that is not allowed for that event", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
      // @ts-expect-error cost is not part of action admission
      cost_micro_usd: 1,
    });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it("ignores an arbitrary unknown key without leaking or suppressing the event", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
      prompt: "student essay",
    } as never);
    expect(events).toHaveLength(1);
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("student essay");
  });
});

describe("catalog and sink gates", () => {
  it("rejects a catalog whose outcome severity policy lacks terminal facts", () => {
    expect(() =>
      defineEventCatalog({
        "bad.event": {
          body: "Bad event.",
          source: "platform",
          severity: "outcome",
          required: ["product_id"],
          optional: [],
        },
      }),
    ).toThrow(TypeError);
  });

  it("rejects an event whose allowed terminal outcomes cannot pair with its reasons", () => {
    expect(() =>
      defineEventCatalog({
        "bad.terminal": {
          body: "Bad terminal event.",
          source: "platform",
          severity: "outcome",
          required: ["terminal"],
          optional: [],
          outcomes: ["error"],
          terminal_reasons: ["timeout"],
        },
      }),
    ).toThrow(TypeError);
  });

  it("rejects a success-only event that also requires an error type", () => {
    expect(() =>
      defineEventCatalog({
        "bad.success_error": {
          body: "Impossible success event.",
          source: "platform",
          severity: "outcome",
          required: ["terminal", "error_type"],
          optional: [],
          outcomes: ["ok"],
          terminal_reasons: ["completed"],
        },
      }),
    ).toThrow(TypeError);
  });

  it("requires callers to choose a sink explicitly", () => {
    expect(() =>
      createCailLogger({
        service: "sandbox-bridge",
        release: "local",
        env: "test",
        sourceClass: "platform",
        catalog: CAIL_EVENT_CATALOG,
        // @ts-expect-error sink selection is required
        sink: undefined,
      }),
    ).toThrow(TypeError);
  });

  it("offers an explicit JSON-line sink for line-oriented runtimes", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger } = capture();
    const lineLogger = createCailLogger({
      service: "sandbox-bridge",
      release: "local",
      env: "test",
      sourceClass: "platform",
      catalog: CAIL_EVENT_CATALOG,
      sink: jsonLineSink,
    });
    lineLogger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
    });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(typeof consoleSpy.mock.calls[0]![0]).toBe("string");
    expect(logger).toBeDefined();
    vi.restoreAllMocks();
  });
});
