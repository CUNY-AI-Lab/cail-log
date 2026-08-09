import { describe, expect, it } from "vitest";
import {
  CAIL_EVENT_CATALOG as SOURCE_CATALOG,
  CAIL_EVENTS as SOURCE_EVENTS,
  correlationFromHeaders as sourceCorrelationFromHeaders,
  createCailLogger as createSourceLogger,
  outboundCorrelationHeaders as sourceOutboundCorrelationHeaders,
} from "../src/index.js";

const UUID_V4 = "11111111-1111-4111-8111-111111111111";
const UUID_V7 = "019f8bdc-342a-76e1-ba71-005d69808f86";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const builds = [
  {
    name: "source",
    catalog: SOURCE_CATALOG,
    events: SOURCE_EVENTS,
    correlationFromHeaders: sourceCorrelationFromHeaders,
    createLogger: createSourceLogger,
    outboundCorrelationHeaders: sourceOutboundCorrelationHeaders,
  },
] as const;

const rejectedRequestIds = [
  "019f8bdc-342a-16e1-ba71-005d69808f86",
  "019f8bdc-342a-56e1-ba71-005d69808f86",
  "019f8bdc-342a-66e1-ba71-005d69808f86",
  "019f8bdc-342a-86e1-ba71-005d69808f86",
  "019f8bdc-342a-76e1-7a71-005d69808f86",
  "019F8BDC-342A-76E1-BA71-005D69808F86",
  "019f8bdc342a76e1ba71005d69808f86",
  "019f8bdc-342a-76e1-ba71-005d69808f86-extra",
] as const;

describe.each(builds)("$name request-ID contract", (build) => {
  it("emits real operational events with exact UUIDv4 and UUIDv7 request IDs", () => {
    const emitted: Array<{
      attributes: { "cail.request.id"?: string };
    }> = [];
    const diagnostics: string[] = [];
    const logger = build.createLogger({
      service: "kale-release-control-plane",
      release: "fa12fe8",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: build.catalog,
      sink: (event) => emitted.push(event),
      onDiagnostic: (code) => diagnostics.push(code),
    });

    for (const requestId of [UUID_V4, UUID_V7]) {
      logger.emit(build.events.ACTION_ADMITTED, {
        action_id: UUID_V4,
        request_id: requestId,
        product_id: "kale-deploy",
        principal: { type: "service" },
        http_method: "POST",
        route: "/v1/projects/{projectId}/releases",
      });
    }

    expect(diagnostics).toEqual([]);
    expect(
      emitted.map((event) => event.attributes["cail.request.id"]),
    ).toEqual([UUID_V4, UUID_V7]);
  });

  it("adopts and forwards UUIDv4 and UUIDv7 verbatim", () => {
    for (const requestId of [UUID_V4, UUID_V7]) {
      const correlation = build.correlationFromHeaders(
        new Headers({ "x-cail-request-id": requestId }),
      );
      expect(correlation.request_id).toBe(requestId);
      expect(
        build.outboundCorrelationHeaders({
          trace_id: TRACE_ID,
          span_id: SPAN_ID,
          trace_flags: 1,
          request_id: requestId,
        })["x-cail-request-id"],
      ).toBe(requestId);
    }
  });

  it("rejects malformed, wrong-version, wrong-variant, and non-lowercase values", () => {
    const emitted: unknown[] = [];
    const diagnostics: string[] = [];
    const logger = build.createLogger({
      service: "kale-release-control-plane",
      release: "fa12fe8",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: build.catalog,
      sink: (event) => emitted.push(event),
      onDiagnostic: (code) => diagnostics.push(code),
    });

    for (const requestId of rejectedRequestIds) {
      const adopted = build.correlationFromHeaders(
        new Headers({ "x-cail-request-id": requestId }),
      );
      expect(adopted.request_id).not.toBe(requestId);
      expect(adopted.request_id).toMatch(UUID_V4_RE);
      expect(() =>
        build.outboundCorrelationHeaders({
          trace_id: TRACE_ID,
          span_id: SPAN_ID,
          trace_flags: 1,
          request_id: requestId,
        }),
      ).toThrow("request_id must be a lowercase UUID v4 or v7");
      logger.emit(build.events.REQUEST_RECEIVED, {
        request_id: requestId,
        product_id: "kale-deploy",
        principal: { type: "service" },
        http_method: "POST",
        route: "/v1/projects/{projectId}/releases",
      });
    }
    expect(emitted).toEqual([]);
    expect(diagnostics).toEqual(
      rejectedRequestIds.map(() => "event_contract_error"),
    );
  });

  it("does not broaden action IDs from UUIDv4 to UUIDv7", () => {
    const emitted: unknown[] = [];
    const diagnostics: string[] = [];
    const logger = build.createLogger({
      service: "kale-release-control-plane",
      release: "fa12fe8",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: build.catalog,
      sink: (event) => emitted.push(event),
      onDiagnostic: (code) => diagnostics.push(code),
    });

    logger.emit(build.events.ACTION_ADMITTED, {
      action_id: UUID_V7,
      request_id: UUID_V7,
      product_id: "kale-deploy",
      principal: { type: "service" },
      http_method: "POST",
      route: "/v1/projects/{projectId}/releases",
    });

    expect(emitted).toEqual([]);
    expect(diagnostics).toEqual(["event_contract_error"]);
  });
});
