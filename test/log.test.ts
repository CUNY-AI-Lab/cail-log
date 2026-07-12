import { describe, it, expect, vi, afterEach } from "vitest";
import { inspect } from "node:util";
import {
  createCailLogger,
  sensitive,
  isSensitive,
  Sensitive,
  CAIL_EVENTS,
  CAIL_EVENT_INVALID,
  CAIL_SEVERITY_NUMBER,
  redactLogEvent,
  workersStructuredSink,
  type CailLogEvent,
  type CailLogFields,
  type CailLogLevel,
} from "../src/index.js";

/** Fixed clock: 2026-07-11T12:00:00.000Z */
const NOW_MS = Date.UTC(2026, 6, 11, 12, 0, 0);
const NOW_ISO = "2026-07-11T12:00:00.000Z";

function capture(overrides?: { release?: string; env?: string }) {
  const events: CailLogEvent[] = [];
  const logger = createCailLogger({
    service: "model-proxy",
    ...overrides,
    sink: (e) => events.push(e),
    clock: () => NOW_MS,
  });
  return { events, logger };
}

/** The only event a bare `info(event)` may produce — pins the full shape. */
function minimalEvent(over: Partial<CailLogEvent> = {}): CailLogEvent {
  return {
    timestamp: NOW_ISO,
    severity_text: "INFO",
    severity_number: 9,
    event: CAIL_EVENTS.REQUEST_COMPLETED,
    message: "Request completed.",
    service: "model-proxy",
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// L1 — typed allowlist only
// ===========================================================================

describe("L1 typed allowlist", () => {
  it("L1a full allowlist struct survives verbatim (pinned whole-object)", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      subject: "a".repeat(64),
      request_id: "0af7651b-16f9-4a3b-8f42-00f067aa0ba9",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
      release: "eed9cb5",
      env: "prod",
      principal_type: "user",
      key_id: "key_01",
      app: "harness-studio",
      http_method: "POST",
      route: "/v1/run",
      model: "@cf/meta/llama-3.1-8b-instruct",
      status: 200,
      outcome: "ok",
      duration_ms: 412.5,
      upstream_ms: 380,
      error_code: "quota_exceeded",
      retry_count: 1,
      req_bytes: 1024,
      resp_bytes: 2048,
      input_tokens: 250,
      output_tokens: 900,
      quota: { state: "ok", remaining: 7.25, used: 2.75 },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      minimalEvent({
        message: "Request completed. (quota_exceeded)",
        subject: "a".repeat(64),
        request_id: "0af7651b-16f9-4a3b-8f42-00f067aa0ba9",
        trace_id: "0af7651916cd43dd8448eb211c80319c",
        span_id: "b7ad6b7169203331",
        release: "eed9cb5",
        env: "prod",
        principal_type: "user",
        key_id: "key_01",
        app: "harness-studio",
        http_method: "POST",
        route: "/v1/run",
        model: "@cf/meta/llama-3.1-8b-instruct",
        status: 200,
        outcome: "ok",
        duration_ms: 412.5,
        upstream_ms: 380,
        error_code: "quota_exceeded",
        retry_count: 1,
        req_bytes: 1024,
        resp_bytes: 2048,
        input_tokens: 250,
        output_tokens: 900,
        quota: { state: "ok", remaining: 7.25, used: 2.75 },
      }),
    );
  });

  it("L1b unknown keys are dropped, only the allowlist survives", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      status: 200,
      some_random_field: "nope",
      user: { id: 1 },
      nested: { deep: "structure" },
    } as CailLogFields);
    expect(events[0]).toEqual(minimalEvent({ status: 200 }));
  });

  it("L1c wrong-typed values are dropped, not coerced", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      status: "200",
      duration_ms: NaN,
      upstream_ms: Infinity,
      retry_count: "three",
      subject: 42,
      route: ["/v1/run"],
      quota: "full",
    } as unknown as CailLogFields);
    expect(events[0]).toEqual(minimalEvent());
  });

  it("L1d enums are policed exactly", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      principal_type: "admin",
      outcome: "success",
    } as unknown as CailLogFields);
    expect(events[0]).toEqual(minimalEvent());
  });

  it("L1e quota sub-object is held to its own allowlist", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.QUOTA_CHARGED, {
      quota: {
        state: "stale",
        remaining: 1,
        used: 9,
        limit_note: "extra",
        state_reason: "who knows",
      } as never,
    });
    expect(events[0]).toEqual(
      minimalEvent({
        event: CAIL_EVENTS.QUOTA_CHARGED,
        message: "Quota charged.",
        quota: { state: "stale", remaining: 1, used: 9 },
      }),
    );
  });

  it("L1f strings are control-char-stripped and truncated (log-injection defense)", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      route: "/v1/run\n{\"fake\":\"second event\"}\r\x00",
      model: "x".repeat(500),
    });
    expect(events[0]!.route).toBe('/v1/run{"fake":"second event"}');
    expect(events[0]!.model).toBe("x".repeat(256));
  });

  it("L1f2 C1 controls and U+2028/U+2029 are stripped too (NEL / line-separator injection)", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      // NEL (U+0085) and the other C1 controls can split lines in some
      // processors; U+2028/U+2029 are JS/ES line terminators (OWASP log-injection).
      route: '/v1/run\u0085{"fake":"nel event"}\u2028second\u2029\u0080\u009f',
      model: "m\u008dodel",
    });
    expect(events[0]!.route).toBe('/v1/run{"fake":"nel event"}second');
    expect(events[0]!.model).toBe("model");
  });

  it("L1j shape-known fields enforce their shape or drop (review M2)", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      http_method: "post", // must be uppercase
      app: "Not A Slug!!",
      trace_id: "not-hex",
      span_id: "b7ad6b71692033", // 14 chars, too short
      request_id: "has spaces in it",
    });
    expect(events[0]).toEqual(minimalEvent());

    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      http_method: "POST",
      app: "harness-studio",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
      request_id: "req-123.ABC",
    });
    expect(events[1]).toEqual(
      minimalEvent({
        http_method: "POST",
        app: "harness-studio",
        trace_id: "0af7651916cd43dd8448eb211c80319c",
        span_id: "b7ad6b7169203331",
        request_id: "req-123.ABC",
      }),
    );
  });

  it("L1k a throwing getter as a field value drops the WHOLE event, never throws", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { events, logger } = capture();
    expect(() =>
      logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
        get route(): string {
          throw new Error("hostile getter with PII: student essay text");
        },
        status: 200,
      }),
    ).not.toThrow();
    expect(events).toHaveLength(0);
    expect(err.mock.calls).toEqual([
      ["cail-log: emit failed; event dropped"],
    ]);
  });

  it("L1g constructor-bound service/release/env apply; valid per-call override wins", () => {
    const { events, logger } = capture({ release: "abc1234", env: "staging" });
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED);
    expect(events[0]!.service).toBe("model-proxy");
    expect(events[0]!.release).toBe("abc1234");
    expect(events[0]!.env).toBe("staging");

    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      service: "key-service",
      env: "prod",
    });
    expect(events[1]!.service).toBe("key-service");
    expect(events[1]!.env).toBe("prod");

    // An INVALID service override falls back to the constructor value.
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      service: "Not A Slug!!",
    });
    expect(events[2]!.service).toBe("model-proxy");
  });

  it("L1h hostile fields objects cannot pollute prototypes or smuggle keys", () => {
    const { events, logger } = capture();
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor":"x","status":204}',
    ) as CailLogFields;
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, hostile);
    expect(events[0]).toEqual(minimalEvent({ status: 204 }));
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(JSON.stringify(events[0])).not.toContain("polluted");
  });

  it("L1i non-object fields (null, string, array) behave as no fields", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, null as never);
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, "free text?" as never);
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, [1, 2, 3] as never);
    for (const e of events) expect(e).toEqual(minimalEvent());
  });
});

