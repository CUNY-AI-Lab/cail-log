# @cuny-ai-lab/cail-log

`cail-log` is CAIL's pre-release operational event primitive. It emits small,
privacy-constrained lifecycle and diagnostic events in Cloudflare Workers,
browsers, Bun, and Node 20 or newer.

The record is aligned with the OpenTelemetry Logs Data Model and semantic
conventions. It is not an OpenTelemetry SDK or an OTLP exporter. Collection,
sampling, retention, export, and dashboards remain separate concerns.

## Guarantees

- Event names come from a catalog that defines one structure per event.
- Event bodies, source profiles, severity policies, required fields, and
  optional fields are catalog-owned rather than call arguments.
- Event fields are narrowed in TypeScript and validated again at runtime.
- Service identity and deployment environment are constructor-owned resource
  attributes.
- Tenant loggers cannot claim platform identity, application, project, model,
  cost, cohort, user, or quota facts.
- A malformed, missing, contradictory, or known-but-disallowed field drops the
  event with a content-free diagnostic instead of creating a weaker event.
- Unknown arbitrary keys are ignored and never become log content.
- Logging and diagnostic failures do not throw into the application path.
- Sink selection is explicit. The Cloudflare sink emits one structured,
  queryable JSON object; the JSON-line sink is a separate deliberate choice.

These rules close common free-text channels. They cannot prove the semantic
origin of every valid machine identifier. Trusted platform callers still have
to classify values correctly and must not place personal data in fields such
as model, key, cohort, or project identifiers.

## Install

Pin a reviewed commit while the package remains below `1.0.0`:

```bash
bun add github:CUNY-AI-Lab/cail-log#<commit>
```

The repository commits `dist`, so consumers do not need a package build step.

## Create a logger

```ts
import {
  CAIL_EVENT_CATALOG,
  CAIL_EVENTS,
  createCailLogger,
  workersStructuredSink,
} from "@cuny-ai-lab/cail-log";

const log = createCailLogger({
  service: "sandbox-bridge",
  release: "218328f",
  env: "production",
  sourceClass: "platform",
  catalog: CAIL_EVENT_CATALOG,
  sink: workersStructuredSink,
});

log.emit(CAIL_EVENTS.SANDBOX_USAGE_SETTLED, {
  usage_id: "8b9ec144-39aa-4f1f-bda5-4c645facf2cd",
  action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7",
  product_id: "kale-workbench",
  principal: {
    type: "user",
    subject: "cail-0123456789abcdef0123456789abcdef",
  },
  terminal: { outcome: "ok", reason: "completed" },
  usage: {
    kind: "sandbox_compute",
    unit: "mib_milliseconds",
    quantity: 67_108_864,
  },
});
```

The catalog narrows the event name, required fields, optional fields, source
profile, and severity. An untyped unknown name emits `event.invalid` with the
fixed body `Event name rejected.` The rejected value is not echoed. Applications
may define additional events with `defineEventCatalog`, but each definition must
declare the same contract components; a name is never just a message string.
The `cail.*` namespace is reserved for the canonical library catalog so a
consumer cannot redefine a shared fleet event with a different structure.
Use `extendCailEventCatalog()` when one logger needs both canonical fleet events
and service-local events. Logger construction rejects catalog-shaped objects
that did not pass one of these definition functions.

### Canonical fleet events

| Event | Required semantic core |
|---|---|
| `cail.action.admitted` | action, product, principal |
| `cail.action.terminal` | action, product, principal, outcome/reason, duration |
| `cail.request.received` | request, product, HTTP method, route template |
| `cail.request.completed` | request, product, HTTP facts, outcome/reason, duration |
| `cail.auth.denied` | request, product, principal, HTTP facts, denied outcome |
| `cail.quota.charged` | product, principal, successful outcome, quota snapshot |
| `cail.upstream.error` | request, product, failed outcome, safe error type |
| `cail.model.call.admitted` | call, action, product, principal, provider, requested model |
| `cail.model.call.terminal` | admitted-call fields plus outcome/reason and duration |
| `cail.sandbox.usage.settled` | usage, product, principal, successful outcome, exact usage |

The exported TypeScript type is the exact field-level contract. This table is
an orientation aid, not a second schema.

## Record shape

The portable sink receives an OpenTelemetry-aligned record:

```json
{
  "schema_version": 1,
  "timestamp": "2026-07-13T16:00:00.000Z",
  "severity_text": "INFO",
  "severity_number": 9,
  "event_name": "cail.sandbox.usage.settled",
  "body": "Sandbox usage settled.",
  "resource": {
    "service.namespace": "cuny-ai-lab",
    "service.name": "sandbox-bridge",
    "service.version": "218328f",
    "deployment.environment.name": "production"
  },
  "attributes": {
    "cail.source.class": "platform",
    "cail.product.id": "kale-workbench",
    "cail.usage.id": "8b9ec144-39aa-4f1f-bda5-4c645facf2cd",
    "cail.usage.kind": "sandbox_compute",
    "cail.usage.unit": "mib_milliseconds",
    "cail.usage.quantity": 67108864
  }
}
```

