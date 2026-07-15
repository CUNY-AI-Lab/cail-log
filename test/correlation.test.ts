import { describe, it, expect, vi } from "vitest";
import {
  correlationFromHeaders,
  outboundCorrelationHeaders,
  TRACEPARENT_HEADER,
  TRACESTATE_HEADER,
  CAIL_REQUEST_ID_HEADER,
  type CailCorrelation,
} from "../src/index.js";

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const PARENT_SPAN = "b7ad6b7169203331";
const TP = `00-${TRACE}-${PARENT_SPAN}-01`;
const RID = "0af7651b-16f9-4a3b-8f42-00f067aa0ba9";

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function withHeaders(entries: Record<string, string>) {
  return new Headers(entries);
}

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
    // request_id was absent -> minted UUID.
    expect(c.request_id).toMatch(UUID);
  });

  it("L7b an existing X-CAIL-Request-Id is adopted VERBATIM (never regenerated)", () => {
    const c = correlationFromHeaders(
      withHeaders({ [CAIL_REQUEST_ID_HEADER]: RID }),
    );
    expect(c.request_id).toBe(RID);
    expect(c.trace_id).toMatch(HEX32);
  });

  it("L7c both present -> both adopted together", () => {
    const c = correlationFromHeaders(
      withHeaders({ traceparent: TP, [CAIL_REQUEST_ID_HEADER]: RID }),
    );
    expect(c.trace_id).toBe(TRACE);
    expect(c.request_id).toBe(RID);
  });

  it("L7d works on a Request-like { headers } and a bare { get } reader", () => {
    const requestLike = { headers: withHeaders({ traceparent: TP }) };
    expect(correlationFromHeaders(requestLike).trace_id).toBe(TRACE);

    const bareReader = {
      get: (name: string) =>
        name === CAIL_REQUEST_ID_HEADER ? RID : null,
    };
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

  it("uses an explicit local recording decision when provided", () => {
    const sampled = correlationFromHeaders(withHeaders({}), { sampled: true });
    const notSampled = correlationFromHeaders(
      withHeaders({ traceparent: TP }),
      { sampled: false },
    );
    expect(sampled.trace_flags).toBe(1);
    expect(notSampled.trace_flags).toBe(0);
    expect(outboundCorrelationHeaders(sampled)[TRACEPARENT_HEADER]).toMatch(
      /-01$/,
    );
    expect(
      outboundCorrelationHeaders(notSampled)[TRACEPARENT_HEADER],
    ).toMatch(/-00$/);
  });

  it("L7f minted ids differ across calls (no fixed fallback id)", () => {
    const a = correlationFromHeaders(withHeaders({}));
    const b = correlationFromHeaders(withHeaders({}));
    expect(a.trace_id).not.toBe(b.trace_id);
    expect(a.span_id).not.toBe(b.span_id);
    expect(a.request_id).not.toBe(b.request_id);
  });

  it("retries all-zero random identifiers and fails boundedly on entropy failure", () => {
    let calls = 0;
    const random = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation((array) => {
        calls += 1;
        const bytes = array as Uint8Array;
        bytes.fill(calls === 1 ? 0 : 1);
        return array;
      });
    const correlation = correlationFromHeaders(withHeaders({}));
    expect(correlation.trace_id).not.toBe("0".repeat(32));
    expect(correlation.span_id).not.toBe("0".repeat(16));

    random.mockImplementation((array) => {
      (array as Uint8Array).fill(0);
      return array;
    });
    expect(() => correlationFromHeaders(withHeaders({}))).toThrow(TypeError);
    random.mockRestore();
  });

  it("L7f2 does not adopt the response-only x-request-id compatibility alias", () => {
    const c = correlationFromHeaders(withHeaders({ "x-request-id": RID }));
    expect(c.request_id).not.toBe(RID);
    expect(c.request_id).toMatch(UUID);
  });

  it("L7g malformed traceparent variants are treated as absent (minted instead)", () => {
    const bad = [
      `00-${"0".repeat(32)}-${PARENT_SPAN}-01`, // all-zero trace id
      `00-${TRACE}-${"0".repeat(16)}-01`, // all-zero parent id
      `ff-${TRACE}-${PARENT_SPAN}-01`, // forbidden version ff
      `00-${TRACE.slice(0, 31)}-${PARENT_SPAN}-01`, // short trace id
      `00-${TRACE.toUpperCase()}-${PARENT_SPAN}-01`, // uppercase hex (W3C: lowercase)
      `00-${TRACE}-${PARENT_SPAN}`, // missing flags
      `00-${TRACE}-${PARENT_SPAN}-01-extra`, // version 00 has EXACTLY 4 fields
      "not-a-traceparent",
      "",
    ];
    for (const tp of bad) {
      const c = correlationFromHeaders(withHeaders({ traceparent: tp }));
      expect(c.trace_id, `traceparent ${JSON.stringify(tp)}`).not.toBe(TRACE);
      expect(c.trace_id).toMatch(HEX32);
    }
  });

  it("L7h malformed request ids are treated as absent (minted instead)", () => {
    // A bare reader, not `Headers`: real Headers rejects some of these values
    // itself, and the helper must be robust to ANY reader implementation.
    const bad = ["with spaces", "a".repeat(129), "semi;colon", "новый", "\n"];
    for (const rid of bad) {
      const c = correlationFromHeaders({
        get: (name: string) => (name === CAIL_REQUEST_ID_HEADER ? rid : null),
      });
      expect(c.request_id, `rid ${JSON.stringify(rid)}`).not.toBe(rid);
      expect(c.request_id).toMatch(UUID);
    }
  });

  it("L7g2 a FUTURE-version traceparent with trailing fields is still adopted (W3C forward compat)", () => {
    const c = correlationFromHeaders(
      withHeaders({ traceparent: `cc-${TRACE}-${PARENT_SPAN}-01-what-future` }),
    );
    expect(c.trace_id).toBe(TRACE);
  });

  it("L7i never throws: garbage sources behave like an empty request", () => {
    const sources = [
      null,
      undefined,
      42,
      "headers",
      {},
      { headers: null },
      { headers: {} },
      {
        get() {
          throw new Error("hostile header reader");
        },
      },
      // Property access itself may be hostile.
      {
        get headers(): never {
          throw new Error("hostile .headers getter");
        },
      },
      new Proxy(
        {},
        {
          get() {
            throw new Error("hostile proxy trap");
          },
        },
      ),
    ];
    for (const s of sources) {
      const c = correlationFromHeaders(s as never);
      expect(c.trace_id).toMatch(HEX32);
      expect(c.request_id).toMatch(UUID);
    }
  });
});