// ===========================================================================
// L2 — no caller-supplied free text
// ===========================================================================

describe("L2 no free text", () => {
  it("L2a message is the static library text for every standard event", () => {
    const { events, logger } = capture();
    const expected: Record<string, string> = {
      [CAIL_EVENTS.REQUEST_RECEIVED]: "Request received.",
      [CAIL_EVENTS.REQUEST_COMPLETED]: "Request completed.",
      [CAIL_EVENTS.AUTH_DENIED]: "Authentication or authorization denied.",
      [CAIL_EVENTS.QUOTA_CHARGED]: "Quota charged.",
      [CAIL_EVENTS.UPSTREAM_ERROR]: "Upstream provider call failed.",
    };
    for (const name of Object.values(CAIL_EVENTS)) logger.info(name);
    events.forEach((e) => {
      expect(e.message).toBe(expected[e.event]);
    });
  });

  it("L2b an unknown-but-valid slug keeps the event, message stays generic (never echoed)", () => {
    const { events, logger } = capture();
    logger.info("workspace.created");
    expect(events[0]!.event).toBe("workspace.created");
    expect(events[0]!.message).toBe("Event recorded.");
  });

  it("L2c a free-text event name is replaced with event.invalid and never emitted", () => {
    const { events, logger } = capture();
    const attempts = [
      "user asked: how do I hide a body",
      "PROMPT",
      "Sensitive Data Here",
      "",
      "a".repeat(65),
      42 as never,
      null as never,
    ];
    for (const a of attempts) logger.info(a);
    for (const [i, e] of events.entries()) {
      expect(e.event, `attempt ${i}`).toBe(CAIL_EVENT_INVALID);
      expect(e.message).toBe("Event name rejected: not a valid event slug.");
      expect(JSON.stringify(e)).not.toContain("how do I hide a body");
    }
  });

  it("L2e prototype-chain event names cannot escape the message table (review B1)", () => {
    const { events, logger } = capture();
    // "constructor" is the one all-lowercase Object.prototype key that passes
    // the slug gate; a plain [event] lookup would return the Object
    // constructor FUNCTION as the message.
    logger.info("constructor");
    expect(events[0]!.event).toBe("constructor");
    expect(events[0]!.message).toBe("Event recorded.");
    expect(typeof events[0]!.message).toBe("string");

    logger.error("constructor", { error_code: "boom" });
    expect(events[1]!.message).toBe("Event recorded. (boom)");

    logger.info("__proto__"); // fails the slug gate (leading underscore)
    expect(events[2]!.event).toBe(CAIL_EVENT_INVALID);

    // Every emitted message must be a plain string that JSON round-trips.
    for (const e of events) {
      expect(JSON.parse(JSON.stringify(e)).message).toBe(e.message);
    }
  });

  it("L2d error_code decorates the derived message only when it is a valid slug", () => {
    const { events, logger } = capture();
    logger.error(CAIL_EVENTS.UPSTREAM_ERROR, { error_code: "upstream_5xx" });
    expect(events[0]!.message).toBe(
      "Upstream provider call failed. (upstream_5xx)",
    );
    logger.error(CAIL_EVENTS.UPSTREAM_ERROR, {
      error_code: "the user's prompt was rejected!!",
    });
    expect(events[1]!.message).toBe("Upstream provider call failed.");
    expect(events[1]!.error_code).toBeUndefined();
  });
});

