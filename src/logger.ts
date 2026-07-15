import {
  CAIL_EVENT_INVALID,
  CAIL_EVENT_INVALID_MESSAGE,
  CAIL_LOG_SCHEMA_VERSION,
  CAIL_PLATFORM_FIELD_NAMES,
  CAIL_SEVERITY_NUMBER,
  HEX_SPAN_RE,
  HEX_TRACE_RE,
  HTTP_METHODS,
  MACHINE_ID_RE,
  MODEL_ID_RE,
  REQUEST_ID_RE,
  ROUTE_TEMPLATE_RE,
  SLUG_RE,
  SUBJECT_RE,
  SUBJECT_VERSION_RE,
  isDefinedEventCatalog,
  isPlainObject,
  type CailEventCatalog,
  type CailEventDefinition,
  type CailLogEnvironment,
  type CailLogAttributes,
  type CailLogAttributeValue,
  type CailLogEvent,
  type CailLogFields,
  type CailLogLevel,
  type CailOutcome,
  type CailPlatformLogFieldName,
  type CailQuotaEvent,
  type CailSourceClass,
  type CailTerminalFields,
} from "./schema.js";
import {
  assertValidatedEvent,
  markValidatedEvent,
} from "./event-provenance.js";
import { isSensitive } from "./sensitive.js";
import { isSecretShaped } from "./secret-shape.js";

export type CailLogDiagnosticCode =
  | "clock_error"
  | "event_contract_error"
  | "event_invalid"
  | "event_dropped"
  | "sink_error";

export type CailLogSink = (event: CailLogEvent) => unknown;
export type CailLogDiagnosticSink = (
  code: CailLogDiagnosticCode,
) => unknown;

type CailLoggerOptionsBase<
  Catalog extends CailEventCatalog,
  Source extends CailSourceClass,
> = {
  service: string;
  release: string;
  env: CailLogEnvironment;
  sourceClass: Source;
  catalog: Catalog;
  sink: CailLogSink;
  onDiagnostic?: CailLogDiagnosticSink;
  clock?: () => number;
};

export type CailLoggerOptions<
  Catalog extends CailEventCatalog,
  Source extends CailSourceClass,
> = CailLoggerOptionsBase<Catalog, Source> &
  (Source extends "platform"
    ? { subjectVersion: string }
    : { subjectVersion?: never });

type CailEventNameFor<
  Catalog extends CailEventCatalog,
  Source extends CailSourceClass,
> = {
  [Event in Extract<keyof Catalog, string>]: Extract<
    Catalog[Event]["source"],
    Source | "both"
  > extends never
    ? never
    : Event;
}[Extract<keyof Catalog, string>];

type CailRequiredFieldNames<Definition extends CailEventDefinition> = Extract<
  Definition["required"][number],
  CailPlatformLogFieldName
>;

type CailOptionalFieldNames<Definition extends CailEventDefinition> = Extract<
  Definition["optional"][number],
  CailPlatformLogFieldName
>;

type CailAllowedOutcomes<Definition extends CailEventDefinition> =
  Definition extends { outcomes: readonly (infer Outcome)[] }
    ? Outcome
    : CailOutcome;

type CailAllowedReasons<Definition extends CailEventDefinition> =
  Definition extends { terminal_reasons: readonly (infer Reason)[] }
    ? Reason
    : CailTerminalFields["reason"];

type CailTerminalFor<Definition extends CailEventDefinition> =
  CailTerminalFields extends infer Terminal
    ? Terminal extends CailTerminalFields
      ? Terminal["outcome"] extends CailAllowedOutcomes<Definition>
        ? Terminal["reason"] extends CailAllowedReasons<Definition>
          ? Terminal
          : never
        : never
      : never
    : never;

type CailFieldValue<
  Definition extends CailEventDefinition,
  Source extends CailSourceClass,
  Field extends keyof CailLogFields<Source>,
