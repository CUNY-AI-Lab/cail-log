# cail-log architecture and security

Status: pre-release schema 2; production activation requires the external
controls listed below.

This file is the canonical architecture, trust-boundary, security, operations,
and adoption guide. [README.md](README.md) is the consumer guide. Exported
types and tests are the executable field contract.

## Contract boundary

`@cuny-ai-lab/cail-log` constructs small operational events. The portable
record follows the OpenTelemetry Logs Data Model: resource identity, record
fields, trace context, and scalar attributes remain separate. Established
OpenTelemetry names are used where they fit; CAIL facts use `cail.*`.

The package owns:

- portable schema versioning and immutable record construction;
- canonical and service-local event catalogs;
- field types, runtime validation, trust profiles, and severity mapping;
- content-free diagnostic codes;
- logger-produced event provenance for public sinks and projections;
- Workers Logs, NDJSON, and Analytics Engine adapters; and
- W3C trace and CAIL request-correlation helpers.

It does not own authentication, authorization, quota decisions, durable state,
collection, deployment provenance, retention, export, alerting, or dashboards.
It is not an OpenTelemetry SDK, OTLP exporter, retry queue, accounting ledger,
or audit log.

## Construction and adapter boundary

The public construction path is:

1. build a frozen catalog with `defineEventCatalog()`,
   `extendCailEventCatalog()`, or `CAIL_EVENT_CATALOG`;
2. construct a platform or tenant logger with `createCailLogger()`;
3. emit a catalog event with its exact typed fields; and
4. send the resulting frozen object to public adapters from the same installed
   package instance.

Canonical catalog entries own the event body, source profile, severity policy,
required and optional fields, and optional terminal constraints. The `cail.*`
namespace is library-owned. A service-local catalog cannot supply a body;
every local event receives `Service event recorded.` Types reject a `body`
property, and runtime validation rejects it when types are bypassed.

An event with a malformed, missing, contradictory, or known-but-disallowed
field is dropped with `event_contract_error`. Unknown arbitrary keys are
ignored and never become attributes. An unknown event name produces the fixed
`event.invalid` record without echoing the rejected name.

Every public console sink, projection helper, Analytics Engine sink, and
`fanoutSinks()` checks an instance-local opaque provenance mark. A structural
`CailLogEvent` lookalike throws before output. An event made by one duplicate
installation is not accepted by another installation's adapters. Consumers
must deduplicate package installations when records cross module boundaries.
Arbitrary code in the same process is outside the isolation model; in
particular, a custom sink can copy a validated event.

## Record contract

Portable schema 2 contains:

- `schema_version: 2`;
- an ISO-8601 UTC timestamp;
- OpenTelemetry severity text and number;
- a catalog-owned event name and fixed body;
- constructor-owned service namespace, name, version, and environment; and
- scalar attributes containing at least `cail.source.class`.

Trace ID, span ID, and flags appear only as a complete valid group. All-zero
trace and span IDs are rejected. Attributes are strings, finite numbers, or
booleans. Nested application objects are accepted only as the typed `principal`,
`trace`, `terminal`, `quota`, and `usage` inputs and are flattened after full
validation.

Platform loggers require `subjectVersion`. Tenant loggers reject it and cannot
emit product attribution, project identity, principals, cohorts, model facts,
cost, quota, or settled usage. The tenant profile prevents accidental claims;
it is not an authorization boundary against malicious application code.

Severity uses OpenTelemetry numbers 1, 5, 9, 13, 17, and 21. Static severity is
catalog-owned. Outcome events map success and cancellation to info; client
error, denial, and unknown outcome to warn; and error and timeout to error.
Workers console routing is coarser but retains exact severity fields in the
structured object.

## Privacy and identity

The supported input surface has no general message, attributes bag, headers,
raw URL, exception, filename, prompt, completion, IP address, user agent,
email, or IdP-subject field. Control characters and line separators are
rejected in string fields. Routes are bounded templates such as
`/users/{user_id}`, never raw request paths.

String validation combines a field grammar with a detector for common secret
token shapes. Regression canaries include PII-shaped content, secret shapes
that satisfy machine-identifier grammar, secret-shaped catalog names,
exception paths, and direct adapter calls. No finite detector can establish
semantic provenance for every valid identifier. Platform producers and the
collector still need field-specific provenance rules, secret scanning, and
tests for their own credential formats.

User and canary principals use
`cail-<version>-<32-lowercase-hex-characters>`. The configured version is 1–16
lowercase letters, digits, or underscores and begins with a letter or digit.
The logger rejects unversioned or mismatched subjects. The value remains
linkable personal data and needs retention and access controls.

The trusted identity boundary owns keyed derivation, normalization, rotation,
and the fleet-wide version value. It must not use an email local part, raw IdP
subject, or unkeyed digest. This library validates representation and configured
version, not HMAC provenance. Cohorts are preferred when a per-person view is
not required.

## Identity, routing, and state invariants

`service.name` is the constructor-owned emitting component.
`cail.product.id` is trusted per-event fleet-product attribution.
`cail.kale.project.name` is a Kale tenant project. Shared gateways and
collectors must not conflate these scopes or accept tenant claims as fleet
provenance.

Request, action, call, and usage IDs are lowercase UUID v4 values with separate
meanings. A request covers one transport request. An action covers one admitted
user-facing attempt. A call covers one billable child operation. A usage ID
covers one immutable source settlement and its idempotent delivery retries.
Only the canonical settled event asserts accounting acknowledgement.

