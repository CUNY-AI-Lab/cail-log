import { describe, expect, it } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  correlationFromHeaders,
  createCailLogger,
  defineEventCatalog,
  outboundCorrelationHeaders,
  type CailLogEvent,
} from "../dist/index.js";
import * as packagedExports from "../dist/index.js";
import * as sourceExports from "../src/index.js";

describe("packaged dist contract", () => {
  it("exports every public source symbol from committed dist", () => {
    expect(Object.keys(packagedExports).sort()).toEqual(
      Object.keys(sourceExports).sort(),
    );
  });

  it("contains a rejected async sink in the exported runtime", async () => {
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "dist-smoke",
      release: "local",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: async () => {
        throw new Error("packaged sink failure");
      },
      onDiagnostic: (code) => diagnostics.push(code),
    });
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7",
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(diagnostics).toEqual(["sink_error"]);
  });

  it("exports nonzero trace identifiers and a real trace flag", () => {
    const correlation = correlationFromHeaders(new Headers());
    expect(correlation.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(correlation.trace_id).not.toBe("0".repeat(32));
    expect(correlation.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(correlation.span_id).not.toBe("0".repeat(16));
    expect(correlation.trace_flags).toBe(0);
  });

  it("contains changing logger options in the exported runtime", () => {
    const catalog = defineEventCatalog({
      "service.ready": {
        source: "tenant",
        severity: "info",
        required: [],
        optional: [],
      },
    });
    const events: CailLogEvent[] = [];
    let catalogReads = 0;
    let envReads = 0;
    const logger = createCailLogger({
      service: "dist-smoke",
      release: "local",
      get env() {
        envReads += 1;
        return envReads === 1 ? "test" as const : "student-secret" as never;
      },
      sourceClass: "tenant",
      get catalog() {
        catalogReads += 1;
        return catalogReads === 1
          ? catalog
          : Object.freeze({
              "service.leak": Object.freeze({
                body: "private-body-sentinel",
                source: "tenant",
                severity: "info",
                required: Object.freeze([]),
                optional: Object.freeze([]),
              }),
            }) as never;
      },
      sink: (event) => events.push(event),
    });

    logger.emit("service.ready");

    expect(catalogReads).toBe(1);
    expect(envReads).toBe(1);
    expect(events[0]?.body).toBe("Service event recorded.");
    expect(events[0]?.resource["deployment.environment.name"]).toBe("test");
    expect(JSON.stringify(events)).not.toContain("private");
    expect(JSON.stringify(events)).not.toContain("student");
  });

  it("rejects coercible outbound identifiers in the exported runtime", () => {
    let coercions = 0;
    const coercible = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        return "0af7651916cd43dd8448eb211c80319c";
      },
    };
    expect(() =>
      outboundCorrelationHeaders({
        trace_id: coercible as never,
        span_id: "b7ad6b7169203331",
        trace_flags: 1,
        request_id: "0af7651b-16f9-4a3b-8f42-00f067aa0ba9",
      }),
    ).toThrow(TypeError);
    expect(coercions).toBe(0);
  });
});