> = Field extends "terminal"
  ? CailTerminalFor<Definition>
  : NonNullable<CailLogFields<Source>[Field]>;

type CailFieldsFor<
  Definition extends CailEventDefinition,
  Source extends CailSourceClass,
> = CailBaseFieldsFor<Definition, Source> &
  CailSuccessErrorConstraint<Definition>;

type CailBaseFieldsFor<
  Definition extends CailEventDefinition,
  Source extends CailSourceClass,
> = {
  [Field in Extract<
    CailRequiredFieldNames<Definition>,
    keyof CailLogFields<Source>
  >]-?: CailFieldValue<Definition, Source, Field>;
} & {
  [Field in Extract<
    CailOptionalFieldNames<Definition>,
    keyof CailLogFields<Source>
  >]?: CailFieldValue<Definition, Source, Field>;
};

type CailAllowedFieldNames<Definition extends CailEventDefinition> =
  | CailRequiredFieldNames<Definition>
  | CailOptionalFieldNames<Definition>;

type CailSuccessErrorConstraint<Definition extends CailEventDefinition> =
  "terminal" extends CailAllowedFieldNames<Definition>
    ? "error_type" extends CailAllowedFieldNames<Definition>
      ?
          | {
              terminal?: Exclude<
                CailTerminalFor<Definition>,
                { outcome: "ok" }
              >;
              error_type?: string;
            }
          | {
              terminal: Extract<
                CailTerminalFor<Definition>,
                { outcome: "ok" }
              >;
              error_type?: never;
            }
      : unknown
    : unknown;

type CailEmitArguments<
  Definition extends CailEventDefinition,
  Source extends CailSourceClass,
> = CailRequiredFieldNames<Definition> extends never
  ? [fields?: CailFieldsFor<Definition, Source>]
  : [fields: CailFieldsFor<Definition, Source>];

export interface CailLogger<
  Catalog extends CailEventCatalog = CailEventCatalog,
  Source extends CailSourceClass = "tenant",
> {
  emit<Event extends CailEventNameFor<Catalog, Source>>(
    event: Event,
    ...args: CailEmitArguments<Catalog[Event], Source>
  ): void;
}

