# @cuny-ai-lab/cail-log

The CAIL structured logger. One wide event (canonical log line) per unit of
work, emitted as a single JSON object — shaped so coding agents can query the
fleet's logs, and shaped so that **logging user content or secrets is
structurally impossible**. This is the logging half of the fleet's
zero-retention promise: the safe-to-log allowlist is a *type*, there is no
free-text parameter, and everything else is dropped or masked before the sink.

Pure ECMAScript + Web Crypto (`crypto.getRandomValues`, `crypto.randomUUID`) —
the same source runs unchanged in the **browser**, **Cloudflare Workers**, and
**Node ≥20**. Zero runtime dependencies; the package is logic only and safe to
be public.

## Who needs this

Every CAIL fleet service and tool that logs anything: the model proxy, the key
service, the studios, deployed tools. If a repo currently calls a console
method with request data, it should call this instead. The portable default
emits one NDJSON line. Cloudflare Workers pass `workersStructuredSink` so
Workers Logs receives the sanitized object directly, indexes its fields, and
retains native severity. Collection, retention, and OpenTelemetry export remain
Cloudflare configuration rather than application code; this library's job is
that **nothing unsafe can be emitted in the first place**.

## Install

Consumed as a public git dependency. The package commits its build output, so
it resolves with no build step:

```bash
bun add github:CUNY-AI-Lab/cail-log
# or
npm install github:CUNY-AI-Lab/cail-log
```

Pin to a tag or commit for reproducibility.

## Quick start — a Worker request boundary

```ts
import {
  createCailLogger,
  correlationFromHeaders,
  outboundCorrelationHeaders,
  CAIL_EVENTS,
  workersStructuredSink,
} from "@cuny-ai-lab/cail-log";

const log = createCailLogger({
  service: "model-proxy",
  release: env.RELEASE,     // e.g. short commit SHA
  env: "prod",
  sink: workersStructuredSink,
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Adopt the gateway's ids; mint only if this service was hit directly.
    const corr = correlationFromHeaders(request);
    const started = Date.now();

    log.info(CAIL_EVENTS.REQUEST_RECEIVED, {
      ...corr,
      http_method: request.method,
      route: "/v1/run",             // the CLASSIFIED route, never a raw URL
    });

    const upstream = await fetch(upstreamUrl, {
      headers: { ...outboundCorrelationHeaders(corr) },  // forward the trace
      // ...
    });

    log.info(CAIL_EVENTS.REQUEST_COMPLETED, {
      ...corr,
      subject,                      // the X-CAIL-Subject HMAC — never email
      app,
      model,
      route: "/v1/run",
      http_method: "POST",
      status: upstream.status,
      outcome: upstream.ok ? "ok" : "error",
      duration_ms: Date.now() - started,
      input_tokens,
      output_tokens,
      quota: { state: "ok", remaining, used },
    });

    return response;
  },
};
```

A Durable Object op is the same shape — reuse the correlation you adopted at
the request boundary and log one event per op:

```ts
log.info(CAIL_EVENTS.QUOTA_CHARGED, {
  ...corr,
  subject,
  outcome: "ok",
  duration_ms,
  quota: { state: "ok", remaining, used },
});

log.error(CAIL_EVENTS.UPSTREAM_ERROR, {
  ...corr,
  subject,
  status: 502,
  outcome: "error",
  error_code: "upstream_5xx",
  retry_count: 1,
});
```

## The by-construction guarantee

There is **no argument you can pass a prompt into**:

- the fields parameter is the typed allowlist struct (`CailLogFields`) —
  `message`, `prompt`, `email`, … are compile errors, and any key smuggled
  past the compiler is dropped at runtime;
- the `event` parameter is a closed-vocabulary slug
  (`/^[a-z0-9][a-z0-9_.-]{0,63}$/`) — free text is replaced with
  `"event.invalid"` and never echoed;
- the emitted `message` is derived from a static, library-owned lookup on
  `event` (+ `error_code`) — never from caller input;
- string values are control-character-stripped (C0, DEL, the C1 block incl.
  NEL, and U+2028/U+2029 — no log-line injection, even through a non-JSON
  sink) and truncated to 256 chars; numbers must be finite; enums are exact.

The suite proves it with a canary: `CANARY-PII-7f3a` is pushed at the logger
through every avenue the API exposes and asserted absent from every emitted
byte.

## The wide-event schema

