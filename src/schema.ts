import { isSecretShaped } from "./secret-shape.js";

export const CAIL_LOG_SCHEMA_VERSION = 2 as const;

export const CAIL_EVENT_INVALID = "event.invalid" as const;
export const CAIL_EVENT_INVALID_MESSAGE = "Event name rejected." as const;

export type CailLogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace";

export const CAIL_SEVERITY_NUMBER: Readonly<Record<CailLogLevel, number>> =
  Object.freeze({
    trace: 1,
    debug: 5,
    info: 9,
    warn: 13,
    error: 17,
    fatal: 21,
  });

export type CailLogEnvironment =
  | "production"
  | "staging"
  | "development"
  | "test";
export type CailSourceClass = "platform" | "tenant";
export type CailOutcome =
  | "ok"
  | "client_error"
  | "error"
  | "denied"
  | "cancelled"
  | "timeout"
  | "outcome_unknown";
export type CailTerminalReason =
  | "application_failure"
  | "cancelled"
  | "client_error"
  | "completed"
  | "denied"
  | "quota_blocked"
  | "rate_limited"
  | "timeout"
  | "unknown"
  | "upstream_failure";
export type CailPrincipalType =
  | "user"
  | "app"
  | "service"
  | "canary"
  | "anonymous";

export type CailPrincipalFields =
  | Readonly<{ type: "user" | "canary"; subject: string }>
  | Readonly<{
      type: "app" | "service" | "anonymous";
      subject?: never;
    }>;

export type CailTraceFields = Readonly<{
  trace_id: string;
  span_id: string;
  trace_flags: 0 | 1;
}>;

export type CailTerminalFields =
  | Readonly<{ outcome: "ok"; reason: "completed" }>
  | Readonly<{ outcome: "client_error"; reason: "client_error" }>
  | Readonly<{ outcome: "error"; reason: "application_failure" }>
  | Readonly<{ outcome: "error"; reason: "upstream_failure" }>
  | Readonly<{ outcome: "denied"; reason: "denied" }>
  | Readonly<{ outcome: "denied"; reason: "quota_blocked" }>
  | Readonly<{ outcome: "denied"; reason: "rate_limited" }>
  | Readonly<{ outcome: "cancelled"; reason: "cancelled" }>
  | Readonly<{ outcome: "timeout"; reason: "timeout" }>
  | Readonly<{ outcome: "outcome_unknown"; reason: "unknown" }>;
export type CailQuotaState = "fresh" | "stale";
export type CailHttpMethod =
  | "CONNECT"
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT"
  | "TRACE"
  | "_OTHER";

export type CailQuotaKindUnit =
  | { kind: "model_spend"; unit: "micro_usd" }
  | { kind: "request_count"; unit: "requests" }
  | { kind: "build_count"; unit: "builds" }
  | { kind: "storage"; unit: "bytes" }
  | { kind: "compute"; unit: "milliseconds" }
  | { kind: "sandbox_compute"; unit: "gib_seconds" };

export type CailQuotaFields = CailQuotaKindUnit & {
  state: CailQuotaState;
  limit: number;
  used: number;
  reset_at: string;
};

export type CailQuotaEvent = CailQuotaFields & {
  remaining: number;
};

export type CailUsageKindUnit = {
  kind: "sandbox_compute";
  unit: "mib_milliseconds";
};

export type CailUsageFields = CailUsageKindUnit & {
  quantity: number;
};

export interface CailTenantLogFields {
  request_id?: string;
  action_id?: string;
  call_id?: string;
  trace?: CailTraceFields;

  http_method?: CailHttpMethod;
  route?: string;
  status?: number;
  terminal?: CailTerminalFields;

  duration_ms?: number;
  upstream_ms?: number;
  error_type?: string;
  retry_count?: number;

  req_bytes?: number;
  resp_bytes?: number;
}

export interface CailPlatformLogFields extends CailTenantLogFields {
  usage_id?: string;
  principal?: CailPrincipalFields;
  cohort?: string;
  key_id?: string;

  product_id?: string;
  project?: string;

  provider?: string;
  request_model?: string;
  response_model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_micro_usd?: number;

  quota?: CailQuotaFields;
  usage?: CailUsageFields;
}

export type CailLogFields<
  Source extends CailSourceClass = "tenant",