type SanitizedScalar = CailLogAttributeValue;
type Sanitizer = (value: unknown) => SanitizedScalar | undefined;
type FieldDefinition = readonly [output: keyof CailLogAttributes, clean: Sanitizer];
type MutableCailLogEvent = {
  -readonly [Key in keyof CailLogEvent]: CailLogEvent[Key];
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

const ENVIRONMENTS: ReadonlySet<string> = new Set([
  "production",
  "staging",
  "development",
  "test",
]);
const SOURCE_CLASSES: ReadonlySet<string> = new Set(["platform", "tenant"]);
const KNOWN_FIELDS: ReadonlySet<string> = new Set(CAIL_PLATFORM_FIELD_NAMES);
function sanitizePattern(value: unknown, pattern: RegExp): string | undefined {
  if (isSensitive(value) || typeof value !== "string") return undefined;
  if (isSecretShaped(value)) return undefined;
  return pattern.test(value) ? value : undefined;
}

function sanitizeEnum(
  value: unknown,
  allowed: readonly string[],
): string | undefined {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : undefined;
}

function sanitizeDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function sanitizeCounter(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function sanitizeStatus(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

function sanitizeRouteTemplate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 160) return undefined;
  return sanitizePattern(value, ROUTE_TEMPLATE_RE);
}

const COMMON_FIELD_DEFS: Readonly<Record<string, FieldDefinition>> = Object.freeze({
  request_id: ["cail.request.id", (value) => sanitizePattern(value, REQUEST_ID_RE)],
  action_id: ["cail.action.id", (value) => sanitizePattern(value, REQUEST_ID_RE)],
  call_id: ["cail.call.id", (value) => sanitizePattern(value, REQUEST_ID_RE)],
  http_method: ["http.request.method", (value) => sanitizeEnum(value, HTTP_METHODS)],
  route: ["url.template", sanitizeRouteTemplate],
  status: ["http.response.status_code", sanitizeStatus],
  duration_ms: ["cail.operation.duration_ms", sanitizeDuration],
  upstream_ms: ["cail.upstream.duration_ms", sanitizeDuration],
  error_type: ["error.type", (value) => sanitizePattern(value, SLUG_RE)],
  retry_count: ["cail.retry.count", sanitizeCounter],
  req_bytes: ["http.request.body.size", sanitizeCounter],
  resp_bytes: ["http.response.body.size", sanitizeCounter],
});

const PLATFORM_FIELD_DEFS: Readonly<Record<string, FieldDefinition>> = Object.freeze({
  usage_id: ["cail.usage.id", (value) => sanitizePattern(value, REQUEST_ID_RE)],
  cohort: ["cail.cohort.id", (value) => sanitizePattern(value, SLUG_RE)],
  key_id: ["cail.key.id", (value) => sanitizePattern(value, MACHINE_ID_RE)],
  product_id: ["cail.product.id", (value) => sanitizePattern(value, SLUG_RE)],
  project: ["cail.kale.project.name", (value) => sanitizePattern(value, SLUG_RE)],
  provider: ["gen_ai.provider.name", (value) => sanitizePattern(value, SLUG_RE)],
  request_model: ["gen_ai.request.model", (value) => sanitizePattern(value, MODEL_ID_RE)],
  response_model: ["gen_ai.response.model", (value) => sanitizePattern(value, MODEL_ID_RE)],
  input_tokens: ["gen_ai.usage.input_tokens", sanitizeCounter],
  output_tokens: ["gen_ai.usage.output_tokens", sanitizeCounter],
  cost_micro_usd: ["cail.gen_ai.cost.micro_usd", sanitizeCounter],
});

const QUOTA_UNITS: Readonly<Record<string, string>> = Object.freeze({
  model_spend: "micro_usd",
  request_count: "requests",
  build_count: "builds",
  storage: "bytes",
  compute: "milliseconds",
  sandbox_compute: "gib_seconds",
});

function sanitizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  return new Date(milliseconds).toISOString() === value ? value : undefined;
}

function sanitizeQuota(value: unknown): CailQuotaEvent | undefined {
  if (!isPlainObject(value)) return undefined;

  const kind = sanitizePattern(value["kind"], SLUG_RE);
  const unit = sanitizePattern(value["unit"], SLUG_RE);
  const state = sanitizeEnum(value["state"], ["fresh", "stale"]);
  const limit = sanitizeCounter(value["limit"]);
  const used = sanitizeCounter(value["used"]);
  const resetAt = sanitizeIsoTimestamp(value["reset_at"]);

  if (
    kind === undefined ||
    unit === undefined ||
    QUOTA_UNITS[kind] !== unit ||
    state === undefined ||
    limit === undefined ||
    used === undefined ||
    resetAt === undefined
  ) {
    return undefined;
  }

  return {
    kind,
    unit,
    state,
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    reset_at: resetAt,
  } as CailQuotaEvent;
}

function sanitizeUsage(value: unknown):
  | { kind: "sandbox_compute"; unit: "mib_milliseconds"; quantity: number }
  | undefined {
  if (!isPlainObject(value)) return undefined;
  if (
    value["kind"] !== "sandbox_compute" ||
    value["unit"] !== "mib_milliseconds"
  ) {
    return undefined;
  }
  const quantity = sanitizeCounter(value["quantity"]);
  if (quantity === undefined) return undefined;
  return {
    kind: "sandbox_compute",
    unit: "mib_milliseconds",
    quantity,
  };
}

