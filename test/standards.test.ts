import { describe, expect, it, vi } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  toWorkersLogEvent,
  workersStructuredSink,
  type CailLogEvent,
} from "../src/index.js";

const REQUEST_ID = "0af7651b-16f9-4a3b-8f42-00f067aa0ba9";
const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";
const CALL_ID = "b47399d2-d0cb-4cb2-a7c0-5a15ced5bace";

function capture() {
  const events: CailLogEvent[] = [];
  const logger = createCailLogger({
    service: "model-proxy",
    release: "218328f",
    env: "production",
    sourceClass: "platform",
    subjectVersion: "v1",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => events.push(event),
    clock: () => Date.UTC(2026, 6, 13, 16, 0, 0),
  });
  return { events, logger };
}

describe("OpenTelemetry-aligned record", () => {
  it("separates resources, record fields, trace context, and attributes", () => {
    const { events, logger } = capture();
    logger.emit(CAIL_EVENTS.REQUEST_COMPLETED, {
      request_id: REQUEST_ID,
      product_id: "kale-workbench",
      http_method: "POST",
      route: "/tenant/{project}/dispatch",
      status: 204,
      terminal: { outcome: "ok", reason: "completed" },
      duration_ms: 18,
      trace: {
        trace_id: "0af7651916cd43dd8448eb211c80319c",
        span_id: "b7ad6b7169203331",
        trace_flags: 1,
      },
      req_bytes: 120,
      resp_bytes: 0,
    });
    expect(events[0]).toMatchObject({
      timestamp: "2026-07-13T16:00:00.000Z",
      severity_text: "INFO",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      resource: {
        "service.namespace": "cuny-ai-lab",
        "service.name": "model-proxy",
        "service.version": "218328f",
        "deployment.environment.name": "production",
      },
      attributes: {
        "cail.product.id": "kale-workbench",
        "http.request.method": "POST",
        "url.template": "/tenant/{project}/dispatch",
        "http.response.status_code": 204,
        "http.request.body.size": 120,
        "http.response.body.size": 0,
      },
    });
  });

  it("uses current GenAI attributes without recording content", () => {
    const { events, logger } = capture();
    logger.emit(CAIL_EVENTS.MODEL_CALL_TERMINAL, {
      call_id: CALL_ID,
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
      provider: "openai",
      request_model: "gpt-5",
      response_model: "gpt-5-2026-06-01",
      terminal: { outcome: "ok", reason: "completed" },
      duration_ms: 500,
      input_tokens: 250,
      output_tokens: 40,
      cost_micro_usd: 137,
    });
    expect(events[0]!.attributes).toMatchObject({
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-5",
      "gen_ai.response.model": "gpt-5-2026-06-01",
      "gen_ai.usage.input_tokens": 250,
      "gen_ai.usage.output_tokens": 40,
      "cail.gen_ai.cost.micro_usd": 137,
    });
  });
});

describe("Cloudflare projection", () => {
  it("flattens one queryable structured object", () => {
    const { events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
    });
    const output = toWorkersLogEvent(events[0]!);
    expect(output).toMatchObject({
      "cail.schema.version": 2,
      "event.name": "cail.action.admitted",
      "service.name": "model-proxy",
      "cail.product.id": "kale-workbench",
    });
    expect(output).not.toHaveProperty("resource");
    expect(output).not.toHaveProperty("attributes");
  });

  it("uses the structured console method selected by derived severity", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createCailLogger({
      service: "model-proxy", release: "local", env: "test",
      sourceClass: "platform", subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: workersStructuredSink,
    });
    logger.emit(CAIL_EVENTS.ACTION_TERMINAL, {
      action_id: ACTION_ID,
      product_id: "kale-workbench",
      principal: { type: "anonymous" },
      terminal: { outcome: "outcome_unknown", reason: "unknown" },
      duration_ms: 10,
    });
    expect(warn.mock.calls[0]![0]).toMatchObject({
      "event.name": "cail.action.terminal",
      severity_number: 13,
    });
    vi.restoreAllMocks();
  });
});
