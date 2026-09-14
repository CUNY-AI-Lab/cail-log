# cail-log

## Recommended CAIL fleet practice

For the colleague-facing engineering and agent-review defaults, see the [CAIL Fleet Engineering and Review Practice](https://github.com/CUNY-AI-Lab/cail-knowledge-base/pull/27). This is recommended unless this repository's own contract or CI makes a rule mandatory. Use Luna workers for bounded independent tasks and Astra for an independent review of substantial or load-bearing changes; keep one primary owner responsible for the combined result and real-path verification.

- Owns the shared event catalog, field validation, correlation helpers, and sink/projection adapters.
- Catalog definitions own event names, bodies, source profiles, severity, and allowed fields; the logger validates each event before any sink is called.
- `createCailLogger()` is the supported construction path, and sinks accept events emitted by that logger instance.
- Correlation helpers handle W3C trace context and the CAIL request-id header; they do not authenticate a principal.
- Workers Logs and Analytics Engine adapters are diagnostic projections, not durable event or accounting stores.
- Producers own service business meaning, lifecycle state, identity, authorization, quotas, accounting, retries, and idempotency.
- Do not add service-specific business logic, identity derivation, authorization, quota enforcement, or delivery guarantees here.
- Keep emitted records scalar and contract-shaped so all configured sinks receive the same event.
- `bun run verify` enforces the vendored full generic anti-slop profile. Fix the
  contract or boundary that causes a finding; do not add suppressions, evasive
  wrappers, or generic `SAFETY` comments.

Check with `bun run verify`.