function sanitizeTrace(value: unknown):
  | { trace_id: string; span_id: string; trace_flags: 0 | 1 }
  | undefined {
  if (!isPlainObject(value)) return undefined;
  const traceId = sanitizePattern(value["trace_id"], HEX_TRACE_RE);
  const spanId = sanitizePattern(value["span_id"], HEX_SPAN_RE);
  const traceFlags = value["trace_flags"];
  if (
    traceId === undefined ||
    traceId === "0".repeat(32) ||
    spanId === undefined ||
    spanId === "0".repeat(16) ||
    (traceFlags !== 0 && traceFlags !== 1)
  ) {
    return undefined;
  }
  return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags };
}

function sanitizePrincipal(value: unknown, subjectVersion: string | undefined):
  | { type: "user" | "app" | "service" | "canary" | "anonymous"; subject?: string }
  | undefined {
  if (!isPlainObject(value)) return undefined;
  const type = sanitizeEnum(value["type"], [
    "user",
    "app",
    "service",
    "canary",
    "anonymous",
  ]);
  if (type === undefined) return undefined;
  const principalType = type as
    | "user"
    | "app"
    | "service"
    | "canary"
    | "anonymous";
  const hasSubject = Object.hasOwn(value, "subject");
  if (principalType === "user" || principalType === "canary") {
    if (subjectVersion === undefined) return undefined;
    const subject = sanitizePattern(value["subject"], SUBJECT_RE);
    return subject === undefined ||
      !subject.startsWith(`cail-${subjectVersion}-`)
      ? undefined
      : { type: principalType, subject };
  }
  return hasSubject ? undefined : { type: principalType };
}

const TERMINAL_REASONS: Readonly<Record<CailOutcome, readonly string[]>> =
  Object.freeze({
    ok: ["completed"],
    client_error: ["client_error"],
    error: ["application_failure", "upstream_failure"],
    denied: ["denied", "quota_blocked", "rate_limited"],
    cancelled: ["cancelled"],
    timeout: ["timeout"],
    outcome_unknown: ["unknown"],
  });

function sanitizeTerminal(value: unknown):
  | { outcome: CailOutcome; reason: string }
  | undefined {
  if (!isPlainObject(value)) return undefined;
  const outcome = sanitizeEnum(value["outcome"], Object.keys(TERMINAL_REASONS));
  const reason = typeof value["reason"] === "string" ? value["reason"] : undefined;
  if (
    outcome === undefined ||
    reason === undefined ||
    !TERMINAL_REASONS[outcome as CailOutcome].includes(reason)
  ) {
    return undefined;
  }
  return { outcome: outcome as CailOutcome, reason };
}

export function jsonLineSink(event: CailLogEvent): void {
  assertValidatedEvent(event);
  console.log(JSON.stringify(event));
}

export type CailWorkersLogEvent = Readonly<
  Record<string, CailLogAttributeValue>
>;

export function toWorkersLogEvent(event: CailLogEvent): CailWorkersLogEvent {
  assertValidatedEvent(event);
  const output: Record<string, CailLogAttributeValue> = {
    ...event.attributes,
    "service.namespace": event.resource["service.namespace"],
    "service.name": event.resource["service.name"],
    "service.version": event.resource["service.version"],
    "deployment.environment.name":
      event.resource["deployment.environment.name"],
    "cail.schema.version": event.schema_version,
    timestamp: event.timestamp,
    severity_text: event.severity_text,
    severity_number: event.severity_number,
    "event.name": event.event_name,
    body: event.body,
  };
  if (event.trace_id !== undefined) output.trace_id = event.trace_id;
  if (event.span_id !== undefined) output.span_id = event.span_id;
  if (event.trace_flags !== undefined) output.trace_flags = event.trace_flags;
  return Object.freeze(output);
}

export function workersStructuredSink(event: CailLogEvent): void {
  const output = toWorkersLogEvent(event);
  if (event.severity_number >= CAIL_SEVERITY_NUMBER.error) {
    console.error(output);
  } else if (event.severity_number >= CAIL_SEVERITY_NUMBER.warn) {
    console.warn(output);
  } else {
    console.log(output);
  }
}

