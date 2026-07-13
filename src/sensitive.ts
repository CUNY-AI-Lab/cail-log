const REDACTED = "[REDACTED]";

const inspectSymbol: unique symbol = Symbol.for(
  "nodejs.util.inspect.custom",
) as never;

export class Sensitive<Value> {
  readonly #value: Value;

  constructor(value: Value) {
    this.#value = value;
  }

  get value(): Value {
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

export function sensitive<Value>(value: Value): Sensitive<Value> {
  return new Sensitive(value);
}

export function isSensitive(value: unknown): value is Sensitive<unknown> {
  return value instanceof Sensitive;
}
