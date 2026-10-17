import { describe, expect, it } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  correlationFromHeaders,
  createCailLogger,
  outboundCorrelationHeaders,
  type CailLogDiagnosticCode,
  type CailLogEvent,
} from "../src/index.js";

const UUID_V4 = "11111111-1111-4111-8111-111111111111";
const UUID_V7 = "019f8bdc-342a-76e1-ba71-005d69808f86";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const rejectedRequestIds = [
  ["version 1", "019f8bdc-342a-16e1-ba71-005d69808f86"],
  ["version 5", "019f8bdc-342a-56e1-ba71-005d69808f86"],
  ["version 6", "019f8bdc-342a-66e1-ba71-005d69808f86"],
  ["version 8", "019f8bdc-342a-86e1-ba71-005d69808f86"],
  ["the wrong variant", "019f8bdc-342a-76e1-7a71-005d69808f86"],
  ["uppercase hex", "019F8BDC-342A-76E1-BA71-005D69808F86"],
  ["no hyphens", "019f8bdc342a76e1ba71005d69808f86"],
  ["a trailing suffix", "019f8bdc-342a-76e1-ba71-005d69808f86-extra"],
] as const;

function capture() {
  const events: CailLogEvent[] = [];
  const diagnostics: CailLogDiagnosticCode[] = [];
  const logger = createCailLogger({
    service: "kale-release-control-plane",
    release: "fa12fe8",
    env: "test",
    sourceClass: "platform",
    subjectVersion: "v1",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => { events.push(event); },
    onDiagnostic: (code) => { diagnostics.push(code); },
  });
  return { diagnostics, events, logger };
}

function correlationWith(requestId: string) {
  return {
    trace_id: TRACE_ID,
    span_id: SPAN_ID,
    trace_flags: 1 as const,
    request_id: requestId,
  };
}

describe("request-ID contract", () => {
  it.each([UUID_V4, UUID_V7])("emits an operational event with request id %s", (requestId) => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: UUID_V4,
      request_id: requestId,
      product_id: "kale-deploy",
      principal: { type: "service" },
      http_method: "POST",
      route: "/v1/projects/{projectId}/releases",
    });
    expect(diagnostics).toEqual([]);
    expect(events[0]?.attributes["cail.request.id"]).toBe(requestId);
  });

  it("adopts an inbound UUIDv7 request id verbatim", () => {
    const correlation = correlationFromHeaders(
      new Headers({ "x-cail-request-id": UUID_V7 }),
    );
    expect(correlation.request_id).toBe(UUID_V7);
  });

  it.each([UUID_V4, UUID_V7])("forwards request id %s verbatim", (requestId) => {
    expect(
      outboundCorrelationHeaders(correlationWith(requestId))["x-cail-request-id"],
    ).toBe(requestId);
  });

  it.each(rejectedRequestIds)("mints a fresh request id instead of adopting one with %s", (_label, requestId) => {
    const adopted = correlationFromHeaders(
      new Headers({ "x-cail-request-id": requestId }),
    );
    expect(adopted.request_id).not.toBe(requestId);
    expect(adopted.request_id).toMatch(UUID_V4_RE);
  });

  it.each(rejectedRequestIds)("refuses to forward a request id with %s", (_label, requestId) => {
    expect(() => outboundCorrelationHeaders(correlationWith(requestId))).toThrow(
      TypeError,
    );
  });

  it.each(rejectedRequestIds)("drops an event whose request id has %s", (_label, requestId) => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.REQUEST_RECEIVED, {
      request_id: requestId,
      product_id: "kale-deploy",
      principal: { type: "service" },
      http_method: "POST",
      route: "/v1/projects/{projectId}/releases",
    });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });

  it("does not broaden action IDs from UUIDv4 to UUIDv7", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: UUID_V7,
      request_id: UUID_V7,
      product_id: "kale-deploy",
      principal: { type: "service" },
      http_method: "POST",
      route: "/v1/projects/{projectId}/releases",
    });
    expect(events).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });
});
