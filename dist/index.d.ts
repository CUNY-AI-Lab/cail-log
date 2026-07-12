/**
 * @cuny-ai-lab/cail-log — the CAIL structured logger.
 *
 * The observability twin of `@cuny-ai-lab/cail-identity` / `cail-client`: the
 * one library the CAIL fleet uses to emit logs. One wide event (canonical log
 * line) per unit of work, shaped so coding agents can query it — and shaped so
 * that logging user content or secrets is STRUCTURALLY IMPOSSIBLE, which is
 * what makes the fleet's zero-retention promise hold at the logging layer.
 *
 * Design contract (see README, invariants L1–L7):
 *   - Pure ECMAScript + Web Crypto (`crypto.getRandomValues`, `randomUUID`).
 *     Runs unchanged in the browser, Cloudflare Workers, and Node >=20.
 *   - L1 — the log API accepts ONLY the typed safe-to-log allowlist struct
 *     ({@link CailLogFields}). Unknown keys are dropped at runtime; adding a
 *     field means editing the type, which forces review.
 *   - L2 — there is NO free-text `message` parameter. Orientation comes from a
 *     closed-vocabulary `event` slug ({@link CAIL_EVENTS}); the emitted
 *     `message` is derived from a static lookup the library owns — never from
 *     a caller argument. A non-slug event name is replaced with
 *     `"event.invalid"` and never echoed.
 *   - L3 — level maps to OTel `severity_number` (error = 17) and
 *     `severity_text`, so "find failures" is a numeric filter.
 *   - L4 — each call emits exactly ONE JSON object via an injectable sink
 *     (default `console.log(JSON.stringify(event))`); the clock is injectable
 *     so tests are deterministic. The logger itself NEVER throws.
 *   - L5 — {@link Sensitive} wraps secrets so accidental interpolation or
 *     serialization emits `"[REDACTED]"`. Known gap: a caller who deliberately
 *     unwraps `.value`.
 *   - L6 — a final defense-in-depth pass masks any denylisted key
 *     (authorization/cookie/token/email/prompt/…, `x-cail-*` headers) and
 *     drops anything not on the allowlist, guarding the cast-a-raw-object
 *     path and future drift.
 *   - L7 — {@link correlationFromHeaders} ADOPTS an existing `traceparent` /
 *     `X-CAIL-Request-Id` and mints only when genuinely absent;
 *     {@link outboundCorrelationHeaders} produces the headers to forward.
 *     "Adopt, never regenerate."
 *
 * The public surface is `string`/`number`/plain-object types only — no
 * ambient platform (`DOM`/Workers) types leak out of the `.d.ts`.
 */
export type CailLogLevel = "error" | "warn" | "info" | "debug" | "trace";
/**
 * OTel Logs Data Model severity numbers (the first number of each band:
 * TRACE=1, DEBUG=5, INFO=9, WARN=13, ERROR=17). "Show me failures" is
 * `severity_number >= 17`.
 */
export declare const CAIL_SEVERITY_NUMBER: Readonly<Record<CailLogLevel, number>>;
/**
 * The standard CAIL lifecycle events. `event` is typed as `string` so tools
 * can add their own names, but every name must be an event SLUG
 * (`/^[a-z0-9][a-z0-9_.-]{0,63}$/`) — anything else is replaced with
 * `"event.invalid"` at emit time, so the event channel cannot carry free text.
 */
export declare const CAIL_EVENTS: Readonly<{
    readonly REQUEST_RECEIVED: "request.received";
    readonly REQUEST_COMPLETED: "request.completed";
    readonly AUTH_DENIED: "auth.denied";
    readonly QUOTA_CHARGED: "quota.charged";
    readonly UPSTREAM_ERROR: "upstream.error";
}>;
export type CailEventName = (typeof CAIL_EVENTS)[keyof typeof CAIL_EVENTS];
/** Substituted for any event name that is not a valid event slug. */
export declare const CAIL_EVENT_INVALID = "event.invalid";
declare const inspectSymbol: unique symbol;
/**
 * A wrapper that makes a secret inert in every serialization path:
 * `toString`, `toJSON`, template interpolation, `String()`, and Node's
 * `util.inspect` all yield `"[REDACTED]"`. The value is held in a true
 * private field, so spreads, `Object.keys`, and `JSON.stringify` of the
 * wrapper never see it.
 *
 * KNOWN GAP: `.value` exists so the secret can be USED (signed with, sent
 * upstream). A caller who deliberately unwraps and logs `.value` defeats the
 * wrapper — that is a code-review boundary, not a runtime one.
 */
