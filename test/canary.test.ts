import { describe, expect, it } from "vitest";
import {
  CAIL_PLATFORM_FIELD_NAMES,
  createCailLogger,
  defineEventCatalog,
  type CailLogEvent,
} from "../src/index.js";

const CANARY = "stephen.zweibel@gc.cuny.edu?CANARY-PII-7f3a";
const EVENTS = defineEventCatalog({
  "test.canary": {
    source: "platform",
    severity: "info",
    required: [],
    optional: CAIL_PLATFORM_FIELD_NAMES,
  },
});

describe("privacy canary", () => {
  it("cannot use runtime fields, event names, or unknown keys as free text", () => {
    const events: CailLogEvent[] = [];
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "model-proxy", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1", catalog: EVENTS,
      sink: (event) => { events.push(event); },
      onDiagnostic: (code) => { diagnostics.push(code); },
    });

    logger.emit("test.canary");
    expect(events).toHaveLength(1);
    expect(events[0]?.event_name).toBe("test.canary");
    expect(diagnostics).toEqual([]);
    events.length = 0;

    for (const field of CAIL_PLATFORM_FIELD_NAMES) {
      // SAFETY: each dynamic canary value deliberately violates the event's
      // field-specific type so the runtime privacy boundary is exercised.
      logger.emit("test.canary", { [field]: CANARY } as never);
      expect(events, field).toEqual([]);
      expect(diagnostics, field).toEqual(["event_contract_error"]);
      diagnostics.length = 0;
    }
    for (const hostile of [
      { principal: { type: CANARY } },
      { principal: { type: "user", subject: CANARY } },
      { principal: { type: "anonymous", email: CANARY } },
      {
        trace: {
          trace_id: CANARY,
          span_id: "b7ad6b7169203331",
          trace_flags: 1,
        },
      },
      {
        trace: {
          trace_id: "0af7651916cd43dd8448eb211c80319c",
          span_id: CANARY,
          trace_flags: 1,
        },
      },
      {
        trace: {
          trace_id: "0af7651916cd43dd8448eb211c80319c",
          span_id: "b7ad6b7169203331",
          trace_flags: CANARY,
        },
      },
      { terminal: { outcome: CANARY, reason: "unknown" } },
      { terminal: { outcome: "outcome_unknown", reason: CANARY } },
      {
        usage: {
          kind: "sandbox_compute",
          unit: "mib_milliseconds",
          quantity: CANARY,
        },
      },
      {
        usage: {
          kind: "sandbox_compute",
          unit: "mib_milliseconds",
          quantity: 1,
          note: CANARY,
        },
      },
      { message: CANARY },
      { prompt: CANARY },
      { completion: CANARY },
      { exception: new Error(CANARY) },
    ]) {
      // SAFETY: the hostile fixtures intentionally violate nested field
      // contracts to prove that free text cannot enter an emitted event.
      logger.emit("test.canary", hostile as never);
    }
    // SAFETY: both values intentionally bypass the typed event-name and field
    // contracts to exercise the runtime invalid-event path.
    logger.emit(CANARY as never, {} as never);

    expect(events.map((event) => event.event_name)).toEqual([
      "test.canary", "test.canary", "test.canary", "test.canary",
      "test.canary", "test.canary", "event.invalid",
    ]);
    expect(diagnostics).toEqual([
      ...Array<string>(8).fill("event_contract_error"), "event_invalid",
    ]);

    const output = JSON.stringify(events) + JSON.stringify(diagnostics);
    expect(output).not.toContain(CANARY);
    expect(output).not.toContain("stephen.zweibel");
    expect(output).not.toContain("CANARY-PII");
  });

});
