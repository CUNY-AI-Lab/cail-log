import { describe, expect, it } from "vitest";
import {
  CAIL_ANALYTICS_ENGINE_DOUBLES,
  CAIL_ANALYTICS_ENGINE_MISSING_NUMBER,
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  CAIL_PLATFORM_FIELD_NAMES,
  createAnalyticsEngineSink,
  createCailLogger,
  defineEventCatalog,
  fanoutSinks,
  toAnalyticsEngineDataPoint,
  type CailAnalyticsEngineDataPoint,
  type CailLogDiagnosticCode,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";
const CALL_ID = "b47399d2-d0cb-4cb2-a7c0-5a15ced5bace";
const SUBJECT = "cail-v1-0123456789abcdef0123456789abcdef";
const NOW_MS = 1_783_972_800_000; // 2026-07-13T20:00:00.000Z

function terminalEvent(
  environment: "production" | "staging" = "production",
): CailLogEvent {
  let captured: CailLogEvent | undefined;
  const logger = createCailLogger({
    service: "agent-studio",
    release: "abc123",
    env: environment,
    sourceClass: "platform",
    subjectVersion: "v1",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => { captured = event; },
    clock: () => NOW_MS,
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

function modelTerminalEvent(
  timings: Readonly<{
    upstream_headers_ms?: number;
    upstream_first_data_ms?: number;
  }> = {},
): CailLogEvent {
  let captured: CailLogEvent | undefined;
  const logger = createCailLogger({
    service: "model-proxy",
    release: "abc123",
    env: "production",
    sourceClass: "platform",
    subjectVersion: "v1",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => { captured = event; },
    clock: () => NOW_MS,
  });
  logger.emit(CAIL_EVENTS.MODEL_CALL_TERMINAL, {
    call_id: CALL_ID,
    action_id: ACTION_ID,
    product_id: "agent-studio",
    principal: { type: "anonymous" },
    provider: "openai",
    request_model: "gpt-5",
    terminal: { outcome: "ok", reason: "completed" },
    duration_ms: 321,
    ...timings,
  });
  return captured!;
}

describe("Analytics Engine projection", () => {
  it("projects an event into the published blob and double positions", () => {
    // Literal arrays: stored rows are read by position, so a reorder must fail
    // here even when the exported position constants move with the writer.
    expect(toAnalyticsEngineDataPoint(terminalEvent())).toEqual({
      indexes: ["production:agent-studio"],
      blobs: [
        "cail.action.terminal",
        "agent-studio",
        "abc123",
        "production",
        "agent-studio",
        "user",
        "pilot-users",
        "/agents/{agent}/{name}",
        "error",
        "application_failure",
        "agent_failed",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
      doubles: [
        1, 2, 17, -1, 321, -1, -1, -1, -1, -1, -1, -1, NOW_MS, -1, -1, -1, -1,
        -1, -1, -1,
      ],
    });
  });

  it("represents absent numeric facts distinctly from zero", () => {
    const point = toAnalyticsEngineDataPoint(terminalEvent());
    expect(point.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.input_tokens - 1])
      .toBe(CAIL_ANALYTICS_ENGINE_MISSING_NUMBER);
    expect(point.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.cost_micro_usd - 1])
      .toBe(CAIL_ANALYTICS_ENGINE_MISSING_NUMBER);
  });

  it("projects model timings into the published double positions", () => {
    const point = toAnalyticsEngineDataPoint(modelTerminalEvent({
      upstream_headers_ms: 125.5,
      upstream_first_data_ms: 250.25,
    }));
    expect(point.doubles).toEqual([
      1, 2, 9, -1, 321, -1, -1, -1, -1, -1, -1, -1, NOW_MS, 125.5, 250.25, -1,
      -1, -1, -1, -1,
    ]);
  });

  it("keeps timing omission distinct from an observed zero", () => {
    const missing = toAnalyticsEngineDataPoint(modelTerminalEvent());
    const zero = toAnalyticsEngineDataPoint(modelTerminalEvent({
      upstream_headers_ms: 0,
      upstream_first_data_ms: 0,
    }));

    expect(missing.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.upstream_headers_ms - 1])
      .toBe(CAIL_ANALYTICS_ENGINE_MISSING_NUMBER);
    expect(missing.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.upstream_first_data_ms - 1])
      .toBe(CAIL_ANALYTICS_ENGINE_MISSING_NUMBER);
    expect(zero.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.upstream_headers_ms - 1])
      .toBe(0);
    expect(zero.doubles[CAIL_ANALYTICS_ENGINE_DOUBLES.upstream_first_data_ms - 1])
      .toBe(0);
  });

  it("writes one point through an explicit dataset sink", () => {
    const points: CailAnalyticsEngineDataPoint[] = [];
    createAnalyticsEngineSink({
      writeDataPoint: (point) => {
        points.push(point);
      },
    })(terminalEvent());
    expect(points).toHaveLength(1);
    expect(points[0]!.indexes).toEqual(["production:agent-studio"]);
  });

  it("contains fanout failure and reports one content-free diagnostic", async () => {
    const points: CailAnalyticsEngineDataPoint[] = [];
    const diagnostics: CailLogDiagnosticCode[] = [];
    let diagnosed: () => void = () => {};
    const diagnosis = new Promise<void>((resolve) => { diagnosed = resolve; });
    const logger = createCailLogger({
      service: "agent-studio",
      release: "abc123",
      env: "production",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: fanoutSinks(
        () => Promise.reject(new Error("secret user content")),
        createAnalyticsEngineSink({
          writeDataPoint: (point) => { points.push(point); },
        }),
      ),
      onDiagnostic: (code) => {
        diagnostics.push(code);
        diagnosed();
      },
      clock: () => NOW_MS,
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

    await diagnosis;
    expect(diagnostics).toEqual(["sink_error"]);
    expect(points).toHaveLength(1);
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

  it("rejects a dataset without writeDataPoint", () => {
    // SAFETY: the missing method is intentional invalid input for the runtime
    // dataset guard; the assertion bypasses only the compile-time interface.
    expect(() => createAnalyticsEngineSink({} as never)).toThrow(TypeError);
  });

  it("rejects an empty fanout", () => {
    expect(() => fanoutSinks()).toThrow(TypeError);
  });

  it("accepts platform capability objects with a custom prototype", () => {
    class PlatformDataset {
      readonly points: CailAnalyticsEngineDataPoint[] = [];

      writeDataPoint(point: CailAnalyticsEngineDataPoint): void {
        this.points.push(point);
      }
    }

    const dataset = new PlatformDataset();
    const event = terminalEvent();
    createAnalyticsEngineSink(dataset)(event);

    expect(dataset.points).toHaveLength(1);
    expect(dataset.points[0]?.blobs[0]).toBe(event.event_name);
  });

  it("isolates production and staging sampling indexes", () => {
    const event = terminalEvent();
    const staging = terminalEvent("staging");
    expect(toAnalyticsEngineDataPoint(event).indexes).toEqual(["production:agent-studio"]);
    expect(toAnalyticsEngineDataPoint(staging).indexes).toEqual(["staging:agent-studio"]);
  });

  it("stays within positional and byte limits at maximum contract lengths", () => {
    const catalog = defineEventCatalog({
      "test.maximal": {
        source: "platform",
        severity: "info",
        required: [],
        optional: CAIL_PLATFORM_FIELD_NAMES,
      },
    });
    let maximal: CailLogEvent | undefined;
    const logger = createCailLogger({
      service: `s${"s".repeat(63)}`,
      release: `v${"v".repeat(127)}`,
      env: "production",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog,
      sink: (event) => { maximal = event; },
    });
    logger.emit("test.maximal", {
      product_id: `p${"p".repeat(63)}`,
      cohort: `c${"c".repeat(63)}`,
      route: `/${"r".repeat(158)}`,
      request_model: `m${"m".repeat(95)}`,
      response_model: `m${"m".repeat(95)}`,
    });
    const point = toAnalyticsEngineDataPoint(maximal!);
    expect(point.indexes).toHaveLength(1);
    expect(new TextEncoder().encode(point.indexes[0]).byteLength).toBeLessThanOrEqual(96);
    expect(point.blobs).toHaveLength(20);
    expect(point.doubles).toHaveLength(20);
    expect(new TextEncoder().encode(point.blobs.join("")).byteLength).toBeLessThanOrEqual(16 * 1024);
  });

  it("falls back to a service-namespaced index within 96 bytes when no product is set", () => {
    const service = `s${"s".repeat(63)}`;
    const tenantCatalog = defineEventCatalog({
      "test.service_only": {
        source: "tenant",
        severity: "info",
        required: [],
        optional: [],
      },
    });
    let serviceOnly: CailLogEvent | undefined;
    const tenantLogger = createCailLogger({
      service,
      release: "local",
      env: "production",
      sourceClass: "tenant",
      catalog: tenantCatalog,
      sink: (event) => { serviceOnly = event; },
    });
    tenantLogger.emit("test.service_only");
    const { indexes } = toAnalyticsEngineDataPoint(serviceOnly!);
    expect(indexes).toEqual([`production:_service.${service}`]);
    expect(new TextEncoder().encode(indexes[0]).byteLength).toBeLessThanOrEqual(96);
  });
});
