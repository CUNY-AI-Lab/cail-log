import { afterEach, describe, it, expect, vi } from "vitest";
import {
  correlationFromHeaders,
  outboundCorrelationHeaders,
  TRACEPARENT_HEADER,
  TRACESTATE_HEADER,
  CAIL_REQUEST_ID_HEADER,
  type CailCorrelation,
  type CailHeadersLike,
} from "../src/index.js";

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const PARENT_SPAN = "b7ad6b7169203331";
const TP = `00-${TRACE}-${PARENT_SPAN}-01`;
const RID = "0af7651b-16f9-4a3b-8f42-00f067aa0ba9";
const TS = "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7";

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const GOOD: CailCorrelation = {
  trace_id: TRACE,
  span_id: PARENT_SPAN,
  trace_flags: 1,
  request_id: RID,
};

function withHeaders(entries: Record<string, string>) {
  return new Headers(entries);
}

/** A bare reader: real Headers rejects some malformed values itself. */
function reader(entries: Readonly<Record<string, string>>): CailHeadersLike {
  return { get: (name: string) => entries[name] ?? null };
}

afterEach(() => vi.restoreAllMocks());

// ===========================================================================
// L7 — adopt-or-mint correlation
// ===========================================================================

describe("L7 adopt", () => {
  it("L7a a valid traceparent is ADOPTED: same trace_id, FRESH span for this hop", () => {
    const c = correlationFromHeaders(withHeaders({ traceparent: TP }));
    expect(c.trace_id).toBe(TRACE);
    expect(c.trace_flags).toBe(1);
    expect(c.span_id).toMatch(HEX16);
    expect(c.span_id).not.toBe(PARENT_SPAN);
  });

  it("L7b an existing X-CAIL-Request-Id is adopted VERBATIM (never regenerated)", () => {
    const c = correlationFromHeaders(
      withHeaders({ [CAIL_REQUEST_ID_HEADER]: RID }),
    );
    expect(c.request_id).toBe(RID);
    expect(c.trace_id).toMatch(HEX32);
  });

  it("L7d reads a Request-like { headers } source", () => {
    const requestLike = { headers: withHeaders({ traceparent: TP }) };
    expect(correlationFromHeaders(requestLike).trace_id).toBe(TRACE);
  });

  it("L7d reads a bare { get } header reader", () => {
    const bareReader = reader({ [CAIL_REQUEST_ID_HEADER]: RID });
    expect(correlationFromHeaders(bareReader).request_id).toBe(RID);
  });
});

