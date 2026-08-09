# cail-log design gate

This package owns one small operational-record path: a validated catalog,
`createCailLogger()`, and the Workers Logs and Analytics Engine projections.
The package does not own product state, accounting, authorization, quota
decisions, delivery guarantees, or release provenance.

## Retained contract

- Correlation helpers preserve W3C trace context and the CAIL request ID.
- Canonical action, request, auth, upstream, model-call, and sandbox-settlement
  events remain the shared lifecycle vocabulary.
- Field validation accepts only bounded identifiers, route templates, terminal
  facts, usage facts, model measurements, and scalar diagnostics used by active
  fleet and Studio consumers.
- Analytics Engine keeps its append-only 20-blob/20-double positional shape;
  positions for removed observations remain missing sentinels rather than being
  renumbered. The platform's 250-point-per-invocation limit remains a producer
  boundary.
- Secret-shaped values and the public sensitive-value wrapper (`Sensitive`,
  `sensitive()`, and `isSensitive()`) are rejected before a sink receives an
  event. Diagnostics contain codes only.

## Deferred cuts

The shared schema retains quota snapshots, credential `key_id`, upstream and
response-byte observations, the JSON-line sink, the public sensitive-value
wrapper (`Sensitive`, `sensitive()`, `isSensitive()`), and the JSON contract
fixture. These paths remain because they carry explicit
validation or compatibility boundaries. Release-authority and publication
controls remain owned by the repository's existing workflow.

## Evidence and checks

The record shape follows the [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/).
Workers output follows [Cloudflare Workers Logs structured JSON](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
Analytics Engine's real platform ceiling is documented in
[Cloudflare's limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/).

Before handoff, run `bun run verify` (which includes the source/dist parity
check), then run one built-package event through a real sink boundary. The
runtime canary must execute the built package through a real sink and show
that an email/secret-shaped value is absent from the emitted record while the
diagnostic code remains content-free.