`severity_number` uses the OpenTelemetry bands `1`, `5`, `9`, `13`, `17`, and
`21` for trace through fatal. Static severity is catalog-owned. Outcome events
use one closed mapping: success and cancellation are `INFO`; client error,
denial, and unknown outcome are `WARN`; error and timeout are `ERROR`. Attribute
values are scalar strings, numbers, or booleans. Nested application objects and
arbitrary content are not accepted.

`workersStructuredSink` projects this record into one flat JSON object. For
example, `resource["service.name"]` becomes the top-level key `service.name`.
Cloudflare Workers Logs can then filter, group, and aggregate those fields
without making Cloudflare's storage format the portable package contract.

This sink constrains custom console events only. Cloudflare separately creates
invocation logs, which can contain request URL and response metadata. A
production pilot must either set `observability.logs.invocation_logs` to
`false` or explicitly approve the native fields, retention, access, and
purpose. The choice belongs in deployment configuration, not this package.

## Field mapping

Callers use short input names; emitted attributes use established semantic
conventions when one exists.

| Input | Emitted attribute | Profile |
|---|---|---|
| `request_id` | `cail.request.id` | both |
| `action_id` | `cail.action.id` | both |
| `call_id` | `cail.call.id` | both |
| `usage_id` | `cail.usage.id` | platform |
| `http_method` | `http.request.method` | both |
| `route` | `url.template` | both |
| `status` | `http.response.status_code` | both |
| `trace.trace_id` | log-record `trace_id` | both |
| `trace.span_id` | log-record `span_id` | both |
| `trace.trace_flags` | log-record `trace_flags` | both |
| `terminal.outcome` | `cail.outcome` | both |
| `terminal.reason` | `cail.outcome.reason` | both |
| `error_type` | `error.type` | both |
| `req_bytes` | `http.request.body.size` | both |
| `resp_bytes` | `http.response.body.size` | both |
| `principal.type` | `cail.principal.type` | platform |
| `principal.subject` | `enduser.pseudo.id` | platform |
| `cohort` | `cail.cohort.id` | platform |
| `product_id` | `cail.product.id` | platform |
| `project` | `cail.kale.project.name` | platform |
| `provider` | `gen_ai.provider.name` | platform |
| `request_model` | `gen_ai.request.model` | platform |
| `response_model` | `gen_ai.response.model` | platform |
| `input_tokens` | `gen_ai.usage.input_tokens` | platform |
| `output_tokens` | `gen_ai.usage.output_tokens` | platform |
| `cost_micro_usd` | `cail.gen_ai.cost.micro_usd` | platform |
| `usage.kind` | `cail.usage.kind` | platform |
| `usage.unit` | `cail.usage.unit` | platform |
| `usage.quantity` | `cail.usage.quantity` | platform |

HTTP methods use the OpenTelemetry known-method vocabulary plus `_OTHER`.
Routes must be templates such as `/users/{user_id}`, never raw request paths or
URLs, and are capped at 160 characters. Product outcome is explicit and does
not derive from HTTP status, so an application failure returned in an HTTP 200
response remains visible. Outcome and terminal reason must be coherent: for
example, `ok` pairs with `completed`, while `timeout` pairs with `timeout`.
`error.type` on an `ok` event is a contract error rather than a silently
corrected record.

`principal`, `trace`, and `terminal` are atomic input facts. Their nested,
discriminated types prevent partial or contradictory combinations before
runtime: identified users and canaries require a pseudonymous subject;
anonymous, app, and service principals cannot carry one; trace context is
all-or-nothing; and each outcome accepts only its closed reason set. The sink
still emits scalar OpenTelemetry-aligned record fields and attributes.

`service.name` is the emitting component. `product_id` is trusted per-event
attribution for a fleet product such as Workbench or Site Studio. `project` is
only a Kale Deploy tenant project. Shared gateways must not conflate these
three scopes.

The canonical subject shape is `cail-` plus 32 lowercase hexadecimal
characters. It is pseudonymous, not anonymous: a stable pseudonym can still be
linkable personal data. Prefer a coarse, policy-defined `cohort` when a
per-person view is not necessary.

## Quotas

Quota input contains `kind`, its matching `unit`, `state`, `limit`, `used`, and
an ISO-8601 reset timestamp. The logger derives `remaining` as
`max(limit - used, 0)` and emits scalar `cail.quota.*` attributes.

```ts
log.emit(CAIL_EVENTS.QUOTA_CHARGED, {
  product_id: "kale-workbench",
  principal: {
    type: "user",
    subject: "cail-0123456789abcdef0123456789abcdef",
  },
  terminal: { outcome: "ok", reason: "completed" },
  quota: {
    kind: "model_spend",
    unit: "micro_usd",
    state: "fresh",
    limit: 10_000_000,
    used: 188_977,
    reset_at: "2026-08-12T16:00:00.000Z",
  },
});
```