describe("L7 mint only when genuinely absent", () => {
  it("L7e no headers -> everything minted, well-formed, non-zero", () => {
    const c = correlationFromHeaders(withHeaders({}));
    expect(c.trace_id).toMatch(HEX32);
    expect(c.trace_id).not.toBe("0".repeat(32));
    expect(c.span_id).toMatch(HEX16);
    expect(c.span_id).not.toBe("0".repeat(16));
    expect(c.request_id).toMatch(UUID);
    expect(c.trace_flags).toBe(0);
  });

  it.each([
    { sampled: true, headers: withHeaders({}), flags: 1 },
    { sampled: false, headers: withHeaders({ traceparent: TP }), flags: 0 },
  ])(
    "sets trace_flags $flags from an explicit sampled=$sampled decision",
    ({ sampled, headers, flags }) => {
      const c = correlationFromHeaders(headers, { sampled });
      expect(c.trace_flags).toBe(flags);
    },
  );

  it("reads the sampled option exactly once", () => {
    let reads = 0;
    const changing = correlationFromHeaders(withHeaders({}), {
      get sampled() {
        reads += 1;
        return reads === 1;
      },
    });
    expect(reads).toBe(1);
    expect(changing.trace_flags).toBe(1);
  });

  it("treats a throwing sampled getter as an omitted decision", () => {
    const hostile = correlationFromHeaders(withHeaders({}), {
      get sampled(): never {
        throw new Error("private-sampled-sentinel");
      },
    });
    expect(hostile.trace_flags).toBe(0);
  });

  it("L7f minted ids differ across calls (no fixed fallback id)", () => {
    const a = correlationFromHeaders(withHeaders({}));
    const b = correlationFromHeaders(withHeaders({}));
    expect(a.trace_id).not.toBe(b.trace_id);
    expect(a.span_id).not.toBe(b.span_id);
    expect(a.request_id).not.toBe(b.request_id);
  });

  it("retries an all-zero random identifier until the source yields entropy", () => {
    let calls = 0;
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
      (array) => {
        calls += 1;
        // SAFETY: correlationFromHeaders passes its owned Uint8Array to this
        // mock; the wider Web Crypto signature exposes ArrayBufferView.
        (array as Uint8Array).fill(calls === 1 ? 0 : 1);
        return array;
      },
    );
    const correlation = correlationFromHeaders(withHeaders({}));
    expect(correlation.trace_id).toBe("01".repeat(16));
  });

  it("throws a TypeError when the random source only yields zeros", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
      (array) => {
        // SAFETY: correlationFromHeaders passes its owned Uint8Array to this
        // deliberate all-zero entropy failure.
        (array as Uint8Array).fill(0);
        return array;
      },
    );
    expect(() => correlationFromHeaders(withHeaders({}))).toThrow(TypeError);
  });

  it("L7f2 does not adopt the response-only x-request-id alias", () => {
    const c = correlationFromHeaders(withHeaders({ "x-request-id": RID }));
    expect(c.request_id).not.toBe(RID);
    expect(c.request_id).toMatch(UUID);
  });

  it.each([
    ["an all-zero trace id", `00-${"0".repeat(32)}-${PARENT_SPAN}-01`],
    ["an all-zero parent id", `00-${TRACE}-${"0".repeat(16)}-01`],
    ["the forbidden version ff", `ff-${TRACE}-${PARENT_SPAN}-01`],
    ["a short trace id", `00-${TRACE.slice(0, 31)}-${PARENT_SPAN}-01`],
    ["uppercase hex", `00-${TRACE.toUpperCase()}-${PARENT_SPAN}-01`],
    ["missing flags", `00-${TRACE}-${PARENT_SPAN}`],
    ["a fifth field on version 00", `00-${TRACE}-${PARENT_SPAN}-01-extra`],
    ["non-traceparent text", "not-a-traceparent"],
    ["an empty value", ""],
  ])("L7g mints a fresh trace id for a traceparent with %s", (_label, traceparent) => {
    const c = correlationFromHeaders(withHeaders({ traceparent }));
    expect(c.trace_id).toMatch(HEX32);
    // A minted id is random, so it cannot occur inside the rejected header.
    expect(traceparent.toLowerCase()).not.toContain(c.trace_id);
  });

  it.each(["with spaces", "a".repeat(129), "semi;colon", "новый", "\n"])(
    "L7h mints a request id instead of adopting %j",
    (rid) => {
      const c = correlationFromHeaders(reader({ [CAIL_REQUEST_ID_HEADER]: rid }));
      expect(c.request_id).not.toBe(rid);
      expect(c.request_id).toMatch(UUID);
    },
  );

  it("L7g2 a FUTURE-version traceparent with trailing fields is still adopted (W3C forward compat)", () => {
    const c = correlationFromHeaders(
      withHeaders({ traceparent: `cc-${TRACE}-${PARENT_SPAN}-01-what-future` }),
    );
    expect(c.trace_id).toBe(TRACE);
  });

  it.each([
    { label: "null", source: null },
    { label: "undefined", source: undefined },
    { label: "a number", source: 42 },
    { label: "a string", source: "headers" },
    { label: "an empty object", source: {} },
    { label: "null headers", source: { headers: null } },
    { label: "headers without get", source: { headers: {} } },
    {
      label: "a throwing get",
      source: {
        get() {
          throw new Error("hostile header reader");
        },
      },
    },
    {
      label: "a throwing headers getter",
      source: {
        get headers(): never {
          throw new Error("hostile .headers getter");
        },
      },
    },
    {
      label: "a throwing proxy",
      source: new Proxy(
        {},
        {
          get() {
            throw new Error("hostile proxy trap");
          },
        },
      ),
    },
  ])("L7i treats $label as an empty request", ({ source }) => {
    // SAFETY: malformed reader objects intentionally bypass the public source
    // union to verify that header access fails closed.
    const c = correlationFromHeaders(source as never);
    expect(c.trace_id).toMatch(HEX32);
    expect(c.request_id).toMatch(UUID);
  });

  it("snapshots a request-like headers reader once", () => {
    const first = withHeaders({
      traceparent: TP,
      [CAIL_REQUEST_ID_HEADER]: RID,
    });
    const second = withHeaders({});
    let reads = 0;
    const source = {
      get headers() {
        reads += 1;
        return reads === 1 ? first : second;
      },
    };

    const correlation = correlationFromHeaders(source);

    expect(reads).toBe(1);
    expect(correlation.trace_id).toBe(TRACE);
    expect(correlation.request_id).toBe(RID);
  });
});

// ===========================================================================
// L7 — tracestate: W3C Trace Context §3.3 ("Vendors receiving a tracestate
// request header MUST send it to outgoing requests"). Because this library
// CONTINUES the inbound trace (adopts trace-id), it must carry tracestate
// through — opaquely, never parsed or reordered, never invented.
// ===========================================================================

