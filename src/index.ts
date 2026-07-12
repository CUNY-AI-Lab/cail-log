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
 *   - L3 — level maps to OTel `severity_number` (error = 17, fatal = 21) and
 *     `severity_text`, so "find failures" is a numeric filter. An UNKNOWN
 *     level from an untyped caller coerces UP to `fatal`, never down — a
 *     miscategorized failure is never hidden below the failure filter.
 *   - L4 — each call emits exactly ONE JSON object via an injectable sink.
 *     The portable default emits one NDJSON line; Workers can opt into
 *     {@link workersStructuredSink} for native field indexing and severity.
 *     The clock is injectable so tests are deterministic. The logger itself
 *     NEVER throws.
 *   - L5 — {@link Sensitive} wraps secrets so accidental interpolation or
 *     serialization emits `"[REDACTED]"`. Known gap: a caller who deliberately
 *     unwraps `.value`.
 *   - L6 — a final defense-in-depth pass masks any denylisted key
 *     (authorization/cookie/token/email/prompt/…, `x-cail-*` headers) and
 *     drops anything not on the allowlist, guarding the cast-a-raw-object
 *     path and future drift.
 *   - L7 — {@link correlationFromHeaders} ADOPTS an existing `traceparent` /
 *     `X-CAIL-Request-Id` and mints only when genuinely absent; an inbound
 *     `tracestate` riding a valid `traceparent` is carried opaquely and
 *     {@link outboundCorrelationHeaders} forwards it verbatim (W3C Trace
 *     Context §3.3 MUST) alongside the headers it produces.
 *     "Adopt, never regenerate."
 *
 * The public surface is `string`/`number`/plain-object types only — no
 * ambient platform (`DOM`/Workers) types leak out of the `.d.ts`.
 */

// ===========================================================================
// Levels (L3)
// ===========================================================================

export type CailLogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace";

/**
 * OTel Logs Data Model severity numbers (the first number of each band:
 * TRACE=1, DEBUG=5, INFO=9, WARN=13, ERROR=17, FATAL=21). "Show me failures"
 * is `severity_number >= 17`.
 */
export const CAIL_SEVERITY_NUMBER: Readonly<Record<CailLogLevel, number>> =
  Object.freeze({
    trace: 1,
    debug: 5,
    info: 9,
    warn: 13,
    error: 17,
    fatal: 21,
  });

// ===========================================================================
// Events (L2) — the closed vocabulary
// ===========================================================================

/**
 * The standard CAIL lifecycle events. `event` is typed as `string` so tools
 * can add their own names, but every name must be an event SLUG
 * (`/^[a-z0-9][a-z0-9_.-]{0,63}$/`) — anything else is replaced with
 * `"event.invalid"` at emit time, so the event channel cannot carry free text.
 */
export const CAIL_EVENTS = Object.freeze({
  REQUEST_RECEIVED: "request.received",
  REQUEST_COMPLETED: "request.completed",
  AUTH_DENIED: "auth.denied",
  QUOTA_CHARGED: "quota.charged",
  UPSTREAM_ERROR: "upstream.error",
} as const);

export type CailEventName = (typeof CAIL_EVENTS)[keyof typeof CAIL_EVENTS];

/** Substituted for any event name that is not a valid event slug. */
export const CAIL_EVENT_INVALID = "event.invalid";

/**
 * The static, library-owned message table (L2). The emitted `message` is
 * ALWAYS a value from this table (plus the sanitized `error_code` in
 * parentheses when present) — never a caller argument, and never an echo of
 * an unknown event name.
 */
const EVENT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  [CAIL_EVENTS.REQUEST_RECEIVED]: "Request received.",
  [CAIL_EVENTS.REQUEST_COMPLETED]: "Request completed.",
  [CAIL_EVENTS.AUTH_DENIED]: "Authentication or authorization denied.",
  [CAIL_EVENTS.QUOTA_CHARGED]: "Quota charged.",
  [CAIL_EVENTS.UPSTREAM_ERROR]: "Upstream provider call failed.",
  [CAIL_EVENT_INVALID]: "Event name rejected: not a valid event slug.",
});

const GENERIC_MESSAGE = "Event recorded.";

