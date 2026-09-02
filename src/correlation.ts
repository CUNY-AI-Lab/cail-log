import {
  HEX_SPAN_RE,
  HEX_TRACE_RE,
  REQUEST_ID_RE,
} from "./schema.js";
import {
  booleanFrom,
  callableFrom,
  numberFrom,
  stringFrom,
} from "./internal.js";

export const TRACEPARENT_HEADER = "traceparent";
export const TRACESTATE_HEADER = "tracestate";
export const CAIL_REQUEST_ID_HEADER = "x-cail-request-id";

export interface CailCorrelation {
  trace_id: string;
  span_id: string;
  trace_flags: 0 | 1;
  request_id: string;
  tracestate?: string;
}

export interface CailCorrelationOptions {
  sampled?: boolean;
}

export interface CailHeadersLike {
  get(name: string): string | null;
}

export type CailOutboundCorrelationHeaders = Record<string, string> & {
  [TRACEPARENT_HEADER]: string;
  [CAIL_REQUEST_ID_HEADER]: string;
  [TRACESTATE_HEADER]?: string;
};

const TRACEPARENT_RE =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

const TRACESTATE_MAX_CHARS = 512;
const TRACESTATE_MAX_MEMBERS = 32;
const TRACESTATE_KEY_RE =
  /^(?:[a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})$/;
const TRACESTATE_VALUE_RE =
  /^[\x20-\x2b\x2d-\x3c\x3e-\x7e]{0,255}[\x21-\x2b\x2d-\x3c\x3e-\x7e]$/;

function sanitizeTracestate<Value>(raw: Value): string | undefined {
  const text = stringFrom(raw);
  if (text === undefined) return undefined;
  if (text.length > TRACESTATE_MAX_CHARS) return undefined;

  const rawMembers = text.split(",");
  if (rawMembers.length > TRACESTATE_MAX_MEMBERS) return undefined;

  const members: string[] = [];
  const keys = new Set<string>();
  for (const rawMember of rawMembers) {
    const member = rawMember.replace(/^[ \t]+|[ \t]+$/g, "");
    if (member === "") continue;
    const equals = member.indexOf("=");
    if (equals <= 0 || equals === member.length - 1) return undefined;
    const key = member.slice(0, equals);
    const value = member.slice(equals + 1);
    if (
      !TRACESTATE_KEY_RE.test(key) ||
      !TRACESTATE_VALUE_RE.test(value) ||
      keys.has(key)
    ) {
      return undefined;
    }
    keys.add(key);
    members.push(member);
  }
  return members.length === 0 ? undefined : members.join(",");
}

function randomBytes(bytes: number): Uint8Array {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return buffer;
}

function randomHex(bytes: number): string {
  let output = "";
  for (const byte of randomBytes(bytes)) {
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
}

function mintRequestId(): string {
  return crypto.randomUUID();
}

function readHeader(
  source: CailHeadersLike | { headers: CailHeadersLike },
  name: string,
): string | null {
  try {
    const owner = "headers" in source ? source.headers : source;
    const read = owner.get;
    return callableFrom(read) === undefined ? null : read.call(owner, name);
  } catch {
    return null;
  }
}

export function correlationFromHeaders(
  source: CailHeadersLike | { headers: CailHeadersLike },
  options: CailCorrelationOptions = {},
): CailCorrelation {
  let traceId: string | undefined;
  let inboundTraceFlags: 0 | 1 | undefined;
  let requestId: string | undefined;
  let tracestate: string | undefined;
  const sampled = booleanFrom(options.sampled);

  const rawTraceparent = stringFrom(readHeader(source, TRACEPARENT_HEADER));
  const rawTracestate = readHeader(source, TRACESTATE_HEADER);
  const rawRequestId = stringFrom(readHeader(source, CAIL_REQUEST_ID_HEADER));

  if (rawTraceparent !== undefined) {
    const match = TRACEPARENT_RE.exec(rawTraceparent.trim());
    if (
      match &&
      match[1] !== "ff" &&
      !(match[1] === "00" && match[5] !== undefined) &&
      match[2] !== ZERO_TRACE &&
      match[3] !== ZERO_SPAN
    ) {
      traceId = match[2];
      // SAFETY: a bitwise AND with one can produce only zero or one.
      inboundTraceFlags = (Number.parseInt(match[4]!, 16) & 1) as 0 | 1;
    }
  }

  if (traceId !== undefined) {
    tracestate = sanitizeTracestate(rawTracestate);
  }
  if (rawRequestId !== undefined) {
    const candidate = rawRequestId.trim();
    if (REQUEST_ID_RE.test(candidate)) requestId = candidate;
  }

  const correlation: CailCorrelation = {
    trace_id: traceId ?? randomHex(16),
    span_id: randomHex(8),
    trace_flags:
      sampled !== undefined
        ? sampled
          ? 1
          : 0
        : (inboundTraceFlags ?? 0),
    request_id: requestId ?? mintRequestId(),
  };
  if (tracestate !== undefined) correlation.tracestate = tracestate;
  return correlation;
}

export function outboundCorrelationHeaders(
  correlation: CailCorrelation,
): CailOutboundCorrelationHeaders {
  const decodedTraceId = stringFrom(correlation.trace_id);
  if (
    decodedTraceId === undefined ||
    !HEX_TRACE_RE.test(decodedTraceId) ||
    decodedTraceId === ZERO_TRACE
  ) {
    throw new TypeError(
      "cail-log: trace_id must be 32 lowercase hex chars, not all-zero",
    );
  }
  const decodedSpanId = stringFrom(correlation.span_id);
  if (
    decodedSpanId === undefined ||
    !HEX_SPAN_RE.test(decodedSpanId) ||
    decodedSpanId === ZERO_SPAN
  ) {
    throw new TypeError(
      "cail-log: span_id must be 16 lowercase hex chars, not all-zero",
    );
  }
  const decodedRequestId = stringFrom(correlation.request_id);
  if (
    decodedRequestId === undefined ||
    !REQUEST_ID_RE.test(decodedRequestId)
  ) {
    throw new TypeError(
      "cail-log: request_id must be a lowercase UUID v4 or v7",
    );
  }
  const decodedTraceFlags = numberFrom(correlation.trace_flags);
  if (decodedTraceFlags !== 0 && decodedTraceFlags !== 1) {
    throw new TypeError("cail-log: trace_flags must be 0 or 1");
  }
  const decodedTracestate = correlation.tracestate === undefined
    ? undefined
    : stringFrom(correlation.tracestate);
  if (
    correlation.tracestate !== undefined &&
    (decodedTracestate === undefined ||
      sanitizeTracestate(decodedTracestate) !== decodedTracestate)
  ) {
    throw new TypeError(
      "cail-log: tracestate must be a structurally valid W3C tracestate list",
    );
  }

  const headers: CailOutboundCorrelationHeaders = {
    [TRACEPARENT_HEADER]: `00-${decodedTraceId}-${decodedSpanId}-0${decodedTraceFlags}`,
    [CAIL_REQUEST_ID_HEADER]: decodedRequestId,
  };
  if (decodedTracestate !== undefined)
    headers[TRACESTATE_HEADER] = decodedTracestate;
  return headers;
}