> = Source extends "platform" ? CailPlatformLogFields : CailTenantLogFields;

export type CailLogResource = Readonly<{
  "service.namespace": string;
  "service.name": string;
  "service.version": string;
  "deployment.environment.name": CailLogEnvironment;
}>;

export type CailLogAttributeValue = string | number | boolean;

export type CailLogAttributes = Readonly<{
  "cail.source.class": CailSourceClass;
  "cail.request.id"?: string;
  "cail.action.id"?: string;
  "cail.call.id"?: string;
  "http.request.method"?: CailHttpMethod;
  "url.template"?: string;
  "http.response.status_code"?: number;
  "cail.outcome"?: CailOutcome;
  "cail.outcome.reason"?: CailTerminalReason;
  "cail.operation.duration_ms"?: number;
  "cail.upstream.duration_ms"?: number;
  "error.type"?: string;
  "cail.retry.count"?: number;
  "http.request.body.size"?: number;
  "http.response.body.size"?: number;

  "cail.principal.type"?: CailPrincipalType;
  "cail.usage.id"?: string;
  "enduser.pseudo.id"?: string;
  "cail.cohort.id"?: string;
  "cail.key.id"?: string;
  "cail.product.id"?: string;
  "cail.kale.project.name"?: string;

  "gen_ai.provider.name"?: string;
  "gen_ai.request.model"?: string;
  "gen_ai.response.model"?: string;
  "gen_ai.usage.input_tokens"?: number;
  "gen_ai.usage.output_tokens"?: number;
  "cail.gen_ai.cost.micro_usd"?: number;

  "cail.quota.kind"?: CailQuotaKindUnit["kind"];
  "cail.quota.unit"?: CailQuotaKindUnit["unit"];
  "cail.quota.state"?: CailQuotaState;
  "cail.quota.limit"?: number;
  "cail.quota.used"?: number;
  "cail.quota.remaining"?: number;
  "cail.quota.reset_at"?: string;

  "cail.usage.kind"?: CailUsageKindUnit["kind"];
  "cail.usage.unit"?: CailUsageKindUnit["unit"];
  "cail.usage.quantity"?: number;
}>;

export type CailLogEvent = Readonly<{
  schema_version: typeof CAIL_LOG_SCHEMA_VERSION;
  timestamp: string;
  severity_text: string;
  severity_number: number;
  event_name: string;
  body: string;
  resource: CailLogResource;
  attributes: CailLogAttributes;
  trace_id?: string;
  span_id?: string;
  trace_flags?: 0 | 1;
}>;

export type CailTenantLogFieldName = keyof CailTenantLogFields;
export type CailPlatformLogFieldName = keyof CailPlatformLogFields;
export type CailEventSource = CailSourceClass | "both";
export type CailEventSeverity = CailLogLevel | "outcome";

type CailEventDefinitionBase = Readonly<{
  body: string;
  severity: CailEventSeverity;
  outcomes?: readonly CailOutcome[];
  terminal_reasons?: readonly CailTerminalReason[];
}>;

export type CailEventDefinition =
  | (CailEventDefinitionBase &
      Readonly<{
        source: "platform";
        required: readonly CailPlatformLogFieldName[];
        optional: readonly CailPlatformLogFieldName[];
      }>)
  | (CailEventDefinitionBase &
      Readonly<{
        source: "tenant" | "both";
        required: readonly CailTenantLogFieldName[];
        optional: readonly CailTenantLogFieldName[];
      }>);

type CailCustomEventDefinitionBase = Readonly<{
  severity: CailEventSeverity;
  outcomes?: readonly CailOutcome[];
  terminal_reasons?: readonly CailTerminalReason[];
}>;

export type CailCustomEventDefinition =
  | (CailCustomEventDefinitionBase &
      Readonly<{
        source: "platform";
        required: readonly CailPlatformLogFieldName[];
        optional: readonly CailPlatformLogFieldName[];
      }>)
  | (CailCustomEventDefinitionBase &
      Readonly<{
        source: "tenant" | "both";
        required: readonly CailTenantLogFieldName[];
        optional: readonly CailTenantLogFieldName[];
      }>);

export const CAIL_SERVICE_EVENT_BODY = "Service event recorded." as const;

