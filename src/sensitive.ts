const REDACTED = "[REDACTED]";

// SAFETY: Symbol.for returns a symbol; the assertion supplies the unique
// compile-time identity required for a computed class method name.
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

export function isSensitive<Value>(
  value: Value,
): value is Value & Sensitive<Value> {
  return value instanceof Sensitive;
}
