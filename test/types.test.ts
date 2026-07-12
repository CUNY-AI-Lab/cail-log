/**
 * COMPILE-TIME half of L1/L2/L3: these assertions are enforced by
 * `bun run typecheck` (tsc over tsconfig.test.json) — an unused
 * `@ts-expect-error` fails the typecheck, so each line below PROVES the type
 * system rejects that shape. Vitest (esbuild) still executes the calls, so a
 * captured sink doubles as a runtime no-leak check.
 */
import { describe, it, expect } from "vitest";
import {
  createCailLogger,
  CAIL_EVENTS,
  type CailLogEvent,
} from "../src/index.js";

describe("type-level contract", () => {
  it("rejects free text and unknown fields at compile time", () => {
    const events: CailLogEvent[] = [];
    const logger = createCailLogger({
      service: "model-proxy",
      sink: (e) => events.push(e),
      clock: () => 0,
    });

    // @ts-expect-error L2 — there is NO message field to stuff free text into
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, { message: "user prompt here" });

    // @ts-expect-error L2 — no free-text positional parameter either
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, "some free text");

    // @ts-expect-error L1 — unknown fields are rejected (adding one = editing the type)
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, { user_prompt: "hi" });

    // @ts-expect-error L1 — email is NOT on the safe-to-log allowlist
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, { email: "a@gc.cuny.edu" });

    // @ts-expect-error L1 — quota is held to its own allowlist
    logger.info(CAIL_EVENTS.QUOTA_CHARGED, { quota: { balance: 10 } });

    // @ts-expect-error L1 — status is a number, not a string
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, { status: "200" });

    // @ts-expect-error L3 — "fatal" is not a CailLogLevel
    logger.log("fatal", CAIL_EVENTS.REQUEST_COMPLETED);

    // Positive control: the full typed struct compiles.
    logger.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      subject: "hmac",
      status: 200,
      outcome: "ok",
      quota: { state: "ok", remaining: 5, used: 5 },
    });

    // Runtime backstop: none of the rejected shapes leaked content.
    const json = JSON.stringify(events);
    expect(json).not.toContain("user prompt here");
    expect(json).not.toContain("some free text");
    expect(json).not.toContain("a@gc.cuny.edu");
  });
});
