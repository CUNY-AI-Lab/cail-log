import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  CAIL_LOG_SCHEMA_VERSION,
  createCailLogger,
  isOperationalLogSubject,
  outboundCorrelationHeaders,
  type CailLogEnvironment,
  type CailLogEvent,
} from "../src/index.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../contract/operational-event-v2.json", import.meta.url),
    "utf8",
  ),
) as {
  schemaVersion: number;
  identitySubject: string;
  operationalSubject: string;
  correlation: Parameters<typeof outboundCorrelationHeaders>[0];
  headers: Record<string, string>;
  event: CailLogEvent;
  forbiddenAttributeExamples: string[];
};

describe("operational-event-v2 fixture", () => {
  it("keeps separately derived ownership and log pseudonym payloads distinct", () => {
    expect(isOperationalLogSubject(fixture.operationalSubject)).toBe(true);
    expect(fixture.identitySubject.slice("cail-".length)).not.toBe(
      fixture.operationalSubject.slice("cail-v1-".length),
    );
  });

  it("round-trips the canonical correlation headers", () => {
    expect(outboundCorrelationHeaders(fixture.correlation)).toEqual(
      fixture.headers,
    );
  });

  it("is exactly producible through the public logger contract", () => {
    const events: CailLogEvent[] = [];
    const diagnostics: string[] = [];
    const logger = createCailLogger({
      service: fixture.event.resource["service.name"],
      release: fixture.event.resource["service.version"],
      env: fixture.event.resource[
        "deployment.environment.name"
      ] as CailLogEnvironment,
      sourceClass: "platform",
      subjectVersion: "v1",
      catalog: CAIL_EVENT_CATALOG,
      sink: (event) => events.push(event),
      onDiagnostic: (code) => diagnostics.push(code),
      clock: () => Date.parse(fixture.event.timestamp),
    });
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
      action_id: fixture.event.attributes["cail.action.id"] as string,
      product_id: fixture.event.attributes["cail.product.id"] as string,
      principal: {
        type: "user",
        subject: fixture.operationalSubject,
      },
      request_id: fixture.correlation.request_id,
    });

    expect(diagnostics).toEqual([]);
    expect(events).toEqual([fixture.event]);
  });

  it("pins schema version and excludes unsafe attribute names", () => {
    expect(fixture.schemaVersion).toBe(CAIL_LOG_SCHEMA_VERSION);
    expect(fixture.event.schema_version).toBe(CAIL_LOG_SCHEMA_VERSION);
    for (const field of fixture.forbiddenAttributeExamples) {
      expect(fixture.event.attributes).not.toHaveProperty(field);
    }
  });
});
