import type { CailOutcome, CailTerminalReason } from "./schema.js";

export const TERMINAL_REASONS: Readonly<
  Record<CailOutcome, readonly CailTerminalReason[]>
> = Object.freeze({
  ok: ["completed"],
  client_error: ["client_error"],
  error: ["application_failure", "upstream_failure"],
  denied: ["denied", "quota_blocked", "rate_limited"],
  cancelled: ["cancelled"],
  timeout: ["timeout"],
  outcome_unknown: ["unknown"],
});