Each call emits exactly ONE flat JSON object (Workers Logs indexes each key).
Absent fields are omitted. All identity is the pseudonymous `X-CAIL-Subject`
HMAC — never email, names, or the raw OIDC `sub`.

| Field | Type | Meaning |
|---|---|---|
| `timestamp` | string | ISO-8601 UTC (injectable clock) |
| `severity_text` | string | `TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL` |
| `severity_number` | number | OTel: 1/5/9/13/17/21 — failures are `>= 17` |
| `event` | string | Closed-vocabulary slug (see `CAIL_EVENTS`) |
| `message` | string | Library-derived from `event`+`error_code`; never caller input |
| `service` | string | Service slug (constructor-bound; slug-validated) |
| `release` | string | Release id (e.g. short SHA) |
| `env` | string | `prod` / `staging` / … |
| `subject` | string | The `X-CAIL-Subject` HMAC |
| `request_id` | string | Fleet request id — shape-enforced (`[A-Za-z0-9._-]{1,128}`) |
| `trace_id` / `span_id` | string | W3C Trace Context ids — shape-enforced (32/16 lowercase hex) |
| `principal_type` | `"user"｜"app"` | Which principal spent |
| `key_id` | string | API-key id (never the key) |
| `app` | string | The validated `X-CAIL-App` slug — slug-enforced |
| `http_method` | string | Request method — shape-enforced (1–16 uppercase letters) |
| `route` | string | The CLASSIFIED route label, never a raw URL with query |
| `model` | string | Model id |
| `status` | number | HTTP status |
| `outcome` | `"ok"｜"client_error"｜"error"｜"denied"` | Normalized verdict |
| `duration_ms` / `upstream_ms` | number | Timings |
| `error_code` | string | Stable machine code (slug), e.g. `quota_exceeded` |
| `retry_count` | number | Retries performed |
| `req_bytes` / `resp_bytes` | number | Sizes, never contents |
| `input_tokens` / `output_tokens` | number | Token counts, never tokens |
| `quota` | object | `{ state: "ok"｜"stale", remaining, used }` |

**Standard events** (`CAIL_EVENTS`): `request.received`, `request.completed`,
`auth.denied`, `quota.charged`, `upstream.error`. Tool-specific slugs are
allowed; their `message` stays the generic `"Event recorded."`.

## SAFE-TO-LOG vs NEVER-LOG

**Safe (the allowlist above — everything else does not exist to this API):**
subject HMAC, correlation ids, service/release/env, principal type, key id,
app slug, method, classified route, model id, status, outcome, durations,
stable error codes, retry counts, byte and token COUNTS, quota meter state.

**Never (denylisted defense-in-depth, on top of the types):**
prompts / completions / streamed tokens / `messages` / `content` / `input` /
`output`; file contents or filenames; `email`, `given_name`, `family_name`,
raw OIDC `sub`; `authorization`, `cookie`, `set-cookie`, `token`, `secret`,
`password`, `api_key`; any `x-cail-*` header value except the subject and
request-id carriers; full bodies or header dumps. `redactLogEvent()` (applied
automatically before every sink call, and exported for raw pipelines) masks
any such key to `"[REDACTED]"`, drops everything not on the allowlist, and
polices VALUES too — a nested object, array, or oversized blob under a
safe-looking key is dropped or truncated, never forwarded.

## The contract — 7 invariants

Weakening any of these is a **major** semver bump every consumer opts into.

