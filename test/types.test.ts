import { describe, expect, it } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  defineEventCatalog,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";

describe("type-level event contract", () => {
  it("requires event-specific fields and source-compatible events", () => {
    const events: CailLogEvent[] = [];
    const platform = createCailLogger({
      service: "gateway", release: "local", env: "test",
      sourceClass: "platform", catalog: CAIL_EVENT_CATALOG,
      sink: (event) => events.push(event),
    });
    const tenantCatalog = defineEventCatalog({
      "tenant.requested": {
        body: "Tenant request received.",
        source: "tenant",
        severity: "info",
        required: ["request_id"],
        optional: ["route", "status"],
      },
    });
    const tenant = createCailLogger({
      service: "tenant-app", release: "local", env: "test",
      sourceClass: "tenant", catalog: tenantCatalog,
      sink: (event) => events.push(event),
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

    if (false) {
      // @ts-expect-error action_id is required by this event definition
      platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        product_id: "kale-workbench",
        principal: { type: "anonymous" },
      });
      platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "anonymous" },
        // @ts-expect-error model cost is not allowed on action admission
        cost_micro_usd: 1,
      });
      // @ts-expect-error a tenant logger cannot emit a platform event
      tenant.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "anonymous" },
      });
      tenant.emit("tenant.requested", {
        request_id: "0af7651b-16f9-4a3b-8f42-00f067aa0ba9",
        // @ts-expect-error tenant event definitions cannot expose product identity
        product_id: "forged",
      });
      defineEventCatalog({
        // @ts-expect-error tenant catalogs cannot define platform-only fields
        "tenant.forged": {
          body: "Tenant forged.",
          source: "tenant",
          severity: "info",
          required: ["product_id"],
          optional: [],
        },
      });
      platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        // @ts-expect-error an identified principal requires a subject
        principal: { type: "user" },
      });
      platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        // @ts-expect-error anonymous principals cannot carry a subject
        principal: { type: "anonymous", subject: "cail-0123456789abcdef0123456789abcdef" },
      });
      platform.emit(CAIL_EVENTS.ACTION_TERMINAL, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "anonymous" },
        // @ts-expect-error outcomes and reasons are one discriminated terminal fact
        terminal: { outcome: "ok", reason: "timeout" },
        duration_ms: 1,
      });
      platform.emit(CAIL_EVENTS.QUOTA_CHARGED, {
        product_id: "kale-workbench",
        principal: { type: "anonymous" },
        // @ts-expect-error the canonical quota event permits only ok/completed
        terminal: { outcome: "timeout", reason: "timeout" },
        quota: {
          kind: "request_count",
          unit: "requests",
          state: "fresh",
          limit: 10,
          used: 1,
          reset_at: "2026-08-01T00:00:00.000Z",
        },
      });
      // @ts-expect-error successful terminal facts cannot carry an error type
      platform.emit(CAIL_EVENTS.ACTION_TERMINAL, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "anonymous" },
        terminal: { outcome: "ok", reason: "completed" },
        duration_ms: 1,
        error_type: "should_not_compile",
      });
      platform.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "anonymous" },
        // @ts-expect-error trace context is atomic
        trace: { trace_id: "0af7651916cd43dd8448eb211c80319c" },
      });
      // @ts-expect-error sink selection is required
      createCailLogger({
        service: "bad", release: "local", env: "test",
        sourceClass: "platform", catalog: CAIL_EVENT_CATALOG,
      });
    }

    expect(events).toHaveLength(2);
  });
});