export declare class Sensitive<T> {
    #private;
    constructor(value: T);
    /** Deliberate unwrap — the one gap. Never pass this to a logger. */
    get value(): T;
    toString(): string;
    toJSON(): string;
    [inspectSymbol](): string;
}
/** Wrap a secret so accidental serialization emits `"[REDACTED]"` (L5). */
export declare function sensitive<T>(value: T): Sensitive<T>;
/** True when `value` is a {@link Sensitive} wrapper. */
export declare function isSensitive(value: unknown): value is Sensitive<unknown>;
export type CailOutcome = "ok" | "client_error" | "error" | "denied";
export type CailPrincipalType = "user" | "app";
export type CailQuotaState = "ok" | "stale";
/** The advisory quota meter sub-object (mirrors `X-CAIL-Quota-*`). */
export interface CailQuotaFields {
    state?: CailQuotaState;
    remaining?: number;
    used?: number;
}
/**
 * THE safe-to-log allowlist (L1). This type IS the policy: a field can be
 * logged iff it appears here, and adding one is a reviewed type change.
 * Everything is optional; identity fields carry the pseudonymous
 * `X-CAIL-Subject` HMAC — NEVER email, names, or the raw OIDC `sub`.
 */
export interface CailLogFields {
    /** Overrides the logger's constructor-bound value for this one event. */
    service?: string;
    release?: string;
    env?: string;
    /** The stable pseudonymous `X-CAIL-Subject` HMAC — never an email. */
    subject?: string;
    /** Shape-enforced: `[A-Za-z0-9._-]{1,128}` or dropped. */
    request_id?: string;
    /** Shape-enforced: 32 lowercase hex chars or dropped. */
    trace_id?: string;
    /** Shape-enforced: 16 lowercase hex chars or dropped. */
    span_id?: string;
    principal_type?: CailPrincipalType;
    key_id?: string;
    /** The validated low-cardinality `X-CAIL-App` slug (slug-enforced). */
    app?: string;
    /** Shape-enforced: 1–16 uppercase letters (`GET`, `POST`, …) or dropped. */
    http_method?: string;
    /** The CLASSIFIED route (route-policy label), never a raw URL with query. */
    route?: string;
    model?: string;
    status?: number;
    outcome?: CailOutcome;
    duration_ms?: number;
    upstream_ms?: number;
    /** Stable machine error code (e.g. `"quota_exceeded"`) — slug-validated. */
    error_code?: string;
    retry_count?: number;
    req_bytes?: number;
    resp_bytes?: number;
    input_tokens?: number;
    output_tokens?: number;
    quota?: CailQuotaFields;
}
/** The single wide event emitted per call (L4). */
export interface CailLogEvent extends CailLogFields {
    /** ISO-8601 UTC, from the injectable clock. */
    timestamp: string;
    severity_text: string;
    severity_number: number;
    /** The closed-vocabulary event slug (or `"event.invalid"`). */
    event: string;
    /** Library-derived from `event` (+ `error_code`) — never caller input. */
    message: string;
    service: string;
}
export type CailLogSink = (event: CailLogEvent) => void;
export interface CailLoggerOptions {
    /** Service slug (e.g. `"model-proxy"`). Required; validated at construction. */
    service: string;
    /** Release identifier (e.g. a short commit SHA). */
    release?: string;
    /** Deployment environment (e.g. `"prod"`, `"staging"`). */
    env?: string;
    /**
     * Where the single JSON event goes (L4). Default:
     * `console.log(JSON.stringify(event))`, which Workers Logs indexes per key.
     * A throwing sink is caught — the logger never throws — and the event is
     * dropped with a fixed, content-free `console.error` note.
     */
    sink?: CailLogSink;
    /** Injectable epoch-milliseconds clock for deterministic tests. */
    clock?: () => number;
}
export interface CailLogger {
    /** Emit one wide event at an explicit level. */
    log(level: CailLogLevel, event: string, fields?: CailLogFields): void;
    error(event: string, fields?: CailLogFields): void;
    warn(event: string, fields?: CailLogFields): void;
    info(event: string, fields?: CailLogFields): void;
    debug(event: string, fields?: CailLogFields): void;
    trace(event: string, fields?: CailLogFields): void;
}
/**
 * The L6 defense-in-depth sweep, run automatically on the FINAL object
 * immediately before the sink: denylisted keys are masked to `"[REDACTED]"`
 * (a visible drift signal — through the typed API such keys never even get
 * built, so a masked key means a raw path or an allowlist edit slipped),
 * keys not on the emitted-event allowlist are dropped, nested `quota` keys
 * are held to the quota allowlist, and any {@link Sensitive} value anywhere
 * is masked. VALUES are policed as well as keys: every surviving field must
 * carry its allowlisted shape (sanitized string/slug/hex/number/enum), so a
 * nested object or oversized blob under a safe-looking key is dropped, not
 * forwarded.
 *
 * Exported so raw pipelines (a Logpush transform, an ops script) can apply
 * the same pass — and so the guard itself stays pinned by tests. MUTATES and
 * returns `obj`.
 */