| # | Invariant |
|---|-----------|
| L1 | **Typed allowlist only.** The log API accepts only `CailLogFields`. Unknown keys are dropped at runtime; adding a field requires editing the type (forced review). Wrong-typed values are dropped, never coerced; strings are control-char-stripped and truncated. |
| L2 | **No caller-supplied free text.** No `message` parameter exists. `event` must be a slug or becomes `"event.invalid"`; the emitted `message` comes only from a static library-owned lookup. |
| L3 | **Severity.** `fatal/error/warn/info/debug/trace` → OTel `severity_number` 21/17/13/9/5/1 + uppercase `severity_text`. Failures are a numeric filter (`>= 17`). An unknown level from an untyped caller coerces UP to `fatal` (21), never down — a miscategorized failure is never hidden below the failure filter. |
| L4 | **One wide event per call**, via an injectable sink. The portable default emits one NDJSON line through `console.log`; `workersStructuredSink` passes the object through Cloudflare's native severity console method. Timestamp is ISO-8601 UTC from an injectable clock. The logger **never throws**; a throwing sink drops the event with a fixed, content-free `console.error` note. Construction fails loud (`TypeError`) on invalid config. |
| L5 | **`Sensitive<T>`.** `sensitive(v)` makes `toString`/`toJSON`/inspect/interpolation all yield `"[REDACTED]"`. Known gap: deliberately unwrapping `.value`. |
| L6 | **Defense-in-depth denylist.** `redactLogEvent` runs on every final object: denylisted keys masked, non-allowlist keys dropped, `quota` policed, `Sensitive` values masked, and every surviving value held to its allowlisted shape — guarding the raw-object path and future drift. |
| L7 | **Adopt, never regenerate.** `correlationFromHeaders` adopts a valid inbound `traceparent` trace-id and `X-CAIL-Request-Id` verbatim, minting fresh ids only when genuinely absent or malformed (version-00 `traceparent` must have exactly four fields; a new span id is minted per hop — that is this service's own span). `X-CAIL-Request-Id` is the sole inter-service request-id carrier. The OpenAI-compatible `x-request-id` header is a response-only alias that HTTP boundaries may echo with the same value; this library neither adopts nor forwards that alias. Outbound trace-flags are deliberately always `01` (the fleet logs every request; sampling happens at the sink). An inbound `tracestate` riding a VALID `traceparent` is carried opaquely — never parsed, reordered, or invented — after minimal structural validation (printable ASCII, ≤512 chars, 1–32 `key=value` members; malformed → dropped fail-closed, and tracestate without a valid traceparent is dropped per spec), and `outboundCorrelationHeaders` forwards it verbatim (W3C Trace Context §3.3: a vendor that continues the trace must send `tracestate` on outgoing requests). `outboundCorrelationHeaders` produces the `traceparent` + `X-CAIL-Request-Id` pair (+ the carried `tracestate`, if any) to forward; it throws `TypeError` on malformed input rather than silently forking a trace. |

## Signature

```ts
createCailLogger(options: {
  service: string;              // required slug
  release?: string;
  env?: string;
  sink?: (event: CailLogEvent) => void;  // default: one portable NDJSON console.log line
  clock?: () => number;         // epoch ms; default Date.now
}): CailLogger

workersStructuredSink(event: CailLogEvent): void // Cloudflare Workers Logs

interface CailLogger {
  log(level: "fatal"|"error"|"warn"|"info"|"debug"|"trace", event: string, fields?: CailLogFields): void;
  fatal(event: string, fields?: CailLogFields): void;
  error(event: string, fields?: CailLogFields): void;
  warn(event: string, fields?: CailLogFields): void;
  info(event: string, fields?: CailLogFields): void;
  debug(event: string, fields?: CailLogFields): void;
  trace(event: string, fields?: CailLogFields): void;
}

sensitive<T>(value: T): Sensitive<T>       // .value is the one (documented) unwrap
isSensitive(value: unknown): boolean
redactLogEvent(obj: Record<string, unknown>): Record<string, unknown>

correlationFromHeaders(source: Headers | { headers: Headers }):  // structural — any { get(name) }
  { trace_id: string; span_id: string; request_id: string; tracestate?: string }
outboundCorrelationHeaders(corr):
  { traceparent: string; "x-cail-request-id": string; tracestate?: string }  // tracestate only if carried

CAIL_EVENTS            // the standard event slugs
CAIL_SEVERITY_NUMBER   // the L3 mapping
TRACEPARENT_HEADER, TRACESTATE_HEADER, CAIL_REQUEST_ID_HEADER
```

The public `.d.ts` uses plain `string`/`number`/object types only — the
header reader is a structural `{ get(name: string): string | null }`, so no
ambient `DOM`/Workers types leak out.

## Development

```bash
bun install
bun run typecheck   # tsc: build config (clean public surface) + test config (incl. @ts-expect-error type-level assertions)
bun run build       # emit dist/ (JS + .d.ts) — committed so git-deps resolve
bun run test        # Vitest — the invariant suite IS the contract
```

## Scope

**In (v1):** the wide-event schema, the typed allowlist logger, the portable
NDJSON sink, the explicit Workers structured sink, the derived message,
`Sensitive<T>`, the denylist sweep, and the TS adopt-or-mint correlation
helpers. **Out:** collection and retention (Workers Logs, OpenTelemetry export,
or Logpush configuration), the gateway's Lua-side correlation minting, and
each repo's adoption.

## License

MIT — see [LICENSE](LICENSE).
