# @cuny-ai-lab/cail-log

`cail-log` is CAIL's pre-release operational event primitive. It emits small,
privacy-constrained lifecycle and diagnostic events in Cloudflare Workers,
browsers, Bun, and Node 20 or newer.

The record is aligned with the OpenTelemetry Logs Data Model and semantic
conventions. It is not an OpenTelemetry SDK or an OTLP exporter. Collection,
sampling, retention, export, and dashboards remain separate concerns. The
package includes deterministic projections for Cloudflare Workers Logs and
Workers Analytics Engine so every producer uses the same field positions; the
storage products still own delivery, sampling, retention, and querying.

## Guarantees

- Event names come from a catalog that defines one structure per event.
- Event bodies, source profiles, severity policies, required fields, and
  optional fields are catalog-owned rather than call arguments.
- Event fields are narrowed in TypeScript and validated again at runtime.
- Service identity and deployment environment are constructor-owned resource
  attributes.
- Tenant loggers cannot claim platform identity, application, model, cost,
  cohort, or user facts.
- A malformed field container or a malformed, missing, contradictory, or
  known-but-disallowed defined field drops the event with a content-free
  diagnostic instead of creating a weaker event. An optional property set to
  `undefined` is treated as omitted, matching ordinary TypeScript consumers.
- Unknown arbitrary keys are ignored and never become log content.
- Logging and diagnostic failures do not throw into the application path.
- Sink selection is explicit. The Workers sink emits one structured, queryable
  JSON object.
- `fanoutSinks()` invokes every selected sink even if another fails, so a
  diagnostic destination cannot suppress the fleet-analytics projection.
- Every exported sink and projection rejects a caller-constructed event before
  it writes. Only the exact frozen object produced by this package instance's
  `createCailLogger()` is accepted.
- Service-local catalogs cannot define bodies. Every service-local event uses
  the library-owned body `Service event recorded.`

These rules close common free-text channels. They cannot prove the semantic
origin of every valid machine identifier. Trusted platform callers still have
to classify values correctly and must not place personal data in fields such
as model, cohort, or provider identifiers.

The guarantee applies to the supported public path: a validated catalog,
`createCailLogger()`, and adapters from the same installed package instance.
It is not a sandbox against arbitrary code in the process. A custom sink can
still copy a validated event elsewhere, and events produced by one duplicate
package instance are rejected by another instance's adapters.

Validation rejects common secret-token shapes as well as the field grammar,
and the canary suite covers PII-shaped values, secret shapes that deliberately
fit identifier fields, error paths, catalog names, and direct adapter calls.
It cannot establish semantic provenance for every syntactically valid
identifier. Trusted platform callers must still keep personal data out of
model, cohort, provider, and other machine-identifier fields.

## Install

The package is published to GitHub Packages under the `@cuny-ai-lab` scope.
Add the registry mapping to the consuming repository's `.npmrc` (resolution
only — never commit a token):

```
@cuny-ai-lab:registry=https://npm.pkg.github.com
```

Pin an exact published release, then run `bun install` with `NODE_AUTH_TOKEN`
set in the environment to a GitHub PAT that has `read:packages` (supplied by a
user-level `~/.npmrc` or a CI secret).

Maintainers publish a stable (non-prerelease) GitHub release whose `vX.Y.Z` tag
matches `package.json`. The workflow checks out that tag, installs with the
frozen Bun lockfile, verifies the tag's package version, runs the package
checks, tests, type-check, build, and pack check, then publishes to GitHub
Packages. The published package includes generated `dist` files.

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
  subjectVersion: "v1",
  catalog: CAIL_EVENT_CATALOG,
  sink: workersStructuredSink,
});