// ===========================================================================
// L3 — severity mapping
// ===========================================================================

describe("L3 severity", () => {
  it("L3a level maps to OTel severity_number and uppercase severity_text", () => {
    const { events, logger } = capture();
    const table: Array<[CailLogLevel, number]> = [
      ["trace", 1],
      ["debug", 5],
      ["info", 9],
      ["warn", 13],
      ["error", 17],
      ["fatal", 21],
    ];
    for (const [level] of table) logger[level](CAIL_EVENTS.REQUEST_COMPLETED);
    table.forEach(([level, num], i) => {
      expect(events[i]!.severity_number).toBe(num);
      expect(events[i]!.severity_text).toBe(level.toUpperCase());
      expect(CAIL_SEVERITY_NUMBER[level]).toBe(num);
    });
    expect(events[4]!.severity_number).toBeGreaterThanOrEqual(17);
    expect(events[5]!.severity_number).toBeGreaterThanOrEqual(17);
  });

  it("L3b log(level, …) honors the level; fatal is a first-class band (OTel FATAL=21)", () => {
    const { events, logger } = capture();
    logger.log("warn", CAIL_EVENTS.REQUEST_COMPLETED);
    expect(events[0]!.severity_number).toBe(13);
    logger.log("fatal", CAIL_EVENTS.REQUEST_COMPLETED);
    expect(events[1]!.severity_number).toBe(21);
    expect(events[1]!.severity_text).toBe("FATAL");
  });

  it("L3c an UNKNOWN level coerces to the HIGHEST severity, never silently downgrades", () => {
    // Fail-closed: a miscategorized failure must never be hidden below the
    // `severity_number >= 17` failure filter (OTel severity bands).
    const { events, logger } = capture();
    for (const bogus of ["critical", "verbose", "", 42, null]) {
      logger.log(bogus as CailLogLevel, CAIL_EVENTS.REQUEST_COMPLETED);
    }
    for (const [i, e] of events.entries()) {
      expect(e.severity_number, `level attempt ${i}`).toBe(21);
      expect(e.severity_text).toBe("FATAL");
    }
    // The bogus level name itself is never echoed into the event.
    expect(JSON.stringify(events)).not.toContain("critical");
    expect(JSON.stringify(events)).not.toContain("verbose");
  });
});

