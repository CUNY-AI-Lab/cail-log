import * as z from "zod/mini";
import type {
  CailLogEvent,
  CailOutcome,
  CailTerminalReason,
} from "./schema.js";

const BOOLEAN_SCHEMA = z.boolean();
const CALLABLE_SCHEMA = z.function();
const NUMBER_SCHEMA = z.number();
const STRING_SCHEMA = z.string();
const SECRET_VALUE_RE =
  /(?:^|[^a-z0-9])(?:(?:[sr]k_(?:live|test)_|sk-[A-Za-z0-9_-]{8,})|npm_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|gh[opusr]_|github_pat_|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-|eyJ[a-zA-Z0-9_-]{8,}\.)/;
const VALIDATED_EVENTS = new WeakSet<object>();

type RuntimeProperty =
  | bigint
  | boolean
  | null
  | number
  | object
  | string
  | symbol
  | undefined;
interface RuntimeRecord {
  readonly action_id?: RuntimeProperty;
  readonly call_id?: RuntimeProperty;
  readonly cohort?: RuntimeProperty;
  readonly cost_micro_usd?: RuntimeProperty;
  readonly duration_ms?: RuntimeProperty;
  readonly error_type?: RuntimeProperty;
  readonly http_method?: RuntimeProperty;
  readonly input_tokens?: RuntimeProperty;
  readonly kind?: RuntimeProperty;
  readonly outcome?: RuntimeProperty;
  readonly output_tokens?: RuntimeProperty;
  readonly principal?: RuntimeProperty;
  readonly product_id?: RuntimeProperty;
  readonly provider?: RuntimeProperty;
  readonly quantity?: RuntimeProperty;
  readonly reason?: RuntimeProperty;
  readonly req_bytes?: RuntimeProperty;
  readonly request_id?: RuntimeProperty;
  readonly request_model?: RuntimeProperty;
  readonly response_model?: RuntimeProperty;
  readonly retry_count?: RuntimeProperty;
  readonly route?: RuntimeProperty;
  readonly span_id?: RuntimeProperty;
  readonly status?: RuntimeProperty;
  readonly subject?: RuntimeProperty;
  readonly terminal?: RuntimeProperty;
  readonly trace?: RuntimeProperty;
  readonly trace_flags?: RuntimeProperty;
  readonly trace_id?: RuntimeProperty;
  readonly type?: RuntimeProperty;
  readonly unit?: RuntimeProperty;
  readonly usage?: RuntimeProperty;
  readonly usage_id?: RuntimeProperty;
}

type RuntimeRecordKey = keyof RuntimeRecord;

export const TERMINAL_REASONS: Readonly<
  Record<CailOutcome, readonly CailTerminalReason[]>
> = Object.freeze({
  ok: ["completed"],
  client_error: ["client_error"],
  error: ["application_failure", "upstream_failure"],
  denied: ["denied", "quota_blocked", "rate_limited"],
  cancelled: ["cancelled"],
  timeout: ["timeout"],
  outcome_unknown: ["unknown"],
});

export function assertValidatedEvent(event: CailLogEvent): void {
  if (!VALIDATED_EVENTS.has(event)) {
    throw new TypeError(
      "cail-log: sinks accept only events produced by createCailLogger",
    );
  }
}

export function booleanFrom<Value>(value: Value): boolean | undefined {
  const result = BOOLEAN_SCHEMA.safeParse(value);
  return result.success ? result.data : undefined;
}

export function callableFrom<Value>(value: Value) {
  const result = CALLABLE_SCHEMA.safeParse(value);
  return result.success ? result.data : undefined;
}

export function containsSecretToken(value: string): boolean {
  return SECRET_VALUE_RE.test(value);
}

export function markValidatedEvent(event: CailLogEvent): CailLogEvent {
  VALIDATED_EVENTS.add(event);
  return event;
}

export function numberFrom<Value>(value: Value): number | undefined {
  const result = NUMBER_SCHEMA.safeParse(value);
  return result.success ? result.data : undefined;
}

export function plainRecordFrom<Value>(value: Value) {
  try {
    if (value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    // SAFETY: an exact Object/null prototype establishes the plain-record
    // owner consumed below; primitives, functions, and class instances have
    // already been rejected without reading caller-controlled properties.
    const owner = value as object;
    // SAFETY: RuntimeProperty exhausts JavaScript property value types, and
    // callers can read only the library's closed field-name union.
    const record = owner as RuntimeRecord;
    return Object.freeze({
      owner,
      has(key: RuntimeRecordKey): boolean {
        return Object.hasOwn(owner, key);
      },
      read(key: RuntimeRecordKey): RuntimeProperty {
        return Object.hasOwn(owner, key) ? record[key] : undefined;
      },
    });
  } catch {
    return undefined;
  }
}

export function stringFrom<Value>(value: Value): string | undefined {
  const result = STRING_SCHEMA.safeParse(value);
  return result.success ? result.data : undefined;
}