type CailServiceEventDefinition<
  Definition extends CailCustomEventDefinition,
> = Readonly<{
  body: typeof CAIL_SERVICE_EVENT_BODY;
  source: Definition["source"];
  severity: Definition["severity"];
  required: Definition["required"];
  optional: Definition["optional"];
}> &
  (Definition extends {
    outcomes: infer Outcomes extends readonly CailOutcome[];
  }
    ? Readonly<{ outcomes: Outcomes }>
    : Readonly<{ outcomes?: never }>) &
  (Definition extends {
    terminal_reasons: infer Reasons extends readonly CailTerminalReason[];
  }
    ? Readonly<{ terminal_reasons: Reasons }>
    : Readonly<{ terminal_reasons?: never }>);

type CailServiceEventCatalog<
  Catalog extends Record<string, CailCustomEventDefinition>,
> = Readonly<{
  [Event in keyof Catalog]: CailServiceEventDefinition<Catalog[Event]>;
}>;

export type CailEventCatalog = Readonly<
  Record<string, CailEventDefinition>
>;

export const CAIL_TENANT_FIELD_NAMES = Object.freeze([
  "request_id",
  "action_id",
  "call_id",
  "trace",
  "http_method",
  "route",
  "status",
  "terminal",
  "duration_ms",
  "upstream_ms",
  "error_type",
  "retry_count",
  "req_bytes",
  "resp_bytes",
] as const satisfies readonly CailTenantLogFieldName[]);

export const CAIL_PLATFORM_ONLY_FIELD_NAMES = Object.freeze([
  "usage_id",
  "principal",
  "cohort",
  "key_id",
  "product_id",
  "project",
  "provider",
  "request_model",
  "response_model",
  "input_tokens",
  "output_tokens",
  "cost_micro_usd",
  "quota",
  "usage",
] as const satisfies readonly Exclude<
  CailPlatformLogFieldName,
  CailTenantLogFieldName
>[]);

export const CAIL_PLATFORM_FIELD_NAMES = Object.freeze([
  ...CAIL_TENANT_FIELD_NAMES,
  ...CAIL_PLATFORM_ONLY_FIELD_NAMES,
] as const satisfies readonly CailPlatformLogFieldName[]);

export const CAIL_EVENTS = Object.freeze({
  ACTION_ADMITTED: "cail.action.admitted",
  ACTION_TERMINAL: "cail.action.terminal",
  REQUEST_RECEIVED: "cail.request.received",
  REQUEST_COMPLETED: "cail.request.completed",
  AUTH_DENIED: "cail.auth.denied",
  QUOTA_CHARGED: "cail.quota.charged",
  UPSTREAM_ERROR: "cail.upstream.error",
  MODEL_CALL_ADMITTED: "cail.model.call.admitted",
  MODEL_CALL_TERMINAL: "cail.model.call.terminal",
  SANDBOX_USAGE_SETTLED: "cail.sandbox.usage.settled",
} as const);

export type CailEventName = (typeof CAIL_EVENTS)[keyof typeof CAIL_EVENTS];

export const SLUG_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
export const MACHINE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const MODEL_ID_RE =
  /^(?:@[a-z0-9][a-z0-9._-]{0,31}\/)?[a-z0-9][a-z0-9._:/-]{0,95}$/;
export const SUBJECT_VERSION_RE = /^[a-z0-9][a-z0-9_]{0,15}$/;
export const SUBJECT_RE = /^cail-[a-z0-9][a-z0-9_]{0,15}-[0-9a-f]{32}$/;
export const REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const HEX_TRACE_RE = /^[0-9a-f]{32}$/;
export const HEX_SPAN_RE = /^[0-9a-f]{16}$/;
export const ROUTE_TEMPLATE_RE =
  /^\/(?:$|(?:(?:[A-Za-z0-9._~-]+|\{[A-Za-z][A-Za-z0-9_]*\})(?:\/(?:[A-Za-z0-9._~-]+|\{[A-Za-z][A-Za-z0-9_]*\}))*\/?))$/;
export const HTTP_METHODS: readonly CailHttpMethod[] = Object.freeze([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
  "_OTHER",
]);

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const MAX_CATALOG_MESSAGE = 160;
const VALIDATED_EVENT_CATALOGS = new WeakSet<object>();

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildEventCatalog<
  const Catalog extends Record<string, CailEventDefinition>,
