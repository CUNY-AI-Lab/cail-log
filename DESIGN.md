# cail-log design gate

Status: candidate source implementation; production adoption not approved
Date: 2026-07-13

## Decision

`@cuny-ai-lab/cail-log` defines one small operational event contract. The
portable record follows the OpenTelemetry Logs Data Model: resource identity,
log-record fields, trace context, and scalar attributes remain distinct.
Established OpenTelemetry semantic attribute names are used where they fit.
CAIL-specific facts use the `cail.*` namespace.

The package does not claim OTLP compliance. It does not implement an
OpenTelemetry SDK, batch processor, exporter, collector, or sampling system.
The Cloudflare sinks project a valid portable record into a structured JSON
object for Workers Logs or a versioned positional point for Workers Analytics
Engine. These projections are adapters, not the core schema.

The package is pre-release. Existing source integrations are prototypes, not
compatibility obligations. The intended first production schema begins at
version `1`; the package stays below `1.0.0` until a pilot is complete.

The standards baseline for this candidate is OpenTelemetry semantic
conventions `1.43.0` and
`open-telemetry/semantic-conventions-genai@63f8200eee093730ce845d26ce2aafb621b0807e`.
The GenAI project currently has no release or schema URL, so changing that pin
requires a deliberate schema review and golden-fixture update.

## Event-definition correction

The envelope alone is not the event contract. OpenTelemetry events require an
event name to identify one documented structure. Before consumer adoption,
each catalog entry therefore owns:

- a static body;
- an allowed source profile;
- a default severity or the closed outcome-to-severity policy;
- required and optional input fields; and
- optional closed outcome and terminal-reason sets.

Caller inputs group dependent facts into three atomic values. `principal` is a
discriminated identity claim, `trace` is a complete three-field W3C context,
and `terminal` is a compatible outcome/reason pair. TypeScript and runtime
validation therefore accept the same combinations rather than relying on
independent optional scalar fields.

An event with a missing, malformed, contradictory, or known-but-disallowed
field is not a weaker version of that event. It is dropped with a content-free
`event_contract_error` diagnostic. Unknown arbitrary keys are ignored so an
untrusted object spread cannot create a free-text channel or suppress an
otherwise valid event.

The `cail.*` namespace is reserved for the library-owned canonical catalog.
Service-local catalogs use their own namespace and cannot redefine a fleet
event with a conflicting structure.

The public logger has one `emit(event, fields)` operation. Severity is part of
the event definition rather than a caller-controlled method name. Sink choice
is explicit: Workers use the structured-object sink, while line-oriented Node
or Bun processes may deliberately choose the JSON-line sink. `fanoutSinks`
contains each destination independently and invokes all configured sinks before
reporting one content-free sink failure to the logger.

The Analytics Engine schema is a load-bearing query contract. Blob and double
positions are append-only and exported as one-based constants. Missing numeric
facts use `-1`, which is outside every accepted nonnegative CAIL measurement;
queries must exclude it rather than treating it as zero. Deployment environment
plus trusted product ID is the sampling index. Service-local events use a
namespaced service fallback.
The projection deliberately omits trace IDs and any field outside the
catalog-approved scalar attributes.

Quota values are absent from this diagnostic projection because their meaning
requires the complete kind/unit/state/reset tuple and the authoritative model
limit lives in accounting. Stable user pseudonyms, per-event UUIDs, usage IDs,
and Kale tenant-project identity also stay in their authoritative stores. The
projection retains the privacy-safer cohort and reserves unused blob/double
positions for append-only growth rather than consuming the provider's entire
positional schema in v1.

Analytics Engine supports weighted aggregate operational trends. It does not
guarantee individual record retention, and a sample interval of one does not
prove lossless delivery. Exact action/request pairing, missing/duplicate event
checks, and workflow success gates therefore remain product-durable-state
responsibilities rather than Analytics Engine claims. Each accepted event
projects to one point, so producers must also remain below Cloudflare's current
250-points-per-invocation platform limit; this library publishes that ceiling
but does not maintain mutable invocation-global counters.

Fleet identity has three distinct scopes. `service.name` is the constructor-
owned emitting component, `cail.product.id` is trusted per-event product
attribution for shared components, and `cail.kale.project.name` is a Kale
tenant project. The older ambiguous `cail.app.name` input is not part of the
candidate production contract.

Settled non-model usage is separate from quota state. The canonical sandbox
settlement event carries `cail.usage.id`, exact integer MiB-milliseconds, and
trusted product/principal attribution. A quota snapshot may accompany it but
does not replace the settled quantity. The durable accounting fact remains the
charge authority; the log is a diagnostic projection. The source meter may
mint the usage ID into a durable outbox before accounting acknowledgement.
Delivery failures are service-local outbox events, not canonical settled
events.

## Ownership boundary

The package owns:

- schema version and record construction;
- closed event catalogs and static bodies;
- field types and runtime validation;
- platform and tenant trust profiles;
- severity and portable sinks;
- privacy-safe diagnostic codes; and
- W3C trace and CAIL request correlation helpers.

It does not own collection, account-level provenance, sampling, aggregation,
retention, export, access control, alerting, or dashboard presentation. Kale's
collector must stamp deployment provenance from Cloudflare and control-plane
state instead of trusting tenant claims.

## Record contract

Every record contains:

- `schema_version: 1`;
- an ISO-8601 UTC `timestamp`;
- OpenTelemetry severity text and number;
- catalog-defined `event_name` and static `body`;
- a resource with `service.namespace`, `service.name`, `service.version`, and
  `deployment.environment.name`; and