// ===========================================================================
// L4 — one wide event per call, injectable sink + clock, never throws
// ===========================================================================

describe("L4 one wide event, injectable sink/clock", () => {
  it("L4a each call emits exactly one event object to the sink", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_RECEIVED);
    logger.error(CAIL_EVENTS.UPSTREAM_ERROR);
    expect(events).toHaveLength(2);
  });

  it("L4b timestamp is ISO-8601 UTC from the injected clock", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED);
    expect(events[0]!.timestamp).toBe(NOW_ISO);
  });

  it("L4c absent optional fields are OMITTED (clean keys for indexing)", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, { status: 200 });
    expect(Object.keys(events[0]!).sort()).toEqual([
      "event",
      "message",
      "service",
      "severity_number",
      "severity_text",
      "status",
      "timestamp",
    ]);
  });

  it("L4d default sink writes one portable NDJSON line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "model-proxy",
      clock: () => NOW_MS,
    });
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, { status: 200 });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    expect(typeof line).toBe("string");
    expect(JSON.parse(line)).toEqual(minimalEvent({ status: 200 }));
  });

  it("L4d2 Workers sink emits structured objects through native severity methods", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "model-proxy",
      sink: workersStructuredSink,
      clock: () => NOW_MS,
    });
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, { status: 200 });
    logger.warn(CAIL_EVENTS.REQUEST_COMPLETED, { status: 429 });
    logger.error(CAIL_EVENTS.UPSTREAM_ERROR, { status: 502 });

    expect(logSpy.mock.calls).toEqual([
      [minimalEvent({ status: 200 })],
    ]);
    expect(warnSpy.mock.calls).toEqual([
      [
        minimalEvent({
          severity_number: 13,
          severity_text: "WARN",
          status: 429,
        }),
      ],
    ]);
    expect(errorSpy.mock.calls).toEqual([
      [
        minimalEvent({
          event: CAIL_EVENTS.UPSTREAM_ERROR,
          message: "Upstream provider call failed.",
          severity_number: 17,
          severity_text: "ERROR",
          status: 502,
        }),
      ],
    ]);
  });

  it("L4e a throwing sink is contained — the logger never throws", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "model-proxy",
      sink: () => {
        throw new Error("sink exploded: SECRET-IN-ERROR");
      },
      clock: () => NOW_MS,
    });
    expect(() => logger.info(CAIL_EVENTS.REQUEST_COMPLETED)).not.toThrow();
    expect(err).toHaveBeenCalledTimes(1);
    // Fixed string only — the sink's error content is never interpolated.
    expect(err.mock.calls[0]).toEqual(["cail-log: emit failed; event dropped"]);
  });

  it("L4f a broken clock falls back to real time instead of throwing", () => {
    const events: CailLogEvent[] = [];
    for (const clock of [() => NaN, () => {
      throw new Error("no clock");
    }]) {
      const logger = createCailLogger({
        service: "model-proxy",
        sink: (e) => events.push(e),
        clock,
      });
      expect(() => logger.info(CAIL_EVENTS.REQUEST_COMPLETED)).not.toThrow();
    }
    for (const e of events) {
      expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false);
    }
  });

  it("L4g construction fails LOUD on invalid config", () => {
    expect(() => createCailLogger({ service: "" })).toThrow(TypeError);
    expect(() => createCailLogger({ service: "Has Spaces" })).toThrow(
      TypeError,
    );
    expect(() =>
      createCailLogger({ service: 42 as unknown as string }),
    ).toThrow(TypeError);
    expect(() =>
      createCailLogger({ service: "ok", sink: "nope" as never }),
    ).toThrow(TypeError);
    expect(() =>
      createCailLogger({ service: "ok", clock: "nope" as never }),
    ).toThrow(TypeError);
    expect(() => createCailLogger(null as never)).toThrow(TypeError);
  });
});