describe("L7 tracestate forwarding (W3C §3.3)", () => {
  it("L7m inbound tracestate beside a valid traceparent is carried and forwarded VERBATIM", () => {
    const c = correlationFromHeaders(
      withHeaders({ traceparent: TP, tracestate: TS }),
    );
    expect(c.trace_id).toBe(TRACE);
    expect(c.tracestate).toBe(TS);
    const wire = outboundCorrelationHeaders(c);
    expect(wire[TRACESTATE_HEADER]).toBe(TS);
    expect(wire[TRACEPARENT_HEADER]).toBe(`00-${TRACE}-${c.span_id}-01`);
  });

  it("L7n absent inbound tracestate -> none carried, none emitted (never invented)", () => {
    const c = correlationFromHeaders(withHeaders({ traceparent: TP }));
    expect(c.tracestate).toBeUndefined();
    expect(outboundCorrelationHeaders(c)).not.toHaveProperty(
      TRACESTATE_HEADER,
    );
  });

  it.each([
    ["absent", { tracestate: TS }],
    ["version ff", { traceparent: `ff-${TRACE}-${PARENT_SPAN}-01`, tracestate: TS }],
    ["all-zero", { traceparent: `00-${"0".repeat(32)}-${PARENT_SPAN}-01`, tracestate: TS }],
    ["unparseable", { traceparent: "not-a-traceparent", tracestate: TS }],
  ])("L7o drops tracestate when the traceparent is %s", (_label, headers) => {
    const c = correlationFromHeaders(withHeaders(headers));
    expect(c.tracestate).toBeUndefined();
  });

  it.each([
    ["a member without key=value", "no-equals-sign"],
    ["one bad member in the list", "ok=fine,no-equals"],
    ["an empty key", "=value"],
    ["an empty value", "key="],
    ["a C0 control character", "a=b\u0007,c=d"],
    ["a C1 control character", "a=b\u0085c=d"],
    ["U+2028", "k=v "],
    ["a non-ASCII value", "k=нет"],
    ["514 characters", `k=${"v".repeat(512)}`],
    ["33 members", Array.from({ length: 33 }, (_, i) => `k${i}=v`).join(",")],
  ])("L7p drops a tracestate with %s and still adopts the trace", (_label, tracestate) => {
    const c = correlationFromHeaders(reader({ traceparent: TP, tracestate }));
    expect(c.trace_id).toBe(TRACE);
    expect(c.tracestate).toBeUndefined();
  });

  it("drops empty W3C tracestate members", () => {
    const withEmptyMembers = correlationFromHeaders(
      withHeaders({ traceparent: TP, tracestate: "congo=a, ,rojo=b," }),
    );
    expect(withEmptyMembers.tracestate).toBe("congo=a,rojo=b");
  });

  it.each(["", "   ", ", ,"])("omits an entirely empty tracestate %j", (tracestate) => {
    const correlation = correlationFromHeaders(reader({ traceparent: TP, tracestate }));
    expect(correlation.trace_id).toBe(TRACE);
    expect(correlation.tracestate).toBeUndefined();
  });

  it.each([
    // Exactly 512 characters; each value is within its own 256-character limit.
    ["512 characters", `a=${"v".repeat(256)},b=${"v".repeat(251)}`],
    ["32 members", Array.from({ length: 32 }, (_, i) => `k${i}=v`).join(",")],
  ])("L7p2 carries a tracestate at the inclusive %s limit", (_label, tracestate) => {
    const c = correlationFromHeaders(
      withHeaders({ traceparent: TP, tracestate }),
    );
    expect(c.tracestate).toBe(tracestate);
  });

  it("L7q round trip: the NEXT hop receives and re-forwards the same tracestate", () => {
    const first = correlationFromHeaders(
      withHeaders({ traceparent: TP, tracestate: TS }),
    );
    const wire = outboundCorrelationHeaders(first);
    const second = correlationFromHeaders(withHeaders(wire));
    expect(second.trace_id).toBe(first.trace_id);
    expect(second.tracestate).toBe(TS);
    expect(outboundCorrelationHeaders(second)[TRACESTATE_HEADER]).toBe(TS);
  });

  // SAFETY: the numeric tracestate intentionally bypasses the string field
  // contract to exercise outbound runtime validation.
  it.each([
    ["no-equals"],
    ["a=b\u0007"],
    [` ${TS} `],
    [42 as never],
    [Array.from({ length: 33 }, (_, i) => `k${i}=v`).join(",")],
  ])("L7r outbound throws a TypeError for a hand-built tracestate %j", (tracestate) => {
    expect(() => outboundCorrelationHeaders({ ...GOOD, tracestate })).toThrow(
      TypeError,
    );
  });
});