>(
  catalog: Catalog,
  allowReservedCailNamespace: boolean,
): Readonly<Catalog> {
  if (!isPlainObject(catalog)) {
    throw new TypeError("cail-log: event catalog must be an object");
  }

  const copy = Object.create(null) as Record<string, CailEventDefinition>;
  const tenantFields = new Set<string>(CAIL_TENANT_FIELD_NAMES);
  const platformFields = new Set<string>(CAIL_PLATFORM_FIELD_NAMES);
  const outcomes = new Set<string>([
    "ok",
    "client_error",
    "error",
    "denied",
    "cancelled",
    "timeout",
    "outcome_unknown",
  ] satisfies CailOutcome[]);
  const terminalReasons = new Set<string>([
    "application_failure",
    "cancelled",
    "client_error",
    "completed",
    "denied",
    "quota_blocked",
    "rate_limited",
    "timeout",
    "unknown",
    "upstream_failure",
  ] satisfies CailTerminalReason[]);
  const sources = new Set<string>(["platform", "tenant", "both"]);
  const severities = new Set<string>([
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "outcome",
  ]);

  for (const event of Object.keys(catalog)) {
    if (
      event === CAIL_EVENT_INVALID ||
      (!allowReservedCailNamespace && event.startsWith("cail.")) ||
      isSecretShaped(event) ||
      !SLUG_RE.test(event)
    ) {
      throw new TypeError(
        "cail-log: every catalog event must be a non-reserved event slug",
      );
    }
    const definition = catalog[event];
    if (!isPlainObject(definition)) {
      throw new TypeError("cail-log: every event definition must be an object");
    }
    const message = definition.body;
    if (
      typeof message !== "string" ||
      message === "" ||
      message !== message.trim() ||
      message.length > MAX_CATALOG_MESSAGE ||
      CONTROL_RE.test(message)
    ) {
      throw new TypeError(
        "cail-log: every catalog message must be a single static line of 1-160 characters",
      );
    }
    if (!sources.has(definition.source)) {
      throw new TypeError("cail-log: event source must be platform, tenant, or both");
    }
    if (!severities.has(definition.severity)) {
      throw new TypeError("cail-log: event severity is invalid");
    }
    if (!Array.isArray(definition.required) || !Array.isArray(definition.optional)) {
      throw new TypeError(
        "cail-log: event required and optional fields must be arrays",
      );
    }

    const allowedFields =
      definition.source === "platform" ? platformFields : tenantFields;
    const required = [...definition.required];
    const optional = [...definition.optional];
    const combined = [...required, ...optional];
    if (
      combined.some(
        (field) => typeof field !== "string" || !allowedFields.has(field),
      ) ||
      new Set(combined).size !== combined.length
    ) {
      throw new TypeError(
        "cail-log: event fields must be valid, unique, and source-compatible",
      );
    }
    if (definition.severity === "outcome" && !required.includes("terminal")) {
      throw new TypeError(
        "cail-log: outcome severity requires the terminal field",
      );
    }

    const allowedOutcomes = definition.outcomes
      ? [...definition.outcomes]
      : undefined;
    if (
      allowedOutcomes !== undefined &&
      (allowedOutcomes.length === 0 ||
        !required.includes("terminal") ||
        new Set(allowedOutcomes).size !== allowedOutcomes.length ||
        allowedOutcomes.some((outcome) => !outcomes.has(outcome)))
    ) {
      throw new TypeError("cail-log: event outcomes are invalid");
    }

    const allowedReasons = definition.terminal_reasons
      ? [...definition.terminal_reasons]
      : undefined;
    if (
      allowedReasons !== undefined &&
      (allowedReasons.length === 0 ||
        !required.includes("terminal") ||
        new Set(allowedReasons).size !== allowedReasons.length ||
        allowedReasons.some((reason) => !terminalReasons.has(reason)))
    ) {
      throw new TypeError("cail-log: event terminal reasons are invalid");
    }

    const reasonsByOutcome: Readonly<Record<CailOutcome, readonly CailTerminalReason[]>> = {
      ok: ["completed"],
      client_error: ["client_error"],
      error: ["application_failure", "upstream_failure"],
      denied: ["denied", "quota_blocked", "rate_limited"],
      cancelled: ["cancelled"],
      timeout: ["timeout"],
      outcome_unknown: ["unknown"],
    };
    if (
      allowedOutcomes !== undefined &&
      allowedReasons !== undefined &&
      (allowedOutcomes.some(
        (outcome) =>
          !allowedReasons.some((reason) =>
            reasonsByOutcome[outcome]!.includes(reason),
          ),
      ) ||
        allowedReasons.some(
          (reason) =>
            !allowedOutcomes.some((outcome) =>
              reasonsByOutcome[outcome]!.includes(reason),
            ),
        ))
    ) {
      throw new TypeError(
        "cail-log: event outcomes and terminal reasons are incompatible",
      );
    }

    const possibleOutcomes = (allowedOutcomes ?? [...outcomes]).filter(
      (outcome): outcome is CailOutcome => outcomes.has(outcome),
    );
    const possibleReasons = new Set<CailTerminalReason>(
      (allowedReasons ?? [...terminalReasons]).filter(
        (reason): reason is CailTerminalReason => terminalReasons.has(reason),
      ),
    );
    const possibleTerminalOutcomes = possibleOutcomes.filter((outcome) =>
      reasonsByOutcome[outcome].some((reason) => possibleReasons.has(reason)),
    );
    if (
      required.includes("terminal") &&
      required.includes("error_type") &&
      possibleTerminalOutcomes.length > 0 &&
      possibleTerminalOutcomes.every((outcome) => outcome === "ok")
    ) {
      throw new TypeError(
        "cail-log: a required error type is incompatible with every allowed terminal fact",
      );
    }

    const frozen: CailEventDefinition = {
      body: message,
      source: definition.source,
      severity: definition.severity,
      required: Object.freeze(required),
      optional: Object.freeze(optional),
    };
    if (allowedOutcomes !== undefined) {
      (frozen as { outcomes?: readonly CailOutcome[] }).outcomes =
        Object.freeze(allowedOutcomes);
    }
    if (allowedReasons !== undefined) {
      (frozen as { terminal_reasons?: readonly CailTerminalReason[] })
        .terminal_reasons = Object.freeze(allowedReasons);
    }
    copy[event] = Object.freeze(frozen);
  }
  if (Object.keys(copy).length === 0) {
    throw new TypeError("cail-log: event catalog must not be empty");
  }
  const frozenCatalog = Object.freeze(copy) as Readonly<Catalog>;
  VALIDATED_EVENT_CATALOGS.add(frozenCatalog);
  return frozenCatalog;
}

