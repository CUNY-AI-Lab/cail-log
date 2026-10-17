import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  isOperationalLogSubject,
  outboundCorrelationHeaders,
  type CailLogDiagnosticCode,
  type CailLogEvent,
} from "../src/index.js";

// SAFETY: this repository-owned, versioned conformance fixture is immutable;
// every projected field is compared with a freshly emitted event below.
const fixture = JSON.parse(
  readFileSync(
    new URL("../contract/operational-event-v2.json", import.meta.url),
    "utf8",
  ),
) as {
  identitySubject: string;
  operationalSubject: string;
  correlation: Parameters<typeof outboundCorrelationHeaders>[0];
  headers: Record<string, string>;
  event: CailLogEvent;
  forbiddenAttributeExamples: string[];
};

function capture() {
  const events: CailLogEvent[] = [];
  const diagnostics: CailLogDiagnosticCode[] = [];
  const logger = createCailLogger({
    service: fixture.event.resource["service.name"],
    release: fixture.event.resource["service.version"],
    env: fixture.event.resource["deployment.environment.name"],
    sourceClass: "platform",
    subjectVersion: "v1",
    catalog: CAIL_EVENT_CATALOG,
    sink: (event) => { events.push(event); },
    onDiagnostic: (code) => { diagnostics.push(code); },
    clock: () => Date.parse(fixture.event.timestamp),
  });
  return { diagnostics, events, logger };
}

// SAFETY: the canonical fixture's exact action and product attributes are
// asserted against the newly emitted event in each test that uses them.
const fixtureFields = {
  action_id: fixture.event.attributes["cail.action.id"] as string,
  product_id: fixture.event.attributes["cail.product.id"] as string,
  principal: {
    type: "user",
    subject: fixture.operationalSubject,
  },
  request_id: fixture.correlation.request_id,
} as const;

describe("operational-event-v2 fixture", () => {
  it("round-trips the canonical correlation headers", () => {
    expect(outboundCorrelationHeaders(fixture.correlation)).toEqual(
      fixture.headers,
    );
  });

  it("is exactly producible through the public logger contract", () => {
    const { diagnostics, events, logger } = capture();
    logger.emit(CAIL_EVENTS.ACTION_ADMITTED, fixtureFields);
    expect(diagnostics).toEqual([]);
    expect(events).toEqual([fixture.event]);
  });

  it("accepts the log pseudonym and rejects the ownership subject as operational subjects", () => {
    expect(isOperationalLogSubject(fixture.operationalSubject)).toBe(true);
    expect(isOperationalLogSubject(fixture.identitySubject)).toBe(false);
  });

  it.each(fixture.forbiddenAttributeExamples)(
    "leaves a caller-supplied %s field out of the emitted event",
    (name) => {
      const { events, logger } = capture();
      // SAFETY: the forbidden key deliberately bypasses the closed field type to
      // prove unknown caller keys never reach the event.
      logger.emit(CAIL_EVENTS.ACTION_ADMITTED, {
        ...fixtureFields,
        [name]: "private-forbidden-value",
      } as never);
      expect(events).toEqual([fixture.event]);
    },
  );
});