// ===========================================================================
// L5 — Sensitive<T>
// ===========================================================================

describe("L5 Sensitive", () => {
  const SECRET = "sk-live-abc123";

  it("L5a every serialization path yields [REDACTED]", () => {
    const s = sensitive(SECRET);
    expect(`${s}`).toBe("[REDACTED]");
    expect(String(s)).toBe("[REDACTED]");
    expect(s.toString()).toBe("[REDACTED]");
    expect(JSON.stringify(s)).toBe('"[REDACTED]"');
    expect(JSON.stringify({ auth: s })).toBe('{"auth":"[REDACTED]"}');
    expect(inspect(s)).toBe("[REDACTED]");
    expect(`Bearer ${s}`).toBe("Bearer [REDACTED]");
  });

  it("L5b the one documented gap: .value deliberately unwraps", () => {
    const s = sensitive(SECRET);
    expect(s.value).toBe(SECRET);
    expect(isSensitive(s)).toBe(true);
    expect(isSensitive(SECRET)).toBe(false);
    expect(s).toBeInstanceOf(Sensitive);
  });

  it("L5c a Sensitive smuggled into a log field masks (strings) or drops (numbers)", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      subject: sensitive(SECRET),
      status: sensitive(200),
      quota: { state: sensitive("ok"), used: 1 },
    } as unknown as CailLogFields);
    expect(events[0]!.subject).toBe("[REDACTED]");
    expect(events[0]!.status).toBeUndefined();
    expect(events[0]!.quota).toEqual({ used: 1 });
    expect(JSON.stringify(events[0])).not.toContain(SECRET);
  });

  it("L5d the wrapper hides the value from keys/spread/stringify of itself", () => {
    const s = sensitive(SECRET);
    expect(Object.keys(s)).toEqual([]);
    expect(JSON.stringify({ ...s })).toBe("{}");
  });
});

// ===========================================================================
// L6 — defense-in-depth denylist
// ===========================================================================