const SLUG_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

// ===========================================================================
// Sensitive<T> (L5)
// ===========================================================================

const REDACTED = "[REDACTED]";

const inspectSymbol: unique symbol = Symbol.for(
  "nodejs.util.inspect.custom",
) as never;

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
export class Sensitive<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  /** Deliberate unwrap — the one gap. Never pass this to a logger. */
  get value(): T {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspectSymbol](): string {
    return REDACTED;
  }
}

/** Wrap a secret so accidental serialization emits `"[REDACTED]"` (L5). */
export function sensitive<T>(value: T): Sensitive<T> {
  return new Sensitive(value);
}

/** True when `value` is a {@link Sensitive} wrapper. */
export function isSensitive(value: unknown): value is Sensitive<unknown> {
  return value instanceof Sensitive;
}

// ===========================================================================
// The typed allowlist (L1)
// ===========================================================================

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

type FieldKind =
  | "string"
  | "slug"
  | "number"
  | "enum"
  | "hex32"
  | "hex16"
  | "request_id"
  | "method";

interface FieldDef {
  kind: FieldKind;
  /** For kind "enum": the exact allowed values. */
  values?: readonly string[];
}

/**
 * Runtime mirror of {@link CailLogFields}. Build iterates THIS table (own
 * properties only), so unknown keys on the argument object never transfer —
 * including `__proto__`-style pollution keys.
 */
const FIELD_DEFS: Readonly<Record<string, FieldDef>> = Object.freeze({
  service: { kind: "slug" },
  release: { kind: "string" },
  env: { kind: "string" },
  subject: { kind: "string" },
  request_id: { kind: "request_id" },
  trace_id: { kind: "hex32" },
  span_id: { kind: "hex16" },
  principal_type: { kind: "enum", values: ["user", "app"] },
  key_id: { kind: "string" },
  app: { kind: "slug" },
  http_method: { kind: "method" },
  route: { kind: "string" },
  model: { kind: "string" },
  status: { kind: "number" },
  outcome: { kind: "enum", values: ["ok", "client_error", "error", "denied"] },
  duration_ms: { kind: "number" },
  upstream_ms: { kind: "number" },
  error_code: { kind: "slug" },
  retry_count: { kind: "number" },
  req_bytes: { kind: "number" },
  resp_bytes: { kind: "number" },
  input_tokens: { kind: "number" },
  output_tokens: { kind: "number" },
});

const QUOTA_DEFS: Readonly<Record<string, FieldDef>> = Object.freeze({
  state: { kind: "enum", values: ["ok", "stale"] },
  remaining: { kind: "number" },
  used: { kind: "number" },
});

/** Keys allowed on the final emitted object (L6 sweep keeps only these). */
const EVENT_KEYS: ReadonlySet<string> = new Set([
  "timestamp",
  "severity_text",
  "severity_number",
  "event",
  "message",
  "quota",
  ...Object.keys(FIELD_DEFS),
]);

// ===========================================================================
// Defense-in-depth denylist (L6)
// ===========================================================================

/**
 * NEVER-LOG key denylist, matched case-insensitively with `-`/`_` treated as
 * equivalent. L1's typed API cannot produce these keys; this pass guards the
 * cast-a-raw-object path and future drift (e.g. someone adding `email` to
 * the type would still emit `"[REDACTED]"`). Exact-key matching on purpose:
 * substring matching would destroy allowlisted `input_tokens`/`output_tokens`.
 */
const DENY_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "secret",
  "password",
  "api-key",
  "apikey",
  "email",
  "given-name",
  "family-name",
  "sub",
  "prompt",
  "messages",
  "completion",
  "content",
  "input",
  "output",
  "body",
]);

/** `x-cail-*` header keys are denied except these two allowlisted carriers. */
const XCAIL_ALLOWED: ReadonlySet<string> = new Set([
  "x-cail-subject",
  "x-cail-request-id",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/_/g, "-");
}

function isDeniedKey(key: string): boolean {
  const norm = normalizeKey(key);
  if (DENY_KEYS.has(norm)) return true;
  if (norm.startsWith("x-cail-") && !XCAIL_ALLOWED.has(norm)) return true;
  return false;
}