// ===========================================================================
// L7 — tracestate: W3C Trace Context §3.3 ("Vendors receiving a tracestate
// request header MUST send it to outgoing requests"). Because this library
// CONTINUES the inbound trace (adopts trace-id), it must carry tracestate
// through — opaquely, never parsed or reordered, never invented.
// ===========================================================================

describe("L7 tracestate forwarding (W3C §3.3)", () => {
  const TS = "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7";

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
    // Fully-minted correlation (no inbound headers at all): same.
    const minted = correlationFromHeaders(withHeaders({}));
    expect(minted.tracestate).toBeUndefined();
    expect(outboundCorrelationHeaders(minted)).not.toHaveProperty(
      TRACESTATE_HEADER,
    );
  });

  it("L7o tracestate is DROPPED when the traceparent is absent or invalid (spec: must not use it)", () => {
    const noTrace: Array<Record<string, string>> = [
      { tracestate: TS }, // no traceparent at all
      { traceparent: `ff-${TRACE}-${PARENT_SPAN}-01`, tracestate: TS },
      { traceparent: `00-${"0".repeat(32)}-${PARENT_SPAN}-01`, tracestate: TS },
      { traceparent: "not-a-traceparent", tracestate: TS },
    ];
    for (const headers of noTrace) {
      const c = correlationFromHeaders(withHeaders(headers));
      expect(c.tracestate, JSON.stringify(headers)).toBeUndefined();
      expect(c.trace_id).not.toBe(TRACE); // minted fresh
    }
  });

  it("L7p malformed tracestate is dropped FAIL-CLOSED; the trace itself is still adopted", () => {
    const bad = [
      "no-equals-sign", // member without key=value shape
      "ok=fine,no-equals", // one bad member spoils the (opaque) list
      "=value", // empty key
      "key=", // empty value
      "a=b\u0007,c=d", // control char (C0)
      "a=b\u0085c=d", // control char (C1 NEL)
      "k=v\u2028", // U+2028 line separator (non-ASCII)
      "k=нет", // non-ASCII value
      `k=${"v".repeat(512)}`, // 514 chars total: over the 512-char guidance
      Array.from({ length: 33 }, (_, i) => `k${i}=v`).join(","), // 33 members > 32
    ];
    for (const ts of bad) {
      // A bare reader, not `Headers`: real Headers rejects some of these
      // values itself (non-ByteString), and the helper must be robust to
      // ANY reader implementation.
      const c = correlationFromHeaders({
        get: (name: string) =>
          name === TRACEPARENT_HEADER
            ? TP
            : name === TRACESTATE_HEADER
              ? ts
              : null,
      });
      expect(c.trace_id, `tracestate ${JSON.stringify(ts)}`).toBe(TRACE);
      expect(c.tracestate, `tracestate ${JSON.stringify(ts)}`).toBeUndefined();
      expect(outboundCorrelationHeaders(c)).not.toHaveProperty(
        TRACESTATE_HEADER,
      );
    }
  });

  it("accepts W3C empty members and omits an entirely empty tracestate", () => {
    const withEmptyMembers = correlationFromHeaders(
      withHeaders({ traceparent: TP, tracestate: "congo=a, ,rojo=b," }),
    );
    expect(withEmptyMembers.tracestate).toBe("congo=a,rojo=b");

    for (const tracestate of ["", "   ", ", ,"]) {
      const correlation = correlationFromHeaders({
        get: (name: string) =>
          name === TRACEPARENT_HEADER
            ? TP
            : name === TRACESTATE_HEADER
              ? tracestate
              : null,
      });
      expect(correlation.trace_id).toBe(TRACE);
      expect(correlation.tracestate).toBeUndefined();
    }
  });

  it("L7p2 the 512-char / 32-member spec limits are inclusive (boundary values pass)", () => {
    const maxLen = `a=${"v".repeat(256)},b=${"v".repeat(251)}`; // exactly 512 chars; each value is within its own 256-char limit
    const maxMembers = Array.from({ length: 32 }, (_, i) => `k${i}=v`).join(
      ",",
    ); // exactly 32 members
    for (const ts of [maxLen, maxMembers]) {
      const c = correlationFromHeaders(
        withHeaders({ traceparent: TP, tracestate: ts }),
      );
      expect(c.tracestate).toBe(ts);
    }
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

  it("L7r outbound fails LOUD (TypeError) on a hand-built malformed tracestate", () => {
    const good: CailCorrelation = {
      trace_id: TRACE,
      span_id: PARENT_SPAN,
      trace_flags: 1,
      request_id: RID,
    };
    const bad = [
      "no-equals",
      "a=b",
      ` ${TS} `, // not exact: surrounding whitespace
      42 as never,
      Array.from({ length: 33 }, (_, i) => `k${i}=v`).join(","),
    ];
    for (const ts of bad) {
      expect(
        () => outboundCorrelationHeaders({ ...good, tracestate: ts }),
        JSON.stringify(ts),
      ).toThrow(TypeError);
    }
    expect(() =>
      outboundCorrelationHeaders({ ...good, tracestate: TS }),
    ).not.toThrow();
  });
});