interface LoggerContext {
  sourceClass: CailSourceClass;
  subjectVersion?: string;
  resource: CailLogEvent["resource"];
}

function buildEvent(
  eventName: unknown,
  fields: unknown,
  timestamp: string,
  context: LoggerContext,
  catalog: CailEventCatalog,
  report: (code: CailLogDiagnosticCode) => void,
): CailLogEvent | undefined {
  const knownEvent =
    typeof eventName === "string" && Object.hasOwn(catalog, eventName);
  if (!knownEvent) {
    report("event_invalid");
    return Object.freeze({
      schema_version: CAIL_LOG_SCHEMA_VERSION,
      timestamp,
      severity_text: "ERROR",
      severity_number: CAIL_SEVERITY_NUMBER.error,
      event_name: CAIL_EVENT_INVALID,
      body: CAIL_EVENT_INVALID_MESSAGE,
      resource: Object.freeze({ ...context.resource }),
      attributes: Object.freeze({
        "cail.source.class": context.sourceClass,
      }),
    });
  }

  const definition = catalog[eventName as string]!;
  if (
    definition.source !== "both" &&
    definition.source !== context.sourceClass
  ) {
    report("event_contract_error");
    return undefined;
  }

  const input: Record<string, unknown> = isPlainObject(fields) ? fields : {};
  const allowed = new Set<string>([
    ...definition.required,
    ...definition.optional,
  ]);
  for (const key of Object.keys(input)) {
    if (KNOWN_FIELDS.has(key) && !allowed.has(key)) {
      report("event_contract_error");
      return undefined;
    }
  }

  const attributes: Record<string, CailLogAttributeValue> = {
    "cail.source.class": context.sourceClass,
  };
  const accepted = new Set<string>();
  for (const [key, [attribute, sanitizer]] of Object.entries(COMMON_FIELD_DEFS)) {
    if (!allowed.has(key) || !Object.hasOwn(input, key)) continue;
    const clean = sanitizer(input[key]);
    if (clean === undefined) {
      report("event_contract_error");
      return undefined;
    }
    attributes[attribute] = clean;
    accepted.add(key);
  }

  let traceId: string | undefined;
  let spanId: string | undefined;
  let traceFlags: 0 | 1 | undefined;
  if (allowed.has("trace") && Object.hasOwn(input, "trace")) {
    const trace = sanitizeTrace(input["trace"]);
    if (trace === undefined) {
      report("event_contract_error");
      return undefined;
    }
    ({ trace_id: traceId, span_id: spanId, trace_flags: traceFlags } = trace);
    accepted.add("trace");
  }

  if (context.sourceClass === "platform") {
    for (const [key, [attribute, sanitizer]] of Object.entries(PLATFORM_FIELD_DEFS)) {
      if (!allowed.has(key) || !Object.hasOwn(input, key)) continue;
      const clean = sanitizer(input[key]);
      if (clean === undefined) {
        report("event_contract_error");
        return undefined;
      }
      attributes[attribute] = clean;
      accepted.add(key);
    }
    if (allowed.has("principal") && Object.hasOwn(input, "principal")) {
      const principal = sanitizePrincipal(
        input["principal"],
        context.subjectVersion,
      );
      if (principal === undefined) {
        report("event_contract_error");
        return undefined;
      }
      attributes["cail.principal.type"] = principal.type;
      if (principal.subject !== undefined) {
        attributes["enduser.pseudo.id"] = principal.subject;
      }
      accepted.add("principal");
    }
    if (allowed.has("quota") && Object.hasOwn(input, "quota")) {
      const quota = sanitizeQuota(input["quota"]);
      if (quota === undefined) {
        report("event_contract_error");
        return undefined;
      }
      attributes["cail.quota.kind"] = quota.kind;
      attributes["cail.quota.unit"] = quota.unit;
      attributes["cail.quota.state"] = quota.state;
      attributes["cail.quota.limit"] = quota.limit;
      attributes["cail.quota.used"] = quota.used;
      attributes["cail.quota.remaining"] = quota.remaining;
      attributes["cail.quota.reset_at"] = quota.reset_at;
      accepted.add("quota");
    }
    if (allowed.has("usage") && Object.hasOwn(input, "usage")) {
      const usage = sanitizeUsage(input["usage"]);
      if (usage === undefined) {
        report("event_contract_error");
        return undefined;
      }
      attributes["cail.usage.kind"] = usage.kind;
      attributes["cail.usage.unit"] = usage.unit;
      attributes["cail.usage.quantity"] = usage.quantity;
      accepted.add("usage");
    }
  }

  if (allowed.has("terminal") && Object.hasOwn(input, "terminal")) {
    const terminal = sanitizeTerminal(input["terminal"]);
    if (terminal === undefined) {
      report("event_contract_error");
      return undefined;
    }
    attributes["cail.outcome"] = terminal.outcome;
    attributes["cail.outcome.reason"] = terminal.reason;
    accepted.add("terminal");
  }

  if (definition.required.some((field) => !accepted.has(field))) {
    report("event_contract_error");
    return undefined;
  }

  const outcome = attributes["cail.outcome"] as CailOutcome | undefined;
  const terminalReason = attributes["cail.outcome.reason"];
  if (
    (outcome === "ok" && attributes["error.type"] !== undefined) ||
    (definition.outcomes !== undefined &&
      (outcome === undefined || !definition.outcomes.includes(outcome))) ||
    (definition.terminal_reasons !== undefined &&
      (terminalReason === undefined ||
        !definition.terminal_reasons.includes(terminalReason as never)))
  ) {
    report("event_contract_error");
    return undefined;
  }

  const level: CailLogLevel = definition.severity === "outcome"
    ? outcome === "ok" || outcome === "cancelled"
      ? "info"
      : outcome === "client_error" || outcome === "denied" || outcome === "outcome_unknown"
        ? "warn"
        : "error"
    : definition.severity;

  const output: MutableCailLogEvent = {
    schema_version: CAIL_LOG_SCHEMA_VERSION,
    timestamp,
    severity_text: level.toUpperCase(),
    severity_number: CAIL_SEVERITY_NUMBER[level],
    event_name: eventName as string,
    body: definition.body,
    resource: context.resource,
    attributes: attributes as unknown as CailLogAttributes,
  };
  if (traceId !== undefined && spanId !== undefined && traceFlags !== undefined) {
    output.trace_id = traceId;
    output.span_id = spanId;
    output.trace_flags = traceFlags;
  }

  return Object.freeze({
    ...output,
    resource: Object.freeze({ ...output.resource }),
    attributes: Object.freeze({ ...attributes }) as unknown as CailLogAttributes,
  });
}