// ===========================================================================
// Sanitizers
// ===========================================================================

const MAX_STRING = 256;

/**
 * Strings are stripped of control characters (log-injection defense: no
 * newline can fake a second event), trimmed, and truncated to 256 chars.
 * The strip covers C0 (U+0000–U+001F), DEL (U+007F), the C1 block
 * (U+0080–U+009F, incl. NEL) and the Unicode line/paragraph separators
 * U+2028/U+2029 — a non-JSON sink or a NEL-splitting processor must never
 * see a fake second line (OWASP Logging Cheat Sheet, log injection).
 * A {@link Sensitive} wrapper masks to `"[REDACTED]"`; anything that is not
 * a string is dropped.
 */
function sanitizeString(value: unknown): string | undefined {
  if (isSensitive(value)) return REDACTED;
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "")
    .trim();
  if (cleaned === "") return undefined;
  return cleaned.length > MAX_STRING ? cleaned.slice(0, MAX_STRING) : cleaned;
}

/** Slug fields (`event`, `error_code`, `service`): valid slug or dropped. */
function sanitizeSlug(value: unknown): string | undefined {
  const s = sanitizeString(value);
  if (s === undefined || s === REDACTED) return undefined;
  return SLUG_RE.test(s) ? s : undefined;
}

/** Numbers must be finite; NaN/±Infinity/non-numbers/Sensitive are dropped. */
function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function sanitizeEnum(
  value: unknown,
  allowed: readonly string[],
): string | undefined {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : undefined;
}

const METHOD_RE = /^[A-Z]{1,16}$/;

/** Shape-known string fields: valid shape or dropped (never coerced). */
function sanitizePattern(value: unknown, re: RegExp): string | undefined {
  const s = sanitizeString(value);
  if (s === undefined || s === REDACTED) return undefined;
  return re.test(s) ? s : undefined;
}

