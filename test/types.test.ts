import { describe, expect, it } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  defineEventCatalog,
  type CailLogEvent,
} from "../src/index.js";

describe("typed logger runtime", () => {
  it("emits through platform and tenant catalog signatures", () => {
    const events: CailLogEvent[] = [];
    const sink = (event: CailLogEvent) => { events.push(event); };
    const platform = createCailLogger({
      service: "gateway", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1", catalog: CAIL_EVENT_CATALOG, sink,
    });
    const tenant = createCailLogger({
      service: "tenant-app", release: "local", env: "test", sourceClass: "tenant",
      catalog: defineEventCatalog({
        "tenant.requested": {
          source: "tenant", severity: "info", required: ["request_id"],
          optional: ["route", "status"],
        },
      }), sink,
    });
    platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7", product_id: "kale-workbench",
      principal: { type: "anonymous" },
    });
    tenant.emit("tenant.requested", {
      request_id: "0af7651b-16f9-4a3b-8f42-00f067aa0ba9", route: "/convert",
    });
    expect(events).toHaveLength(2);
  });
});
