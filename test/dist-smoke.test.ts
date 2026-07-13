import { describe, expect, it } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  correlationFromHeaders,
  createCailLogger,
} from "../dist/index.js";

describe("packaged dist contract", () => {
  it("contains a rejected async sink in the exported runtime", async () => {
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "dist-smoke",
      release: "local",
      env: "test",
      sourceClass: "platform",
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
});