describe("L7 outbound headers", () => {
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
    expect(outboundCorrelationHeaders(c)).not.toHaveProperty("x-request-id");
  });

  it("L7k round trip: the NEXT hop adopts the same trace_id and request_id, new span", () => {
    const first = correlationFromHeaders(withHeaders({ traceparent: TP }));
    const wire = outboundCorrelationHeaders(first);
    const second = correlationFromHeaders(withHeaders(wire));
    expect(second.trace_id).toBe(first.trace_id);
    expect(second.request_id).toBe(first.request_id);
    expect(second.span_id).not.toBe(first.span_id);
  });

  it("L7l outbound fails LOUD (TypeError) on malformed correlation", () => {
    const good: CailCorrelation = {
      trace_id: TRACE,
      span_id: PARENT_SPAN,
      trace_flags: 1,
      request_id: RID,
    };
    const bad: Array<Partial<CailCorrelation> | null> = [
      null,
      { ...good, trace_id: "0".repeat(32) },
      { ...good, trace_id: TRACE.toUpperCase() },
      { ...good, trace_id: "short" },
      { ...good, span_id: "0".repeat(16) },
      { ...good, span_id: "xyz" },
      { ...good, trace_flags: 2 as never },
      { ...good, trace_flags: undefined as never },
      { ...good, request_id: "has spaces" },
      { ...good, request_id: "" },
      { ...good, request_id: undefined as never },
    ];
    for (const c of bad) {
      expect(
        () => outboundCorrelationHeaders(c as CailCorrelation),
        JSON.stringify(c),
      ).toThrow(TypeError);
    }
    expect(() => outboundCorrelationHeaders(good)).not.toThrow();
  });
});
