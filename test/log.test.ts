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
  type CailLogDiagnosticCode,
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
  const diagnostics: CailLogDiagnosticCode[] = [];
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
  const emptyCatalog = defineEventCatalog({
    "test.empty": {
      source: "tenant",
      severity: "info",
      required: [],
      optional: [],
    },
  });

  it.each([
    ["null", null],
    ["a number", 42],
    ["a string", "content"],
    ["a date", new Date()],
  ])("drops the event when the fields container is %s", (_label, fields) => {
    const events: CailLogEvent[] = [];
    const diagnostics: CailLogDiagnosticCode[] = [];
    const logger = createCailLogger({
      service: "workbench",
      release: "local",
      env: "test",
      sourceClass: "tenant",
      catalog: emptyCatalog,
      sink: (event) => { events.push(event); },
      onDiagnostic: (code) => { diagnostics.push(code); },
    });
    // SAFETY: each non-record fixture intentionally bypasses the fields type
    // to exercise the logger's runtime container rejection.
    logger.emit("test.empty", fields as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
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

  it.each([
    ["an all-zero trace id", { trace_id: "0".repeat(32), span_id: "1".repeat(16), trace_flags: 1 }],
    ["an all-zero span id", { trace_id: "1".repeat(32), span_id: "0".repeat(16), trace_flags: 1 }],
    ["a partial trace", { trace_id: "1".repeat(32) }],
  ])("drops trace context with %s", (_label, trace) => {
    const { diagnostics, events, logger } = capture();
    // SAFETY: the fixtures deliberately provide invalid trace objects so the
    // runtime atomic-trace check is exercised.
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      trace,
    } as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it.each(["user", "canary"] as const)("drops a %s principal without a subject", (type) => {
    const { diagnostics, events, logger } = capture();
    // SAFETY: the identified principal deliberately omits its subject to
    // exercise runtime principal validation.
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      principal: { type },
    } as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it.each(["user", "canary"] as const)("records the subject of a %s principal", (type) => {
    const { events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      principal: { type, subject: SUBJECT },
    });
    expect(events[0]?.attributes).toMatchObject({
      "cail.principal.type": type,
      "enduser.pseudo.id": SUBJECT,
    });
  });

  it.each(["app", "service", "anonymous"] as const)(
    "drops an event whose %s principal carries a subject",
    (type) => {
      const { diagnostics, events, logger } = capture();
      // SAFETY: the unidentified principal deliberately carries a forbidden
      // subject so the runtime discriminated-union guard is exercised.
      logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        ...actionFields(),
        principal: { type, subject: SUBJECT },
      } as never);
      expect(events).toEqual([]);
      expect(diagnostics).toEqual(["event_contract_error"]);
    },
  );

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

  it.each([
    ["upstream_headers_ms", -1],
    ["upstream_headers_ms", Number.NaN],
    ["upstream_headers_ms", Number.POSITIVE_INFINITY],
    ["upstream_first_data_ms", -1],
    ["upstream_first_data_ms", Number.NaN],
    ["upstream_first_data_ms", Number.POSITIVE_INFINITY],
  ] as const)("drops a model call whose %s is %s", (field, value) => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.MODEL_CALL_TERMINAL, {
      call_id: "b47399d2-d0cb-4cb2-a7c0-5a15ced5bace",
      action_id: ACTION_ID,
      product_id: "agent-studio",
      principal: { type: "anonymous" },
      provider: "openai",
      request_model: "gpt-5",
      terminal: { outcome: "ok", reason: "completed" },
      duration_ms: 1,
      [field]: value,
    });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });
});

describe("sink failure", () => {
  it("contains an asynchronously rejecting sink as one sink_error diagnostic", async () => {
    const diagnostics: CailLogDiagnosticCode[] = [];
    let diagnosed: () => void = () => {};
    const diagnosis = new Promise<void>((resolve) => { diagnosed = resolve; });
    const logger = createCailLogger({
      service: "workbench", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: async () => { throw new Error("SECRET"); },
      onDiagnostic: (code) => {
        diagnostics.push(code);
        diagnosed();
      },
    });
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, actionFields());
    await diagnosis;
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

  it("rejects a sensitive wrapper in an allowed field", () => {
    const { diagnostics, events, logger } = capture();
    // SAFETY: the Sensitive wrapper deliberately bypasses request_id's string
    // type to exercise runtime redaction and rejection.
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      ...actionFields(),
      request_id: sensitive("secret-request"),
    } as never);
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });
});