export function defineEventCatalog<
  const Catalog extends Record<string, CailCustomEventDefinition>,
>(
  catalog: Catalog & {
    readonly [Event in keyof Catalog]: Readonly<{ body?: never }>;
  },
): CailServiceEventCatalog<Catalog> {
  if (!isPlainObject(catalog)) {
    throw new TypeError("cail-log: event catalog must be an object");
  }
  const withBodies = Object.create(null) as Record<
    string,
    CailEventDefinition
  >;
  for (const [event, value] of Object.entries(catalog)) {
    if (!isPlainObject(value) || Object.hasOwn(value, "body")) {
      throw new TypeError(
        "cail-log: service event bodies are fixed by the library",
      );
    }
    withBodies[event] = {
      ...value,
      body: CAIL_SERVICE_EVENT_BODY,
    } as CailEventDefinition;
  }
  return buildEventCatalog(
    withBodies,
    false,
  ) as CailServiceEventCatalog<Catalog>;
}

export function isDefinedEventCatalog(value: unknown): value is CailEventCatalog {
  return (
    typeof value === "object" &&
    value !== null &&
    VALIDATED_EVENT_CATALOGS.has(value)
  );
}

export const CAIL_EVENT_CATALOG = buildEventCatalog({
  [CAIL_EVENTS.ACTION_ADMITTED]: {
    body: "Action admitted.", source: "platform", severity: "info",
    required: ["action_id", "product_id", "principal"],
    optional: ["request_id", "trace", "cohort", "key_id", "project", "http_method", "route"],
  },
  [CAIL_EVENTS.ACTION_TERMINAL]: {
    body: "Action reached a terminal state.", source: "platform", severity: "outcome",
    required: ["action_id", "product_id", "principal", "terminal", "duration_ms"],
    optional: ["request_id", "trace", "cohort", "key_id", "project", "http_method", "route", "error_type", "retry_count"],
  },
  [CAIL_EVENTS.REQUEST_RECEIVED]: {
    body: "Request received.", source: "platform", severity: "info",
    required: ["request_id", "product_id", "http_method", "route"],
    optional: ["trace", "principal", "cohort", "key_id", "project", "req_bytes"],
  },
  [CAIL_EVENTS.REQUEST_COMPLETED]: {
    body: "Request completed.", source: "platform", severity: "outcome",
    required: ["request_id", "product_id", "http_method", "route", "status", "terminal", "duration_ms"],
    optional: ["action_id", "call_id", "trace", "principal", "cohort", "key_id", "project", "upstream_ms", "error_type", "retry_count", "req_bytes", "resp_bytes"],
  },
  [CAIL_EVENTS.AUTH_DENIED]: {
    body: "Authentication or authorization denied.", source: "platform", severity: "warn",
    required: ["request_id", "product_id", "principal", "http_method", "route", "status", "terminal"],
    optional: ["trace", "cohort", "project", "error_type"],
    outcomes: ["denied"], terminal_reasons: ["denied"],
  },
  [CAIL_EVENTS.QUOTA_CHARGED]: {
    body: "Quota charged.", source: "platform", severity: "info",
    required: ["product_id", "principal", "terminal", "quota"],
    optional: ["request_id", "action_id", "call_id", "trace", "cohort", "key_id", "project"],
    outcomes: ["ok"], terminal_reasons: ["completed"],
  },
  [CAIL_EVENTS.UPSTREAM_ERROR]: {
    body: "Upstream provider call failed.", source: "platform", severity: "error",
    required: ["request_id", "product_id", "terminal", "error_type"],
    optional: ["action_id", "call_id", "trace", "principal", "cohort", "project", "provider", "request_model", "response_model", "status", "duration_ms", "upstream_ms", "retry_count"],
    outcomes: ["error", "timeout", "outcome_unknown"],
    terminal_reasons: ["upstream_failure", "timeout", "unknown"],
  },
  [CAIL_EVENTS.MODEL_CALL_ADMITTED]: {
    body: "Model call admitted.", source: "platform", severity: "info",
    required: ["call_id", "action_id", "product_id", "principal", "provider", "request_model"],
    optional: ["request_id", "trace", "cohort", "key_id", "project", "quota"],
  },
  [CAIL_EVENTS.MODEL_CALL_TERMINAL]: {
    body: "Model call reached a terminal state.", source: "platform", severity: "outcome",
    required: ["call_id", "action_id", "product_id", "principal", "provider", "request_model", "terminal", "duration_ms"],
    optional: ["request_id", "trace", "cohort", "key_id", "project", "response_model", "input_tokens", "output_tokens", "cost_micro_usd", "quota", "status", "upstream_ms", "error_type", "retry_count"],
  },
  [CAIL_EVENTS.SANDBOX_USAGE_SETTLED]: {
    body: "Sandbox usage settled.", source: "platform", severity: "info",
    required: ["usage_id", "product_id", "principal", "terminal", "usage"],
    optional: ["request_id", "action_id", "trace", "cohort", "key_id", "project", "quota", "duration_ms", "retry_count"],
    outcomes: ["ok"], terminal_reasons: ["completed"],
  },
}, true);

export function extendCailEventCatalog<
  const Catalog extends Record<string, CailCustomEventDefinition>,
>(
  catalog: Catalog & {
    readonly [Event in keyof Catalog]: Readonly<{ body?: never }>;
  },
): Readonly<typeof CAIL_EVENT_CATALOG & CailServiceEventCatalog<Catalog>> {
  const serviceCatalog = defineEventCatalog(catalog);
  const combined = Object.assign(
    Object.create(null) as Record<string, CailEventDefinition>,
    CAIL_EVENT_CATALOG,
    serviceCatalog,
  );
  const frozen = Object.freeze(combined);
  VALIDATED_EVENT_CATALOGS.add(frozen);
  return frozen as Readonly<
    typeof CAIL_EVENT_CATALOG & CailServiceEventCatalog<Catalog>
  >;
}