export declare function redactLogEvent(obj: Record<string, unknown>): Record<string, unknown>;
/**
 * Create a {@link CailLogger}. Construction fails LOUD (`TypeError`) on
 * invalid configuration — a bad `service` slug or non-function `sink`/`clock`
 * is a deploy-time programmer error, matching the sibling libraries. The
 * returned logger's log methods NEVER throw.
 */
export declare function createCailLogger(options: CailLoggerOptions): CailLogger;
/** Canonical inbound/outbound correlation header names. */
export declare const TRACEPARENT_HEADER = "traceparent";
export declare const CAIL_REQUEST_ID_HEADER = "x-cail-request-id";
export interface CailCorrelation {
    /** 32 lowercase hex chars (W3C Trace Context), never all-zero. */
    trace_id: string;
    /** THIS service's span id — 16 lowercase hex chars, never all-zero. */
    span_id: string;
    /** The fleet request id (`X-CAIL-Request-Id`), UUID-shaped when minted. */
    request_id: string;
}
/**
 * Structural stand-in for the platform `Headers` (so no DOM types leak into
 * the `.d.ts`). A real `Headers` — or `request.headers` — satisfies it.
 */
export interface CailHeadersLike {
    get(name: string): string | null;
}
/**
 * Read correlation off an inbound request (a `Headers`, or anything with a
 * `.headers`, e.g. a `Request`), ADOPTING what exists and minting ONLY what
 * is genuinely absent (L7 — "adopt, never regenerate"):
 *
 *   - a valid `traceparent` → its `trace_id` is adopted; a FRESH `span_id`
 *     is minted for this hop (that is this service's own span, per W3C —
 *     the inbound parent-id belongs to the caller);
 *   - a well-formed `X-CAIL-Request-Id` → adopted verbatim;
 *   - anything absent or malformed (all-zero ids, version `ff`, version-00
 *     with trailing fields, wrong shape) → minted fresh, as when the
 *     service is hit directly.
 *
 * Never throws; a garbage `source` behaves like a request with no headers.
 */
export declare function correlationFromHeaders(source: CailHeadersLike | {
    headers: CailHeadersLike;
}): CailCorrelation;
/**
 * The headers to forward DOWNSTREAM so the next hop can adopt this trace:
 * a W3C `traceparent` (version 00, parent-id = OUR span) plus
 * `X-CAIL-Request-Id`. Throws `TypeError` on a malformed correlation —
 * that is a programmer error, and forwarding a broken id would silently
 * fork the trace.
 *
 * The trace-flags byte is DELIBERATELY always `01` (sampled): the CAIL fleet
 * logs every request (head_sampling happens at the sink, not per-trace), so
 * inbound sampling flags are not propagated.
 */
export declare function outboundCorrelationHeaders(correlation: CailCorrelation): Record<string, string>;
export {};
//# sourceMappingURL=index.d.ts.map