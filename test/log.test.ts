import { afterEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  Sensitive,
  createCailLogger,
  defineEventCatalog,
  isSensitive,
  sensitive,
  workersStructuredSink,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";
const SUBJECT = "cail-v1-0123456789abcdef0123456789abcdef";

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
    subjectVersion: "v1",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => { events.push(event); },
    onDiagnostic: (code) => { diagnostics.push(code); },
  });
  return { diagnostics, events, logger };
}

afterEach(() => vi.restoreAllMocks());

describe("strict field behavior", () => {
  it("drops a malformed fields container even when the event has no required fields", () => {
    const catalog = defineEventCatalog({
      "test.empty": {
        source: "tenant",
        severity: "info",
        required: [],
        optional: [],
      },
    });
    for (const fields of [null, 42, "content", new Date()]) {
      const events: CailLogEvent[] = [];
      const diagnostics: string[] = [];
      const logger = createCailLogger({
        service: "workbench",
        release: "local",
        env: "test",
        sourceClass: "tenant",
        catalog,
        sink: (event) => { events.push(event); },
        onDiagnostic: (code) => { diagnostics.push(code); },
      });
      // SAFETY: each non-record fixture intentionally bypasses the fields type
      // to exercise the logger's runtime container rejection.
      logger.emit("test.empty", fields as never);
      expect(events, Object.prototype.toString.call(fields)).toEqual([]);
      expect(diagnostics, Object.prototype.toString.call(fields)).toEqual([
        "event_contract_error",
      ]);
    }
  });

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
      // SAFETY: the fixtures deliberately provide incomplete trace objects so
      // the runtime atomic-trace check is exercised.
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
    // SAFETY: the identified principal deliberately omits its subject to
    // exercise runtime principal validation.
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

  it("does not evaluate or suppress an event for an unknown hostile getter", () => {
    const { diagnostics, events, logger } = capture();
    let reads = 0;
    // SAFETY: prompt is deliberately outside the event contract to prove that
    // an unknown hostile getter is never inspected.
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      get prompt(): string {
        reads += 1;
        throw new Error("student essay");
      },
    } as never);
    expect(reads).toBe(0);
    expect(events).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });

  it("inspects a fixed field set without enumerating caller-owned keys", () => {
    const { diagnostics, events, logger } = capture();
    const fields = new Proxy(actionFields(), {
      ownKeys() {
        throw new Error("unbounded caller key enumeration");
      },
    });
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, fields);
    expect(events).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });
});

describe("explicit sinks and derived severity", () => {
  it("routes outcome-derived Workers events by severity", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "workbench", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
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
      sourceClass: "platform", subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: async () => { throw new Error("SECRET"); },
      onDiagnostic: (code) => { diagnostics.push(code); },
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
    // SAFETY: the Sensitive wrapper deliberately bypasses request_id's string
    // type to exercise runtime redaction and rejection.
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      request_id: sensitive("secret-request"),
    } as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret-request");
  });
});
