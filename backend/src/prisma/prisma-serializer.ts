function isDecimalLike(value: unknown): value is { toNumber(): number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function' &&
    value.constructor?.name === 'Decimal'
  );
}

export function serializePrisma<T>(value: unknown): T {
  if (Array.isArray(value)) {
    return value.map((item) => serializePrisma(item)) as T;
  }

  if (isDecimalLike(value)) {
    return value.toNumber() as T;
  }

  if (value instanceof Date || value === null || typeof value !== 'object') {
    return value as T;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      serializePrisma(nestedValue),
    ]),
  ) as T;
}