describe("L7 outbound headers", () => {
  it("snapshots every outbound field once", () => {
    const reads = new Map<string, number>();
    const changing = <Value>(name: string, first: Value, later: Value) => {
      const count = (reads.get(name) ?? 0) + 1;
      reads.set(name, count);
      return count === 1 ? first : later;
    };
    const correlation = {
      get trace_id() {
        return changing("trace_id", TRACE, "forged-trace");
      },
      get span_id() {
        return changing("span_id", PARENT_SPAN, "forged-span");
      },
      get trace_flags() {
        return changing("trace_flags", 1 as const, 0 as const);
      },
      get request_id() {
        return changing("request_id", RID, "forged-request");
      },
      get tracestate() {
        return changing("tracestate", undefined, "forged=state");
      },
    };

    expect(outboundCorrelationHeaders(correlation)).toEqual({
      [TRACEPARENT_HEADER]: `00-${TRACE}-${PARENT_SPAN}-01`,
      [CAIL_REQUEST_ID_HEADER]: RID,
    });
    expect(Object.fromEntries(reads)).toEqual({
      trace_id: 1,
      span_id: 1,
      trace_flags: 1,
      request_id: 1,
      tracestate: 1,
    });
  });

  it.each(["trace_id", "span_id", "request_id"] as const)(
    "rejects a coercible %s without invoking its coercion hook",
    (field) => {
      let coercions = 0;
      const coercible = {
        [Symbol.toPrimitive]() {
          coercions += 1;
          return GOOD[field];
        },
      };

      // SAFETY: the coercible object intentionally bypasses CailCorrelation to
      // prove validation never invokes caller-controlled coercion hooks.
      expect(() =>
        outboundCorrelationHeaders({ ...GOOD, [field]: coercible } as never),
      ).toThrow(TypeError);
      expect(coercions).toBe(0);
    },
  );

  it.each([
    {
      label: "a throwing getter",
      correlation: {
        get trace_id(): never {
          throw new Error("private-correlation-sentinel");
        },
      },
    },
    {
      label: "a throwing prototype trap",
      correlation: new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("private-correlation-sentinel");
          },
        },
      ),
    },
  ])("contains $label without echoing its error", ({ correlation }) => {
    let thrown: unknown;
    try {
      // SAFETY: hostile objects intentionally bypass CailCorrelation to prove
      // reflection errors are contained and redacted.
      outboundCorrelationHeaders(correlation as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).not.toContain("private-correlation-sentinel");
  });

  it("L7j outbound traceparent forwards the trace with OUR span as parent-id", () => {
    const c: CailCorrelation = {
      trace_id: TRACE,
      span_id: "1234567890abcdef",
      trace_flags: 0,
      request_id: RID,
    };
    expect(outboundCorrelationHeaders(c)).toEqual({
      [TRACEPARENT_HEADER]: `00-${TRACE}-1234567890abcdef-00`,
      [CAIL_REQUEST_ID_HEADER]: RID,
    });
  });

  it("L7k round trip: the NEXT hop adopts the same trace_id and request_id, new span", () => {
    const first = correlationFromHeaders(withHeaders({ traceparent: TP }));
    const wire = outboundCorrelationHeaders(first);
    const second = correlationFromHeaders(withHeaders(wire));
    expect(second.trace_id).toBe(first.trace_id);
    expect(second.request_id).toBe(first.request_id);
    expect(second.span_id).not.toBe(first.span_id);
  });

  // SAFETY: malformed numeric and missing values intentionally bypass the
  // closed correlation fields so the runtime guard can reject them.
  it.each([
    ["null", null],
    ["an all-zero trace_id", { ...GOOD, trace_id: "0".repeat(32) }],
    ["an uppercase trace_id", { ...GOOD, trace_id: TRACE.toUpperCase() }],
    ["a short trace_id", { ...GOOD, trace_id: "short" }],
    ["an all-zero span_id", { ...GOOD, span_id: "0".repeat(16) }],
    ["a non-hex span_id", { ...GOOD, span_id: "xyz" }],
    ["trace_flags 2", { ...GOOD, trace_flags: 2 as never }],
    ["missing trace_flags", { ...GOOD, trace_flags: undefined as never }],
    ["a request_id with spaces", { ...GOOD, request_id: "has spaces" }],
    ["an empty request_id", { ...GOOD, request_id: "" }],
    ["a missing request_id", { ...GOOD, request_id: undefined as never }],
  ])("L7l outbound throws a TypeError for %s", (_label, correlation) => {
    // SAFETY: every row is deliberately incomplete or malformed and is cast
    // only to exercise outbound runtime validation.
    expect(() => outboundCorrelationHeaders(correlation as CailCorrelation)).toThrow(
      TypeError,
    );
  });
});