- attributes containing at least `cail.source.class`.

Trace ID, span ID, and trace flags are emitted only as a complete valid group.
All-zero trace and span IDs are invalid. Attributes remain scalar so the record
can map cleanly into OpenTelemetry and common log stores.

The trust profiles are:

- `platform`: a CAIL-operated boundary may add validated product, project,
  pseudonymous subject, cohort, model usage, cost, and quota facts.
- `tenant`: application code may add operational request facts only. Platform
  attribution, identity, model, cost, and quota fields are absent from the
  TypeScript surface and discarded at runtime.

## Invariants

1. Callers cannot supply event bodies, request or response content, headers,
   URLs, filenames, exception text, prompts, completions, or raw identities.
2. Unknown fields are discarded. No general-purpose attributes bag exists.
3. Service resource identity and source class cannot be overridden per event.
4. Event names are selected from a validated, frozen catalog. An unknown name
   becomes `event.invalid` without echoing the rejected input.
5. Routes are bounded `url.template` values such as `/users/{user_id}`, not
   raw paths. Shape validation cannot prove semantic origin, so caller review
   and collector policy remain necessary.
6. HTTP method, status, body-size, duration, and error fields follow existing
   semantic conventions where applicable. Product outcome is explicit rather
   than inferred from HTTP status; `error.type` on success is a contract error.
7. The canonical subject is a `cail-` pseudonym. It is linkable personal data,
   not anonymous data. Coarse cohorts are preferred when person-level analysis
   is unnecessary.
8. Quotas use a discriminated kind/unit pair. Remaining balance is derived and
   cannot be supplied by the caller.
9. One logger call attempts one sink call. Runtime logging and diagnostic
   failures, including rejected promise-like returns, never throw into
   application work. Asynchronous I/O remains the sink's lifecycle
   responsibility; Workers sinks must register it with `waitUntil()`.
   A fanout sink attempts every configured destination and reports destination
   failure without letting one destination prevent another from receiving the
   event.
10. W3C trace flags preserve or explicitly reflect a recording decision. A new
    trace defaults to unsampled; the library never hardcodes sampled.
11. `tracestate` is processed only with a valid `traceparent`. Valid empty list
    members are accepted and removed; malformed or duplicate entries are not
    forwarded.
12. Request, action, call, and usage IDs describe different scopes. A request is one
    transport hop, an action is one admitted user-facing attempt, and a call is
    one billable child operation. A usage ID points to one immutable source
    settlement fact and can correlate its delivery retries. Only the canonical
    settled event asserts accounting acknowledgement. The IDs do not substitute
    for each other.
13. Product outcome and terminal reason use a closed compatibility map. An
    application failure may legitimately have HTTP status 200 and retain
    `error.type`; success pairs only with `completed` and no `error.type`.

## Privacy boundary

The package must not receive raw user content. `enduser.pseudo.id` is available
only to the platform profile and requires access controls and a retention
decision wherever it is stored. Public traffic remains anonymous unless a
trusted platform boundary deliberately adds a pseudonym or cohort. No IP
address, user agent, fingerprint, email, IdP subject, or inferred unique-user
field is exposed by this API.

A principal marked `anonymous` cannot emit a subject. An absent principal means
unresolved rather than user. A tenant profile is a developer guard, not a security boundary against
malicious application code. A Kale Tail Worker must discard raw request URLs,
headers, arbitrary console arguments, and exception messages before durable
storage. It must apply its own allowlist and authoritative deployment mapping.

## Cloudflare Enterprise boundary

CAIL expects an Enterprise agreement. That makes Cloudflare-native Logs,
Query Builder, Logpush or OTLP export, and account-level controls the preferred
collection path. It does not change this library contract. Retention, included
volume, export destinations, access roles, and pricing are contract-specific
procurement checks rather than assumptions embedded in code.

`workersStructuredSink` governs custom console events only. Cloudflare's
separate invocation logs may retain request URL and response metadata. A pilot
must disable `observability.logs.invocation_logs` or approve those native
fields, retention, access, and purpose before production adoption.

## Rollback and adoption

There is no production migration or live data conversion. Rollback is source
only: discard or revert the candidate changes reviewed for adoption. No consumer repository,
Cloudflare binding, secret, ingress rule, spending rule, or persistent
application changes are part of this task.

Before a production pilot:

- complete an independent fresh-context review;
- pass tests, typecheck, build, package-content inspection, and secret scan;
- confirm the GenAI semantic convention version to pin;
- verify the cohort-only Analytics Engine projection contains no stable user
  pseudonym or per-event identifier;
- validate each producer's bounded event count against the exported Analytics
  Engine invocation ceiling;
- implement the product-owned durable action-attempt/call state needed for
  exact workflow reporting;
- add compile-only fixtures for each intended platform consumer;
- publish a versioned runtime schema and collector golden fixtures;
- make trusted or collector-derived product attribution a golden-fixture
  invariant for action and model-call event catalogs;
- confirm Cloudflare Enterprise log retention, export, access, and cost terms;
- disable native invocation logs or approve their request metadata explicitly;
- run a local or sandbox collector test with synthetic events; and
- review production adoption as a separate change.

The next primitive is the Kale collector: authoritative provenance and privacy
reduction from Cloudflare telemetry into compact aggregate facts. The dashboard
reads those facts plus control-plane deployment state. Neither component needs
to turn `cail-log` into a storage or query framework.