log.emit(CAIL_EVENTS.SANDBOX_USAGE_SETTLED, {
  usage_id: "8b9ec144-39aa-4f1f-bda5-4c645facf2cd",
  action_id: "9f50d4a4-ef70-41b2-b225-0a5cbf2df5e7",
  product_id: "kale-workbench",
  principal: {
    type: "user",
    subject: "cail-v1-0123456789abcdef0123456789abcdef",
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
and service-local events. A service-local definition supplies source, severity,
required and optional fields, and optional terminal constraints. It cannot
supply `body`; TypeScript rejects that property and the runtime rejects it when
types are bypassed. Logger construction rejects catalog-shaped objects that did
not pass one of these definition functions.

### Canonical fleet events

| Event | Required semantic core |
|---|---|
| `cail.action.admitted` | action, product, principal |
| `cail.action.terminal` | action, product, principal, outcome/reason, duration |
| `cail.request.received` | request, product, HTTP method, route template |
| `cail.request.completed` | request, product, HTTP facts, outcome/reason, duration |
| `cail.auth.denied` | request, product, principal, HTTP facts, denied outcome |
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
  "schema_version": 2,
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

`workersStructuredSink` carries every field from the accepted event in one flat
JSON object. It flattens resources and attributes, renames
`schema_version` to `cail.schema.version` and `event_name` to `event.name`, and
passes one object to Cloudflare. Exact severity remains in `severity_text` and
`severity_number`. Cloudflare console severity is coarser: fatal and error use
`console.error`, warn uses `console.warn`, and info, debug, and trace use
`console.log`.

The sinks and `toWorkersLogEvent()` accept only records received from a
`createCailLogger()` sink callback in the same package instance. A structural
lookalike throws `TypeError` before console output.

`workersStructuredSink` constrains custom console events only. Cloudflare
separately creates invocation logs, which can contain request URL and response
metadata. A production pilot must either set
`observability.logs.invocation_logs` to `false` or explicitly approve the
native fields, retention, access, and
purpose. The choice belongs in deployment configuration, not this package.

### Fleet analytics projection

Cloudflare Workers Logs is a short-lived diagnostic surface and does not expose
a programmatic query API for the fleet console's aggregate trends. The optional
Analytics Engine projection writes the same accepted event to the versioned
`cail_fleet_events_v1` dataset:

```ts
import {
  createAnalyticsEngineSink,
  fanoutSinks,
  workersStructuredSink,
} from "@cuny-ai-lab/cail-log";

const sink = fanoutSinks(
  workersStructuredSink,
  createAnalyticsEngineSink(env.CAIL_FLEET_EVENTS),
);
```

`toAnalyticsEngineDataPoint()` owns the complete ordered-column projection.
`CAIL_ANALYTICS_ENGINE_BLOBS` and `CAIL_ANALYTICS_ENGINE_DOUBLES` publish the
one-based positions used by queries. Missing strings are empty; missing
nonnegative numeric facts use `CAIL_ANALYTICS_ENGINE_MISSING_NUMBER` (`-1`), so
zero never means unknown. The point index is deployment environment plus
trusted `product_id`, with a namespaced service fallback for service-local
events. This prevents noisy test or staging traffic from sharing a production
sampling boundary.

The fleet projection intentionally omits stable user pseudonyms, per-event
UUIDs, and settled usage facts. Model-limit state and Sandbox allocation come
from their authoritative accounting APIs. The aggregate projection retains the
privacy-safer cohort. Unused blob and double positions remain reserved for
future schema growth.

Analytics Engine is diagnostic only. It may sample, retains data for its native
platform window, and cannot replace authoritative product state, model
accounting, or Sandbox accounting. Weighted aggregate success/error/latency
queries use `_sample_interval` and expose sampling evidence. Exact lifecycle
pairing, duplicates, missing terminals, and individual event sequences require
a product-owned durable state store; Analytics Engine cannot prove them even
when the observed sample interval is one.

The adapter writes one point for each accepted event. Canonical producers emit
a bounded number of lifecycle events per invocation and must not use `cail-log`
as a bulk-event transport.

`toAnalyticsEngineDataPoint()` and `createAnalyticsEngineSink()` enforce the
same logger-produced-record gate as the console sinks. A caller-constructed
`CailLogEvent` throws before a data point is returned or written.

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
| `principal.type` | `cail.principal.type` | platform |
| `principal.subject` | `enduser.pseudo.id` | platform |
| `cohort` | `cail.cohort.id` | platform |
| `product_id` | `cail.product.id` | platform |
| `provider` | `gen_ai.provider.name` | platform |
| `request_model` | `gen_ai.request.model` | platform |
| `response_model` | `gen_ai.response.model` | platform |
| `input_tokens` | `gen_ai.usage.input_tokens` | platform |
| `output_tokens` | `gen_ai.usage.output_tokens` | platform |
| `cost_micro_usd` | `cail.gen_ai.cost.micro_usd` | platform |
| `usage.kind` | `cail.usage.kind` | platform |
| `usage.unit` | `cail.usage.unit` | platform |
| `usage.quantity` | `cail.usage.quantity` | platform |

HTTP methods use the OpenTelemetry known-method vocabulary, including `QUERY`,
plus `_OTHER`. The `route` grammar accepts bounded path templates such as
`/users/{user_id}` and rejects URLs, queries, and control characters. Syntax
cannot distinguish a safe static router template from an identifier-bearing
raw path such as `/users/example-user`; the trusted producer must pass the
router template and keep a raw-path canary in its tests. The portable record
uses `url.template` for the route attribute.

Product outcome is explicit and does not derive from HTTP status, so an
application failure returned in an HTTP 200 response remains visible. Outcome
and terminal reason must be coherent: for example, `ok` pairs with `completed`,
while `timeout` pairs with `timeout`. `error.type` on an `ok` event is a
contract error rather than a silently corrected record.

`principal`, `trace`, and `terminal` are atomic input facts. Their nested,
discriminated types prevent partial or contradictory combinations before
runtime: identified users and canaries require a pseudonymous subject;
anonymous, app, and service principals cannot carry one; trace context is
all-or-nothing; and each outcome accepts only its closed reason set. The sink
still emits scalar OpenTelemetry-aligned record fields and attributes.

`service.name` is the emitting component. `product_id` is trusted per-event
attribution for a fleet product such as Workbench or Site Studio.

The canonical subject shape is
`cail-<version>-<32-lowercase-hex-characters>`. Platform logger construction
requires `subjectVersion`, and a user or canary subject must carry that exact
version. Versions use 1–16 lowercase letters, digits, or underscores and begin
with a letter or digit. Tenant loggers cannot configure a subject version.

The value is pseudonymous and remains linkable personal data. Prefer a coarse,
policy-defined `cohort` when a per-person view is not necessary. This package
does not derive the HMAC or prove identity-boundary provenance. The trusted
identity boundary owns keyed derivation and version coordination; it must never
use an email local part, raw IdP subject, or unkeyed digest.

Use `isOperationalLogSubject` only to validate stored or transported event
data. It does not derive the pseudonym. The trusted identity boundary must
perform the separate keyed derivation documented above. The packaged
`contract/operational-event-v2.json` fixture pins distinct ownership and log
pseudonym payloads, correlation headers, event shape, and forbidden unsafe
fields.

### Numeric field semantics

- `req_bytes` is a nonnegative safe-integer request-body size excluding
  headers.
- `input_tokens` and `output_tokens` are nonnegative safe-integer totals for
  the one model call. Input totals include cached input tokens and output totals
  include reasoning tokens when the provider reports those components.
- `cost_micro_usd` is a nonnegative safe-integer observed model-call cost in
  millionths of one US dollar. It carries no cost source or quality and is not
  an accounting adjustment or charge authority.
- `duration_ms` is finite, nonnegative milliseconds and may be fractional.
  Retry counts, byte counts, token counts, money, and settled usage quantities
  must be safe integers.
- Settled Sandbox usage is exact integer MiB-milliseconds from the trusted
  meter. GiB-seconds and allocated cost are downstream derived facts.

Omission means unknown or unavailable; an explicit zero means measured zero.
Workers Logs omit absent attributes. The Analytics Engine projection
uses `-1` for missing nonnegative numeric facts. Operational cost and token
fields remain diagnostic observations; the durable accounting service owns
cost quality, reconciliation, corrections, and authoritative totals.

## Settled usage

The canonical `cail.sandbox.usage.settled` event requires a platform-minted
`usage_id`, trusted product and principal attribution, and exact integer
`sandbox_compute`/`mib_milliseconds`.

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
Action, call, and usage IDs use lowercase UUID v4 values. Request IDs accept
lowercase UUID v4 and UUID v7 values; this library still mints UUID v4 when no
valid request ID is present. A trusted boundary must mint action, call, and
usage IDs; tenant-supplied identifiers are diagnostic hints until a collector
validates their provenance.

`correlationFromHeaders()` accepts `Headers`, a Request-like `{ headers }`, or
a structural `{ get(name) }` reader. It adopts a valid W3C trace, creates a new
span for the current hop, adopts a lowercase UUID v4 or UUID v7
`X-CAIL-Request-Id`, or mints a UUID v4 when that header is absent or invalid.

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

The W3C baseline is the 2021 Trace Context Recommendation: the helper carries
the sampled bit, creates a fresh span for each hop, forwards valid
`tracestate`, and emits version `00`. `X-CAIL-Request-Id` is a separate CAIL
contract. Only a lowercase UUID v4 or UUID v7 in that header is adopted. Other
UUID versions, uppercase values, and malformed values cause a new UUID v4 to be
minted. Every fleet ingress must normalize to `X-CAIL-Request-Id` before
relying on cross-service request-ID correlation.

## Diagnostics and sensitive values

The optional `onDiagnostic` callback receives one closed code: `clock_error`,
`event_contract_error`, `event_invalid`, `event_dropped`, or `sink_error`. It
never receives the original error or event content.

The logger contains synchronous throws and rejected promise-like returns from
the sink and diagnostic callbacks. It does not await asynchronous delivery.
A Cloudflare sink that performs I/O must synchronously register that promise
with `ExecutionContext.waitUntil()` so the runtime keeps it alive; returning a
promise to `cail-log` only gives the library a rejection to contain.

This fire-and-forget behavior means `cail-log` is not an accounting ledger and
cannot prove that every admitted action reached a terminal state. The durable
action/call store is authoritative; log events are diagnostic projections of
admission and terminal transitions.

The package does not retry a sink, deduplicate events, enforce idempotency,
authorize callers, or resolve an ambiguous delivery outcome. Those
responsibilities remain with the producer and the durable service that owns the
underlying state transition.

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

Semantic conventions evolve, especially GenAI attributes. Changes require an
explicit schema decision; the package will not silently rename emitted fields.

Portable `schema_version` is currently `2`. The Analytics Engine
projection has its own exported schema version and append-only positional
mapping. The package version, component `service.version`, and service-local
catalog version are separate concerns. Producers that add or change
service-local event definitions must version their event contract; the shared
`schema_version` does not define those local events.

## Development

```bash
bun install
bun run test
bun run typecheck
bun run build
bun run verify
```

The suite covers the record envelope, Cloudflare projection, closed event
catalogs, trust profiles, hostile inputs, failure
containment, W3C propagation, and a PII-shaped canary attempted through every
runtime field.

`verify` builds generated `dist`, runs tests and type-checking, and inspects the
package contents. `dist` is generated at build and is not committed. CI installs
from the frozen Bun lockfile and runs the same command. Publishing occurs only
from a stable GitHub release after the workflow checks the tag's package
version, runs the package checks, tests, type-check, build, and pack check, and
then publishes.

[DESIGN.md](DESIGN.md) is the canonical architecture, security, and operations
guide. This README is the consumer guide.

## License

MIT — see [LICENSE](LICENSE).
