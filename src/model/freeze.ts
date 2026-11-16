function refuseChange(): never {
  throw new TypeError("Yards and motion are immutable; build a new one instead.");
}

function deepFreeze(value: unknown) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      deepFreeze(key);
      deepFreeze(entry);
    }
    // Object.freeze doesn't stop Map methods, so replace them on this instance.
    for (const method of ["set", "delete", "clear"]) {
      Object.defineProperty(value, method, { value: refuseChange });
    }
  } else {
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  Object.freeze(value);
}

/**
 * Deep-freezes yards and motion in development and tests, so accidental in-place changes throw.
 * Already-frozen parts are skipped, so structure shared with an earlier yard costs nothing.
 * Production builds skip this entirely.
 */
export function frozen<T>(value: T): T {
  if (import.meta.env.DEV) deepFreeze(value);
  return value;
}
