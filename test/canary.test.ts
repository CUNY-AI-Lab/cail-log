/**
 * THE ZERO-RETENTION PROOF.
 *
 * A PII-shaped canary string is pushed at the logger through every avenue the
 * API surface exposes — stray fields, denylisted keys, Sensitive wrappers,
 * raw/hostile objects, event names, error codes, enum and numeric fields,
 * nested quota keys, level names, service overrides — and the suite asserts
 * the canary NEVER appears in any emitted JSON, on any sink, ever.
 *
 * (The typed allowlist's plain string fields — subject, route, model, … — are
 * safe-to-log BY POLICY; their values are the reviewed caller's contract.
 * This test covers every path that is supposed to be structurally closed.)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createCailLogger,
  sensitive,
  CAIL_EVENTS,
  type CailLogEvent,
  type CailLogFields,
  type CailLogLevel,
} from "../src/index.js";

const CANARY = "CANARY-PII-7f3a";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("canary: CANARY-PII-7f3a never reaches any output", () => {
  it("survives every abuse of the API without leaking", () => {
    const events: CailLogEvent[] = [];
    const lines: string[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });

    const logger = createCailLogger({
      service: "model-proxy",
      sink: (e) => events.push(e),
      clock: () => 0,
    });
    // A second logger on the DEFAULT console.log sink, same abuses.
    const defaultLogger = createCailLogger({ service: "model-proxy" });

    for (const log of [logger, defaultLogger]) {
      // 1. Stray unknown field.
      log.info(CAIL_EVENTS.REQUEST_COMPLETED, {
        stray_note: CANARY,
      } as unknown as CailLogFields);

      // 2. Every denylisted key.
      log.info(CAIL_EVENTS.REQUEST_COMPLETED, {
        authorization: `Bearer ${CANARY}`,
        cookie: CANARY,
        "set-cookie": CANARY,
        token: CANARY,
        secret: CANARY,
        password: CANARY,
        api_key: CANARY,
        apikey: CANARY,
        email: `${CANARY}@gc.cuny.edu`,
        given_name: CANARY,
        family_name: CANARY,
        sub: CANARY,
        prompt: CANARY,
        messages: [{ role: "user", content: CANARY }],
        completion: CANARY,
        content: CANARY,
        input: CANARY,
        output: CANARY,
        body: CANARY,
        "x-cail-identity-jwt": CANARY,
        "X-CAIL-Email": CANARY,
      } as unknown as CailLogFields);

      // 3. Sensitive wrappers, in string fields, number fields, and quota.
      log.info(CAIL_EVENTS.REQUEST_COMPLETED, {
        subject: sensitive(CANARY),
        release: sensitive(CANARY),
        status: sensitive(CANARY),
        quota: { state: sensitive(CANARY), used: sensitive(CANARY) },
      } as unknown as CailLogFields);

      // 4. A raw hostile object (JSON.parse path, __proto__ smuggling).
      log.info(
        CAIL_EVENTS.REQUEST_COMPLETED,
        JSON.parse(
          `{"__proto__":{"leak":"${CANARY}"},"prompt":"${CANARY}","deep":{"nested":"${CANARY}"}}`,
        ) as CailLogFields,
      );

      // 5. The event name itself.
      log.info(`user typed ${CANARY}`);
      log.info(CANARY);

      // 6. error_code (slug-gated), enums, numbers, service override, level.
      log.error(CAIL_EVENTS.UPSTREAM_ERROR, {
        error_code: CANARY,
        outcome: CANARY,
        principal_type: CANARY,
        status: CANARY,
        service: CANARY,
      } as unknown as CailLogFields);
      log.log(CANARY as CailLogLevel, CAIL_EVENTS.REQUEST_COMPLETED);

      // 7. Nested quota unknown key.
      log.info(CAIL_EVENTS.QUOTA_CHARGED, {
        quota: { state: "ok", note: CANARY } as never,
      });
    }

    // 8. Sensitive interpolation/serialization outside the logger.
    const s = sensitive(CANARY);
    lines.push(`${s}`, String(s), JSON.stringify(s), JSON.stringify({ s }));

    // Nothing emitted anywhere — captured events, default-sink lines, or
    // console.error notes — may contain the canary (or even its suffix).
    const everything =
      JSON.stringify(events) + "\n" + lines.join("\n");
    expect(events.length).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
    expect(everything).not.toContain(CANARY);
    expect(everything).not.toContain("7f3a");
    expect(everything).not.toContain("CANARY");

    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
