import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CAIL_LOG_SCHEMA_VERSION,
  isOperationalLogSubject,
  outboundCorrelationHeaders,
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
  event: { schema_version: number; attributes: Record<string, unknown> };
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

  it("pins schema version and excludes unsafe attribute names", () => {
    expect(fixture.schemaVersion).toBe(CAIL_LOG_SCHEMA_VERSION);
    expect(fixture.event.schema_version).toBe(CAIL_LOG_SCHEMA_VERSION);
    for (const field of fixture.forbiddenAttributeExamples) {
      expect(fixture.event.attributes).not.toHaveProperty(field);
    }
  });
});
