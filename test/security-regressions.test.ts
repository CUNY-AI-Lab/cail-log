import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  CAIL_LOG_SCHEMA_VERSION,
  CAIL_PLATFORM_FIELD_NAMES,
  createAnalyticsEngineSink,
  createCailLogger,
  defineEventCatalog,
  fanoutSinks,
  jsonLineSink,
  toAnalyticsEngineDataPoint,
  toWorkersLogEvent,
  workersStructuredSink,
  type CailLogEvent,
} from "../src/index.js";

const ACTION_ID = "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7";
const GRAMMAR_CATALOG = defineEventCatalog({
  "test.secret_grammars": {
    source: "platform",
    severity: "info",
    required: [],
    optional: CAIL_PLATFORM_FIELD_NAMES,
  },
});

function forgedEvent(): CailLogEvent {
  return Object.freeze({
    schema_version: CAIL_LOG_SCHEMA_VERSION,
    timestamp: "2026-07-14T12:00:00.000Z",
    severity_text: "INFO",
    severity_number: 9,
    event_name: "forged.user_content",
    body: "student essay text",
    resource: Object.freeze({
      "service.namespace": "cuny-ai-lab",
      "service.name": "forged-service",
      "service.version": "local",
      "deployment.environment.name": "test" as const,
    }),
    attributes: Object.freeze({
      "cail.source.class": "platform" as const,
      "cail.key.id": "sk-cail-synthetic-secret-7f3a",
    }),
  });
}

