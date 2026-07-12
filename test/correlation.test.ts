import { describe, it, expect } from "vitest";
import {
  correlationFromHeaders,
  outboundCorrelationHeaders,
  TRACEPARENT_HEADER,
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
  });

  it("L7f minted ids differ across calls (no fixed fallback id)", () => {
    const a = correlationFromHeaders(withHeaders({}));
    const b = correlationFromHeaders(withHeaders({}));
    expect(a.trace_id).not.toBe(b.trace_id);
    expect(a.span_id).not.toBe(b.span_id);
    expect(a.request_id).not.toBe(b.request_id);
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
      // Review M1: even PROPERTY ACCESS may be hostile.
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

describe("L7 outbound headers", () => {
  it("L7j outbound traceparent forwards the trace with OUR span as parent-id", () => {
    const c: CailCorrelation = {
      trace_id: TRACE,
      span_id: "1234567890abcdef",
      request_id: RID,
    };
    expect(outboundCorrelationHeaders(c)).toEqual({
      [TRACEPARENT_HEADER]: `00-${TRACE}-1234567890abcdef-01`,
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

  it("L7l outbound fails LOUD (TypeError) on malformed correlation", () => {
    const good: CailCorrelation = {
      trace_id: TRACE,
      span_id: PARENT_SPAN,
      request_id: RID,
    };
    const bad: Array<Partial<CailCorrelation> | null> = [
      null,
      { ...good, trace_id: "0".repeat(32) },
      { ...good, trace_id: TRACE.toUpperCase() },
      { ...good, trace_id: "short" },
      { ...good, span_id: "0".repeat(16) },
      { ...good, span_id: "xyz" },
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
