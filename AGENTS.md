# cail-log

- Owns the shared event catalog, field validation, correlation helpers, and sink/projection adapters.
- Catalog definitions own event names, bodies, source profiles, severity, and allowed fields; the logger validates each event before any sink is called.
- `createCailLogger()` is the supported construction path, and sinks accept events emitted by that logger instance.
- Correlation helpers handle W3C trace context and the CAIL request-id header; they do not authenticate a principal.
- Workers Logs and Analytics Engine adapters are diagnostic projections, not durable event or accounting stores.
- Producers own service business meaning, lifecycle state, identity, authorization, quotas, accounting, retries, and idempotency.
- Do not add service-specific business logic, identity derivation, authorization, quota enforcement, or delivery guarantees here.
- Keep emitted records scalar and contract-shaped so all configured sinks receive the same event.

Check with `bun run verify`.