Product outcome and terminal reason form one closed fact. Success pairs only
with `completed` and cannot carry `error.type`. Product outcome is not inferred
from HTTP status; an application failure may legitimately have HTTP 200.

The logger does not retry or deduplicate sink delivery and cannot resolve an
ambiguous outcome. The producer's durable state transition and idempotency key
come first. One logger call attempts one sink call. Synchronous errors and
rejected promise-like returns become `sink_error` without entering application
control flow. Asynchronous Worker I/O must be registered synchronously with
`ExecutionContext.waitUntil()`.

Quota facts are diagnostic snapshots with a closed kind/unit pair. The logger
derives `remaining = max(limit - used, 0)`. It does not authorize a request or
charge an account. Sandbox settled usage is exact integer MiB-milliseconds from
the trusted meter after durable accounting acknowledges the idempotent fact.
Outbox retries use a service-local event, not the canonical settled event.

## Numeric semantics

Byte, token, micro-USD cost, retry, quota, and usage fields are nonnegative safe
integers. Durations are finite nonnegative milliseconds and may be fractional.
Omission means unknown; zero means measured zero. Request and response bytes
are payload-body bytes excluding headers, using transferred compressed size
when transport compression applies. Token totals include cached input and
reasoning output when the provider reports those components. Observed model
cost is diagnostic and never an accounting adjustment.

Analytics Engine uses `-1` for missing nonnegative numeric values. Queries must
exclude that sentinel rather than treating it as zero.

## Projection contracts

NDJSON carries the nested portable record. Workers Logs carries the same facts
as one flat object, renaming `schema_version` to `cail.schema.version` and
`event_name` to `event.name`. Neither projection adds application content.

Analytics Engine dataset `cail_fleet_events_v1` has its own projection schema
version 1. Blob and double positions are append-only and exported as one-based
constants. The point index is environment plus trusted product ID, with a
namespaced service fallback. Stable user pseudonyms, per-event UUIDs, quota
tuples, settled usage, and Kale project identity are deliberately omitted.
Reserved positions remain empty for append-only growth.

Analytics Engine is sampled diagnostic storage. Weighted aggregate queries
must use `_sample_interval` and expose sampling evidence. It cannot prove
individual delivery, exact action pairing, duplicates, or missing terminals.
Those facts belong in product-owned durable state. Each event creates one data
point; producers must stay below the exported 250-points-per-invocation limit.

Cloudflare invocation logs are separate from custom console events and can
contain request URL and response metadata. Deployment configuration must set
`observability.logs.invocation_logs` to `false` or explicitly approve those
fields, retention, access, and purpose.

## Correlation

The W3C baseline is Trace Context 2021. A valid inbound `traceparent` keeps its
trace ID and sampled decision while receiving a fresh local span. A new trace
defaults to unsampled unless the caller supplies a recording decision. Valid
`tracestate` is forwarded only beside a valid trace, with the 512-character and
32-member limits enforced.

`X-CAIL-Request-Id` is the only adopted request-ID header and must contain a
lowercase UUID v4. Malformed values, other UUID versions, uppercase UUIDs, and
`X-Request-Id` cause a new UUID v4 to be minted. Fleet ingress must normalize to
the CAIL header before cross-service correlation relies on it.

## Schema 2 adoption and rollback

Schema 2 changes the subject representation and adapter boundary. A platform
consumer must configure the identity boundary's `subjectVersion`, emit subjects
with that version, and allow portable `schema_version: 2`. Service-local catalog
definitions must remove `body`. Directly constructed events must be replaced
with logger-produced events. There is no database or durable-state migration in
this repository; existing schema-1 logs remain historical records.

Collectors that can receive records during a mixed rollout must branch on
`schema_version`. Rollback after schema-2 emission requires either continued
collector support for both versions or a pause in emission while consumers are
reverted. Analytics Engine retains projection schema 1 and records portable log
schema 2 in its existing `log_schema_version` double column.

The package remains below 1.0. Pin a reviewed commit. Do not publish or deploy
from an unverified checkout.

## External activation requirements

Production activation remains outside this repository and requires:

- one fleet identity subject version and keyed derivation policy;
- authoritative product and deployment mapping in producers or the collector;
- product-owned durable action, call, and usage state with idempotent writes;
- Cloudflare retention, export, access, included-volume, and cost decisions;
- an explicit invocation-log decision;
- consumer compile fixtures and collector golden fixtures for schema 2;
- producer-specific secret/PII canaries and bounded event-count tests; and
- a synthetic sandbox or local end-to-end collector test before deployment.

No Cloudflare binding, production dataset, secret, domain, OAuth grant, or
durable production data is changed by this repository's build or test suite.

## Verification and recovery

`bun run verify` performs an isolated source build and compares it with
committed `dist`, runs all tests, type-checks source and tests, and inspects the
package contents. CI installs from the frozen Bun lockfile and runs the same
command on pull requests and pushes to `main`. The parity test also injects a
stale generated file and proves the check fails.

Runtime rollback is a producer and collector deployment operation. Logging is
non-authoritative, so loss of a diagnostic sink does not roll back application
state. Operators should alert on content-free diagnostic counts, preserve the
authoritative durable transition, and reconcile diagnostics from that state
rather than replaying untrusted log payloads.

The standards baseline is OpenTelemetry semantic conventions `1.43.0`,
`open-telemetry/semantic-conventions-genai@63f8200eee093730ce845d26ce2aafb621b0807e`,
and W3C Trace Context 2021. Changing emitted semantic names or positional
columns requires an explicit schema decision and updated golden fixtures.