export function createCailLogger<
  const Catalog extends CailEventCatalog,
  const Source extends CailSourceClass,
>(
  options: CailLoggerOptions<Catalog, Source>,
): CailLogger<Catalog, Source> {
  if (!isPlainObject(options)) {
    throw new TypeError("cail-log: options must be an object");
  }

  const service = sanitizePattern(options.service, SLUG_RE);
  const release = sanitizePattern(options.release, MACHINE_ID_RE);
  if (service === undefined) {
    throw new TypeError("cail-log: service must be a slug");
  }
  if (release === undefined) {
    throw new TypeError("cail-log: release must be a machine identifier");
  }
  if (!ENVIRONMENTS.has(options.env)) {
    throw new TypeError(
      "cail-log: env must be production, staging, development, or test",
    );
  }
  if (!SOURCE_CLASSES.has(options.sourceClass)) {
    throw new TypeError("cail-log: sourceClass must be platform or tenant");
  }
  const subjectVersion = sanitizePattern(
    options.subjectVersion,
    SUBJECT_VERSION_RE,
  );
  if (options.sourceClass === "platform" && subjectVersion === undefined) {
    throw new TypeError(
      "cail-log: platform loggers require a subjectVersion",
    );
  }
  if (
    options.sourceClass === "tenant" &&
    Object.hasOwn(options, "subjectVersion")
  ) {
    throw new TypeError(
      "cail-log: tenant loggers must not configure a subjectVersion",
    );
  }
  let configuredSink: CailLogSink | undefined;
  let configuredClock: (() => number) | undefined;
  let configuredDiagnostic: CailLogDiagnosticSink | undefined;
  try {
    configuredSink = options.sink;
    configuredClock = options.clock;
    configuredDiagnostic = options.onDiagnostic;
  } catch {
    throw new TypeError("cail-log: callback options must be readable");
  }

  if (typeof configuredSink !== "function") {
    throw new TypeError("cail-log: sink must be an explicit function");
  }
  if (configuredClock !== undefined && typeof configuredClock !== "function") {
    throw new TypeError("cail-log: clock must be a function");
  }
  if (
    configuredDiagnostic !== undefined &&
    typeof configuredDiagnostic !== "function"
  ) {
    throw new TypeError("cail-log: onDiagnostic must be a function");
  }

  if (!isDefinedEventCatalog(options.catalog)) {
    throw new TypeError(
      "cail-log: catalog must come from defineEventCatalog, extendCailEventCatalog, or CAIL_EVENT_CATALOG",
    );
  }
  const catalog = options.catalog as Catalog;
  const sink = configuredSink;
  const clock = configuredClock ?? Date.now;
  const onDiagnostic = configuredDiagnostic;
  const context: LoggerContext = {
    sourceClass: options.sourceClass,
    subjectVersion,
    resource: Object.freeze({
      "service.namespace": "cuny-ai-lab",
      "service.name": service,
      "service.version": release,
      "deployment.environment.name": options.env,
    }),
  };

  function reportFallbackDiagnostic(): void {
    try {
      console.error("cail-log: diagnostic_error");
    } catch {
      // Nothing else can safely report this failure.
    }
  }

  function report(code: CailLogDiagnosticCode): void {
    if (onDiagnostic !== undefined) {
      try {
        const result = onDiagnostic(code) as unknown;
        if (isPromiseLike(result)) {
          Promise.resolve(result).catch(reportFallbackDiagnostic);
        }
        return;
      } catch {
        reportFallbackDiagnostic();
        return;
      }
    }
    try {
      console.error(`cail-log: ${code}`);
    } catch {
      // Logging must never break the application path.
    }
  }

  function emit(
    event: Extract<keyof Catalog, string>,
    fields?: CailLogFields<Source>,
  ): void {
    let now: number;
    try {
      now = clock();
      if (!Number.isFinite(now)) throw new TypeError("invalid clock");
    } catch {
      report("clock_error");
      try {
        now = Date.now();
        if (!Number.isFinite(now)) throw new TypeError("invalid fallback clock");
      } catch {
        report("event_dropped");
        return;
      }
    }

    let logEvent: CailLogEvent | undefined;
    try {
      logEvent = buildEvent(
        event,
        fields,
        new Date(now).toISOString(),
        context,
        catalog,
        report,
      );
    } catch {
      report("event_dropped");
      return;
    }

    if (logEvent === undefined) return;
    markValidatedEvent(logEvent);

    try {
      const result = sink(logEvent) as unknown;
      if (isPromiseLike(result)) {
        Promise.resolve(result).catch(() => report("sink_error"));
      }
    } catch {
      report("sink_error");
    }
  }

  return {
    emit,
  } as CailLogger<Catalog, Source>;
}
