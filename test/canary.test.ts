import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => vi.restoreAllMocks());

describe("privacy canary", () => {
  it("cannot use runtime fields, event names, or unknown keys as free text", () => {
    const events: CailLogEvent[] = [];
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "model-proxy", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1", catalog: EVENTS,
      sink: (event) => events.push(event),
      onDiagnostic: (code) => diagnostics.push(code),
    });

    for (const field of CAIL_PLATFORM_FIELD_NAMES) {
      logger.emit("test.canary", { [field]: CANARY } as never);
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
        quota: {
          kind: "request_count",
          unit: "requests",
          state: "fresh",
          limit: 10,
          used: 1,
          reset_at: CANARY,
        },
      },
      {
        quota: {
          kind: "request_count",
          unit: "requests",
          state: "fresh",
          limit: 10,
          used: 1,
          reset_at: "2026-08-01T00:00:00.000Z",
          note: CANARY,
        },
      },
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
      logger.emit("test.canary", hostile as never);
    }
    logger.emit(CANARY as never, {} as never);

    const output = JSON.stringify(events) + JSON.stringify(diagnostics);
    expect(output).not.toContain(CANARY);
    expect(output).not.toContain("stephen.zweibel");
    expect(output).not.toContain("CANARY-PII");
  });

  it("never exposes sink or diagnostic exception content", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "model-proxy", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1", catalog: EVENTS,
      sink: () => { throw new Error(CANARY); },
      onDiagnostic: () => { throw new Error(CANARY); },
    });
    logger.emit("test.canary");
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(CANARY);
  });
});
