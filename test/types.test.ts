import { describe, expect, it } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  defineEventCatalog,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";

describe("typed logger runtime", () => {
  it("emits through platform and tenant catalog signatures", () => {
    const events: CailLogEvent[] = [];
    const platform = createCailLogger({
      service: "gateway", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: (event) => { events.push(event); },
    });
    const tenantCatalog = defineEventCatalog({
      "tenant.requested": {
        source: "tenant",
        severity: "info",
        required: ["request_id"],
        optional: ["route", "status"],
      },
    });
    const tenant = createCailLogger({
      service: "tenant-app", release: "local", env: "test",
      sourceClass: "tenant", catalog: tenantCatalog,
      sink: (event) => { events.push(event); },
    });

    platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
    });
    tenant.emit("tenant.requested", {
      request_id: "0af7651b-16f9-4a3b-8f42-00f067aa0ba9",
      route: "/convert",
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event_name: CAIL_EVENTS.ACTION_ADMITTED,
      resource: { "service.name": "gateway" },
      attributes: {
        "cail.source.class": "platform",
        "cail.action.id": ACTION_ID,
        "cail.product.id": "kale-workbench",
        "cail.principal.type": "anonymous",
      },
    });
    expect(events[1]).toMatchObject({
      event_name: "tenant.requested",
      body: "Service event recorded.",
      resource: { "service.name": "tenant-app" },
      attributes: {
        "cail.source.class": "tenant",
        "cail.request.id": "0af7651b-16f9-4a3b-8f42-00f067aa0ba9",
        "url.template": "/convert",
      },
    });
  });
});