function sanitizeField(value: unknown, def: FieldDef): string | number | undefined {
  switch (def.kind) {
    case "string":
      return sanitizeString(value);
    case "slug":
      return sanitizeSlug(value);
    case "number":
      return sanitizeNumber(value);
    case "enum":
      return sanitizeEnum(value, def.values ?? []);
    case "hex32":
      return sanitizePattern(value, HEX_TRACE_RE);
    case "hex16":
      return sanitizePattern(value, HEX_SPAN_RE);
    case "request_id":
      return sanitizePattern(value, REQUEST_ID_RE);
    case "method":
      return sanitizePattern(value, METHOD_RE);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ===========================================================================
// The logger (L1–L6)
// ===========================================================================

export type CailLogSink = (event: CailLogEvent) => void;

export interface CailLoggerOptions {
  /** Service slug (e.g. `"model-proxy"`). Required; validated at construction. */
  service: string;
  /** Release identifier (e.g. a short commit SHA). */
  release?: string;
  /** Deployment environment (e.g. `"prod"`, `"staging"`). */
  env?: string;
  /**
   * Where the single JSON event goes (L4). Default: one portable NDJSON line
   * through `console.log`. Cloudflare Workers should pass
   * {@link workersStructuredSink} to use native field indexing and severity.
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
  fatal(event: string, fields?: CailLogFields): void;
  error(event: string, fields?: CailLogFields): void;
  warn(event: string, fields?: CailLogFields): void;
  info(event: string, fields?: CailLogFields): void;
  debug(event: string, fields?: CailLogFields): void;
  trace(event: string, fields?: CailLogFields): void;
}

const LEVELS: ReadonlySet<string> = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);

function defaultSink(event: CailLogEvent): void {
  console.log(JSON.stringify(event));
}

/**
 * Cloudflare Workers structured-console sink. Workers Logs receives the event
 * object directly, indexes its fields, and derives native severity from the
 * console method. Keep this explicit: Node and Bun format console objects as
 * multi-line inspection text rather than portable NDJSON.
 */
export function workersStructuredSink(event: CailLogEvent): void {
  if (event.severity_number >= CAIL_SEVERITY_NUMBER.error) {
    console.error(event);
  } else if (event.severity_number >= CAIL_SEVERITY_NUMBER.warn) {
    console.warn(event);
  } else {
    console.log(event);
  }
}

function deriveMessage(event: string, errorCode: string | undefined): string {
  // Own-property lookup ONLY: `"constructor"` is a valid slug, and a plain
  // `[event]` read would walk Object.prototype and return the Object
  // constructor function instead of a table string (review finding B1).
  const base = Object.hasOwn(EVENT_MESSAGES, event)
    ? EVENT_MESSAGES[event]!
    : GENERIC_MESSAGE;
  return errorCode === undefined ? base : `${base} (${errorCode})`;
}

/**
 * Build the wide event from the typed fields. Iterates the ALLOWLIST table
 * (never the argument's own keys), so unknown/hostile keys cannot transfer.
 */
function buildEvent(
  level: CailLogLevel,
  eventName: string,
  fields: CailLogFields | undefined,
  defaults: { service: string; release?: string; env?: string },
  nowMs: number,
): CailLogEvent {
  let timestamp: string;
  try {
    timestamp = new Date(
      Number.isFinite(nowMs) ? nowMs : Date.now(),
    ).toISOString();
  } catch {
    timestamp = new Date().toISOString();
  }

  const slug = sanitizeSlug(eventName);
  const event = slug ?? CAIL_EVENT_INVALID;

  const out: Record<string, unknown> = {
    timestamp,
    severity_text: level.toUpperCase(),
    severity_number: CAIL_SEVERITY_NUMBER[level],
    event,
  };

  const src: Record<string, unknown> = isPlainObject(fields) ? fields : {};

  for (const key of Object.keys(FIELD_DEFS)) {
    if (!Object.hasOwn(src, key)) continue;
    const def = FIELD_DEFS[key]!;
    const val = sanitizeField(src[key], def);
    if (val !== undefined) out[key] = val;
  }

  // Constructor-bound identity, unless the call overrode it with a valid value.
  if (out["service"] === undefined) out["service"] = defaults.service;
  if (out["release"] === undefined && defaults.release !== undefined) {
    out["release"] = defaults.release;
  }
  if (out["env"] === undefined && defaults.env !== undefined) {
    out["env"] = defaults.env;
  }

  // quota sub-object: same allowlist discipline, one level deep.
  if (Object.hasOwn(src, "quota") && isPlainObject(src["quota"])) {
    const rawQuota = src["quota"] as Record<string, unknown>;
    const quota: Record<string, unknown> = {};
    for (const key of Object.keys(QUOTA_DEFS)) {
      if (!Object.hasOwn(rawQuota, key)) continue;
      const val = sanitizeField(rawQuota[key], QUOTA_DEFS[key]!);
      if (val !== undefined) quota[key] = val;
    }
    if (Object.keys(quota).length > 0) out["quota"] = quota;
  }

  // L2: message derived ONLY from the (sanitized) event + error_code.
  out["message"] = deriveMessage(
    event,
    out["error_code"] as string | undefined,
  );

  return redactLogEvent(out) as unknown as CailLogEvent;
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
export function redactLogEvent(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(obj)) {
    if (isDeniedKey(key)) {
      obj[key] = REDACTED;
      continue;
    }
    if (!EVENT_KEYS.has(key)) {
      delete obj[key];
      continue;
    }
    const val = obj[key];
    if (isSensitive(val)) {
      obj[key] = REDACTED;
      continue;
    }
    // VALUES are policed too, not just keys (review finding B2): an
    // allowlisted key must carry its allowlisted SHAPE, or it is dropped.
    // Otherwise a raw pipeline could smuggle `{ route: { messages: [...] } }`
    // or an untruncated 10 KB "model" string under a safe-looking key.
    if (key === "quota") {
      if (!isPlainObject(val)) {
        delete obj[key];
        continue;
      }
      for (const qk of Object.keys(val)) {
        if (isDeniedKey(qk)) {
          val[qk] = REDACTED;
          continue;
        }
        if (!Object.hasOwn(QUOTA_DEFS, qk)) {
          delete val[qk];
          continue;
        }
        if (isSensitive(val[qk])) {
          val[qk] = REDACTED;
          continue;
        }
        const qv = sanitizeField(val[qk], QUOTA_DEFS[qk]!);
        if (qv === undefined) delete val[qk];
        else val[qk] = qv;
      }
    } else if (Object.hasOwn(FIELD_DEFS, key)) {
      const clean = sanitizeField(val, FIELD_DEFS[key]!);
      if (clean === undefined) delete obj[key];
      else obj[key] = clean;
    } else if (key === "severity_number") {
      const n = sanitizeNumber(val);
      if (n === undefined) delete obj[key];
      else obj[key] = n;
    } else {
      // timestamp / severity_text / event / message: strings only.
      const s = sanitizeString(val);
      if (s === undefined) delete obj[key];
      else obj[key] = s;
    }
  }
  return obj;
}

/**
 * Create a {@link CailLogger}. Construction fails LOUD (`TypeError`) on
 * invalid configuration — a bad `service` slug or non-function `sink`/`clock`
 * is a deploy-time programmer error, matching the sibling libraries. The
 * returned logger's log methods NEVER throw.
 */
export function createCailLogger(options: CailLoggerOptions): CailLogger {
  if (!isPlainObject(options)) {
    throw new TypeError("cail-log: options must be an object");
  }
  const service = sanitizeSlug(options.service);
  if (service === undefined) {
    throw new TypeError(
      "cail-log: `service` is required and must be a slug ([a-z0-9][a-z0-9_.-]{0,63})",
    );
  }
  if (options.sink !== undefined && typeof options.sink !== "function") {
    throw new TypeError("cail-log: `sink` must be a function");
  }
  if (options.clock !== undefined && typeof options.clock !== "function") {
    throw new TypeError("cail-log: `clock` must be a function");
  }
  const sink = options.sink ?? defaultSink;
  const clock = options.clock ?? Date.now;
  const defaults = {
    service,
    release: sanitizeString(options.release),
    env: sanitizeString(options.env),
  };

  function emit(
    level: CailLogLevel,
    event: string,
    fields?: CailLogFields,
  ): void {
    try {
      // FAIL-CLOSED level coercion: an unknown level from an untyped caller
      // coerces to the HIGHEST band ("fatal", OTel 21), never downward — a
      // miscategorized failure must never hide below the `>= 17` failure
      // filter. (Throwing is not an option here: emit never throws, per L4.)
      const lvl: CailLogLevel = LEVELS.has(level) ? level : "fatal";
      let nowMs: number;
      try {
        nowMs = clock();
      } catch {
        nowMs = Date.now();
      }
      sink(buildEvent(lvl, event, fields, defaults, nowMs));
    } catch {
      // L4: the logger never throws into the request path. Fixed string only
      // — interpolating the error could smuggle content into unstructured logs.
      try {
        console.error("cail-log: emit failed; event dropped");
      } catch {
        /* nothing left to do */
      }
    }
  }

  return {
    log: emit,
    fatal: (event, fields) => emit("fatal", event, fields),
    error: (event, fields) => emit("error", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    info: (event, fields) => emit("info", event, fields),
    debug: (event, fields) => emit("debug", event, fields),
    trace: (event, fields) => emit("trace", event, fields),
  };
}

// ===========================================================================
// Correlation: adopt-or-mint (L7)
// ===========================================================================

/** Canonical inbound/outbound correlation header names. */
export const TRACEPARENT_HEADER = "traceparent";
export const TRACESTATE_HEADER = "tracestate";
export const CAIL_REQUEST_ID_HEADER = "x-cail-request-id";

export interface CailCorrelation {
  /** 32 lowercase hex chars (W3C Trace Context), never all-zero. */
  trace_id: string;
  /** THIS service's span id — 16 lowercase hex chars, never all-zero. */
  span_id: string;
  /** The fleet request id (`X-CAIL-Request-Id`), UUID-shaped when minted. */
  request_id: string;
  /**
   * The inbound `tracestate` header, carried OPAQUELY (W3C Trace Context
   * §3.3: a vendor that continues the trace MUST forward it). Present only
   * when the inbound `traceparent` was adopted AND the header passed the
   * minimal structural checks in {@link correlationFromHeaders}; never
   * minted, parsed, or reordered by this library.
   */
  tracestate?: string;
}

/**
 * Structural stand-in for the platform `Headers` (so no DOM types leak into
 * the `.d.ts`). A real `Headers` — or `request.headers` — satisfies it.
 */
export interface CailHeadersLike {
  get(name: string): string | null;
}

const TRACEPARENT_RE =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const HEX_TRACE_RE = /^[0-9a-f]{32}$/;
const HEX_SPAN_RE = /^[0-9a-f]{16}$/;

// W3C Trace Context tracestate limits: vendors MUST be able to handle up to
// 32 list-members, and SHOULD propagate at least 512 characters. `tracestate`
// is a comma-separated list of `key=value` members whose contents this
// library deliberately does NOT interpret (spec: vendors must not parse or
// depend on other vendors' entries) — validation here is purely structural
// and FAIL-CLOSED: anything outside these bounds is dropped, never repaired.
const TRACESTATE_MAX_CHARS = 512;
const TRACESTATE_MAX_MEMBERS = 32;
/** Printable ASCII only — a header value smuggling control chars is malformed. */
const TRACESTATE_PRINTABLE_RE = /^[ -~]+$/;

/**
 * Minimal, opaque structural validation of a `tracestate` header value:
 * printable ASCII, <= 512 chars, 1–32 comma-separated members that each look
 * like `key=value`. Returns the trimmed value to carry verbatim, or
 * `undefined` (drop, fail-closed). Vendor contents are never interpreted.
 */
function sanitizeTracestate(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // Trim ONLY ASCII space/tab (HTTP OWS). `String.prototype.trim` would also
  // eat U+2028/U+2029/etc. and thereby LAUNDER a malformed value into a valid
  // one — fail-closed means such input must reach the printable check and drop.
  const value = raw.replace(/^[ \t]+|[ \t]+$/g, "");
  if (value === "" || value.length > TRACESTATE_MAX_CHARS) return undefined;
  if (!TRACESTATE_PRINTABLE_RE.test(value)) return undefined;
  // Empty list members (`a=b,,c=d`) are legal per spec; skip them when
  // counting, but every NON-empty member must have a key=value shape.
  const members = value
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m !== "");
  if (members.length === 0 || members.length > TRACESTATE_MAX_MEMBERS) {
    return undefined;
  }
  for (const member of members) {
    const eq = member.indexOf("=");
    if (eq <= 0 || eq === member.length - 1) return undefined;
  }
  return value;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * UUID v4 via `crypto.randomUUID` where available; otherwise built from
 * `getRandomValues` (browsers expose `randomUUID` only in secure contexts).
 */
function mintRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function headersOf(
  source: CailHeadersLike | { headers: CailHeadersLike },
): CailHeadersLike | null {
  if (!source || typeof source !== "object") return null;
  if (typeof (source as CailHeadersLike).get === "function") {
    return source as CailHeadersLike;
  }
  const inner = (source as { headers: CailHeadersLike }).headers;
  if (inner && typeof inner.get === "function") return inner;
  return null;
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
 *   - a `tracestate` beside an ADOPTED `traceparent` → carried opaquely
 *     after minimal structural validation, so
 *     {@link outboundCorrelationHeaders} can forward it (W3C §3.3 MUST);
 *     malformed tracestate is dropped fail-closed, and tracestate arriving
 *     WITHOUT a valid traceparent is dropped too (the spec forbids using
 *     it when traceparent failed to parse) — it is NEVER minted;
 *   - anything absent or malformed (all-zero ids, version `ff`, version-00
 *     with trailing fields, wrong shape) → minted fresh, as when the
 *     service is hit directly.
 *
 * Never throws; a garbage `source` behaves like a request with no headers.
 */
export function correlationFromHeaders(
  source: CailHeadersLike | { headers: CailHeadersLike },
): CailCorrelation {
  let traceId: string | undefined;
  let requestId: string | undefined;
  let tracestate: string | undefined;

  // Even PROPERTY ACCESS on a hostile source (a throwing `.headers` getter,
  // a Proxy trap) must not throw out of this helper (review finding M1) —
  // it sits on the request path and "never throws" is load-bearing.
  let headers: CailHeadersLike | null = null;
  try {
    headers = headersOf(source);
  } catch {
    /* treat as absent */
  }
  if (headers) {
    let rawTp: string | null = null;
    let rawTs: string | null = null;
    let rawRid: string | null = null;
    try {
      rawTp = headers.get(TRACEPARENT_HEADER);
      rawTs = headers.get(TRACESTATE_HEADER);
      rawRid = headers.get(CAIL_REQUEST_ID_HEADER);
    } catch {
      /* treat as absent */
    }
    if (typeof rawTp === "string") {
      const m = TRACEPARENT_RE.exec(rawTp.trim());
      if (
        m &&
        m[1] !== "ff" &&
        // Version 00 has EXACTLY four fields; trailing data is only legal
        // on future versions (W3C Trace Context §versioning).
        !(m[1] === "00" && m[5] !== undefined) &&
        m[2] !== ZERO_TRACE &&
        m[3] !== ZERO_SPAN
      ) {
        traceId = m[2];
      }
    }
    // tracestate rides ONLY on an adopted traceparent (W3C: if traceparent
    // failed to parse, the vendor MUST NOT use the tracestate).
    if (traceId !== undefined) {
      tracestate = sanitizeTracestate(rawTs);
    }
    if (typeof rawRid === "string") {
      const rid = rawRid.trim();
      if (REQUEST_ID_RE.test(rid)) requestId = rid;
    }
  }

  const correlation: CailCorrelation = {
    trace_id: traceId ?? randomHex(16),
    span_id: randomHex(8),
    request_id: requestId ?? mintRequestId(),
  };
  if (tracestate !== undefined) correlation.tracestate = tracestate;
  return correlation;
}

/**
 * The headers to forward DOWNSTREAM so the next hop can adopt this trace:
 * a W3C `traceparent` (version 00, parent-id = OUR span) plus
 * `X-CAIL-Request-Id` — and, when the inbound `tracestate` was carried on
 * the correlation, that `tracestate` verbatim (W3C Trace Context §3.3:
 * vendors receiving tracestate must send it on outgoing requests; this
 * library continues the trace, so it forwards). No inbound tracestate →
 * no outbound tracestate; one is never invented. Throws `TypeError` on a
 * malformed correlation — that is a programmer error, and forwarding a
 * broken id (or a malformed tracestate) would silently corrupt the trace.
 *
 * The trace-flags byte is DELIBERATELY always `01` (sampled): the CAIL fleet
 * logs every request (head_sampling happens at the sink, not per-trace), so
 * inbound sampling flags are not propagated.
 */
export function outboundCorrelationHeaders(
  correlation: CailCorrelation,
): Record<string, string> {
  if (!isPlainObject(correlation)) {
    throw new TypeError("cail-log: correlation must be an object");
  }
  const { trace_id, span_id, request_id, tracestate } = correlation;
  if (
    typeof trace_id !== "string" ||
    !HEX_TRACE_RE.test(trace_id) ||
    trace_id === ZERO_TRACE
  ) {
    throw new TypeError(
      "cail-log: trace_id must be 32 lowercase hex chars, not all-zero",
    );
  }
  if (
    typeof span_id !== "string" ||
    !HEX_SPAN_RE.test(span_id) ||
    span_id === ZERO_SPAN
  ) {
    throw new TypeError(
      "cail-log: span_id must be 16 lowercase hex chars, not all-zero",
    );
  }
  if (typeof request_id !== "string" || !REQUEST_ID_RE.test(request_id)) {
    throw new TypeError(
      "cail-log: request_id must match [A-Za-z0-9._-]{1,128}",
    );
  }
  // tracestate is optional; when present it must be EXACTLY a value the
  // structural validator would carry (fail loud on a hand-built bad one —
  // emitting it would ship a malformed header downstream in CAIL's name).
  if (tracestate !== undefined && sanitizeTracestate(tracestate) !== tracestate) {
    throw new TypeError(
      "cail-log: tracestate must be a structurally valid W3C tracestate list (or omitted)",
    );
  }
  const out: Record<string, string> = {
    [TRACEPARENT_HEADER]: `00-${trace_id}-${span_id}-01`,
    [CAIL_REQUEST_ID_HEADER]: request_id,
  };
  if (tracestate !== undefined) out[TRACESTATE_HEADER] = tracestate;
  return out;
}
