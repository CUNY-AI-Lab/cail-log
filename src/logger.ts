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
  type CailSourceClass,
  type CailTerminalReason,
  type CailTerminalFields,
} from "./schema.js";
import {
  assertValidatedEvent,
  markValidatedEvent,
} from "./event-provenance.js";
import { isSensitive } from "./sensitive.js";
import { containsSecretToken } from "./secret-pattern.js";
import { TERMINAL_REASONS } from "./terminal-reasons.js";
import {
  callableFrom,
  numberFrom,
  plainRecordFrom,
  stringFrom,
} from "./validation.js";

export type CailLogDiagnosticCode =
  | "clock_error"
  | "event_contract_error"
  | "event_invalid"
  | "event_dropped"
  | "sink_error";

export type CailLogSink = (event: CailLogEvent) => void | PromiseLike<void>;
export type CailLogDiagnosticSink = (
  code: CailLogDiagnosticCode,
) => void | PromiseLike<void>;

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
type Sanitizer = <Value>(value: Value) => SanitizedScalar | undefined;
type FieldDefinition = readonly [output: keyof CailLogAttributes, clean: Sanitizer];
type MutableCailLogEvent = {
  -readonly [Key in keyof CailLogEvent]: CailLogEvent[Key];
};
type CailLoggerOptionsSnapshot = Readonly<{
  service: unknown;
  release: unknown;
  env: unknown;
  sourceClass: unknown;
  subjectVersion: unknown;
  catalog: unknown;
  sink: unknown;
  onDiagnostic: unknown;
  clock: unknown;
}>;

const ENVIRONMENTS: ReadonlySet<string> = new Set([
  "production",
  "staging",
  "development",
  "test",
]);
const SOURCE_CLASSES: ReadonlySet<string> = new Set(["platform", "tenant"]);
const KNOWN_FIELDS: ReadonlySet<string> = new Set(CAIL_PLATFORM_FIELD_NAMES);

function snapshotLoggerOptions<Value>(options: Value): CailLoggerOptionsSnapshot {
  try {
    const parsed = plainRecordFrom(options);
    if (parsed === undefined) {
      throw new TypeError("invalid logger options");
    }
    const fields = parsed;
    return Object.freeze({
      service: fields.read("service"),
      release: fields.read("release"),
      env: fields.read("env"),
      sourceClass: fields.read("sourceClass"),
      subjectVersion: fields.read("subjectVersion"),
      catalog: fields.read("catalog"),
      sink: fields.read("sink"),
      onDiagnostic: fields.read("onDiagnostic"),
      clock: fields.read("clock"),
    });
  } catch {
    throw new TypeError("cail-log: options must be a readable plain object");
  }
}

function sanitizePattern<Value>(value: Value, pattern: RegExp): string | undefined {
  const text = stringFrom(value);
  if (text === undefined || isSensitive(value)) return undefined;
  if (containsSecretToken(text)) return undefined;
  return pattern.test(text) ? text : undefined;
}

function sanitizeEnum<Value>(
  value: Value,
  allowed: readonly string[],
): string | undefined {
  const text = stringFrom(value);
  return text !== undefined && allowed.includes(text) ? text : undefined;
}

function sanitizeDuration<Value>(value: Value): number | undefined {
  const number = numberFrom(value);
  return number !== undefined && Number.isFinite(number) && number >= 0
    ? number
    : undefined;
}

function sanitizeCounter<Value>(value: Value): number | undefined {
  const number = numberFrom(value);
  return number !== undefined && Number.isSafeInteger(number) && number >= 0
    ? number
    : undefined;
}

function sanitizeStatus<Value>(value: Value): number | undefined {
  const number = numberFrom(value);
  return number !== undefined &&
    Number.isInteger(number) &&
    number >= 100 &&
    number <= 599
    ? number
    : undefined;
}

function sanitizeRouteTemplate<Value>(value: Value): string | undefined {
  const route = stringFrom(value);
  if (route === undefined || route.length > 160) return undefined;
  return sanitizePattern(route, ROUTE_TEMPLATE_RE);
}

const EVENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const COMMON_FIELD_DEFS: Readonly<Record<string, FieldDefinition>> = Object.freeze({
  request_id: ["cail.request.id", (value) => sanitizePattern(value, REQUEST_ID_RE)],
  action_id: ["cail.action.id", (value) => sanitizePattern(value, EVENT_ID_RE)],
  call_id: ["cail.call.id", (value) => sanitizePattern(value, EVENT_ID_RE)],
  http_method: ["http.request.method", (value) => sanitizeEnum(value, HTTP_METHODS)],
  route: ["url.template", sanitizeRouteTemplate],
  status: ["http.response.status_code", sanitizeStatus],
  duration_ms: ["cail.operation.duration_ms", sanitizeDuration],
  error_type: ["error.type", (value) => sanitizePattern(value, SLUG_RE)],
  retry_count: ["cail.retry.count", sanitizeCounter],
  req_bytes: ["http.request.body.size", sanitizeCounter],
});

const PLATFORM_FIELD_DEFS: Readonly<Record<string, FieldDefinition>> = Object.freeze({
  usage_id: ["cail.usage.id", (value) => sanitizePattern(value, EVENT_ID_RE)],
  cohort: ["cail.cohort.id", (value) => sanitizePattern(value, SLUG_RE)],
  product_id: ["cail.product.id", (value) => sanitizePattern(value, SLUG_RE)],
  provider: ["gen_ai.provider.name", (value) => sanitizePattern(value, SLUG_RE)],
  request_model: ["gen_ai.request.model", (value) => sanitizePattern(value, MODEL_ID_RE)],
  response_model: ["gen_ai.response.model", (value) => sanitizePattern(value, MODEL_ID_RE)],
  input_tokens: ["gen_ai.usage.input_tokens", sanitizeCounter],
  output_tokens: ["gen_ai.usage.output_tokens", sanitizeCounter],
  cost_micro_usd: ["cail.gen_ai.cost.micro_usd", sanitizeCounter],
});

function sanitizeUsage<Value>(value: Value):
  | { kind: "sandbox_compute"; unit: "mib_milliseconds"; quantity: number }
  | undefined {
  const parsed = plainRecordFrom(value);
  if (parsed === undefined) return undefined;
  const fields = parsed;
  if (
    fields.read("kind") !== "sandbox_compute" ||
    fields.read("unit") !== "mib_milliseconds"
  ) {
    return undefined;
  }
  const quantity = sanitizeCounter(fields.read("quantity"));
  if (quantity === undefined) return undefined;
  return {
    kind: "sandbox_compute",
    unit: "mib_milliseconds",
    quantity,
  };
}