describe("validated event provenance", () => {
  it("rejects caller-constructed envelopes at every exported adapter", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const writes: unknown[] = [];
    const forged = forgedEvent();

    expect(() => jsonLineSink(forged)).toThrow(TypeError);
    expect(() => toWorkersLogEvent(forged)).toThrow(TypeError);
    expect(() => workersStructuredSink(forged)).toThrow(TypeError);
    expect(() => toAnalyticsEngineDataPoint(forged)).toThrow(TypeError);
    expect(() =>
      createAnalyticsEngineSink({ writeDataPoint: (point) => writes.push(point) })(
        forged,
      ),
    ).toThrow(TypeError);
    expect(() => fanoutSinks(() => writes.push("delivered"))(forged)).toThrow(
      TypeError,
    );

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("content-free service catalogs", () => {
  it("assigns one library-owned body to service-defined events", () => {
    const catalog = defineEventCatalog({
      "service.ready": {
        source: "tenant",
        severity: "info",
        required: [],
        optional: [],
      },
    });
    expect(catalog["service.ready"]!.body).toBe("Service event recorded.");
  });

  it("rejects a runtime body escape hatch even when types are bypassed", () => {
    expect(() =>
      defineEventCatalog({
        "service.leak": {
          body: "student essay text",
          source: "tenant",
          severity: "info",
          required: [],
          optional: [],
        },
      } as never),
    ).toThrow(TypeError);
  });

  it("rejects a secret-shaped event name", () => {
    expect(() =>
      defineEventCatalog({
        "sk-cail-synthetic-secret-7f3a": {
          source: "tenant",
          severity: "info",
          required: [],
          optional: [],
        },
      }),
    ).toThrow(TypeError);
  });
});

describe("identifier and subject privacy boundaries", () => {
  it("drops a secret-shaped value that otherwise satisfies key_id grammar", () => {
    for (const canary of [
      "sk-cail-synthetic-secret-7f3a",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "github_pat_synthetic_secret_7f3a",
      "AKIA0123456789ABCDEF",
      "AIza0123456789abcdefghijklmnop",
      "xoxb-synthetic-secret-7f3a",
      "eyJsyntheticheader.payload.signature",
    ]) {
      const events: CailLogEvent[] = [];
      const diagnostics: string[] = [];
      const logger = createCailLogger({
        service: "gateway",
        release: "local",
        env: "test",
        sourceClass: "platform",
        subjectVersion: "v1",
        catalog: CAIL_EVENT_CATALOG,
        sink: (event) => events.push(event),
        onDiagnostic: (code) => diagnostics.push(code),
      });
      logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "anonymous" },
        key_id: canary,
      });
      expect(events, canary).toEqual([]);
      expect(diagnostics, canary).toEqual(["event_contract_error"]);
    }
  });

  it("rejects secret canaries that satisfy every admitted string grammar", () => {
    const cases = [
      ["error_type", "sk-cail-synthetic-secret-7f3a"],
      ["cohort", "sk-cail-synthetic-secret-7f3a"],
      ["product_id", "sk-cail-synthetic-secret-7f3a"],
      ["project", "sk-cail-synthetic-secret-7f3a"],
      ["provider", "sk-cail-synthetic-secret-7f3a"],
      ["key_id", "sk-cail-synthetic-secret-7f3a"],
      ["request_model", "sk-cail-synthetic-secret-7f3a"],
      ["response_model", "sk-cail-synthetic-secret-7f3a"],
      ["route", "/sk-cail-synthetic-secret-7f3a"],
    ] as const;
    for (const [field, canary] of cases) {
      const events: CailLogEvent[] = [];
      const diagnostics: string[] = [];
      const logger = createCailLogger({
        service: "gateway",
        release: "local",
        env: "test",
        sourceClass: "platform",
        subjectVersion: "v1",
        catalog: GRAMMAR_CATALOG,
        sink: (event) => events.push(event),
        onDiagnostic: (code) => diagnostics.push(code),
      });
      logger.emit("test.secret_grammars", { [field]: canary } as never);
      expect(events, field).toEqual([]);
      expect(diagnostics, field).toEqual(["event_contract_error"]);
    }

    const base = {
      env: "test" as const,
      sourceClass: "platform" as const,
      subjectVersion: "v1",
      catalog: GRAMMAR_CATALOG,
      sink: () => {},
    };
    expect(() =>
      createCailLogger({
        ...base,
        service: "sk-cail-synthetic-secret-7f3a",
        release: "local",
      }),
    ).toThrow(TypeError);
    expect(() =>
      createCailLogger({
        ...base,
        service: "gateway",
        release: "sk-cail-synthetic-secret-7f3a",
      }),
    ).toThrow(TypeError);
  });

  it("requires the platform logger's configured subject version", () => {
    const events: CailLogEvent[] = [];
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: "gateway",
      release: "local",
      env: "test",
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: (event) => events.push(event),
      onDiagnostic: (code) => diagnostics.push(code),
    });
    for (const subject of [
      "cail-0123456789abcdef0123456789abcdef",
      "cail-v2-0123456789abcdef0123456789abcdef",
    ]) {
      logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        action_id: ACTION_ID,
        product_id: "kale-workbench",
        principal: { type: "user", subject },
      });
    }
    expect(events).toEqual([]);
    expect(diagnostics).toEqual([
      "event_contract_error",
      "event_contract_error",
    ]);
  });

  it("fails closed when subject version configuration is absent or misplaced", () => {
    const base = {
      service: "gateway",
      release: "local",
      env: "test" as const,
      catalog: CAIL_EVENT_CATALOG,
      sink: () => {},
    };
    expect(() =>
      createCailLogger({
        ...base,
        sourceClass: "platform",
      } as never),
    ).toThrow(TypeError);
    expect(() =>
      createCailLogger({
        ...base,
        sourceClass: "tenant",
        subjectVersion: "v1",
      } as never),
    ).toThrow(TypeError);
  });
});

describe("repository verification contract", () => {
  it("checks committed dist parity in local verification and CI", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["verify"]).toContain("check:dist");
    expect(packageJson.scripts["prepublishOnly"]).toBe("bun run verify");
    expect(existsSync(".github/workflows/ci.yml")).toBe(true);
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain(
      "bun run verify",
    );
  });

  it("fails the parity check for stale generated output", () => {
    const temporary = mkdtempSync(join(tmpdir(), "cail-log-stale-dist-"));
    try {
      cpSync("dist", temporary, { recursive: true });
      writeFileSync(
        join(temporary, "index.js"),
        `${readFileSync(join(temporary, "index.js"), "utf8")}\n// stale\n`,
      );
      const result = spawnSync(
        "bun",
        ["scripts/check-dist.ts", temporary],
        { encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "does not match source build",
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
