import { describe, expect, it } from "vitest";
import {
  CAIL_PLATFORM_FIELD_NAMES,
  createCailLogger,
  defineEventCatalog,
  type CailLogDiagnosticCode,
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

function capture() {
  const events: CailLogEvent[] = [];
  const diagnostics: CailLogDiagnosticCode[] = [];
  const logger = createCailLogger({
    service: "model-proxy", release: "local", env: "test",
    sourceClass: "platform", subjectVersion: "v1", catalog: EVENTS,
    sink: (event) => { events.push(event); },
    onDiagnostic: (code) => { diagnostics.push(code); },
  });
  return { diagnostics, events, logger };
}

describe("privacy canary", () => {
  it("emits the canary event when no field is set", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit("test.canary");
    expect(events.map((event) => event.event_name)).toEqual(["test.canary"]);
    expect(diagnostics).toEqual([]);
  });

  it.each(CAIL_PLATFORM_FIELD_NAMES)("drops the event when %s carries free text", (field) => {
    const { diagnostics, events, logger } = capture();
    // SAFETY: the canary value deliberately violates the field-specific type so
    // the runtime privacy boundary is exercised.
    logger.emit("test.canary", { [field]: CANARY } as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it.each([
    ["principal type", { principal: { type: CANARY } }],
    ["user subject", { principal: { type: "user", subject: CANARY } }],
    ["trace id", {
      trace: { trace_id: CANARY, span_id: "b7ad6b7169203331", trace_flags: 1 },
    }],
    ["span id", {
      trace: { trace_id: "0af7651916cd43dd8448eb211c80319c", span_id: CANARY, trace_flags: 1 },
    }],
    ["trace flags", {
      trace: {
        trace_id: "0af7651916cd43dd8448eb211c80319c",
        span_id: "b7ad6b7169203331",
        trace_flags: CANARY,
      },
    }],
    ["terminal outcome", { terminal: { outcome: CANARY, reason: "unknown" } }],
    ["terminal reason", { terminal: { outcome: "outcome_unknown", reason: CANARY } }],
    ["usage quantity", {
      usage: { kind: "sandbox_compute", unit: "mib_milliseconds", quantity: CANARY },
    }],
  ])("drops the event when the nested %s carries free text", (_label, fields) => {
    const { diagnostics, events, logger } = capture();
    // SAFETY: the hostile fixture intentionally violates a nested field
    // contract to prove free text cannot enter an emitted event.
    logger.emit("test.canary", fields as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it.each([
    ["an anonymous principal's email", { principal: { type: "anonymous", email: CANARY } }],
    ["a usage note", {
      usage: { kind: "sandbox_compute", unit: "mib_milliseconds", quantity: 1, note: CANARY },
    }],
    ["a message", { message: CANARY }],
    ["an exception", { exception: new Error(CANARY) }],
  ])("emits the event without the free text in %s", (_label, fields) => {
    const { diagnostics, events, logger } = capture();
    // SAFETY: the unknown keys intentionally bypass the field contract to prove
    // they are ignored rather than copied into the event.
    logger.emit("test.canary", fields as never);
    expect(events).toHaveLength(1);
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("CANARY-PII");
  });
});
