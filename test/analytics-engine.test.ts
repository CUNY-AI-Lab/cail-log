import { describe, expect, it } from "vitest";
import {
  CAIL_ANALYTICS_ENGINE_BLOBS,
  CAIL_ANALYTICS_ENGINE_DOUBLES,
  CAIL_ANALYTICS_ENGINE_MISSING_NUMBER,
  CAIL_ANALYTICS_ENGINE_MAX_POINTS_PER_INVOCATION,
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createAnalyticsEngineSink,
  createCailLogger,
  fanoutSinks,
  toAnalyticsEngineDataPoint,
  type CailAnalyticsEngineDataPoint,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";
const SUBJECT = "cail-0123456789abcdef0123456789abcdef";

function terminalEvent(): CailLogEvent {
  let captured: CailLogEvent | undefined;
  const logger = createCailLogger({
    service: "agent-studio",
    release: "abc123",
    env: "production",
    sourceClass: "platform",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => { captured = event; },
    clock: () => Date.parse("2026-07-13T20:00:00.000Z"),
  });
  logger.emit(CAIL_EVENTS.ACTION_TERMINAL, {
    action_id: ACTION_ID,
    product_id: "agent-studio",
    principal: { type: "user", subject: SUBJECT },
    cohort: "pilot-users",
    route: "/agents/{agent}/{name}",
    terminal: { outcome: "error", reason: "application_failure" },
    duration_ms: 321,
    error_type: "agent_failed",
  });
  return captured!;
}

describe("Analytics Engine projection", () => {
  it("uses a stable, content-free positional schema", () => {
    const point = toAnalyticsEngineDataPoint(terminalEvent());
    expect(point.indexes).toEqual(["production:agent-studio"]);
    expect(point.blobs).toHaveLength(20);
    expect(point.doubles).toHaveLength(20);
    expect(point.blobs[CAIL_ANALYTICS_ENGINE_BLOBS.event_name - 1])
      .toBe("cail.action.terminal");
    expect(point.blobs[CAIL_ANALYTICS_ENGINE_BLOBS.service_name - 1])
      .toBe("agent-studio");
    expect(point.blobs[CAIL_ANALYTICS_ENGINE_BLOBS.product_id - 1])
      .toBe("agent-studio");
    expect(point.blobs[CAIL_ANALYTICS_ENGINE_BLOBS.cohort - 1])
      .toBe("pilot-users");
    expect(JSON.stringify(point)).not.toContain(SUBJECT);
    expect(point.blobs.slice(15)).toEqual(Array(5).fill(""));
    expect(point.blobs[CAIL_ANALYTICS_ENGINE_BLOBS.route - 1])
      .toBe("/agents/{agent}/{name}");
    expect(point.blobs[CAIL_ANALYTICS_ENGINE_BLOBS.outcome - 1])
      .toBe("error");
    expect(point.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.duration_ms - 1])
      .toBe(321);
    expect(point.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.event_timestamp_ms - 1])
      .toBe(Date.parse("2026-07-13T20:00:00.000Z"));
    expect(point.doubles.slice(13)).toEqual(Array(7).fill(-1));
    expect(JSON.stringify(point)).not.toMatch(/prompt|completion|authorization|email/i);
  });

  it("represents absent numeric facts distinctly from zero", () => {
    const point = toAnalyticsEngineDataPoint(terminalEvent());
    expect(point.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.input_tokens - 1])
      .toBe(CAIL_ANALYTICS_ENGINE_MISSING_NUMBER);
    expect(point.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.cost_micro_usd - 1])
      .toBe(CAIL_ANALYTICS_ENGINE_MISSING_NUMBER);
  });

  it("writes one point through an explicit dataset sink", () => {
    const points: CailAnalyticsEngineDataPoint[] = [];
    createAnalyticsEngineSink({ writeDataPoint: (point) => points.push(point) })(
      terminalEvent(),
    );
    expect(points).toHaveLength(1);
    expect(points[0]!.indexes).toEqual(["production:agent-studio"]);
  });

  it("contains fanout failure and reports one content-free diagnostic", async () => {
    const points: CailAnalyticsEngineDataPoint[] = [];
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "agent-studio",
      release: "abc123",
      env: "production",
      sourceClass: "platform",
      catalog: CAIL_EVENT_CATALOG,
      sink: fanoutSinks(
        () => Promise.reject(new Error("secret user content")),
        createAnalyticsEngineSink({
          writeDataPoint: (point) => points.push(point),
        }),
      ),
      onDiagnostic: (code) => { diagnostics.push(code); },
      clock: () => Date.parse("2026-07-13T20:00:00.000Z"),
    });

    logger.emit(CAIL_EVENTS.ACTION_TERMINAL, {
      action_id: ACTION_ID,
      product_id: "agent-studio",
      principal: { type: "user", subject: SUBJECT },
      cohort: "pilot-users",
      route: "/agents/{agent}/{name}",
      terminal: { outcome: "ok", reason: "completed" },
      duration_ms: 321,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(diagnostics).toEqual(["sink_error"]);
    expect(points).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain("secret user content");
  });

  it("fans out after a synchronous or asynchronous sink failure", async () => {
    const delivered: string[] = [];
    const sink = fanoutSinks(
      () => { throw new Error("first failed"); },
      (event) => { delivered.push(event.event_name); },
      async () => { throw new Error("third failed"); },
    );
    await expect(sink(terminalEvent())).rejects.toBeTruthy();
    expect(delivered).toEqual(["cail.action.terminal"]);
  });

  it("rejects missing datasets and empty fanout configuration", () => {
    expect(() => createAnalyticsEngineSink({} as never)).toThrow(TypeError);
    expect(() => fanoutSinks()).toThrow(TypeError);
  });

  it("isolates production and staging sampling indexes", () => {
    const event = terminalEvent();
    const staging = {
      ...event,
      resource: {
        ...event.resource,
        "deployment.environment.name": "staging" as const,
      },
    };
    expect(toAnalyticsEngineDataPoint(event).indexes).toEqual(["production:agent-studio"]);
    expect(toAnalyticsEngineDataPoint(staging).indexes).toEqual(["staging:agent-studio"]);
  });

  it("stays within positional and byte limits at maximum contract lengths", () => {
    const base = terminalEvent();
    const maximal: CailLogEvent = {
      ...base,
      resource: {
        ...base.resource,
        "service.name": `s${"s".repeat(63)}`,
        "service.version": `v${"v".repeat(127)}`,
      },
      attributes: {
        ...base.attributes,
        "cail.product.id": `p${"p".repeat(63)}`,
        "cail.cohort.id": `c${"c".repeat(63)}`,
        "url.template": `/${"r".repeat(158)}`,
        "gen_ai.request.model": `m${"m".repeat(95)}`,
        "gen_ai.response.model": `m${"m".repeat(95)}`,
      },
    };
    const point = toAnalyticsEngineDataPoint(maximal);
    expect(point.indexes).toHaveLength(1);
    expect(new TextEncoder().encode(point.indexes[0]).byteLength).toBeLessThanOrEqual(96);
    expect(point.blobs).toHaveLength(20);
    expect(point.doubles).toHaveLength(20);
    expect(new TextEncoder().encode(point.blobs.join("")).byteLength).toBeLessThanOrEqual(16 * 1024);
    expect(CAIL_ANALYTICS_ENGINE_MAX_POINTS_PER_INVOCATION).toBe(250);

    const serviceFallback = toAnalyticsEngineDataPoint({
      ...maximal,
      attributes: Object.fromEntries(
        Object.entries(maximal.attributes).filter(([name]) => name !== "cail.product.id"),
      ) as CailLogEvent["attributes"],
    });
    expect(serviceFallback.indexes[0].startsWith("production:_service.")).toBe(true);
    expect(new TextEncoder().encode(serviceFallback.indexes[0]).byteLength).toBeLessThanOrEqual(96);
  });
});