Valid pairs are `model_spend`/`micro_usd`, `request_count`/`requests`,
`build_count`/`builds`, `storage`/`bytes`, `compute`/`milliseconds`, and
`sandbox_compute`/`gib_seconds`.

## Settled usage

Quota is a window snapshot; settled usage is an immutable measured occurrence.
The canonical `cail.sandbox.usage.settled` event requires a platform-minted
`usage_id`, trusted product and principal attribution, and exact integer
`sandbox_compute`/`mib_milliseconds`. A quota snapshot may accompany it.

The log is not the charge authority. SandboxMeter settlement and durable
accounting ingestion happen first. The event is emitted only after accounting
acknowledges the idempotent usage fact.

The source settlement may mint `usage_id` before accounting delivery succeeds,
so the same ID can correlate bounded outbox retries. Those retries use a
service-local event such as `sandbox_bridge.outbox.delivery_failed`, defined
with `extendCailEventCatalog()`. They must not emit
`cail.sandbox.usage.settled` or otherwise claim accounting acknowledgement.

## Correlation

`request_id` identifies one HTTP request. `action_id` identifies a user-facing
workflow attempt that can span requests, retries, model calls, and sandbox
work. `call_id` identifies one billable child call. `usage_id` identifies one
immutable source settlement fact, such as sandbox compute, and may correlate
its idempotent accounting-delivery retries. The canonical settled log event
additionally means the accounting service acknowledged that fact.
All four use lowercase UUID v4 values. A trusted boundary must mint action,
call, and usage IDs;
tenant-supplied identifiers are diagnostic hints until a collector validates
their provenance.

`correlationFromHeaders()` accepts `Headers`, a Request-like `{ headers }`, or
a structural `{ get(name) }` reader. It adopts a valid W3C trace, creates a new
span for the current hop, and adopts or mints a lowercase UUID v4
`X-CAIL-Request-Id`.

```ts
const correlation = correlationFromHeaders(request.headers, {
  sampled: span.isTraced,
});

log.emit(CAIL_EVENTS.ACTION_ADMITTED, {
  action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7",
  product_id: "kale-workbench",
  principal: { type: "anonymous" },
  request_id: correlation.request_id,
  trace: correlation,
});
```

If `sampled` is omitted, an inbound sampled decision is preserved; a new trace
defaults to `0`, as required for a deferred decision. The helper never invents
a sampled decision. `outboundCorrelationHeaders()` validates the correlation
and writes the matching `traceparent`, request ID, and normalized `tracestate`.
W3C-valid empty `tracestate` list members are accepted and removed; an entirely
empty value is not forwarded.

## Diagnostics and sensitive values

The optional `onDiagnostic` callback receives one closed code: `clock_error`,
`event_contract_error`, `event_invalid`, `event_dropped`, or `sink_error`. It
never receives the original error or event content.

The logger contains synchronous throws and rejected promise-like returns from
both sinks and diagnostic callbacks. It does not await asynchronous delivery.
A Cloudflare sink that performs I/O must synchronously register that promise
with `ExecutionContext.waitUntil()` so the runtime keeps it alive; returning a
promise to `cail-log` only gives the library a rejection to contain.

This fire-and-forget behavior means `cail-log` is not an accounting ledger and
cannot prove that every admitted action reached a terminal state. The durable
action/call store is authoritative; log events are diagnostic projections of
admission and terminal transitions.

`sensitive(value)` wraps a secret so string conversion, JSON serialization,
template interpolation, and Node inspection produce `[REDACTED]`. A wrapper in
an allowed event field causes a content-free contract failure and drops the
event. Deliberately reading `.value` unwraps the secret for application use.

## Standards position

The core contract is pinned for this candidate to OpenTelemetry semantic
conventions `1.43.0`. GenAI attributes are pinned to
`open-telemetry/semantic-conventions-genai` commit
`63f8200eee093730ce845d26ce2aafb621b0807e`; that project currently has no
published release or schema URL. An upgrade is an explicit schema review, not
an automatic rename.

The contract follows the
[OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/),
[OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/),
and the [W3C Trace Context Recommendation](https://www.w3.org/TR/trace-context/).
The Cloudflare projection follows
[Workers Logs structured JSON guidance](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
Privacy and failure behavior follow the
[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

Semantic conventions evolve, especially GenAI attributes. A future convention
change requires an explicit schema decision; the package will not silently
rename emitted fields.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

The suite covers the record envelope, Cloudflare projection, closed event
catalogs, trust profiles, quota consistency, hostile inputs, failure
containment, W3C propagation, and a PII-shaped canary attempted through every
runtime field.

See [DESIGN.md](DESIGN.md) for the design gate, boundaries, pilot requirements,
and rollback plan.

## License

MIT — see [LICENSE](LICENSE).
