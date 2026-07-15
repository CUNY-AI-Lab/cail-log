import type { CailLogEvent } from "./schema.js";

const VALIDATED_EVENTS = new WeakSet<object>();

export function markValidatedEvent(event: CailLogEvent): CailLogEvent {
  VALIDATED_EVENTS.add(event);
  return event;
}

export function assertValidatedEvent(event: CailLogEvent): void {
  if (
    typeof event !== "object" ||
    event === null ||
    !VALIDATED_EVENTS.has(event)
  ) {
    throw new TypeError(
      "cail-log: sinks accept only events produced by createCailLogger",
    );
  }
}