function sanitizeTrace<Value>(value: Value):
  | { trace_id: string; span_id: string; trace_flags: 0 | 1 }
  | undefined {
  const parsed = plainRecordFrom(value);
  if (parsed === undefined) return undefined;
  const fields = parsed;
  const traceId = sanitizePattern(fields.read("trace_id"), HEX_TRACE_RE);
  const spanId = sanitizePattern(fields.read("span_id"), HEX_SPAN_RE);
  const traceFlags = numberFrom(fields.read("trace_flags"));
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

function sanitizePrincipal<Value>(value: Value, subjectVersion: string | undefined):
  | { type: "user" | "app" | "service" | "canary" | "anonymous"; subject?: string }
  | undefined {
  const parsed = plainRecordFrom(value);
  if (parsed === undefined) return undefined;
  const fields = parsed;
  const type = sanitizeEnum(fields.read("type"), [
    "user",
    "app",
    "service",
    "canary",
    "anonymous",
  ]);
  if (type === undefined) return undefined;
  // SAFETY: sanitizeEnum accepted only the five values in the closed list.
  const principalType = type as
    | "user"
    | "app"
    | "service"
    | "canary"
    | "anonymous";
  const subjectValue = fields.has("subject")
    ? fields.read("subject")
    : undefined;
  const hasSubject = subjectValue !== undefined;
  if (principalType === "user" || principalType === "canary") {
    if (subjectVersion === undefined) return undefined;
    const subject = sanitizePattern(subjectValue, SUBJECT_RE);
    return subject === undefined ||
      !subject.startsWith(`cail-${subjectVersion}-`)
      ? undefined
      : { type: principalType, subject };
  }
  return hasSubject ? undefined : { type: principalType };
}

function sanitizeTerminal<Value>(value: Value):
  | { outcome: CailOutcome; reason: string }
  | undefined {
  const parsed = plainRecordFrom(value);
  if (parsed === undefined) return undefined;
  const outcome = sanitizeEnum(
    parsed.read("outcome"),
    Object.keys(TERMINAL_REASONS),
  );
  const reason = stringFrom(parsed.read("reason"));
  if (
    outcome === undefined ||
    reason === undefined ||
    // SAFETY: sanitizeEnum accepted only keys owned by TERMINAL_REASONS.
    !TERMINAL_REASONS[outcome as CailOutcome].includes(
      // SAFETY: includes performs the final closed reason check.
      reason as CailTerminalReason,
    )
  ) {
    return undefined;
  }
  // SAFETY: the map lookup and includes check established the closed pair.
  return { outcome: outcome as CailOutcome, reason };
}

export type CailWorkersLogEvent = Readonly<
  Record<string, CailLogAttributeValue>
>;

export function toWorkersLogEvent(event: CailLogEvent): CailWorkersLogEvent {
  assertValidatedEvent(event);
  const output = new Map<string, CailLogAttributeValue>(
    Object.entries(event.attributes),
  );
  output.set("service.namespace", event.resource["service.namespace"]);
  output.set("service.name", event.resource["service.name"]);
  output.set("service.version", event.resource["service.version"]);
  output.set(
    "deployment.environment.name",
    event.resource["deployment.environment.name"],
  );
  output.set("cail.schema.version", event.schema_version);
  output.set("timestamp", event.timestamp);
  output.set("severity_text", event.severity_text);
  output.set("severity_number", event.severity_number);
  output.set("event.name", event.event_name);
  output.set("body", event.body);
  if (event.trace_id !== undefined) output.set("trace_id", event.trace_id);
  if (event.span_id !== undefined) output.set("span_id", event.span_id);
  if (event.trace_flags !== undefined)
    output.set("trace_flags", event.trace_flags);
  return Object.freeze(Object.fromEntries(output));
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

function buildEvent<EventName, Fields>(
  eventName: EventName,
  fields: Fields,
  timestamp: string,
  context: LoggerContext,
  catalog: CailEventCatalog,
  report: (code: CailLogDiagnosticCode) => void,
): CailLogEvent | undefined {
  const eventNameString = stringFrom(eventName);
  if (
    eventNameString === undefined ||
    !Object.hasOwn(catalog, eventNameString)
  ) {
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

  const definition = catalog[eventNameString]!;
  if (
    definition.source !== "both" &&
    definition.source !== context.sourceClass
  ) {
    report("event_contract_error");
    return undefined;
  }

  const parsedFields = plainRecordFrom(fields === undefined ? {} : fields);
  if (parsedFields === undefined) {
    report("event_contract_error");
    return undefined;
  }
  const rawInput = parsedFields;
  const allowed = new Set<string>([
    ...definition.required,
    ...definition.optional,
  ]);
  const input = new Map<string, unknown>();
  for (const key of KNOWN_FIELDS) {
    if (!rawInput.has(key)) continue;
    const value = rawInput.read(key);
    if (value === undefined) continue;
    if (!allowed.has(key)) {
      report("event_contract_error");
      return undefined;
    }
    input.set(key, value);
  }

  const attributes = new Map<keyof CailLogAttributes, CailLogAttributeValue>([
    ["cail.source.class", context.sourceClass],
  ]);
  const accepted = new Set<string>();
  for (const [key, [attribute, sanitizer]] of Object.entries(COMMON_FIELD_DEFS)) {
    if (!allowed.has(key) || !input.has(key)) continue;
    const clean = sanitizer(input.get(key));
    if (clean === undefined) {
      report("event_contract_error");
      return undefined;
    }
    attributes.set(attribute, clean);
    accepted.add(key);
  }

  let traceId: string | undefined;
  let spanId: string | undefined;
  let traceFlags: 0 | 1 | undefined;
  if (allowed.has("trace") && input.has("trace")) {
    const trace = sanitizeTrace(input.get("trace"));
    if (trace === undefined) {
      report("event_contract_error");
      return undefined;
    }
    ({ trace_id: traceId, span_id: spanId, trace_flags: traceFlags } = trace);
    accepted.add("trace");
  }

  if (context.sourceClass === "platform") {
    for (const [key, [attribute, sanitizer]] of Object.entries(PLATFORM_FIELD_DEFS)) {
      if (!allowed.has(key) || !input.has(key)) continue;
      const clean = sanitizer(input.get(key));
      if (clean === undefined) {
        report("event_contract_error");
        return undefined;
      }
      attributes.set(attribute, clean);
      accepted.add(key);
    }
    if (allowed.has("principal") && input.has("principal")) {
      const principal = sanitizePrincipal(
        input.get("principal"),
        context.subjectVersion,
      );
      if (principal === undefined) {
        report("event_contract_error");
        return undefined;
      }
      attributes.set("cail.principal.type", principal.type);
      if (principal.subject !== undefined) {
        attributes.set("enduser.pseudo.id", principal.subject);
      }
      accepted.add("principal");
    }
    if (allowed.has("usage") && input.has("usage")) {
      const usage = sanitizeUsage(input.get("usage"));
      if (usage === undefined) {
        report("event_contract_error");
        return undefined;
      }
      attributes.set("cail.usage.kind", usage.kind);
      attributes.set("cail.usage.unit", usage.unit);
      attributes.set("cail.usage.quantity", usage.quantity);
      accepted.add("usage");
    }
  }

  let terminalOutcome: CailOutcome | undefined;
  let terminalReason: CailTerminalReason | undefined;
  if (allowed.has("terminal") && input.has("terminal")) {
    const terminal = sanitizeTerminal(input.get("terminal"));
    if (terminal === undefined) {
      report("event_contract_error");
      return undefined;
    }
    terminalOutcome = terminal.outcome;
    // SAFETY: sanitizeTerminal accepts only a reason from the closed terminal
    // reason map before returning it.
    terminalReason = terminal.reason as CailTerminalReason;
    attributes.set("cail.outcome", terminalOutcome);
    attributes.set("cail.outcome.reason", terminalReason);
    accepted.add("terminal");
  }

  if (definition.required.some((field) => !accepted.has(field))) {
    report("event_contract_error");
    return undefined;
  }

  const outcome = terminalOutcome;
  if (
    (outcome === "ok" && attributes.has("error.type")) ||
    (definition.outcomes !== undefined &&
      (outcome === undefined || !definition.outcomes.includes(outcome))) ||
    (definition.terminal_reasons !== undefined &&
      (terminalReason === undefined ||
        !definition.terminal_reasons.includes(terminalReason)))
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

  const rawAttributes = Object.fromEntries(attributes);
  // SAFETY: every key is owned by CailLogAttributes and every value passed its
  // field-specific sanitizer before insertion.
  const eventAttributes = Object.freeze(rawAttributes) as CailLogAttributes;
  const output: MutableCailLogEvent = {
    schema_version: CAIL_LOG_SCHEMA_VERSION,
    timestamp,
    severity_text: level.toUpperCase(),
    severity_number: CAIL_SEVERITY_NUMBER[level],
    event_name: eventNameString,
    body: definition.body,
    resource: context.resource,
    attributes: eventAttributes,
  };
  if (traceId !== undefined && spanId !== undefined && traceFlags !== undefined) {
    output.trace_id = traceId;
    output.span_id = spanId;
    output.trace_flags = traceFlags;
  }

  return Object.freeze({
    ...output,
    resource: Object.freeze({ ...output.resource }),
    attributes: eventAttributes,
  });
}

export function createCailLogger<
  const Catalog extends CailEventCatalog,
  const Source extends CailSourceClass,
>(
  options: CailLoggerOptions<Catalog, Source>,
): CailLogger<Catalog, Source> {
  const configured = snapshotLoggerOptions(options);

  const service = sanitizePattern(configured.service, SLUG_RE);
  const release = sanitizePattern(configured.release, MACHINE_ID_RE);
  if (service === undefined) {
    throw new TypeError("cail-log: service must be a slug");
  }
  if (release === undefined) {
    throw new TypeError("cail-log: release must be a machine identifier");
  }
  const configuredEnvironment = stringFrom(configured.env);
  if (
    configuredEnvironment === undefined ||
    !ENVIRONMENTS.has(configuredEnvironment)
  ) {
    throw new TypeError(
      "cail-log: env must be production, staging, development, or test",
    );
  }
  const configuredSourceClass = stringFrom(configured.sourceClass);
  if (
    configuredSourceClass === undefined ||
    !SOURCE_CLASSES.has(configuredSourceClass)
  ) {
    throw new TypeError("cail-log: sourceClass must be platform or tenant");
  }
  // SAFETY: membership in the closed environment set was established above.
  const env = configuredEnvironment as CailLogEnvironment;
  // SAFETY: membership in the closed source-class set was established above.
  const sourceClass = configuredSourceClass as CailSourceClass;
  const subjectVersion = sanitizePattern(
    configured.subjectVersion,
    SUBJECT_VERSION_RE,
  );
  if (sourceClass === "platform" && subjectVersion === undefined) {
    throw new TypeError(
      "cail-log: platform loggers require a subjectVersion",
    );
  }
  if (
    sourceClass === "tenant" &&
    configured.subjectVersion !== undefined
  ) {
    throw new TypeError(
      "cail-log: tenant loggers must not configure a subjectVersion",
    );
  }
  if (callableFrom(configured.sink) === undefined) {
    throw new TypeError("cail-log: sink must be an explicit function");
  }
  if (
    configured.clock !== undefined &&
    callableFrom(configured.clock) === undefined
  ) {
    throw new TypeError("cail-log: clock must be a function");
  }
  if (
    configured.onDiagnostic !== undefined &&
    callableFrom(configured.onDiagnostic) === undefined
  ) {
    throw new TypeError("cail-log: onDiagnostic must be a function");
  }

  if (!isDefinedEventCatalog(configured.catalog)) {
    throw new TypeError(
      "cail-log: catalog must come from defineEventCatalog, extendCailEventCatalog, or CAIL_EVENT_CATALOG",
    );
  }
  // SAFETY: isDefinedEventCatalog established provenance and the generic
  // options contract preserves the caller's exact catalog type.
  const catalog = configured.catalog as Catalog;
  // SAFETY: callableFrom established a callable value and the options contract
  // supplies its event signature.
  const sink = configured.sink as CailLogSink;
  // SAFETY: callableFrom established the optional clock's callability; the
  // options contract owns its zero-argument numeric result.
  const clock = (configured.clock as (() => number) | undefined) ?? Date.now;
  // SAFETY: callableFrom established the optional diagnostic sink's
  // callability; the options contract owns its diagnostic signature.
  const onDiagnostic = configured.onDiagnostic as
    | CailLogDiagnosticSink
    | undefined;
  const context: LoggerContext = {
    sourceClass,
    subjectVersion,
    resource: Object.freeze({
      "service.namespace": "cuny-ai-lab",
      "service.name": service,
      "service.version": release,
      "deployment.environment.name": env,
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
        const result = onDiagnostic(code);
        if (result !== undefined) {
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
      const result = sink(logEvent);
      if (result !== undefined) {
        Promise.resolve(result).catch(() => report("sink_error"));
      }
    } catch {
      report("sink_error");
    }
  }

  // SAFETY: emit is closed over the exact Catalog and Source supplied to this
  // constructor; the public mapped signature narrows those same event keys.
  return {
    emit,
  } as CailLogger<Catalog, Source>;
}
