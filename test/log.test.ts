import { afterEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  Sensitive,
  createCailLogger,
  isSensitive,
  jsonLineSink,
  sensitive,
  workersStructuredSink,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";
const SUBJECT = "cail-0123456789abcdef0123456789abcdef";

function actionFields() {
  return {
    action_id: ACTION_ID,
    product_id: "kale-workbench" as const,
    principal: { type: "anonymous" as const },
  };
}

function capture() {
  const events: CailLogEvent[] = [];
  const diagnostics: string[] = [];
  const logger = createCailLogger({
    service: "workbench",
    release: "local",
    env: "test",
    sourceClass: "platform",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => events.push(event),
    onDiagnostic: (code) => diagnostics.push(code),
  });
  return { diagnostics, events, logger };
}

afterEach(() => vi.restoreAllMocks());

describe("strict field behavior", () => {
  it("drops malformed allowed values instead of weakening the event", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      request_id: "not-a-uuid",
    });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it("drops partial and all-zero trace context", () => {
    for (const fields of [
      { trace: { trace_id: "0".repeat(32), span_id: "1".repeat(16), trace_flags: 1 } },
      { trace: { trace_id: "1".repeat(32) } },
    ]) {
      const { diagnostics, events, logger } = capture();
      logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        ...actionFields(),
        ...fields,
      } as never);
      expect(events).toEqual([]);
      expect(diagnostics).toEqual(["event_contract_error"]);
    }
  });

  it("requires subjects for user and canary principals only", () => {
    const missing = capture();
    missing.logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "user" },
    } as never);
    expect(missing.events).toEqual([]);

    const valid = capture();
    valid.logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "user", subject: SUBJECT },
    });
    expect(valid.events).toHaveLength(1);
  });

  it("contains hostile field getters", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      get request_id(): string { throw new Error("student essay"); },
    });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_dropped"]);
  });
});

describe("explicit sinks and derived severity", () => {
  it("writes a JSON line only when jsonLineSink is selected", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "workbench", release: "local", env: "test",
      sourceClass: "platform", catalog: CAIL_EVENT_CATALOG,
      sink: jsonLineSink,
    });
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, actionFields());
    const line = consoleSpy.mock.calls[0]![0];
    expect(typeof line).toBe("string");
    expect(JSON.parse(line as string)).toMatchObject({
      event_name: CAIL_EVENTS.ACTION_ADMITTED,
    });
  });

  it("routes outcome-derived Workers events by severity", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "workbench", release: "local", env: "test",
      sourceClass: "platform", catalog: CAIL_EVENT_CATALOG,
      sink: workersStructuredSink,
    });
    logger.emit(CAIL_EVENTS.ACTION_TERMINAL, {
      ...actionFields(), terminal: { outcome: "ok", reason: "completed" }, duration_ms: 1,
    });
    logger.emit(CAIL_EVENTS.ACTION_TERMINAL, {
      ...actionFields(), terminal: { outcome: "timeout", reason: "timeout" }, duration_ms: 2,
    });
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ severity_number: 9 });
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({ severity_number: 17 });
  });

  it("contains asynchronously rejecting sinks", async () => {
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "workbench", release: "local", env: "test",
      sourceClass: "platform", catalog: CAIL_EVENT_CATALOG,
      sink: async () => { throw new Error("SECRET"); },
      onDiagnostic: (code) => diagnostics.push(code),
    });
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, actionFields());
    await Promise.resolve();
    await Promise.resolve();
    expect(diagnostics).toEqual(["sink_error"]);
  });
});

describe("Sensitive", () => {
  it("redacts accidental serialization paths and requires deliberate unwrap", () => {
    const secret = sensitive("sk-live-abc123");
    expect(`${secret}`).toBe("[REDACTED]");
    expect(JSON.stringify(secret)).toBe('"[REDACTED]"');
    expect(inspect(secret)).toBe("[REDACTED]");
    expect(secret.value).toBe("sk-live-abc123");
    expect(secret).toBeInstanceOf(Sensitive);
    expect(isSensitive(secret)).toBe(true);
  });

  it("rejects a sensitive wrapper in an allowed field without leaking it", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      request_id: sensitive("secret-request"),
    } as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret-request");
  });
});