describe("L6 denylist", () => {
  it("L6a denylisted keys smuggled past the types never reach the emitted event", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      authorization: "Bearer sk-live-xyz",
      cookie: "cail_session=abc",
      prompt: "the user's essay",
      email: "student@gc.cuny.edu",
    } as unknown as CailLogFields);
    // Through the typed path they are dropped ENTIRELY (the allowlist builder
    // never copies them); the redactLogEvent sweep behind it is pinned by L6f.
    const e = events[0] as unknown as Record<string, unknown>;
    expect(e["authorization"]).toBeUndefined();
    expect(e["cookie"]).toBeUndefined();
    expect(e["prompt"]).toBeUndefined();
    expect(e["email"]).toBeUndefined();
    const json = JSON.stringify(events[0]);
    for (const leak of [
      "sk-live-xyz",
      "cail_session",
      "essay",
      "student@gc.cuny.edu",
    ]) {
      expect(json).not.toContain(leak);
    }
  });

  it("L6b matching is case-insensitive and treats _ and - as equivalent", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      API_KEY: "k1",
      "Set-Cookie": "c1",
      set_cookie: "c2",
      Email: "e@x.y",
      GIVEN_NAME: "Ada",
      "family-name": "Lovelace",
    } as unknown as CailLogFields);
    const json = JSON.stringify(events[0]);
    for (const leak of ["k1", "c1", "c2", "e@x.y", "Ada", "Lovelace"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("L6c x-cail-* header keys are denied except the two allowlisted carriers", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      "x-cail-identity-jwt": "eyJhbGciOi...",
      "X-CAIL-Email": "e@x.y",
      "x-cail-quota-remaining": "5",
    } as unknown as CailLogFields);
    const json = JSON.stringify(events[0]);
    expect(json).not.toContain("eyJhbGciOi");
    expect(json).not.toContain("e@x.y");
  });

  it("L6d exact-key matching: input_tokens/output_tokens are NOT collateral damage", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      input_tokens: 100,
      output_tokens: 200,
      retry_count: 2,
    });
    expect(events[0]!.input_tokens).toBe(100);
    expect(events[0]!.output_tokens).toBe(200);
    expect(events[0]!.retry_count).toBe(2);
  });

  it("L6f the redactLogEvent sweep itself: masks denied keys, drops unknowns, polices quota", () => {
    // The drift/raw-object net, applied automatically before every sink call
    // and exported for raw pipelines. Feed it a raw object directly.
    const raw: Record<string, unknown> = {
      event: "request.completed",
      status: 200,
      authorization: "Bearer sk-live-xyz", // denied -> masked
      API_KEY: "k1", // denied (case/sep-insensitive) -> masked
      "x-cail-identity-jwt": "eyJhbGciOi", // denied x-cail-* -> masked
      "x-cail-subject": "hmac-ok", // deny-exempt carrier, but not an event key -> dropped, never masked
      unknown_extra: "dropped", // not on the event allowlist -> dropped
      subject: sensitive("wrapped-secret"), // Sensitive anywhere -> masked
      quota: {
        state: "ok",
        note: "dropped too", // unknown quota key -> dropped
        token: "masked too", // denied quota key -> masked
        used: sensitive(9), // Sensitive in quota -> masked
      },
    };
    const out = redactLogEvent(raw);
    expect(out).toEqual({
      event: "request.completed",
      status: 200,
      authorization: "[REDACTED]",
      API_KEY: "[REDACTED]",
      "x-cail-identity-jwt": "[REDACTED]",
      subject: "[REDACTED]",
      quota: { state: "ok", token: "[REDACTED]", used: "[REDACTED]" },
    });
    const json = JSON.stringify(out);
    for (const leak of [
      "sk-live-xyz",
      "k1",
      "eyJhbGciOi",
      "dropped",
      "wrapped-secret",
    ]) {
      expect(json).not.toContain(leak);
    }
  });

  it("L6g redactLogEvent polices VALUES too — no content smuggled under safe keys (review B2)", () => {
    const out = redactLogEvent({
      event: "request.completed",
      quota_array: undefined, // placeholder key ordering guard (dropped)
      quota: ["USER PROMPT LEAK", { messages: ["hi"] }], // array -> dropped whole
      route: { messages: [{ content: "SECRET ESSAY" }] }, // object under string key -> dropped
      model: "m".repeat(3000), // oversized -> truncated to 256
      trace_id: "not-hex-at-all", // shape-enforced -> dropped
      http_method: "post", // shape-enforced -> dropped
      status: "200", // wrong type -> dropped
      severity_number: "17", // wrong type -> dropped
      message: "ok\nline2", // control chars stripped
      duration_ms: 5,
    });
    expect(out).toEqual({
      event: "request.completed",
      model: "m".repeat(256),
      message: "okline2",
      duration_ms: 5,
    });

    const nested = redactLogEvent({
      quota: { used: { deep: "HIDDEN SECRET" }, state: "ok" },
    });
    expect(nested).toEqual({ quota: { state: "ok" } });

    const json = JSON.stringify(out) + JSON.stringify(nested);
    for (const leak of ["USER PROMPT LEAK", "SECRET ESSAY", "HIDDEN SECRET"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("L6e bare content-bearing keys (input/output/messages/content/body/sub) never pass", () => {
    const { events, logger } = capture();
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      input: "write my paper",
      output: "here is your paper",
      messages: [{ role: "user", content: "hello" }],
      content: "raw content",
      body: '{"whole":"request"}',
      sub: "raw-oidc-sub@login.cuny.edu",
    } as unknown as CailLogFields);
    const json = JSON.stringify(events[0]);
    for (const leak of [
      "write my paper",
      "here is your paper",
      "hello",
      "raw content",
      "whole",
      "raw-oidc-sub",
    ]) {
      expect(json).not.toContain(leak);
    }
  });
});
